// Runs on moodle.sce.ac.il

async function init() {
  // 1. Extract sesskey from DOM
  const sesskeyInput = document.querySelector('input[name="sesskey"]');
  let sesskey = sesskeyInput ? sesskeyInput.value : null;
  
  if (!sesskey) {
    const logoutLink = document.querySelector('a[href*="logout.php"]');
    if (logoutLink) {
      try {
        const url = new URL(logoutLink.href);
        sesskey = url.searchParams.get('sesskey');
      } catch (e) {}
    }
  }

  if (sesskey) {
    // Extract user name
    const userMenu = document.querySelector('.usertext, .userbutton .usertext, .usermenu .usertext');
    const userName = userMenu ? userMenu.textContent.trim() : "";
    
    // Send sesskey to background to store
    chrome.runtime.sendMessage({ action: "setSesskey", sesskey, userName });
  } else {
    // Not logged in or couldn't find sesskey
    return;
  }

  // 2. Create DOM
  createWidget();

  // 3. Load data
  await loadWidgetData();
}

function createWidget() {
  const widget = document.createElement("div");
  widget.id = "sce-tracker-widget";

  widget.innerHTML = `
    <button id="sce-tracker-fab">📋
      <span id="sce-tracker-badge" style="display:none;">0</span>
    </button>
    <div id="sce-tracker-panel">
      <div class="panel-header">
        <span>📚 עבודות ממתינות</span>
        <button class="panel-close" id="sce-panel-close">✕</button>
      </div>
      <div class="panel-list" id="sce-panel-list"></div>
    </div>
  `;

  document.body.appendChild(widget);

  // Event listeners
  document.getElementById("sce-tracker-fab").addEventListener("click", togglePanel);
  document.getElementById("sce-panel-close").addEventListener("click", closePanel);

  // Close on outside click
  document.addEventListener("click", (e) => {
    const w = document.getElementById("sce-tracker-widget");
    if (w && !w.contains(e.target)) closePanel();
  });
}

function togglePanel() {
  const panel = document.getElementById("sce-tracker-panel");
  panel.classList.toggle("open");
}

function closePanel() {
  const panel = document.getElementById("sce-tracker-panel");
  panel.classList.remove("open");
}

async function loadWidgetData() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getAssignments" });
    if (!response.success) return;

    const assignments = response.assignments || [];
    const badge = document.getElementById("sce-tracker-badge");
    const fab = document.getElementById("sce-tracker-fab");
    const list = document.getElementById("sce-panel-list");

    // Update badge
    if (assignments.length > 0) {
      badge.textContent = assignments.length;
      badge.style.display = "flex";
    } else {
      badge.style.display = "none";
    }

    // Check urgency
    const hasUrgent = assignments.some(a => {
      const r = getTimeRemaining(a.duedate);
      return r.urgency === "critical";
    });
    if (hasUrgent) {
        fab.classList.add("has-urgent");
    } else {
        fab.classList.remove("has-urgent");
    }

    // Render list
    if (assignments.length === 0) {
      list.innerHTML = `
        <div class="panel-empty">
          <div class="panel-empty-icon">🎉</div>
          <div>הכל הוגש!</div>
        </div>
      `;
      return;
    }

    list.innerHTML = "";
    const topAssignments = assignments.slice(0, 5);
    
    topAssignments.forEach(a => {
      const remaining = getTimeRemaining(a.duedate);
      const item = document.createElement("div");
      
      let urgencyClass = "ok";
      if (remaining.urgency === "critical" || remaining.urgency === "overdue") urgencyClass = "urgent";
      else if (remaining.urgency === "warning") urgencyClass = "warning";
      
      item.className = `panel-item ${urgencyClass}`;
      item.onclick = () => window.location.href = a.url;

      item.innerHTML = `
        <div class="panel-item-name">${escapeHtml(a.name)}</div>
        <div class="panel-item-meta">
          <span>${escapeHtml(a.courseName)}</span>
          <span>${remaining.text}</span>
        </div>
      `;
      list.appendChild(item);
    });

    if (assignments.length > 5) {
      const more = document.createElement("div");
      more.className = "panel-item";
      more.style.textAlign = "center";
      more.style.color = "#00d4aa";
      more.style.cursor = "pointer";
      more.textContent = `עוד ${assignments.length - 5} עבודות... (פתח תוסף)`;
      list.appendChild(more);
    }
  } catch (err) {
    console.error("SCE Tracker Content Script Error:", err);
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Start
init();
