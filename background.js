importScripts("utils.js");

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("refreshAssignments", { delayInMinutes: 30, periodInMinutes: 30 });
  chrome.alarms.create("checkDeadlines", { delayInMinutes: 5, periodInMinutes: 60 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "refreshAssignments") {
    const data = await chrome.storage.local.get(["sesskey", "lastFetched"]);
    // Only auto-refresh if we have a sesskey AND have fetched before (user used the extension at least once)
    if (data.sesskey && data.lastFetched) {
      try {
        const result = await fetchAllPendingAssignments(data.sesskey);
        await chrome.storage.local.set({ assignments: result.pending, courseProgress: result.courseProgress, lastFetched: Date.now() });
      } catch (e) {
        console.warn("Auto refresh skipped:", e?.message || JSON.stringify(e));
      }
    }
  }

  if (alarm.name === "checkDeadlines") {
    await checkAndNotify();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  
  if (request.action === "setSesskey") {
    chrome.storage.local.set({ sesskey: request.sesskey }).then(async () => {
       if (request.userName) {
          await chrome.storage.local.set({ userInfo: { fullName: request.userName } });
       }
       sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === "getAssignments") {
    (async () => {
      try {
        const data = await chrome.storage.local.get(["assignments", "lastFetched", "sesskey"]);
        if (!data.sesskey) {
           sendResponse({ success: false, error: { code: "not_logged_in", message: "Not logged in" } });
           return;
        }
        // Use cache if less than 30 mins old
        if (data.assignments && data.lastFetched && (Date.now() - data.lastFetched < 1800000)) {
          const cpData = await chrome.storage.local.get("courseProgress");
          sendResponse({ success: true, assignments: data.assignments, courseProgress: cpData.courseProgress });
        } else {
          const freshData = await fetchAllPendingAssignments(data.sesskey);
          await chrome.storage.local.set({ assignments: freshData.pending, courseProgress: freshData.courseProgress, lastFetched: Date.now() });
          sendResponse({ success: true, assignments: freshData.pending, courseProgress: freshData.courseProgress });
        }
      } catch (error) {
        sendResponse({ success: false, error: error });
      }
    })();
    return true;
  }

  if (request.action === "forceRefresh") {
      (async () => {
          try {
              const data = await chrome.storage.local.get("sesskey");
              if (!data.sesskey) {
                 sendResponse({ success: false, error: { code: "not_logged_in", message: "Not logged in" } });
                 return;
              }
              const freshData = await fetchAllPendingAssignments(data.sesskey);
              await chrome.storage.local.set({ assignments: freshData.pending, courseProgress: freshData.courseProgress, lastFetched: Date.now() });
              sendResponse({ success: true, assignments: freshData.pending, courseProgress: freshData.courseProgress });
          } catch (error) {
              sendResponse({ success: false, error: error });
          }
      })();
      return true;
  }

  if (request.action === "getStatus") {
    chrome.storage.local.get(["sesskey", "userInfo", "lastFetched"]).then((data) => {
      sendResponse({
        loggedIn: !!data.sesskey,
        user: data.userInfo,
        lastFetched: data.lastFetched
      });
    });
    return true;
  }

  if (request.action === "updateNotificationSettings") {
    chrome.storage.local.set({ notificationSettings: request.settings }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === "getAttachments") {
    (async () => {
      try {
        // Step 1: Open the assignment page in a hidden tab
        const tab = await chrome.tabs.create({ url: request.url, active: false });
        
        // Step 2: Wait for the tab to finish loading
        await new Promise((resolve) => {
          const listener = (tabId, changeInfo) => {
            if (tabId === tab.id && changeInfo.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          // Safety timeout after 10 seconds
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }, 10000);
        });
        
        // Step 3: Inject script to find file links in the loaded page
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const links = [];
            // Look for all links that contain pluginfile.php
            document.querySelectorAll('a[href*="pluginfile.php"]').forEach(a => {
              const href = a.href;
              // Skip user icons, theme files, course overview images
              if (href.includes('/user/icon/') || href.includes('/theme/') || href.includes('/course/overviewfiles/')) return;
              
              let url = href;
              if (!url.includes('forcedownload=1')) {
                url += (url.includes('?') ? '&' : '?') + 'forcedownload=1';
              }
              if (!links.includes(url)) links.push(url);
            });
            
            // Also look for embedded resources like iframes/objects with PDFs
            document.querySelectorAll('object[data*="pluginfile.php"], iframe[src*="pluginfile.php"]').forEach(el => {
              const url = el.data || el.src;
              if (url && !links.includes(url)) links.push(url);
            });
            
            return links;
          }
        });
        
        // Step 4: Close the hidden tab
        chrome.tabs.remove(tab.id);
        
        const links = results && results[0] && results[0].result ? results[0].result : [];
        sendResponse({ success: true, links });
      } catch (err) {
        sendResponse({ success: false, error: err.toString() });
      }
    })();
    return true;
  }
});

async function fetchAjax(methodname, args, sesskey) {
  const payload = [{ index: 0, methodname, args }];
  const url = `${AJAX_ENDPOINT}?info=${methodname}&sesskey=${sesskey}`;
  
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (networkError) {
    // Network error (offline, DNS fail etc.) - do NOT clear sesskey
    throw { code: "network_error", message: "אין חיבור לרשת. נסה שוב מאוחר יותר." };
  }
  
  if (response.status === 403 || response.status === 401 || response.url.includes("login/index.php")) {
      handleAuthError();
  }

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    throw { code: "parse_error", message: "תגובה לא תקינה מ-Moodle" };
  }
  
  if (!data || data.length === 0) throw { code: "empty_response", message: "תגובה ריקה מ-Moodle" };
  
  if (data[0].error) {
      if (data[0].exception && (data[0].exception.errorcode === "invalidtoken" || data[0].exception.errorcode === "requireloginerror")) {
          handleAuthError();
      }
      throw { code: data[0].exception?.errorcode || "api_error", message: data[0].exception?.message || "שגיאת API" };
  }
  return data[0].data;
}

function handleAuthError() {
    chrome.storage.local.remove(["sesskey"]);
    throw { code: "not_logged_in", message: "החיבור למודל פג תוקף, יש לפתוח את מודל ולהתחבר מחדש" };
}

async function fetchAllPendingAssignments(sesskey) {
  const now = Math.floor(Date.now() / 1000);
  const timesortfrom = now - (14 * 86400); // 14 days ago
  
  const data = await fetchAjax("core_calendar_get_action_events_by_timesort", {
    timesortfrom: timesortfrom,
    limitnum: 50
  }, sesskey);
  
  if (!data || !data.events) return { pending: [], courseProgress: [] };
  
  const pending = [];
  const courseProgressMap = {};

  for (const event of data.events) {
    // Only assignments
    if (event.modulename !== "assign") continue;
    
    const courseId = event.course ? event.course.id : 0;
    const courseName = event.course ? event.course.fullname : "קורס כללי";
    
    if (!courseProgressMap[courseId]) {
      courseProgressMap[courseId] = { courseId, courseName, total: 0, submitted: 0 };
    }
    
    courseProgressMap[courseId].total++;

    // Check if it's actionable (meaning not submitted yet)
    if (event.action && event.action.actionable === false) {
       courseProgressMap[courseId].submitted++;
       continue;
    }

    pending.push({
      id: event.instance,
      cmid: event.instance, // We use instance id if cmid is missing, but url handles navigation
      name: event.name,
      courseName,
      courseId,
      duedate: event.timesort,
      cutoffdate: 0,
      url: event.url
    });
  }

  pending.sort((a, b) => {
    if (a.duedate === 0) return 1;
    if (b.duedate === 0) return -1;
    return a.duedate - b.duedate;
  });

  return { pending, courseProgress: Object.values(courseProgressMap) };
}

function getSmartReminders(duedate) {
  const now = Math.floor(Date.now() / 1000);
  const hoursLeft = (duedate - now) / 3600;
  if (hoursLeft > 168) return [72];                    // 7+ days -> 3 days
  if (hoursLeft > 72) return [24, 6];                  // 3-7 days -> 24h, 6h
  if (hoursLeft > 24) return [12, 3, 1];               // 1-3 days -> 12h, 3h, 1h
  return [6, 3, 1, 0.5];                               // < 24 hours -> 6h, 3h, 1h, 30m
}

async function checkAndNotify() {
  const data = await chrome.storage.local.get(["sesskey", "assignments", "notificationSettings", "notifiedMap"]);
  if (!data.sesskey || !data.assignments) return;

  const settings = data.notificationSettings || { enabled: true, smartMode: true, reminders: [24, 6, 1] };
  if (!settings.enabled) return;

  const notifiedMap = data.notifiedMap || {};
  const now = Math.floor(Date.now() / 1000);
  let mapUpdated = false;

  for (const assignment of data.assignments) {
    if (assignment.duedate === 0) continue;
    const hoursLeft = (assignment.duedate - now) / 3600;

    const currentReminders = settings.smartMode ? getSmartReminders(assignment.duedate) : settings.reminders;

    for (const reminderHours of currentReminders) {
      const key = `${assignment.id}_${reminderHours}h`;
      if (hoursLeft <= reminderHours && hoursLeft > 0 && !notifiedMap[key]) {
        let timeStr = hoursLeft < 2 ? "פחות משעתיים" : `${Math.floor(hoursLeft)} שעות`;
        if (hoursLeft < 1) {
             timeStr = "פחות משעה";
        }
        sendNotification(
          `⏰ ${assignment.name}`,
          `נשאר ${timeStr} להגשה!\nקורס: ${assignment.courseName}`,
          assignment.url
        );
        notifiedMap[key] = true;
        mapUpdated = true;
      }
    }
  }

  if (mapUpdated) {
    await chrome.storage.local.set({ notifiedMap });
  }
}

function sendNotification(title, message, url) {
  const notifId = `notif_${Date.now()}`;
  chrome.notifications.create(notifId, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: title,
    message: message,
    priority: 2,
    requireInteraction: true
  });
  
  // Store url for click handler
  chrome.storage.local.set({ [`url_${notifId}`]: url });
}

chrome.notifications.onClicked.addListener((notifId) => {
    chrome.storage.local.get(`url_${notifId}`).then(data => {
        const url = data[`url_${notifId}`];
        if (url) {
            chrome.tabs.create({ url: url });
            chrome.storage.local.remove(`url_${notifId}`);
        }
    });
});
