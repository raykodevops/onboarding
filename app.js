const state = {
  tabs: [],
  activeTab: 0,
  notes: [],
  user: null,
};

window.addEventListener('DOMContentLoaded', async () => {
  attachHandlers();
  loadLocalPlan();
  await refreshAuth();
  if (state.user) {
    await tryAutoLoadPlan();
  }
  render();
});

function attachHandlers() {
  document.getElementById('loginBtn').addEventListener('click', login);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('loginGateBtn').addEventListener('click', login);
  document.getElementById('fetchPlanBtn').addEventListener('click', fetchPlanFromSite);
  document.getElementById('choosePlanFileBtn').addEventListener('click', () => document.getElementById('planFile').click());
  document.getElementById('planFile').addEventListener('change', handlePlanFile);
  document.getElementById('addNoteBtn').addEventListener('click', addNote);
  document.getElementById('saveNotesBtn').addEventListener('click', saveNotes);
  document.getElementById('loadNotesBtn').addEventListener('click', loadNotes);
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
      status.textContent = `Signed in as ${state.user.userDetails || state.user.name || 'unknown'}`;
    } else {
      state.user = null;
      status.textContent = 'Not signed in';
      showLoginGate();
      return;
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
  window.location.href = '/.auth/login/aad?post_login_redirect_url=/';
}

function logout() {
  window.location.href = '/.auth/logout?post_logout_redirect_url=/';
}

function showLoginGate() {
  const gate = document.getElementById('authGate');
  const main = document.querySelector('main.page-body');
  gate.classList.toggle('hidden', !!state.user);
  if (main) main.classList.toggle('hidden', !state.user);
}

async function tryAutoLoadPlan() {
  if (state.tabs && state.tabs.length) {
    renderPlanTabs();
    return;
  }
  try {
    await fetchPlanFromSite();
  } catch {
    // ignore
  }
}

async function fetchPlanFromSite() {
  const message = document.getElementById('planMessage');
  message.textContent = 'Loading plan from site...';
  try {
    const res = await fetch('90_Day_Plan_Azure_Infrastructure_Manager.md');
    if (!res.ok) throw new Error('Plan file not found');
    const md = await res.text();
    state.tabs = parsePlanMarkdown(md);
    state.activeTab = 0;
    saveLocalPlan();
    renderPlanTabs();
    message.textContent = `Loaded ${state.tabs.length} plan weeks from site.`;
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
    state.tabs = parsePlanMarkdown(String(reader.result || ''));
    state.activeTab = 0;
    saveLocalPlan();
    renderPlanTabs();
    document.getElementById('planMessage').textContent = `Loaded ${state.tabs.length} plan weeks from file.`;
  };
  reader.readAsText(file);
  event.target.value = '';
}

function parsePlanMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const tabs = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const weekMatch = line.match(/^##\s+(Week\s*\d+.*)$/i);
    if (weekMatch) {
      current = { name: weekMatch[1], items: [] };
      tabs.push(current);
      continue;
    }
    if (!current) continue;
    const sectionMatch = line.match(/^###\s+(.*)$/);
    if (sectionMatch) {
      current.items.push({ text: sectionMatch[1], done: false, meta: true });
      continue;
    }
    const checkMatch = line.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (checkMatch) {
      current.items.push({ text: checkMatch[2], done: checkMatch[1].toLowerCase() === 'x' });
      continue;
    }
    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      current.items.push({ text: bulletMatch[1], done: false });
      continue;
    }
  }
  return tabs;
}

function render() {
  renderPlanTabs();
  renderNotes();
}

function renderPlanTabs() {
  const tabsContainer = document.getElementById('planTabs');
  const content = document.getElementById('planTabContent');
  tabsContainer.innerHTML = '';
  content.innerHTML = '';
  if (!state.tabs || !state.tabs.length) {
    content.innerHTML = '<div class="muted">No plan loaded. Load the plan from the site or import a local Markdown file.</div>';
    return;
  }

  state.tabs.forEach((tab, index) => {
    const button = document.createElement('button');
    button.className = `tab-button${index === state.activeTab ? ' active' : ''}`;
    button.type = 'button';
    button.textContent = tab.name;
    button.addEventListener('click', () => {
      state.activeTab = index;
      saveLocalPlan();
      renderPlanTabs();
    });
    tabsContainer.appendChild(button);
  });

  const active = state.tabs[state.activeTab] || state.tabs[0];
  const html = ['<h3>' + escapeHtml(active.name) + '</h3>', '<ul class="checklist">'];
  active.items.forEach((item, idx) => {
    const checked = item.done ? 'checked' : '';
    const isMeta = !!item.meta;
    html.push('<li>' +
      `<label><input type="checkbox" data-idx="${idx}" ${checked} ${isMeta ? 'disabled' : ''}>` +
      `<span class="${isMeta ? 'muted' : ''}">${escapeHtml(item.text)}</span></label></li>`);
  });
  html.push('</ul>');
  content.innerHTML = html.join('');

  content.querySelectorAll('input[type=checkbox]').forEach((checkbox) => {
    checkbox.addEventListener('change', (event) => {
      const idx = Number(event.target.dataset.idx);
      state.tabs[state.activeTab].items[idx].done = event.target.checked;
      saveLocalPlan();
    });
  });
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
}
