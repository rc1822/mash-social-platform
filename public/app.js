const state = {
  token: sessionStorage.getItem('mashToken'),
  me: null,
  friends: [],
  activeConversation: null,
  videoIndex: 0,
  videos: ['/videos/video1.mp4', '/videos/video2.mp4', '/videos/video3.mp4', '/videos/video4.mp4']
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function toast(message, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.className = 'toast', 2600);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...options, headers });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    if (response.status === 401 && state.token) logoutLocal();
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function avatarUrl(user) { return user?.avatar || '/assets/default-avatar.jpg'; }
function timeAgo(date) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(date).toLocaleDateString();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file.'));
    if (file.size > 600_000) return reject(new Error('Please use an image under 600 KB.'));
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });
}

function logoutLocal() {
  state.token = null; state.me = null; state.friends = []; state.activeConversation = null;
  sessionStorage.removeItem('mashToken');
  $('#appView').classList.add('hidden');
  $('#authView').classList.remove('hidden');
}

function renderSidebarUser() {
  $('#sidebarUser').innerHTML = `<img class="avatar" src="${avatarUrl(state.me)}" alt=""><div class="user-text"><strong>${escapeHtml(state.me.username)}</strong><span>${escapeHtml(state.me.bio)}</span></div>`;
}

async function loadMe() {
  const { user } = await api('/api/me');
  state.me = user;
  renderSidebarUser();
}

function showView(name) {
  $$('.view').forEach(v => v.classList.add('hidden'));
  $(`#${name}View`).classList.remove('hidden');
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $('.sidebar').classList.remove('open');
  if (name === 'feed') loadFeed();
  if (name === 'friends') loadFriends();
  if (name === 'messages') loadMessageFriends();
  if (name === 'profile') loadProfile();
  if (name === 'minis') loadVideo();
}

async function authenticate(token) {
  state.token = token;
  sessionStorage.setItem('mashToken', token);
  await loadMe();
  $('#authView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  showView('feed');
}

async function loadFeed() {
  const target = $('#feedList');
  target.innerHTML = '<div class="panel empty">Loading posts…</div>';
  try {
    const { posts } = await api('/api/feed');
    if (!posts.length) {
      target.innerHTML = '<div class="panel empty">No posts yet. Create your first post or add a friend.</div>';
      return;
    }
    target.innerHTML = posts.map(post => `
      <article class="post-card">
        ${post.image ? `<img class="post-image" src="${post.image}" alt="Post image">` : ''}
        <div class="post-body">
          <div class="post-author"><img class="avatar" src="${avatarUrl(post.author)}" alt=""><span>@${escapeHtml(post.author.username)} · ${timeAgo(post.createdAt)}</span></div>
          <h3>${escapeHtml(post.title)}</h3>
          <p>${escapeHtml(post.body)}</p>
        </div>
      </article>`).join('');
  } catch (error) { target.innerHTML = `<div class="panel empty">${escapeHtml(error.message)}</div>`; }
}

function userCard(user, actions = '') {
  return `<div class="result-card"><img class="avatar" src="${avatarUrl(user)}" alt=""><div class="user-text"><strong>@${escapeHtml(user.username)}</strong><span>${escapeHtml(user.bio)}</span></div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}

async function loadFriends() {
  try {
    const data = await api('/api/friends');
    state.friends = data.friends;
    $('#friendsList').innerHTML = data.friends.length ? data.friends.map(u => userCard(u, `<button class="ghost" data-message="${escapeHtml(u.username)}">Message</button><button class="ghost danger" data-remove="${escapeHtml(u.username)}">Remove</button>`)).join('') : '<p class="empty">No friends yet.</p>';
    $('#incomingList').innerHTML = data.incoming.length ? data.incoming.map(u => userCard(u, `<button class="primary compact" data-respond="accept" data-user="${escapeHtml(u.username)}">Accept</button><button class="ghost" data-respond="decline" data-user="${escapeHtml(u.username)}">Decline</button>`)).join('') : '<p class="empty">No requests.</p>';
    $('#outgoingList').innerHTML = data.outgoing.length ? data.outgoing.map(u => userCard(u)).join('') : '<p class="empty">Nothing pending.</p>';
  } catch (error) { toast(error.message, true); }
}

async function searchUsers() {
  const q = $('#userSearch').value.trim();
  if (!q) return;
  try {
    const { users } = await api(`/api/users?q=${encodeURIComponent(q)}`);
    $('#searchResults').innerHTML = users.length ? `<div class="panel result-list">${users.map(u => userCard(u, `<button class="primary compact" data-add="${escapeHtml(u.username)}">Add friend</button>`)).join('')}</div>` : '<div class="panel empty">No users found.</div>';
  } catch (error) { toast(error.message, true); }
}

async function loadMessageFriends() {
  try {
    const data = await api('/api/friends');
    state.friends = data.friends;
    $('#messageFriends').innerHTML = data.friends.length ? data.friends.map(u => `<button class="nav-item" data-conversation="${escapeHtml(u.username)}">@${escapeHtml(u.username)}</button>`).join('') : '<p class="empty">Add a friend to start messaging.</p>';
  } catch (error) { toast(error.message, true); }
}

async function openConversation(username) {
  state.activeConversation = username;
  $('#conversationHeader').textContent = `@${username}`;
  $('#messageForm').classList.remove('hidden');
  const list = $('#messageList'); list.innerHTML = '<p class="empty">Loading…</p>';
  try {
    const { messages } = await api(`/api/messages/${encodeURIComponent(username)}`);
    list.innerHTML = messages.length ? messages.map(m => `<div class="bubble ${m.sender.toLowerCase() === state.me.username.toLowerCase() ? 'mine' : ''}">${escapeHtml(m.body)}<small>${escapeHtml(m.sender)} · ${new Date(m.createdAt).toLocaleString()}</small></div>`).join('') : '<p class="empty">No messages yet.</p>';
    list.scrollTop = list.scrollHeight;
  } catch (error) { list.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`; }
}

function loadProfile() {
  $('#profileAvatar').src = avatarUrl(state.me);
  $('#profileUsername').textContent = `@${state.me.username}`;
  $('#profileBio').textContent = state.me.bio;
  $('#profileJoined').textContent = `Joined ${new Date(state.me.createdAt).toLocaleDateString()}`;
  $('#profileForm').elements.bio.value = state.me.bio;
}

function loadVideo() {
  const video = $('#miniVideo');
  video.src = state.videos[state.videoIndex];
  $('#videoCounter').textContent = `${state.videoIndex + 1} / ${state.videos.length}`;
  video.load();
  video.play().catch(() => {});
}

$('#loginTab').addEventListener('click', () => { $('#loginTab').classList.add('active'); $('#registerTab').classList.remove('active'); $('#loginForm').classList.remove('hidden'); $('#registerForm').classList.add('hidden'); });
$('#registerTab').addEventListener('click', () => { $('#registerTab').classList.add('active'); $('#loginTab').classList.remove('active'); $('#registerForm').classList.remove('hidden'); $('#loginForm').classList.add('hidden'); });

$('#registerForm').addEventListener('submit', async event => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
  try { await api('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }); toast('Account created. Sign in to continue.'); $('#loginTab').click(); $('#loginForm').elements.username.value = data.username; event.currentTarget.reset(); } catch (error) { toast(error.message, true); }
});

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
  try { const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }); await authenticate(result.token); event.currentTarget.reset(); } catch (error) { toast(error.message, true); }
});

$('#logoutBtn').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST' }); } catch {} logoutLocal(); });
$('#nav').addEventListener('click', event => { const button = event.target.closest('[data-view]'); if (button) showView(button.dataset.view); });
document.addEventListener('click', event => { const go = event.target.closest('[data-go]'); if (go) showView(go.dataset.go); });
$('#mobileMenuBtn').addEventListener('click', () => $('.sidebar').classList.toggle('open'));

$('#postForm').elements.image.addEventListener('change', async event => { try { const url = await fileToDataUrl(event.target.files[0]); $('#postPreview').src = url; $('#postPreview').classList.toggle('hidden', !url); } catch (error) { event.target.value = ''; $('#postPreview').classList.add('hidden'); toast(error.message, true); } });
$('#postForm').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget;
  try { const image = await fileToDataUrl(form.elements.image.files[0]); await api('/api/posts', { method: 'POST', body: JSON.stringify({ title: form.elements.title.value, body: form.elements.body.value, image }) }); form.reset(); $('#postPreview').classList.add('hidden'); toast('Post published.'); showView('feed'); } catch (error) { toast(error.message, true); }
});

$('#searchBtn').addEventListener('click', searchUsers);
$('#userSearch').addEventListener('keydown', e => { if (e.key === 'Enter') searchUsers(); });
$('#friendsView').addEventListener('click', async event => {
  const add = event.target.closest('[data-add]'); const respond = event.target.closest('[data-respond]'); const remove = event.target.closest('[data-remove]'); const message = event.target.closest('[data-message]');
  try {
    if (add) { await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ username: add.dataset.add }) }); toast('Friend request sent.'); await loadFriends(); }
    if (respond) { await api('/api/friends/respond', { method: 'POST', body: JSON.stringify({ username: respond.dataset.user, action: respond.dataset.respond }) }); toast(`Request ${respond.dataset.respond}ed.`); await loadFriends(); }
    if (remove) { await api(`/api/friends/${encodeURIComponent(remove.dataset.remove)}`, { method: 'DELETE' }); toast('Friend removed.'); await loadFriends(); }
    if (message) { showView('messages'); await loadMessageFriends(); await openConversation(message.dataset.message); }
  } catch (error) { toast(error.message, true); }
});

$('#messageFriends').addEventListener('click', event => { const button = event.target.closest('[data-conversation]'); if (button) openConversation(button.dataset.conversation); });
$('#messageForm').addEventListener('submit', async event => {
  event.preventDefault(); if (!state.activeConversation) return;
  const input = event.currentTarget.elements.body;
  try { await api('/api/messages', { method: 'POST', body: JSON.stringify({ username: state.activeConversation, body: input.value }) }); input.value = ''; await openConversation(state.activeConversation); } catch (error) { toast(error.message, true); }
});

$('#profileForm').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget;
  try { const avatar = form.elements.avatar.files[0] ? await fileToDataUrl(form.elements.avatar.files[0]) : undefined; const payload = { bio: form.elements.bio.value }; if (avatar !== undefined) payload.avatar = avatar; const { user } = await api('/api/me', { method: 'PATCH', body: JSON.stringify(payload) }); state.me = user; renderSidebarUser(); form.elements.avatar.value = ''; loadProfile(); toast('Profile updated.'); } catch (error) { toast(error.message, true); }
});

$('#prevVideo').addEventListener('click', () => { state.videoIndex = (state.videoIndex - 1 + state.videos.length) % state.videos.length; loadVideo(); });
$('#nextVideo').addEventListener('click', () => { state.videoIndex = (state.videoIndex + 1) % state.videos.length; loadVideo(); });
$('#miniVideo').addEventListener('ended', () => { state.videoIndex = (state.videoIndex + 1) % state.videos.length; loadVideo(); });

(async function boot() {
  if (!state.token) return;
  try { await authenticate(state.token); } catch { logoutLocal(); }
})();
