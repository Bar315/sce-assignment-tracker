const MOODLE_BASE_URL = "https://moodle.sce.ac.il";
const AJAX_ENDPOINT = `${MOODLE_BASE_URL}/lib/ajax/service.php`;

function formatHebrewDate(unixTimestamp) {
  if (!unixTimestamp) return "";
  const date = new Date(unixTimestamp * 1000);
  const months = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  
  return `${day} ב${month} ${year}, ${hours}:${minutes}`;
}

function getTimeRemaining(unixTimestamp) {
  if (unixTimestamp === 0) return { text: "ללא תאריך הגשה", urgency: "nodate" };
  
  const now = Math.floor(Date.now() / 1000);
  const diff = unixTimestamp - now;
  
  if (diff < 0) {
    return { text: "עבר מועד ההגשה", urgency: "overdue" };
  }
  
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  
  if (days === 0 && hours === 0) {
    return { text: `עוד ${minutes} דקות`, urgency: "critical" };
  }
  if (days === 0) {
    return { text: `עוד ${hours} שעות ו-${minutes} דקות`, urgency: "critical" };
  }
  if (days === 1) {
    return { text: `מחר (עוד ${hours} שעות)`, urgency: "critical" };
  }
  if (days === 2) {
    return { text: `עוד יומיים`, urgency: "warning" };
  }
  if (days <= 7) {
    return { text: `עוד ${days} ימים`, urgency: "warning" };
  }
  return { text: `עוד ${days} ימים`, urgency: "ok" };
}

function getCountdownParts(unixTimestamp) {
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, unixTimestamp - now);
  return {
    days: Math.floor(diff / 86400),
    hours: Math.floor((diff % 86400) / 3600),
    minutes: Math.floor((diff % 3600) / 60),
    seconds: diff % 60,
    isOverdue: unixTimestamp - now < 0,
    totalSeconds: diff
  };
}

function buildGoogleCalendarUrl(assignment) {
  const title = encodeURIComponent(`📝 הגשה: ${assignment.name}`);
  const details = encodeURIComponent(`קורס: ${assignment.courseName}\nקישור: ${assignment.url}`);
  const dueDate = new Date(assignment.duedate * 1000);
  const endDate = new Date(assignment.duedate * 1000);
  const startDate = new Date(dueDate.getTime() - (60 * 60 * 1000));
  const fmt = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${fmt(startDate)}/${fmt(endDate)}&details=${details}&sf=true`;
}

function buildWhatsAppUrl(assignment) {
  const remaining = getTimeRemaining(assignment.duedate);
  const msg = `📝 *הגשה: ${assignment.name}*\n📚 קורס: ${assignment.courseName}\n⏰ דדליין: ${formatHebrewDate(assignment.duedate)}\n⏳ ${remaining.text}\n🔗 ${assignment.url}\n\n(נשלח מ-SCE Assignment Tracker)`;
  return `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

function getSubmissionStatusText(status) {
  switch (status) {
    case "new": return "לא הוגש";
    case "draft": return "טיוטה (לא הוגש)";
    case "submitted": return "הוגש ✓";
    case "reopened": return "נפתח מחדש";
    default: return "לא ידוע";
  }
}

function getAssignmentUrl(cmid) {
  return `${MOODLE_BASE_URL}/mod/assign/view.php?id=${cmid}`;
}

// Export for module usage (optional, mostly for background script)
if (typeof module !== 'undefined') {
    module.exports = {
        MOODLE_BASE_URL,
        AJAX_ENDPOINT,
        formatHebrewDate,
        getTimeRemaining,
        getCountdownParts,
        getSubmissionStatusText,
        getAssignmentUrl,
        buildGoogleCalendarUrl,
        buildWhatsAppUrl
    };
}
