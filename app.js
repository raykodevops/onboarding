const state = {
  tabs: [],
  activeTab: 0,
  notes: [],
  user: null,
  // ND-friendly additions (local only)
  focusItems: [],
  prefs: { fontScale: 1, compact: false, hideDone: false, calm: false, highContrast: false },
  goals: []
};

const START_DATE = new Date('2026-06-29');

const AZURE_AD_TENANT_ID = '50d1d247-aa75-4931-8ddf-3c2ee9421629';

let currentPlanFilter = '';
let focusMode = false;
let KB_CACHE = null;

async function loadKnowledgeBase() {
  if (KB_CACHE) return KB_CACHE;
  try {
    const res = await fetch('/api/kb');
    if (res.ok) {
      KB_CACHE = await res.json();
      return KB_CACHE;
    }
  } catch (e) {
    console.warn('Could not load KB from Azure, using local fallback');
  }
  return null;
}

function getCurrentDay() {
  const now = new Date();
  // Compare dates only (ignore time of day) using local time
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(START_DATE.getFullYear(), START_DATE.getMonth(), START_DATE.getDate());

  if (today < start) {
    return 0; // Do not start counting days until the actual first day (June 29)
  }

  const diffMs = today - start;
  let d = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, Math.min(90, d));
}

function getDaysUntilStart() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(START_DATE.getFullYear(), START_DATE.getMonth(), START_DATE.getDate());

  if (today >= start) {
    return 0;
  }

  const diffMs = start - today;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

const DEFAULT_GOALS = [
  { text: "Complete full Azure environment inventory, resource mapping, and baseline documentation", done: false },
  { text: "Lead and deliver at least one low-risk production improvement (with proposal, testing, metrics, and updated runbooks)", done: false },
  { text: "Build and deliver knowledge transfer to the team (updated runbooks + at least one peer training/review session)", done: false }
];

// Discovery data source of truth is now the free Azure KB at /api/kb (populated from the same rich data).
// This WEEK_DATA block is kept only as a local fallback if the API is unreachable (keeps the app working offline).
const WEEK_DATA = {
  // Full rich discovery data now lives in the free /api/kb backend (see api/kb/index.js).
  // This is kept as a minimal offline fallback only.
};

// Fallback for any week not explicitly listed
const DEFAULT_WEEK_DATA = {
  topic: "Discovery & Execution",
  discovery: [
    { id: "risks", q: "What risks or unknowns are you seeing in this area?" },
    { id: "owners", q: "Who are the key owners/stakeholders for the systems involved?" },
    { id: "documentation", q: "Where is the current documentation and how reliable is it?" }
  ],
  ideas: [
    "Document as you discover — don't rely on memory",
    "Add the most important open questions to your 'Open Questions' list",
    "Look for low-risk ways to contribute value early"
  ]
};

window.addEventListener('DOMContentLoaded', async () => {
  loadLocalPlan();           // includes focus + prefs
  applyPrefs();
  attachHandlers();

  // Load the Azure Knowledge Base early (powers discovery questions + can be used by MCP)
  loadKnowledgeBase().then(kb => {
    if (kb) {
      window.ONBOARDING_KB = kb;
      // Re-render plan tabs if already loaded so discovery pulls from server
      if (state.tabs && state.tabs.length) renderPlanTabs();
    }
  });

  await refreshAuth();
  if (state.user) {
    await tryAutoLoadPlan();
  }
  render();
  renderGoals();
  updateDashboard();
  renderFocus();
});

function attachHandlers() {
  document.getElementById('loginBtn').addEventListener('click', login);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('loginGateBtn').addEventListener('click', login);
  document.getElementById('fetchPlanBtn').addEventListener('click', fetchPlanFromSite);
  document.getElementById('viewFullPlanBtn').addEventListener('click', showFullPlan);
  document.getElementById('closeFullPlanBtn').addEventListener('click', hideFullPlan);
  document.getElementById('choosePlanFileBtn').addEventListener('click', () => document.getElementById('planFile').click());
  document.getElementById('planFile').addEventListener('change', handlePlanFile);
  document.getElementById('addNoteBtn').addEventListener('click', addNote);
  document.getElementById('saveNotesBtn').addEventListener('click', saveNotes);
  document.getElementById('loadNotesBtn').addEventListener('click', loadNotes);

  // ND comfort controls
  const fsPlus = document.getElementById('fsPlus');
  const fsMinus = document.getElementById('fsMinus');
  const fsReset = document.getElementById('fsReset');
  if (fsPlus) fsPlus.addEventListener('click', () => { state.prefs.fontScale = Math.min(1.35, (state.prefs.fontScale || 1) + 0.08); savePrefs(); applyPrefs(); });
  if (fsMinus) fsMinus.addEventListener('click', () => { state.prefs.fontScale = Math.max(0.85, (state.prefs.fontScale || 1) - 0.08); savePrefs(); applyPrefs(); });
  if (fsReset) fsReset.addEventListener('click', () => { state.prefs.fontScale = 1; savePrefs(); applyPrefs(); });

  const densityBtn = document.getElementById('densityBtn');
  if (densityBtn) densityBtn.addEventListener('click', () => {
    state.prefs.compact = !state.prefs.compact; savePrefs(); applyPrefs();
  });

  const hideDoneBtn = document.getElementById('hideDoneBtn');
  if (hideDoneBtn) hideDoneBtn.addEventListener('click', () => {
    state.prefs.hideDone = !state.prefs.hideDone; savePrefs(); applyPrefs(); renderPlanTabs();
  });

  const calmBtn = document.getElementById('calmBtn');
  if (calmBtn) calmBtn.addEventListener('click', () => {
    state.prefs.calm = !state.prefs.calm;
    if (state.prefs.calm) state.prefs.highContrast = false;
    savePrefs(); applyPrefs();
  });

  const hcBtn = document.getElementById('hcBtn');
  if (hcBtn) hcBtn.addEventListener('click', () => {
    state.prefs.highContrast = !state.prefs.highContrast;
    if (state.prefs.highContrast) state.prefs.calm = false;
    savePrefs(); applyPrefs();
  });

  const focusModeBtn = document.getElementById('focusModeBtn');
  if (focusModeBtn) focusModeBtn.addEventListener('click', () => {
    focusMode = !focusMode;
    const notesCard = document.querySelector('section.card:nth-of-type(2)');
    if (notesCard) notesCard.style.display = focusMode ? 'none' : '';
    focusModeBtn.classList.toggle('active', focusMode);
    focusModeBtn.textContent = focusMode ? 'Exit focus' : 'Focus mode';
  });

  const planSearch = document.getElementById('planSearch');
  if (planSearch) {
    planSearch.addEventListener('input', () => {
      currentPlanFilter = planSearch.value || '';
      renderPlanTabs();
    });
  }

  const clearFocusBtn = document.getElementById('clearFocusBtn');
  if (clearFocusBtn) clearFocusBtn.addEventListener('click', () => {
    if (confirm('Clear all Focus Today items?')) {
      state.focusItems = [];
      savePrefs();
      renderFocus();
      updateDashboard();
    }
  });

  // Goals
  const addGoalBtn = document.getElementById('addGoalBtn');
  const newGoalInput = document.getElementById('newGoalInput');
  if (addGoalBtn && newGoalInput) {
    addGoalBtn.addEventListener('click', () => {
      const text = newGoalInput.value.trim();
      if (!text) return;
      state.goals.push({ text, done: false });
      newGoalInput.value = '';
      saveGoals();
      renderGoals();
      updateDashboard();
    });
    newGoalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        addGoalBtn.click();
      }
    });
  }
}

async function refreshAuth() {
  const status = document.getElementById('authStatus');
  try {
    const res = await fetch('/.auth/me');
    if (!res.ok) {
      state.user = null;
      status.textContent = 'Not signed in';
      showLoginGate();
      return;
    }
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      state.user = data[0];
    } else if (data && data.clientPrincipal && typeof data.clientPrincipal === 'object' && Object.keys(data.clientPrincipal).length > 0) {
      state.user = data.clientPrincipal;
    } else {
      state.user = null;
      status.textContent = 'Not signed in';
      showLoginGate();
      return;
    }

    // Restrict to specific tenant only
    if (state.user) {
      let userTenant = state.user.tid || state.user.tenantId;
      if (!userTenant && Array.isArray(state.user.claims)) {
        const tidClaim = state.user.claims.find(c => (c.typ || c.claim) === 'tid');
        if (tidClaim) userTenant = tidClaim.val || tidClaim.value;
      }

      if (userTenant && userTenant !== AZURE_AD_TENANT_ID) {
        console.warn('Access denied from tenant:', userTenant);
        state.user = null;
        status.textContent = 'Access restricted to authorized organization only.';
        showLoginGate();
        // Force logout to clear the session for other tenants
        setTimeout(() => {
          window.location.href = '/.auth/logout?post_logout_redirect_url=/';
        }, 1200);
        return;
      }

      status.textContent = `Signed in as ${state.user.userDetails || state.user.userId || 'unknown'}`;
    }
  } catch (err) {
    state.user = null;
    status.textContent = 'Not signed in';
    showLoginGate();
    return;
  }
  document.getElementById('loginBtn').classList.toggle('hidden', !!state.user);
  document.getElementById('logoutBtn').classList.toggle('hidden', !state.user);
  showLoginGate();
}

function login() {
  // Force login to the specific tenant only
  window.location.href = `/.auth/login/aad?tenant=${AZURE_AD_TENANT_ID}&post_login_redirect_url=/`;
}

function hideFullPlan() {
  document.getElementById('fullPlan').classList.add('hidden');
  document.getElementById('planTabs').closest('section').classList.remove('hidden');
  const notesSection = document.querySelector('section.card:nth-of-type(2)');
  if (notesSection) notesSection.classList.remove('hidden');
}

function renderFullPlan(markdown) {
  const html = markdown
    .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^\*\*([^*]+)\*\*/gm, '<strong>$1</strong>')
    .replace(/^- \[ \] (.+)$/gm, '<li><input type="checkbox" disabled> $1</li>')
    .replace(/^- \[x\] (.+)$/gim, '<li><input type="checkbox" checked disabled> $1</li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br />');

  return `<div>${html}</div>`;
}

async function showFullPlan() {
  document.getElementById('fullPlan').classList.remove('hidden');
  const planSection = document.getElementById('planTabs').closest('section');
  if (planSection) planSection.classList.add('hidden');
  const notesSection = document.querySelector('section.card:nth-of-type(2)');
  if (notesSection) notesSection.classList.add('hidden');

  const fullPlanContent = document.getElementById('fullPlanContent');
  const fullPlanMessage = document.getElementById('fullPlanMessage');
  try {
    const res = await fetch('90_Day_Plan_Azure_Infrastructure_Manager.md');
    if (!res.ok) throw new Error('Plan file not found');
    const md = await res.text();
    fullPlanContent.innerHTML = renderFullPlan(md);
    fullPlanMessage.textContent = 'Complete 90-Day onboarding plan.';
  } catch (err) {
    fullPlanMessage.textContent = 'Unable to load full plan content.';
  }
}

function logout() {
  window.location.href = '/.auth/logout?post_logout_redirect_url=/';
}

function showLoginGate() {
  const gate = document.getElementById('authGate');
  const main = document.querySelector('main.page-body');
  const footer = document.querySelector('footer.page-footer');
  gate.classList.toggle('hidden', !!state.user);
  if (main) main.classList.toggle('hidden', !state.user);
  if (footer) footer.classList.toggle('hidden', !state.user);
}

async function tryAutoLoadPlan() {
  // Always attempt to load the latest plan definition from the MD file on startup.
  // If the user already has saved progress (from localStorage), we merge the done states
  // so that deploying new features or updating the plan content does not wipe completed items.
  try {
    const res = await fetch('90_Day_Plan_Azure_Infrastructure_Manager.md');
    if (!res.ok) throw new Error('Plan file not found');

    const md = await res.text();
    const freshTabs = parsePlanMarkdown(md);

    if (state.tabs && state.tabs.length) {
      // Merge previous progress into the fresh plan structure
      state.tabs = mergeProgressIntoNewPlan(freshTabs);
    } else {
      state.tabs = freshTabs;
    }

    state.activeTab = Math.min(state.activeTab || 0, state.tabs.length - 1);
    saveLocalPlan();
    renderPlanTabs();
    renderGoals();
    updateDashboard();
    renderFocus();
    return;
  } catch (err) {
    // Fall back to saved local progress only
    if (state.tabs && state.tabs.length) {
      renderPlanTabs();
      renderGoals();
      updateDashboard();
      renderFocus();
    }
  }
}

async function fetchPlanFromSite() {
  const message = document.getElementById('planMessage');
  message.textContent = 'Loading plan from site...';
  try {
    const res = await fetch('90_Day_Plan_Azure_Infrastructure_Manager.md');
    if (!res.ok) throw new Error('Plan file not found');
    const md = await res.text();
    const freshTabs = parsePlanMarkdown(md);
    state.tabs = mergeProgressIntoNewPlan(freshTabs);
    state.activeTab = Math.min(state.activeTab || 0, state.tabs.length - 1);
    saveLocalPlan();
    renderPlanTabs();
    renderGoals();
    updateDashboard();
    renderFocus();
    message.textContent = `Loaded ${state.tabs.length} plan weeks from site (progress preserved where possible).`;
  } catch (err) {
    message.textContent = 'Unable to load plan from site. Use local import instead.';
    throw err;
  }
}

function handlePlanFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const freshTabs = parsePlanMarkdown(String(reader.result || ''));
    state.tabs = mergeProgressIntoNewPlan(freshTabs);
    state.activeTab = Math.min(state.activeTab || 0, state.tabs.length - 1);
    saveLocalPlan();
    renderPlanTabs();
    renderGoals();
    updateDashboard();
    renderFocus();
    document.getElementById('planMessage').textContent = `Loaded ${state.tabs.length} plan weeks from file (progress preserved where possible).`;
  };
  reader.readAsText(file);
  event.target.value = '';
}

function parsePlanMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const tabs = [];
  let current = null;
  let inMeetings = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      inMeetings = false;
      continue;
    }

    const weekMatch = line.match(/^##\s+(Week\s*\d+.*)$/i);
    if (weekMatch) {
      current = { name: weekMatch[1], items: [], meetings: [], goal: '' };
      tabs.push(current);
      inMeetings = false;
      continue;
    }
    if (!current) continue;

    // Weekly Goal (very valuable for ND users)
    const goalMatch = line.match(/\*\*Weekly Goal[:\*]?\*\*?\s*(.*)$/i) || line.match(/^Weekly Goal[:\*]?\s*(.*)$/i);
    if (goalMatch && current) {
      current.goal = (goalMatch[1] || '').replace(/^\*\*|\*\*$/g, '').trim();
      continue;
    }

    // Meetings section
    if (/^###?\s*Meetings to Schedule/i.test(line) || /Meetings to Schedule/i.test(line)) {
      inMeetings = true;
      continue;
    }
    if (/^###?\s*[A-Za-z]/.test(line) && !/^[-*]/.test(line)) inMeetings = false;

    const checkMatch = line.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (checkMatch) {
      const obj = { text: checkMatch[2], done: checkMatch[1].toLowerCase() === 'x' };
      if (inMeetings) current.meetings.push(obj);
      else current.items.push(obj);
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      const obj = { text: bulletMatch[1], done: false };
      if (inMeetings) current.meetings.push(obj);
      else current.items.push(obj);
      continue;
    }

    const sectionMatch = line.match(/^###\s+(.*)$/);
    if (sectionMatch) {
      current.items.push({ text: sectionMatch[1], done: false, meta: true });
    }
  }
  return tabs;
}

/**
 * When loading a fresh plan (from site or file), merge any existing done states
 * from the previously saved plan by matching item text. This prevents losing
 * user progress when we deploy new features or update the source MD file.
 */
function mergeProgressIntoNewPlan(newTabs) {
  const oldTabs = state.tabs || [];
  if (!oldTabs.length) {
    return newTabs;
  }

  return newTabs.map((newTab) => {
    const oldTab = oldTabs.find((t) => t.name === newTab.name);
    if (!oldTab) {
      return newTab; // new week we didn't have before
    }

    // Preserve goal if it exists
    if (newTab.goal && !oldTab.goal) {
      // keep the fresh one
    }

    // Merge main items by exact text match
    newTab.items = (newTab.items || []).map((newItem) => {
      const oldItem = (oldTab.items || []).find((i) => i.text === newItem.text);
      if (oldItem) {
        newItem.done = oldItem.done;
      }
      return newItem;
    });

    // Merge meetings separately (they are their own list)
    if (newTab.meetings && oldTab.meetings) {
      newTab.meetings = newTab.meetings.map((newMeeting) => {
        const oldMeeting = oldTab.meetings.find((m) => m.text === newMeeting.text);
        if (oldMeeting) {
          newMeeting.done = oldMeeting.done;
        }
        return newMeeting;
      });
    }

    // Preserve discovery question answers (by question id)
    if (oldTab.discoveryAnswers) {
      newTab.discoveryAnswers = { ...(oldTab.discoveryAnswers || {}) };
    }

    return newTab;
  });
}

function render() {
  renderPlanTabs();
  renderNotes();
  renderGoals();
  updateDashboard();
  renderFocus();
}

function renderPlanTabs() {
  const tabsContainer = document.getElementById('planTabs');
  const content = document.getElementById('planTabContent');
  tabsContainer.innerHTML = '';
  content.innerHTML = '';

  if (!state.tabs || !state.tabs.length) {
    content.innerHTML = '<div class="muted">No plan loaded. Load the plan from the site or import a local Markdown file.</div>';
    updateDashboard();
    return;
  }

  // Tabs
  state.tabs.forEach((tab, index) => {
    const button = document.createElement('button');
    button.className = `tab-button${index === state.activeTab ? ' active' : ''}`;
    button.type = 'button';
    button.textContent = tab.name;
    button.addEventListener('click', () => {
      state.activeTab = index;
      currentPlanFilter = '';
      const s = document.getElementById('planSearch');
      if (s) s.value = '';
      saveLocalPlan();
      renderPlanTabs();
    });
    tabsContainer.appendChild(button);
  });

  const active = state.tabs[state.activeTab] || state.tabs[0];
  if (!active) return;

  // Ensure discovery answers object exists for this tab
  if (!active.discoveryAnswers) active.discoveryAnswers = {};

  // Prefer server KB (free Azure backend) for discovery questions + ideas.
  // Falls back to local WEEK_DATA or default.
  let weekData = DEFAULT_WEEK_DATA;
  const kb = window.ONBOARDING_KB || (KB_CACHE);
  if (kb && kb.weeks) {
    // Match by week number extracted from tab name (e.g. "Week 5: ...")
    const weekMatch = active.name.match(/Week\s*(\d+)/i);
    const weekNum = weekMatch ? parseInt(weekMatch[1], 10) : null;
    const kbWeek = weekNum ? kb.weeks.find(w => w.week === weekNum) : null;
    if (kbWeek) weekData = kbWeek;
  } else if (WEEK_DATA[active.name]) {
    weekData = WEEK_DATA[active.name];
  }
  const topic = weekData.topic || active.name;

  let html = `<h3>${escapeHtml(active.name)} <span class="topic-badge">${escapeHtml(topic)}</span></h3>`;

  // Prominent Weekly Goal (ND gold) - keep small
  if (active.goal) {
    html += `<div class="plan-meta"><strong>🎯 Weekly Goal:</strong> ${escapeHtml(active.goal)}</div>`;
  }

  // Separate Meetings to Schedule - keep small
  if (active.meetings && active.meetings.length) {
    html += `<div style="margin:6px 0 4px;font-size:0.9em;color:#9cc8ff"><strong>Meetings to schedule</strong></div>`;
    html += `<ul class="checklist meetings-list">`;
    active.meetings.forEach((m, mIdx) => {
      const hide = state.prefs.hideDone && m.done;
      if (hide) return;
      const ch = m.done ? 'checked' : '';
      html += `<li><label><input type="checkbox" data-meeting="${mIdx}" ${ch}> ${escapeHtml(m.text)}</label></li>`;
    });
    html += `</ul>`;
  }

  // === Discovery Questions — PROMINENT and centralized (no need to scroll far) ===
  if (weekData.discovery && weekData.discovery.length) {
    html += `<div class="discovery-section" style="margin-top:12px;">
      <h4>🔍 Discovery Questions — Ask & Capture</h4>
      <p style="margin:0 0 8px;font-size:0.8em;color:#7fa8d8;">High-value questions for this topic. Answers saved automatically.</p>`;

    weekData.discovery.forEach((dq) => {
      const answer = active.discoveryAnswers[dq.id] || '';
      html += `<div class="discovery-item">
        <label>${escapeHtml(dq.q)}</label>
        <textarea data-qid="${dq.id}" rows="2" placeholder="Your findings, contacts, links, screenshots notes...">${escapeHtml(answer)}</textarea>
      </div>`;
    });
    html += `</div>`;
  }

  // === Week Checklist — collapsed by default to keep discovery central ===
  html += `<details class="plan-section"><summary><strong>Week Checklist</strong> (click to expand)</summary>`;
  html += `<ul class="checklist" id="mainPlanItems">`;
  const filter = (currentPlanFilter || '').toLowerCase();
  const hideDone = !!state.prefs.hideDone;

  active.items.forEach((item, idx) => {
    if (hideDone && item.done) return;
    const text = item.text || '';
    if (filter && !text.toLowerCase().includes(filter)) return;

    const checked = item.done ? 'checked' : '';
    const isMeta = !!item.meta;
    const spanClass = isMeta ? 'muted' : '';
    html += `<li>
      <label><input type="checkbox" data-idx="${idx}" ${checked} ${isMeta ? 'disabled' : ''}>
      <span class="${spanClass}">${escapeHtml(text)}</span></label>
      <button class="btn btn-secondary" data-pin-idx="${idx}" style="padding:2px 8px;font-size:0.7em;margin-left:6px;background:rgba(84,167,255,0.12);color:#9cc8ff;border:none;">Pin</button>
    </li>`;
  });
  html += `</ul></details>`;

  // === Beneficial Discovery Ideas — collapsed by default ===
  if (weekData.ideas && weekData.ideas.length) {
    html += `<details class="plan-section"><summary><strong>💡 Beneficial Discovery Ideas</strong> (click to expand)</summary>
      <ul>`;
    weekData.ideas.forEach((idea) => {
      const safeIdea = escapeHtml(idea).replace(/`([^`]+)`/g, '<code>$1</code>');
      html += `<li>${safeIdea}</li>`;
    });
    html += `</ul>
      <p style="margin:6px 0 0;font-size:0.75em;color:#7fa8d8;">Tip: Pin useful ones to Focus Today.</p>
    </details>`;
  }

  content.innerHTML = html;

  // Main plan checkboxes
  content.querySelectorAll('#mainPlanItems input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const idx = Number(e.target.dataset.idx);
      state.tabs[state.activeTab].items[idx].done = e.target.checked;
      saveLocalPlan();
      updateDashboard();
      renderFocus();
    });
  });

  // Pin buttons for plan items
  content.querySelectorAll('[data-pin-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.pinIdx);
      const item = (state.tabs[state.activeTab] || {}).items[idx];
      if (item && item.text) addToFocus(item.text);
    });
  });

  // Meetings checkboxes (separate)
  content.querySelectorAll('.meetings-list input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const mIdx = Number(e.target.dataset.meeting);
      const act = state.tabs[state.activeTab];
      if (act && act.meetings && act.meetings[mIdx]) {
        act.meetings[mIdx].done = e.target.checked;
        saveLocalPlan();
        updateDashboard();
      }
    });
  });

  // === Discovery question answer fields (save on input) ===
  content.querySelectorAll('textarea[data-qid]').forEach((ta) => {
    const qid = ta.dataset.qid;
    // Restore any previously saved answer
    ta.value = active.discoveryAnswers[qid] || '';

    ta.addEventListener('input', () => {
      active.discoveryAnswers[qid] = ta.value;
      saveLocalPlan();
      // Optional: light feedback in dashboard
      updateDashboard();
    });
  });

  updateDashboard();
}

function addNote() {
  const title = document.getElementById('noteTitle').value.trim();
  const body = document.getElementById('noteBody').value.trim();
  if (!title && !body) {
    updateNoteMessage('Enter a title or note body.');
    return;
  }
  state.notes.unshift({ title: title || 'Untitled', body, createdAt: new Date().toISOString() });
  document.getElementById('noteTitle').value = '';
  document.getElementById('noteBody').value = '';
  renderNotes();
  updateNoteMessage('Note added locally. Save notes to persist in Azure.');
}

function renderNotes() {
  const notesList = document.getElementById('notesList');
  notesList.innerHTML = '';
  if (!state.notes.length) {
    notesList.innerHTML = '<div class="muted">No notes yet. Add one and save it to Azure.</div>';
    return;
  }
  state.notes.forEach((note, idx) => {
    const noteCard = document.createElement('div');
    noteCard.className = 'note-card';
    noteCard.innerHTML = `
      <h3>${escapeHtml(note.title)}</h3>
      <div>${escapeHtml(note.body).replace(/\n/g, '<br>')}</div>
      <time>${new Date(note.createdAt).toLocaleString()}</time>
      <div class="button-row btn-group"><button class="btn btn-secondary" data-action="delete" data-idx="${idx}">Delete</button></div>
    `;
    notesList.appendChild(noteCard);
  });
  notesList.querySelectorAll('button[data-action="delete"]').forEach((button) => {
    button.addEventListener('click', (event) => {
      const index = Number(event.target.dataset.idx);
      state.notes.splice(index, 1);
      renderNotes();
      updateNoteMessage('Note removed locally. Save notes to persist the change.');
    });
  });
}

async function saveNotes() {
  if (!state.user) {
    updateNoteMessage('Please sign in to save notes.');
    return;
  }
  try {
    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: state.notes }),
    });
    if (!res.ok) {
      const error = await res.json();
      updateNoteMessage(`Unable to save notes: ${error.error || res.statusText}`);
      return;
    }
    updateNoteMessage('Notes saved successfully.');
  } catch (err) {
    updateNoteMessage('Unable to save notes. Check your connection and login status.');
  }
}

async function loadNotes() {
  if (!state.user) {
    updateNoteMessage('Please sign in to load notes.');
    return;
  }
  try {
    const res = await fetch('/api/notes');
    if (!res.ok) {
      const error = await res.json();
      updateNoteMessage(`Unable to load notes: ${error.error || res.statusText}`);
      return;
    }
    const data = await res.json();
    state.notes = Array.isArray(data.notes) ? data.notes : [];
    renderNotes();
    updateNoteMessage('Notes loaded from Azure.');
  } catch (err) {
    updateNoteMessage('Unable to load notes. Check your connection and login status.');
  }
}

function updateNoteMessage(message) {
  document.getElementById('noteMessage').textContent = message;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* =====================================================
   ND-friendly helpers (progress, focus pinning, prefs,
   richer plan rendering with goals + meetings)
   ===================================================== */

function applyPrefs() {
  const body = document.body;
  body.style.setProperty('--font-scale', state.prefs.fontScale || 1);

  body.classList.toggle('compact', !!state.prefs.compact);
  body.classList.toggle('calm', !!state.prefs.calm);
  body.classList.toggle('high-contrast', !!state.prefs.highContrast);

  // Update active state on control buttons
  const ids = ['densityBtn', 'hideDoneBtn', 'calmBtn', 'hcBtn'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'densityBtn') el.classList.toggle('active', !!state.prefs.compact);
    if (id === 'hideDoneBtn') el.classList.toggle('active', !!state.prefs.hideDone);
    if (id === 'calmBtn') el.classList.toggle('active', !!state.prefs.calm);
    if (id === 'hcBtn') el.classList.toggle('active', !!state.prefs.highContrast);
  });
}

function updateDashboard() {
  const container = document.getElementById('ndDashboard');
  if (!container) return;

  let planDone = 0, planTotal = 0;
  (state.tabs || []).forEach(tab => {
    (tab.items || []).forEach(it => {
      if (!it.meta) { planTotal++; if (it.done) planDone++; }
    });
  });

  const planPct = planTotal > 0 ? Math.round((planDone / planTotal) * 100) : 0;

  const currentDay = getCurrentDay();

  // Derive phase/week from active tab name (fallback)
  let phase = 'Phase 1 — Orientation';
  let weekLabel = '—';
  const active = (state.tabs || [])[state.activeTab];
  if (active && active.name) {
    const m = active.name.match(/week\s*(\d+)/i);
    if (m) {
      const w = parseInt(m[1], 10);
      weekLabel = 'Week ' + w;
      if (w >= 9) phase = 'Phase 3 — Ownership';
      else if (w >= 5) phase = 'Phase 2 — Building Competency';
    }
  }

  const goals = state.goals || [];
  const goalsDone = goals.filter(g => g.done).length;
  const goalsText = goals.length ? `${goalsDone}/${goals.length} goals` : 'No goals yet';

  let dayText;
  let timelineSub;
  if (currentDay === 0) {
    const daysUntil = getDaysUntilStart();
    dayText = daysUntil === 1 
      ? "1 day until start" 
      : `${daysUntil} days until start`;
    timelineSub = `First day: June 29, 2026 • Day 1 begins then`;
  } else {
    dayText = `Day ${currentDay} of 90`;
    timelineSub = `${phase} &nbsp;•&nbsp; ${weekLabel}`;
  }

  container.innerHTML = `
    <div class="nd-dash-card">
      <div class="label">MISSION TIMELINE (started 29 Jun 2026)</div>
      <div class="big">${dayText}</div>
      <div style="margin-top:3px;font-size:0.8em;color:var(--muted)">${timelineSub}</div>
    </div>
    <div class="nd-dash-card">
      <div class="label">EXECUTION STATUS</div>
      <div class="big">${planPct}%</div>
      <div class="nd-progress"><div style="width:${planPct}%"></div></div>
      <div style="margin-top:3px;font-size:0.78em;color:var(--muted)">${planDone} / ${planTotal} checklist items</div>
    </div>
    <div class="nd-dash-card">
      <div class="label">GOALS PROGRESS</div>
      <div class="big">${goalsText}</div>
      <div style="margin-top:4px;font-size:0.78em;color:#9cc8ff">Key mission outcomes tracked</div>
    </div>
    <div class="nd-dash-card">
      <div class="label">FOCUS PRIORITIES</div>
      <div style="font-size:0.92em;color:#9cc8ff">Pin up to 3 active priorities</div>
      <div style="margin-top:6px;font-size:0.78em;">Use Pin buttons in Plan tabs</div>
    </div>
  `;
}

function renderFocus() {
  const container = document.getElementById('ndFocusList');
  if (!container) return;
  container.innerHTML = '';

  const items = state.focusItems || [];
  if (!items.length) {
    container.innerHTML = '<div style="color:#7fa8d8;font-size:0.9em;padding:4px 2px;">Nothing pinned yet. Use the Pin buttons on plan items below.</div>';
    return;
  }

  items.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'nd-focus-item';
    const doneStyle = item.done ? 'opacity:0.6;text-decoration:line-through' : '';
    row.innerHTML = `
      <input type="checkbox" ${item.done ? 'checked' : ''}>
      <span style="flex:1;${doneStyle}">${escapeHtml(item.text)}</span>
      <button class="remove" data-idx="${idx}">remove</button>
    `;

    const cb = row.querySelector('input');
    cb.addEventListener('change', () => {
      state.focusItems[idx].done = cb.checked;
      savePrefs();
      renderFocus();
      // Also try to reflect in main plan if possible (best effort)
      updateDashboard();
    });

    row.querySelector('.remove').addEventListener('click', () => {
      state.focusItems.splice(idx, 1);
      savePrefs();
      renderFocus();
      updateDashboard();
    });

    container.appendChild(row);
  });
}

function addToFocus(text) {
  if (!state.focusItems) state.focusItems = [];
  if (state.focusItems.length >= 3) {
    alert('Focus Today supports max 3 items. This helps prevent decision fatigue and overwhelm.');
    return;
  }
  if (state.focusItems.some(f => f.text === text)) return;
  state.focusItems.push({ text, done: false });
  savePrefs();
  renderFocus();
  updateDashboard();
}

function updateNdButtons() {
  // Called from applyPrefs already
}

function renderGoals() {
  const list = document.getElementById('goalsList');
  const progressEl = document.getElementById('goalsProgress');
  const subtitle = document.getElementById('goalsSubtitle');
  if (!list) return;

  list.innerHTML = '';

  const goals = state.goals || [];
  const doneCount = goals.filter(g => g.done).length;

  if (progressEl) {
    progressEl.textContent = `${doneCount} / ${goals.length} goals complete`;
  }

  // Dynamic subtitle with days until start counter (before June 29)
  if (subtitle) {
    const currentDay = getCurrentDay();
    if (currentDay === 0) {
      const daysUntil = getDaysUntilStart();
      const dayWord = daysUntil === 1 ? 'day' : 'days';
      subtitle.innerHTML = `Starts <strong>June 29, 2026</strong> • <strong>${daysUntil} ${dayWord} until start</strong> • 3 realistic milestones + your own`;
    } else {
      subtitle.innerHTML = `Started <strong>June 29, 2026</strong> • 3 realistic milestones + room for your own`;
    }
  }

  if (!goals.length) {
    list.innerHTML = '<li class="muted">No goals yet. Add your first one above.</li>';
    return;
  }

  goals.forEach((goal, idx) => {
    const li = document.createElement('li');
    const doneClass = goal.done ? 'done' : '';
    li.innerHTML = `
      <label class="${doneClass}">
        <input type="checkbox" data-goal-idx="${idx}" ${goal.done ? 'checked' : ''} />
        <span class="goal-text">${escapeHtml(goal.text)}</span>
      </label>
      <button class="delete-goal" data-goal-idx="${idx}" title="Remove goal">×</button>
    `;

    const cb = li.querySelector('input');
    cb.addEventListener('change', () => {
      state.goals[idx].done = cb.checked;
      saveGoals();
      renderGoals();
      updateDashboard();
    });

    li.querySelector('.delete-goal').addEventListener('click', () => {
      if (confirm('Remove this goal?')) {
        state.goals.splice(idx, 1);
        saveGoals();
        renderGoals();
        updateDashboard();
      }
    });

    list.appendChild(li);
  });
}

function saveLocalPlan() {
  localStorage.setItem('onboardingPlanTabs', JSON.stringify(state.tabs));
  localStorage.setItem('onboardingActiveTab', String(state.activeTab));
}

function loadLocalPlan() {
  try {
    const saved = localStorage.getItem('onboardingPlanTabs');
    if (saved) {
      state.tabs = JSON.parse(saved);
      state.activeTab = Number(localStorage.getItem('onboardingActiveTab')) || 0;
    }
  } catch {
    state.tabs = [];
    state.activeTab = 0;
  }

  // ND state (focus + prefs)
  try {
    const f = localStorage.getItem('onboardingFocusItems');
    if (f) state.focusItems = JSON.parse(f);
  } catch { state.focusItems = []; }

  try {
    const p = localStorage.getItem('onboardingPrefs');
    if (p) state.prefs = Object.assign({ fontScale: 1, compact: false, hideDone: false, calm: false, highContrast: false }, JSON.parse(p));
  } catch {}

  // Goals (with seeding of 3 realistic default goals if none exist)
  try {
    const g = localStorage.getItem('onboardingGoals');
    if (g) {
      state.goals = JSON.parse(g);
    }
  } catch { state.goals = []; }

  if (!state.goals || state.goals.length === 0) {
    state.goals = DEFAULT_GOALS.map(g => ({ ...g }));
    saveGoals();
  }
}

function savePrefs() {
  localStorage.setItem('onboardingFocusItems', JSON.stringify(state.focusItems || []));
  localStorage.setItem('onboardingPrefs', JSON.stringify(state.prefs || {}));
}

function saveGoals() {
  localStorage.setItem('onboardingGoals', JSON.stringify(state.goals || []));
}
