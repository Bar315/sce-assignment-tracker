let allAssignments = [];

document.addEventListener("DOMContentLoaded", async () => {
  const userName = document.getElementById("userName");
  const refreshBtn = document.getElementById("refreshBtn");
  const settingsBtn = document.getElementById("settingsBtn");
  
  const courseFilter = document.getElementById("courseFilter");
  const sortBy = document.getElementById("sortBy");
  
  const assignmentList = document.getElementById("assignmentList");
  const loadingState = document.getElementById("loadingState");
  const emptyState = document.getElementById("emptyState");
  const errorState = document.getElementById("errorState");
  const errorText = document.getElementById("errorText");
  const retryBtn = document.getElementById("retryBtn");
  const loginRequiredState = document.getElementById("loginRequiredState");
  const openMoodleBtn = document.getElementById("openMoodleBtn");
  
  const settingsPanel = document.getElementById("settingsPanel");
  const notifToggle = document.getElementById("notifToggle");
  const smartRemindersToggle = document.getElementById("smartRemindersToggle");
  const manualRemindersBlock = document.getElementById("manualRemindersBlock");
  const remind24h = document.getElementById("remind24h");
  const remind6h = document.getElementById("remind6h");
  const remind1h = document.getElementById("remind1h");
  const saveSettingsBtn = document.getElementById("saveSettingsBtn");
  const closeSettingsBtn = document.getElementById("closeSettingsBtn");

  const tabAssignments = document.getElementById("tabAssignments");
  const tabWorkload = document.getElementById("tabWorkload");
  const mainView = document.getElementById("mainView");
  const workloadView = document.getElementById("workloadView");
  const workloadChart = document.getElementById("workloadChart");

  const pendingCount = document.getElementById("pendingCount");
  const urgentCount = document.getElementById("urgentCount");
  const lastUpdated = document.getElementById("lastUpdated");

  // 1. בדיקת התחברות
  let response;
  try {
    response = await chrome.runtime.sendMessage({ action: "getStatus" });
  } catch (err) {
    // Service worker may not be ready yet
    response = null;
  }
  if (!response || !response.loggedIn) {
    showLoginRequired();
    return;
  } else {
    if (response.user) userName.textContent = response.user.fullName;
  }

  // 2. טעינת עבודות
  await loadAssignments();

  // 3. Event listeners
  refreshBtn.onclick = () => loadAssignments(true);
  
  settingsBtn.onclick = showSettings;
  closeSettingsBtn.onclick = hideSettings;
  saveSettingsBtn.onclick = saveSettings;
  
  smartRemindersToggle.onchange = () => {
    manualRemindersBlock.style.display = smartRemindersToggle.checked ? "none" : "block";
  };
  
  courseFilter.onchange = filterAndRender;
  sortBy.onchange = filterAndRender;
  retryBtn.onclick = () => loadAssignments(true);
  openMoodleBtn.onclick = () => chrome.tabs.create({ url: "https://moodle.sce.ac.il" });

  tabAssignments.onclick = () => {
    tabAssignments.classList.add("active");
    tabWorkload.classList.remove("active");
    mainView.style.display = "block";
    workloadView.style.display = "none";
  };
  
  tabWorkload.onclick = () => {
    tabWorkload.classList.add("active");
    tabAssignments.classList.remove("active");
    mainView.style.display = "none";
    workloadView.style.display = "block";
    renderWorkloadChart(allAssignments);
  };

  async function loadAssignments(forceRefresh = false, retries = 1) {
    showLoading();
    try {
      const action = forceRefresh ? "forceRefresh" : "getAssignments";
      const res = await chrome.runtime.sendMessage({ action });

      if (!res || !res.success) {
        if (res?.error?.code === "invalidtoken" || res?.error?.code === "not_logged_in" || res?.error?.code === "requireloginerror") {
          showLoginRequired();
          return;
        }
        showError(res?.error?.message || "שגיאה בטעינת נתונים");
        return;
      }

      allAssignments = res.assignments;
      populateCourseFilter(allAssignments);
      await updateStats(allAssignments);
      if (res.courseProgress) renderCourseProgress(res.courseProgress);
      filterAndRender();
    } catch (err) {
      if (retries > 0) {
        // Retry once after a short delay (helps if service worker was just waking up)
        setTimeout(() => loadAssignments(forceRefresh, retries - 1), 300);
      } else {
        console.error("loadAssignments error:", err);
        showError("שגיאה בחיבור לתוסף. נסה לרענן שוב.");
      }
    }
  }

  function populateCourseFilter(assignments) {
    const courses = [...new Set(assignments.map(a => a.courseName))];
    courseFilter.innerHTML = '<option value="all">כל הקורסים</option>';
    for (const courseName of courses) {
      const option = document.createElement("option");
      option.value = courseName;
      option.textContent = courseName;
      courseFilter.appendChild(option);
    }
  }

  function renderCourseProgress(courseProgress) {
    const section = document.getElementById('courseProgressSection');
    if (!courseProgress || courseProgress.length === 0) {
      section.style.display = 'none'; return;
    }
    section.style.display = 'block';
    section.innerHTML = courseProgress.map(cp => {
      const pct = cp.total > 0 ? Math.round((cp.submitted / cp.total) * 100) : 0;
      return `
        <div class="progress-row">
          <div class="progress-info">
            <span class="progress-course">${escapeHtml(cp.courseName)}</span>
            <span class="progress-fraction">${cp.submitted}/${cp.total}</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderWorkloadChart(assignments) {
    const weeks = [
      { label: 'השבוע', count: 0 },
      { label: 'שבוע הבא', count: 0 },
      { label: 'עוד שבועיים', count: 0 },
      { label: 'עוד 3 שבועות', count: 0 }
    ];
    
    const now = Math.floor(Date.now() / 1000);
    
    for (const a of assignments) {
       if (a.duedate === 0) continue;
       const daysLeft = (a.duedate - now) / 86400;
       if (daysLeft < 0) continue; // overdue
       if (daysLeft <= 7) weeks[0].count++;
       else if (daysLeft <= 14) weeks[1].count++;
       else if (daysLeft <= 21) weeks[2].count++;
       else if (daysLeft <= 28) weeks[3].count++;
    }
    
    const maxCount = Math.max(...weeks.map(w => w.count), 5); // baseline of 5
    
    const maxBarHeight = 120; // pixels
    
    workloadChart.innerHTML = weeks.map((w, i) => {
       const pct = maxCount > 0 ? (w.count / maxCount) : 0;
       
       let barClass = 'bar-green';
       if (i === 0 && w.count > 0) barClass = 'bar-red';
       else if (i === 1 && w.count > 0) barClass = 'bar-yellow';
       
       const barHeight = w.count === 0 ? 4 : Math.max(8, Math.round(pct * maxBarHeight));
       
       return `
         <div class="chart-bar-wrapper" style="animation-delay: ${i*0.1}s">
           <div class="chart-bar ${barClass}" style="height: ${barHeight}px"></div>
           <span class="chart-count">${w.count}</span>
           <span class="chart-label">${w.label}</span>
         </div>
       `;
    }).join('');
  }

  async function updateStats(assignments) {
    pendingCount.textContent = assignments.length;
    urgentCount.textContent = assignments.filter(a => {
      const remaining = getTimeRemaining(a.duedate);
      return remaining.urgency === "critical";
    }).length;

    const data = await chrome.storage.local.get("lastFetched");
    if (data.lastFetched) {
      const minutesAgo = Math.floor((Date.now() - data.lastFetched) / 60000);
      if (minutesAgo < 1) lastUpdated.textContent = "עכשיו";
      else if (minutesAgo < 60) lastUpdated.textContent = `לפני ${minutesAgo} דק׳`;
      else lastUpdated.textContent = `לפני ${Math.floor(minutesAgo/60)} שע׳`;
    }
  }

  function filterAndRender() {
    let filtered = [...allAssignments];

    // סינון לפי קורס
    if (courseFilter.value !== "all") {
      filtered = filtered.filter(a => a.courseName === courseFilter.value);
    }

    // מיון
    switch (sortBy.value) {
      case "duedate":
        filtered.sort((a, b) => {
           if (a.duedate === 0) return 1;
           if (b.duedate === 0) return -1;
           return a.duedate - b.duedate;
        });
        break;
      case "urgency":
        const urgencyOrder = { "critical": 1, "warning": 2, "ok": 3, "nodate": 4, "overdue": 5 };
        filtered.sort((a, b) => {
           const uA = urgencyOrder[getTimeRemaining(a.duedate).urgency];
           const uB = urgencyOrder[getTimeRemaining(b.duedate).urgency];
           if (uA !== uB) return uA - uB;
           // If same urgency, sort by duedate
           return a.duedate - b.duedate;
        });
        break;
      case "course":
        filtered.sort((a, b) => a.courseName.localeCompare(b.courseName));
        break;
    }

    renderAssignments(filtered);
  }

  function renderAssignments(assignments) {
    if (assignments.length === 0) {
      assignmentList.style.display = "none";
      loadingState.style.display = "none";
      emptyState.style.display = "flex";
      errorState.style.display = "none";
      loginRequiredState.style.display = "none";
      return;
    }

    assignmentList.style.display = "block";
    emptyState.style.display = "none";
    loadingState.style.display = "none";
    errorState.style.display = "none";
    loginRequiredState.style.display = "none";

    assignmentList.innerHTML = "";

    for (const assignment of assignments) {
      const remaining = getTimeRemaining(assignment.duedate);
      const statusText = getSubmissionStatusText(assignment.submissionStatus);

      const card = document.createElement("div");
      card.className = `assignment-card urgency-${remaining.urgency}`;
      card.onclick = () => chrome.tabs.create({ url: assignment.url });

      card.innerHTML = `
        <div class="assignment-name">
          📝 ${escapeHtml(assignment.name)}
        </div>
        <div class="assignment-course">
          📚 ${escapeHtml(assignment.courseName)}
        </div>
        <div class="assignment-meta">
          <span class="assignment-due">
            ${assignment.duedate ? '⏰ ' + formatHebrewDate(assignment.duedate) : ''}
          </span>
          <span class="assignment-countdown live-countdown countdown-${remaining.urgency}" data-deadline="${assignment.duedate || 0}">
            ${remaining.text}
          </span>
        </div>
        <div class="card-actions">
          <button class="action-btn cal-btn" title="הוסף ליומן Google" data-cal-url="${escapeHtml(buildGoogleCalendarUrl(assignment))}">📅 יומן</button>
          <button class="action-btn share-btn" title="שתף בוואטסאפ" data-wa-url="${escapeHtml(buildWhatsAppUrl(assignment))}">💬 שתף</button>
          <button class="action-btn attach-btn" title="הורד קבצים מצורפים" data-assign-url="${escapeHtml(assignment.url)}">📎 קבצים</button>
        </div>
      `;

      card.querySelectorAll('.cal-btn, .share-btn').forEach(btn => {
         btn.onclick = (e) => {
            e.stopPropagation();
            const target = e.target.closest('.action-btn');
            if (!target) return;
            const url = target.dataset.calUrl || target.dataset.waUrl;
            if (url) chrome.tabs.create({ url });
         };
      });

      const attachBtn = card.querySelector('.attach-btn');
      if (attachBtn) {
         attachBtn.onclick = async (e) => {
            e.stopPropagation();
            const originalText = attachBtn.textContent;
            attachBtn.textContent = '⏳ ...';
            const url = attachBtn.dataset.assignUrl;
            const res = await chrome.runtime.sendMessage({ action: "getAttachments", url });
            attachBtn.textContent = originalText;
            
            if (res && res.success && res.links && res.links.length > 0) {
               res.links.forEach(link => chrome.tabs.create({ url: link, active: false }));
            } else {
               alert("לא נמצאו קבצים מצורפים. פותח את דף המטלה במקום.");
               chrome.tabs.create({ url: url });
            }
         };
      }

      assignmentList.appendChild(card);
    }
    
    startCountdownTimers();
  }

  let countdownInterval = null;
  function startCountdownTimers() {
    if (countdownInterval) clearInterval(countdownInterval);
    
    const updateTimers = () => {
      document.querySelectorAll('.live-countdown').forEach(el => {
        const deadline = parseInt(el.dataset.deadline);
        if (!deadline) return;
        
        const parts = getCountdownParts(deadline);
        if (parts.isOverdue) {
          el.textContent = 'עבר הזמן!';
          el.className = 'assignment-countdown live-countdown countdown-overdue';
        } else {
          const dd = String(parts.days).padStart(2, '0');
          const hh = String(parts.hours).padStart(2, '0');
          const mm = String(parts.minutes).padStart(2, '0');
          const ss = String(parts.seconds).padStart(2, '0');
          
          if (parts.days > 0) {
              el.textContent = `${dd}:${hh}:${mm}:${ss}`;
          } else {
              el.textContent = `${hh}:${mm}:${ss}`;
          }
        }
      });
    };
    
    updateTimers(); // immediate update
    countdownInterval = setInterval(updateTimers, 1000);
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function showLoading() {
    assignmentList.style.display = "none";
    loadingState.style.display = "flex";
    emptyState.style.display = "none";
    errorState.style.display = "none";
    loginRequiredState.style.display = "none";
  }

  function showError(msg) {
    assignmentList.style.display = "none";
    loadingState.style.display = "none";
    emptyState.style.display = "none";
    errorState.style.display = "flex";
    loginRequiredState.style.display = "none";
    errorText.textContent = msg;
  }

  function showLoginRequired() {
    assignmentList.style.display = "none";
    loadingState.style.display = "none";
    emptyState.style.display = "none";
    errorState.style.display = "none";
    loginRequiredState.style.display = "flex";
  }

  async function showSettings() {
    settingsPanel.style.display = "block";
    const data = await chrome.storage.local.get("notificationSettings");
    if (data.notificationSettings) {
      notifToggle.checked = data.notificationSettings.enabled;
      smartRemindersToggle.checked = data.notificationSettings.smartMode !== false;
      remind24h.checked = data.notificationSettings.reminders.includes(24);
      remind6h.checked = data.notificationSettings.reminders.includes(6);
      remind1h.checked = data.notificationSettings.reminders.includes(1);
      manualRemindersBlock.style.display = smartRemindersToggle.checked ? "none" : "block";
    }
  }

  function hideSettings() {
    settingsPanel.style.display = "none";
  }

  async function saveSettings() {
    const reminders = [];
    if (remind24h.checked) reminders.push(24);
    if (remind6h.checked) reminders.push(6);
    if (remind1h.checked) reminders.push(1);

    const settings = { 
      enabled: notifToggle.checked, 
      smartMode: smartRemindersToggle.checked,
      reminders 
    };
    await chrome.runtime.sendMessage({
      action: "updateNotificationSettings",
      settings
    });
    hideSettings();
  }
});
