const state = {
  status: null,
  submissions: [],
  items: [],
};

const $ = (selector) => document.querySelector(selector);

const els = {
  message: $('#message'),
  adminToken: $('#adminToken'),
  refreshButton: $('#refreshButton'),
  statusGrid: $('#statusGrid'),
  publishForm: $('#publishForm'),
  submissionsList: $('#submissionsList'),
  itemsList: $('#itemsList'),
};

els.adminToken.value = localStorage.getItem('agentSkillHubAdminToken') || '';

function adminHeaders(extra = {}) {
  const token = els.adminToken.value.trim();
  if (token) {
    localStorage.setItem('agentSkillHubAdminToken', token);
  } else {
    localStorage.removeItem('agentSkillHubAdminToken');
  }
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

function showMessage(text, type = 'ok') {
  els.message.textContent = text;
  els.message.className = `message ${type}`;
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => {
    els.message.className = 'message hidden';
  }, 4500);
}

async function readError(response, fallback) {
  try {
    const data = await response.json();
    return data.details || data.error || fallback;
  } catch {
    return fallback;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: adminHeaders(options.headers || {}),
  });
  if (!response.ok) {
    throw new Error(await readError(response, 'Request failed'));
  }
  return response.json();
}

function kindLabel(kind) {
  return kind === 'skill' ? 'Skill' : 'Agent';
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderStatus() {
  const repository = state.status;
  if (!repository) {
    els.statusGrid.innerHTML = '<div class="empty">Status is not loaded.</div>';
    return;
  }

  els.statusGrid.innerHTML = [
    ['Catalog URL', `<a href="${repository.catalogUrl}" target="_blank" rel="noreferrer">${repository.catalogUrl}</a>`],
    ['Published', repository.publishedItems],
    ['Pending', repository.pendingSubmissions],
    ['Rejected', repository.rejectedSubmissions],
    ['Submit token', repository.submitTokenRequired ? 'Required' : 'Open'],
    ['Admin token', repository.adminTokenRequired ? 'Required' : 'Local-only fallback'],
    ['Storage', repository.root],
    ['Public base', repository.publicBasePath],
  ].map(([label, value]) => `
    <div class="stat">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join('');
}

function renderSubmissions() {
  if (state.submissions.length === 0) {
    els.submissionsList.innerHTML = '<div class="empty">No submissions.</div>';
    return;
  }

  els.submissionsList.innerHTML = state.submissions.map((submission) => `
    <article class="item">
      <div class="itemHeader">
        <div class="itemTitle">
          <strong>${submission.title}</strong>
          <span>${submission.name} · ${submission.author || 'unknown author'}</span>
        </div>
        <span class="badge">${kindLabel(submission.kind)} · ${submission.status}</span>
      </div>
      <div class="meta">
        <span>${submission.description || 'No description'}</span>
      </div>
      ${submission.status === 'pending' ? `
        <div class="itemActions">
          <button class="button primary" data-action="publish-submission" data-id="${submission.id}" type="button">Publish</button>
          <button class="button secondary" data-action="reject-submission" data-id="${submission.id}" type="button">Reject</button>
        </div>
      ` : ''}
    </article>
  `).join('');
}

function renderItems() {
  if (state.items.length === 0) {
    els.itemsList.innerHTML = '<div class="empty">No published items.</div>';
    return;
  }

  els.itemsList.innerHTML = state.items.map((item) => `
    <article class="item">
      <div class="itemHeader">
        <div class="itemTitle">
          <strong>${item.title}</strong>
          <span>${item.id}</span>
        </div>
        <span class="badge">${kindLabel(item.kind)}</span>
      </div>
      <div class="meta">
        <span>${item.description || 'No description'}</span>
        <span>${item.likes || 0} likes</span>
        <span>${item.downloads || 0} downloads</span>
      </div>
      <div class="itemActions">
        <button class="button danger" data-action="delete-item" data-id="${item.id}" type="button">Delete</button>
      </div>
    </article>
  `).join('');
}

async function loadHub() {
  const [status, submissions, items] = await Promise.all([
    api('/api/admin/status'),
    api('/api/admin/submissions?status=all'),
    api('/api/admin/items'),
  ]);
  state.status = status.repository;
  state.submissions = submissions.submissions || [];
  state.items = items.items || [];
  renderStatus();
  renderSubmissions();
  renderItems();
}

async function publishForm(event) {
  event.preventDefault();
  const form = new FormData(els.publishForm);
  const payload = Object.fromEntries(form.entries());
  payload.tags = parseList(payload.tags);
  payload.supportedApps = parseList(payload.supportedApps);
  payload.capabilities = parseList(payload.capabilities);
  payload.overwrite = form.get('overwrite') === 'on';

  await api('/api/admin/items', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  els.publishForm.reset();
  showMessage('Published item.');
  await loadHub();
}

async function handleListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;

  if (action === 'publish-submission') {
    await api(`/api/admin/submissions/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      body: JSON.stringify({ overwrite: true }),
    });
    showMessage('Published submission.');
  }

  if (action === 'reject-submission') {
    await api(`/api/admin/submissions/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Rejected from Agent/Skill Hub admin.' }),
    });
    showMessage('Rejected submission.');
  }

  if (action === 'delete-item') {
    await api(`/api/admin/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
    showMessage('Deleted item.');
  }

  await loadHub();
}

els.refreshButton.addEventListener('click', () => {
  loadHub().catch((error) => showMessage(error.message, 'error'));
});

els.publishForm.addEventListener('submit', (event) => {
  publishForm(event).catch((error) => showMessage(error.message, 'error'));
});

document.addEventListener('click', (event) => {
  handleListClick(event).catch((error) => showMessage(error.message, 'error'));
});

loadHub().catch((error) => {
  renderStatus();
  showMessage(error.message, 'error');
});
