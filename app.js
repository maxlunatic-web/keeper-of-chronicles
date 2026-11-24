/* KEEPER OF CHRONICLES - THE APP
 * Version 1.0 (build step 1: logins, chronicles, GM/player views, pages, search)
 * You do not need to change anything in this file. Your settings live in config.js.
 */
'use strict';

const APP_VERSION = '1.0';
const API_URL = (window.KEEPER_API_URL || '').trim();

const CATEGORIES = [
  'Player Characters',
  'NPCs',
  'Factions & Clans',
  'Locations',
  'Session Logs',
  'Lore',
  'Crossover Universes',
  'Items & Artifacts',
  'Other'
];

const CATEGORY_ICONS = {
  'Player Characters': '🎭',
  'NPCs': '👤',
  'Factions & Clans': '🛡️',
  'Locations': '🏰',
  'Session Logs': '📜',
  'Lore': '📖',
  'Crossover Universes': '🌀',
  'Items & Artifacts': '🗝️',
  'Other': '✒️'
};

const VISIBILITY_LABELS = {
  everyone: 'Everyone',
  gm: 'GM only',
  private: 'Private'
};

/* ------------------------------------------------------------------ */
/* Saved data on this device                                           */
/* ------------------------------------------------------------------ */
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }
};

const state = {
  token: store.get('kc_token', null),
  user: store.get('kc_user', null),
  users: store.get('kc_users', []),
  chronicles: store.get('kc_chronicles', []),
  chronicleId: store.get('kc_chronicle', null),
  pages: [],
  pagesLoadedAt: 0,
  offline: false,
  busy: 0,
  installPrompt: null
};

/* ------------------------------------------------------------------ */
/* Talking to the Google Apps Script backend                           */
/* ------------------------------------------------------------------ */
class NetworkError extends Error {}

async function api(action, data) {
  const body = Object.assign({ action: action, token: state.token }, data || {});
  let response;
  setBusy(+1);
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    });
  } catch (e) {
    throw new NetworkError('No connection to the server. Check your internet.');
  } finally {
    setBusy(-1);
  }
  let json;
  try {
    json = await response.json();
  } catch (e) {
    throw new Error('The server sent an unexpected answer. Is the Web app URL in config.js correct, and is the deployment set to "Anyone"?');
  }
  if (!json.ok) {
    if (json.code === 'AUTH') {
      forgetLogin();
      render();
    }
    throw new Error(json.error || 'Something went wrong.');
  }
  setOffline(false);
  return json.data;
}

function setBusy(delta) {
  state.busy = Math.max(0, state.busy + delta);
  document.body.classList.toggle('busy', state.busy > 0);
}

function setOffline(value) {
  if (state.offline === value) return;
  state.offline = value;
  const banner = document.getElementById('offline-banner');
  if (banner) banner.hidden = !value;
}

/* ------------------------------------------------------------------ */
/* Login, start-up and chronicles                                      */
/* ------------------------------------------------------------------ */
function forgetLogin() {
  state.token = null;
  state.user = null;
  store.remove('kc_token');
  store.remove('kc_user');
}

async function login(username, password) {
  const device = (navigator.userAgent || '').slice(0, 150);
  const data = await api('login', { username: username, password: password, device: device });
  state.token = data.token;
  state.user = data.user;
  store.set('kc_token', data.token);
  store.set('kc_user', data.user);
  await loadBootstrap();
}

async function logout() {
  try { await api('logout'); } catch (e) { /* even if offline, forget the login on this device */ }
  forgetLogin();
  state.pages = [];
  location.hash = '#/';
  render();
}

async function loadBootstrap() {
  const data = await api('bootstrap');
  state.user = data.user;
  state.users = data.users;
  state.chronicles = data.chronicles;
  store.set('kc_user', data.user);
  store.set('kc_users', data.users);
  store.set('kc_chronicles', data.chronicles);
  if (state.chronicleId && !currentChronicle()) chooseChronicle(null);
}

function currentChronicle() {
  return state.chronicles.find((c) => c.id === state.chronicleId) || null;
}

function role() {
  const c = currentChronicle();
  return c ? c.role : 'none';
}

function isGM() {
  return role() === 'gm';
}

function userName(username) {
  const u = state.users.find((x) => x.username === username);
  return u ? u.displayName : (username || 'someone');
}

function chooseChronicle(id) {
  state.chronicleId = id;
  if (id) store.set('kc_chronicle', id); else store.remove('kc_chronicle');
  state.pages = id ? store.get('kc_pages_' + id, []) : [];
  state.pagesLoadedAt = 0;
}

async function loadPages() {
  if (!state.chronicleId) return;
  const id = state.chronicleId;
  try {
    const data = await api('listPages', { chronicleId: id });
    if (state.chronicleId !== id) return; // switched chronicle meanwhile
    state.pages = data.pages;
    state.pagesLoadedAt = Date.now();
    store.set('kc_pages_' + id, data.pages);
  } catch (e) {
    if (e instanceof NetworkError) {
      setOffline(true);
      state.pages = store.get('kc_pages_' + id, []);
    } else {
      throw e;
    }
  }
}

async function refreshAll(showMessage) {
  try {
    await loadBootstrap();
    await loadPages();
    if (showMessage) toast('Up to date.');
  } catch (e) {
    if (e instanceof NetworkError) {
      setOffline(true);
      if (showMessage) toast('You are offline. Showing the copy saved on this phone.');
    } else {
      toast(e.message, true);
    }
  }
  if (!$('#editor')) render(); // never redraw a page someone is typing in
}

function rememberPage(page) {
  const i = state.pages.findIndex((p) => p.id === page.id);
  if (i >= 0) state.pages[i] = page; else state.pages.push(page);
  store.set('kc_pages_' + state.chronicleId, state.pages);
}

function forgetPage(id) {
  state.pages = state.pages.filter((p) => p.id !== id);
  store.set('kc_pages_' + state.chronicleId, state.pages);
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */
function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function unesc(value) {
  return String(value)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function $(selector, root) { return (root || document).querySelector(selector); }
function $$(selector, root) { return Array.from((root || document).querySelectorAll(selector)); }

function on(selector, eventName, handler) {
  $$(selector).forEach((el) => el.addEventListener(eventName, handler));
}

function toast(message, isError) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.className = 'toast'; }, isError ? 6000 : 3000);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + ' h ago';
  if (diff < 7 * 86400) return Math.floor(diff / 86400) + ' days ago';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function tagList(page) {
  return String(page.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
}

function byTitle(a, b) {
  return a.title.localeCompare(b.title, 'en', { sensitivity: 'base' });
}

function byUpdated(a, b) {
  return String(b.updated).localeCompare(String(a.updated));
}

function findPageByTitle(title) {
  const t = String(title).trim().toLowerCase();
  return state.pages.find((p) => p.title.toLowerCase() === t) || null;
}

function allCategories() {
  const set = new Set(CATEGORIES);
  state.pages.forEach((p) => { if (p.category) set.add(p.category); });
  return Array.from(set);
}

function visibilityBadge(page) {
  if (page.visibility === 'gm') return '<span class="badge badge-gm" title="Hidden from players">🔒 GM only</span>';
  if (page.visibility === 'private') return '<span class="badge badge-private" title="Only the author sees this">👁 Private</span>';
  return '';
}

function plainText(markdown) {
  return String(markdown || '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Page text formatting (a small, safe "Markdown")                     */
/* ------------------------------------------------------------------ */
function formatInline(text) {
  // text is already HTML-escaped
  let s = text;
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (match, rawTitle, rawLabel) => {
    const title = unesc(rawTitle).trim();
    const label = rawLabel ? rawLabel : rawTitle;
    const target = findPageByTitle(title);
    if (target) return '<a class="wikilink" href="#/p/' + encodeURIComponent(target.id) + '">' + label + '</a>';
    return '<a class="wikilink missing" title="This page does not exist yet. Tap to create it." href="#/new?title=' +
      encodeURIComponent(title) + '">' + label + '</a>';
  });
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s;
}

function renderMarkdown(source) {
  const lines = esc(source || '').split(/\r?\n/);
  let html = '';
  let paragraph = [];
  let list = null;
  let quote = [];

  const flushParagraph = () => {
    if (paragraph.length) html += '<p>' + formatInline(paragraph.join('<br>')) + '</p>';
    paragraph = [];
  };
  const flushList = () => {
    if (list) html += '<' + list.type + '>' + list.items.map((i) => '<li>' + formatInline(i) + '</li>').join('') + '</' + list.type + '>';
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) html += '<blockquote>' + formatInline(quote.join('<br>')) + '</blockquote>';
    quote = [];
  };
  const flushAll = () => { flushParagraph(); flushList(); flushQuote(); };

  lines.forEach((line) => {
    let m;
    if (/^\s*$/.test(line)) { flushAll(); return; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      flushAll();
      const level = m[1].length + 1; // # becomes <h2>, because the page title is <h1>
      html += '<h' + level + '>' + formatInline(m[2]) + '</h' + level + '>';
      return;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushAll(); html += '<hr>'; return; }
    if ((m = line.match(/^&gt;\s?(.*)$/))) { flushParagraph(); flushList(); quote.push(m[1]); return; }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      flushParagraph(); flushQuote();
      if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
      list.items.push(m[1]);
      return;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushParagraph(); flushQuote();
      if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
      list.items.push(m[1]);
      return;
    }
    flushList(); flushQuote();
    paragraph.push(line);
  });
  flushAll();
  return html || '<p class="muted">This page is still empty.</p>';
}

/* ------------------------------------------------------------------ */
/* Router: the part after # in the address decides which screen shows   */
/* ------------------------------------------------------------------ */
function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = hash.split('?');
  const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const query = {};
  (queryPart || '').split('&').filter(Boolean).forEach((pair) => {
    const [k, v] = pair.split('=');
    query[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '));
  });
  return { name: parts[0] || 'home', id: parts[1] || '', query: query };
}

function go(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

function render() {
  const app = document.getElementById('app');

  if (!API_URL || API_URL.indexOf('PASTE-YOUR') === 0) {
    document.body.dataset.role = 'none';
    app.innerHTML = viewNotConfigured();
    return;
  }
  if (!state.token) {
    document.body.dataset.role = 'none';
    app.innerHTML = viewLogin();
    bindLogin();
    return;
  }

  const route = parseRoute();

  if (!currentChronicle() || route.name === 'chronicles' || route.name === 'chronicle') {
    document.body.dataset.role = 'none';
    if (route.name === 'chronicle') {
      app.innerHTML = shell(viewChronicleForm(route.id), true);
      bindChronicleForm(route.id);
    } else {
      app.innerHTML = shell(viewChroniclePicker(), !!currentChronicle());
      bindChroniclePicker();
    }
    return;
  }

  document.body.dataset.role = role();
  let content = '';
  let bind = () => {};
  switch (route.name) {
    case 'p':        content = viewPage(route.id); bind = () => bindPage(route.id); break;
    case 'edit':     content = viewEditor(route.id, route.query); bind = () => bindEditor(route.id, route.query); break;
    case 'new':      content = viewEditor('', route.query); bind = () => bindEditor('', route.query); break;
    case 'c':        content = viewCategory(route.id); break;
    case 'search':   content = viewSearch(route.query); bind = () => bindSearch(); break;
    case 'settings': content = viewSettings(); bind = () => bindSettings(); break;
    default:         content = viewHome(); bind = () => bindHome();
  }
  app.innerHTML = shell(content, true);
  bindShell();
  bind();
}

/* ------------------------------------------------------------------ */
/* The frame around every screen: top bar, offline banner, bottom bar  */
/* ------------------------------------------------------------------ */
function shell(content, withNav) {
  const c = currentChronicle();
  const route = parseRoute().name;
  const roleBadge = !c ? '' : (c.role === 'gm'
    ? '<span class="role-chip gm">GM view</span>'
    : '<span class="role-chip player">Player view</span>');
  const tab = (name, hash, icon, label) =>
    '<a class="tab' + (route === name ? ' active' : '') + '" href="' + hash + '"><span class="tab-icon">' + icon + '</span><span>' + label + '</span></a>';

  return '' +
    '<header class="topbar">' +
      '<a class="brand" href="#/chronicles" title="Switch chronicle">' +
        '<img src="icon-192.png" alt="" width="32" height="32">' +
        '<span class="brand-text"><span class="brand-small">Keeper of Chronicles</span>' +
        '<span class="brand-chronicle">' + esc(c ? c.name : 'Choose a chronicle') + '</span></span>' +
      '</a>' +
      roleBadge +
      '<button class="icon-btn" id="refresh-btn" title="Refresh from server" aria-label="Refresh">⟳</button>' +
    '</header>' +
    '<div class="gm-stripe" aria-hidden="true"></div>' +
    '<div id="offline-banner" class="offline-banner"' + (state.offline ? '' : ' hidden') + '>Offline: showing the copy saved on this phone. Editing is paused.</div>' +
    '<main class="view">' + content + '</main>' +
    (withNav && c ? '<nav class="bottombar">' +
      tab('home', '#/', '⌂', 'Home') +
      tab('search', '#/search', '⌕', 'Search') +
      tab('new', '#/new', '＋', 'New page') +
      tab('settings', '#/settings', '⚙', 'Settings') +
    '</nav>' : '');
}

function bindShell() {
  on('#refresh-btn', 'click', () => refreshAll(true));
}

/* ------------------------------------------------------------------ */
/* Screen: not configured yet                                          */
/* ------------------------------------------------------------------ */
function viewNotConfigured() {
  return '<main class="view narrow center-screen">' +
    '<img src="icon-192.png" alt="" width="96" height="96">' +
    '<h1>Almost there</h1>' +
    '<p>The app does not know where its Google backend is yet.</p>' +
    '<p>Open <strong>config.js</strong> on GitHub and paste your Apps Script <strong>Web app URL</strong> between the quotes. ' +
    'The setup guide, step 6, shows how.</p>' +
    '</main>';
}

/* ------------------------------------------------------------------ */
/* Screen: login                                                       */
/* ------------------------------------------------------------------ */
function viewLogin() {
  return '<main class="view narrow center-screen">' +
    '<img class="login-logo" src="icon-512.png" alt="" width="128" height="128">' +
    '<h1 class="login-title">Keeper of Chronicles</h1>' +
    '<p class="muted">The archives are sealed. Speak your name.</p>' +
    '<form id="login-form" class="card form" autocomplete="on">' +
      '<label>Login name<input name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>' +
      '<label>Password<input name="password" type="password" autocomplete="current-password" required></label>' +
      '<button class="btn primary" type="submit">Log in</button>' +
      '<p class="muted small">You stay logged in on this device until you log out in Settings.</p>' +
    '</form>' +
    '</main>';
}

function bindLogin() {
  on('#login-form', 'submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const button = $('button', form);
    button.disabled = true;
    button.textContent = 'Checking…';
    try {
      await login(form.username.value.trim().toLowerCase(), form.password.value);
      if (state.chronicleId && currentChronicle()) {
        await loadPages();
        location.hash = '#/';
      } else {
        location.hash = '#/chronicles';
      }
      render();
    } catch (e) {
      toast(e.message, true);
      button.disabled = false;
      button.textContent = 'Log in';
    }
  });
}

/* ------------------------------------------------------------------ */
/* Screen: choose a chronicle                                          */
/* ------------------------------------------------------------------ */
function chronicleCard(c) {
  const roleText = c.role === 'gm' ? '<span class="role-chip gm">You are the GM</span>'
    : '<span class="role-chip player">You play · GM: ' + esc(userName(c.gm)) + '</span>';
  return '<div class="card chronicle-card' + (c.id === state.chronicleId ? ' current' : '') + '">' +
    '<button class="chronicle-open" data-id="' + esc(c.id) + '">' +
      '<span class="chronicle-name">' + esc(c.name) + '</span>' +
      (c.description ? '<span class="chronicle-desc">' + esc(c.description) + '</span>' : '') +
      roleText +
    '</button>' +
    '<a class="chronicle-edit" href="#/chronicle/' + encodeURIComponent(c.id) + '" title="Edit chronicle" aria-label="Edit chronicle">✎</a>' +
  '</div>';
}

function viewChroniclePicker() {
  const active = state.chronicles.filter((c) => c.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name));
  const archived = state.chronicles.filter((c) => c.status === 'archived').sort((a, b) => a.name.localeCompare(b.name));
  return '<div class="narrow">' +
    '<h1>Which chronicle?</h1>' +
    '<p class="muted">Welcome, ' + esc(state.user ? state.user.displayName : '') + '. Choose the chronicle to open.</p>' +
    (active.length ? active.map(chronicleCard).join('') :
      '<div class="card empty">No chronicles yet. Create the first one below.</div>') +
    '<a class="btn primary block" href="#/chronicle/new">＋ Create a new chronicle</a>' +
    (archived.length ? '<details class="archived"><summary>Archived chronicles (' + archived.length + ')</summary>' +
      archived.map(chronicleCard).join('') + '</details>' : '') +
    '<p class="center"><button class="btn link" id="picker-refresh">Refresh list</button> · <button class="btn link" id="picker-logout">Log out</button></p>' +
  '</div>';
}

function bindChroniclePicker() {
  bindShell();
  on('.chronicle-open', 'click', async (event) => {
    const id = event.currentTarget.dataset.id;
    chooseChronicle(id);
    location.hash = '#/';
    render();
    try { await loadPages(); } catch (e) { toast(e.message, true); }
    render();
  });
  on('#picker-refresh', 'click', () => refreshAll(true));
  on('#picker-logout', 'click', () => { if (confirm('Log out on this device?')) logout(); });
}

/* ------------------------------------------------------------------ */
/* Screen: create or edit a chronicle                                  */
/* ------------------------------------------------------------------ */
function viewChronicleForm(id) {
  const c = id === 'new' ? null : state.chronicles.find((x) => x.id === id);
  if (id !== 'new' && !c) return '<div class="narrow"><p>Chronicle not found.</p><a href="#/chronicles">Back</a></div>';
  const gm = c ? c.gm : (state.user && state.user.username);
  return '<div class="narrow">' +
    '<h1>' + (c ? 'Edit chronicle' : 'New chronicle') + '</h1>' +
    '<form id="chronicle-form" class="card form">' +
      '<label>Name<input name="name" required maxlength="200" value="' + esc(c ? c.name : '') + '" placeholder="e.g. Budapest by Night"></label>' +
      '<label>Short description<textarea name="description" rows="3" maxlength="2000" placeholder="Optional">' + esc(c ? c.description : '') + '</textarea></label>' +
      '<label>Who is the GM?<select name="gm">' +
        state.users.map((u) => '<option value="' + esc(u.username) + '"' + (u.username === gm ? ' selected' : '') + '>' + esc(u.displayName) + '</option>').join('') +
      '</select></label>' +
      '<p class="muted small">The GM sees hidden pages and GM notes in this chronicle. Everyone else gets the player view.</p>' +
      (c ? '<label>Status<select name="status">' +
        '<option value="active"' + (c.status !== 'archived' ? ' selected' : '') + '>Active</option>' +
        '<option value="archived"' + (c.status === 'archived' ? ' selected' : '') + '>Archived (finished)</option>' +
      '</select></label>' : '') +
      '<div class="row">' +
        '<button class="btn primary" type="submit">Save</button>' +
        '<a class="btn" href="#/chronicles">Cancel</a>' +
      '</div>' +
    '</form>' +
  '</div>';
}

function bindChronicleForm(id) {
  bindShell();
  on('#chronicle-form', 'submit', async (event) => {
    event.preventDefault();
    if (state.offline) { toast('You are offline. Try again when you have internet.', true); return; }
    const f = event.target;
    const button = $('button[type=submit]', f);
    button.disabled = true;
    try {
      const saved = await api('saveChronicle', {
        chronicle: {
          id: id === 'new' ? '' : id,
          name: f.name.value,
          description: f.description.value,
          gm: f.gm.value,
          status: f.status ? f.status.value : 'active'
        }
      });
      const i = state.chronicles.findIndex((c) => c.id === saved.id);
      if (i >= 0) state.chronicles[i] = saved; else state.chronicles.push(saved);
      store.set('kc_chronicles', state.chronicles);
      toast('Chronicle saved.');
      if (id === 'new') {
        chooseChronicle(saved.id);
        await loadPages();
        go('#/');
      } else {
        go(saved.id === state.chronicleId ? '#/settings' : '#/chronicles');
      }
    } catch (e) {
      toast(e.message, true);
      button.disabled = false;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Screen: home                                                        */
/* ------------------------------------------------------------------ */
function pageItem(page, extra) {
  const tags = tagList(page).slice(0, 4).map((t) => '<span class="tag">#' + esc(t) + '</span>').join('');
  return '<li class="page-item">' +
    '<a href="#/p/' + encodeURIComponent(page.id) + '">' +
      '<span class="page-item-title">' + esc(page.title) + ' ' + visibilityBadge(page) + '</span>' +
      '<span class="page-item-meta">' + esc(page.category) + ' · ' + esc(formatDate(page.updated)) + (tags ? ' ' + tags : '') + '</span>' +
    '</a>' + (extra || '') +
  '</li>';
}

function viewHome() {
  const c = currentChronicle();
  const pages = state.pages;
  const counts = {};
  pages.forEach((p) => { counts[p.category] = (counts[p.category] || 0) + 1; });

  const intro = '<section class="hero">' +
    '<h1>' + esc(c.name) + '</h1>' +
    (c.description ? '<p class="muted">' + esc(c.description) + '</p>' : '') +
    '<p class="hero-role">' + (isGM()
      ? 'You are the <strong>Game Master</strong> of this chronicle. Hidden pages and GM notes are visible to you.'
      : 'You are a <strong>player</strong> in this chronicle. Your GM is ' + esc(userName(c.gm)) + '.') + '</p>' +
    '<form id="home-search" class="search-row"><input name="q" type="search" placeholder="Search ' + pages.length + (pages.length === 1 ? ' page' : ' pages') + '…" aria-label="Search"></form>' +
  '</section>';

  const categories = '<section><h2>Categories</h2><div class="cat-grid">' +
    allCategories().map((cat) =>
      '<a class="cat" href="#/c/' + encodeURIComponent(cat) + '">' +
        '<span class="cat-icon">' + (CATEGORY_ICONS[cat] || '📁') + '</span>' +
        '<span class="cat-name">' + esc(cat) + '</span>' +
        '<span class="cat-count">' + (counts[cat] || 0) + '</span>' +
      '</a>').join('') +
  '</div></section>';

  let special = '';
  if (isGM()) {
    const hidden = pages.filter((p) => p.visibility === 'gm').sort(byUpdated);
    special = '<section class="panel gm-panel"><h2>🔒 Hidden from players (' + hidden.length + ')</h2>' +
      (hidden.length ? '<ul class="page-list">' + hidden.slice(0, 12).map((p) => pageItem(p,
        '<button class="btn small reveal-btn" data-id="' + esc(p.id) + '">Reveal</button>')).join('') + '</ul>'
        : '<p class="muted">Nothing hidden right now. New pages you create are hidden until you reveal them.</p>') +
    '</section>';
  } else {
    const revealed = pages.filter((p) => p.revealedAt).sort((a, b) => String(b.revealedAt).localeCompare(String(a.revealedAt)));
    special = '<section class="panel player-panel"><h2>✨ Recently revealed</h2>' +
      (revealed.length ? '<ul class="page-list">' + revealed.slice(0, 8).map((p) => pageItem(p)).join('') + '</ul>'
        : '<p class="muted">The GM has not revealed any secrets yet.</p>') +
    '</section>';
  }

  const mine = pages.filter((p) => p.visibility === 'private' && p.author === state.user.username).sort(byUpdated);
  const myPrivate = mine.length ? '<section><h2>👁 My private pages</h2><ul class="page-list">' +
    mine.slice(0, 8).map((p) => pageItem(p)).join('') + '</ul></section>' : '';

  const recent = pages.slice().sort(byUpdated).slice(0, 10);
  const recentHtml = '<section><h2>Recently updated</h2>' + (recent.length
    ? '<ul class="page-list">' + recent.map((p) => pageItem(p)).join('') + '</ul>'
    : '<div class="card empty">No pages yet. Tap <strong>＋ New page</strong> below to write the first one.</div>') +
  '</section>';

  return intro + special + categories + myPrivate + recentHtml;
}

function bindHome() {
  on('#home-search', 'submit', (event) => {
    event.preventDefault();
    go('#/search?q=' + encodeURIComponent(event.target.q.value));
  });
  on('.reveal-btn', 'click', (event) => {
    event.preventDefault();
    revealPage(event.currentTarget.dataset.id);
  });
}

async function revealPage(id) {
  const page = state.pages.find((p) => p.id === id);
  if (!page) return;
  if (state.offline) { toast('You are offline. Try again when you have internet.', true); return; }
  if (!confirm('Reveal "' + page.title + '" to the players?\n\nGM notes stay hidden.')) return;
  try {
    const saved = await api('revealPage', { id: id });
    rememberPage(saved);
    toast('Revealed to the players.');
    render();
  } catch (e) { toast(e.message, true); }
}

/* ------------------------------------------------------------------ */
/* Screen: one category                                                */
/* ------------------------------------------------------------------ */
function viewCategory(category) {
  const pages = state.pages.filter((p) => p.category === category).sort(byTitle);
  return '<div class="narrow">' +
    '<p class="crumbs"><a href="#/">Home</a> ›</p>' +
    '<h1>' + (CATEGORY_ICONS[category] || '📁') + ' ' + esc(category) + '</h1>' +
    (pages.length ? '<ul class="page-list">' + pages.map((p) => pageItem(p)).join('') + '</ul>'
      : '<div class="card empty">No pages in this category yet.</div>') +
    '<a class="btn primary block" href="#/new?category=' + encodeURIComponent(category) + '">＋ New page in ' + esc(category) + '</a>' +
  '</div>';
}

/* ------------------------------------------------------------------ */
/* Screen: one wiki page                                               */
/* ------------------------------------------------------------------ */
function viewPage(id) {
  const page = state.pages.find((p) => p.id === id);
  if (!page) {
    return '<div class="narrow"><h1>Page not found</h1>' +
      '<p class="muted">It may have been deleted, it may be hidden from you, or it has not been loaded yet. Try the refresh button at the top.</p>' +
      '<a class="btn" href="#/">Back to home</a></div>';
  }
  const tags = tagList(page).map((t) =>
    '<a class="tag" href="#/search?q=' + encodeURIComponent('#' + t) + '">#' + esc(t) + '</a>').join(' ');

  let hiddenNotice = '';
  if (page.visibility === 'gm') {
    hiddenNotice = '<div class="notice notice-gm">🔒 <strong>Hidden from players.</strong> ' +
      (page.canReveal ? 'Only you' + (page.author !== state.user.username ? ' and ' + esc(userName(page.author)) : '') + ' can see this page.' : '') +
      (page.canReveal ? ' <button class="btn small primary" id="reveal-btn">Reveal to players</button>' : '') + '</div>';
  } else if (page.visibility === 'private') {
    hiddenNotice = '<div class="notice notice-private">👁 <strong>Private.</strong> Only you can see this page.' +
      (page.canReveal ? ' <button class="btn small" id="reveal-btn">Share with everyone</button>' : '') + '</div>';
  }

  const notesLabel = isGM() ? 'GM notes · players never see these' : 'Secret notes · only you and the GM see these';
  const gmNotes = page.canSeeSecrets && page.gmNotes
    ? '<aside class="gm-notes"><h2>' + notesLabel + '</h2>' + renderMarkdown(page.gmNotes) + '</aside>' : '';

  const linkPattern = new RegExp('\\[\\[\\s*' + page.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(\\||\\]\\])', 'i');
  const backlinks = state.pages.filter((p) => p.id !== page.id && (linkPattern.test(p.content) || (p.canSeeSecrets && linkPattern.test(p.gmNotes)))).sort(byTitle);

  return '<article class="narrow page">' +
    '<p class="crumbs"><a href="#/">Home</a> › <a href="#/c/' + encodeURIComponent(page.category) + '">' + esc(page.category) + '</a></p>' +
    '<h1 class="page-title">' + esc(page.title) + '</h1>' +
    '<p class="page-meta">' + visibilityBadge(page) + ' ' + tags + '</p>' +
    hiddenNotice +
    '<div class="content">' + renderMarkdown(page.content) + '</div>' +
    gmNotes +
    (backlinks.length ? '<section class="backlinks"><h2>Pages that link here</h2><ul class="page-list">' +
      backlinks.map((p) => pageItem(p)).join('') + '</ul></section>' : '') +
    '<p class="muted small">Written by ' + esc(userName(page.author)) + ' · last changed ' + esc(formatDate(page.updated)) +
      (page.updatedBy ? ' by ' + esc(userName(page.updatedBy)) : '') + '</p>' +
    '<div class="row actions">' +
      '<a class="btn primary" href="#/edit/' + encodeURIComponent(page.id) + '">✎ Edit</a>' +
      (page.canDelete ? '<button class="btn danger" id="delete-btn">Delete</button>' : '') +
    '</div>' +
  '</article>';
}

function bindPage(id) {
  on('#reveal-btn', 'click', () => revealPage(id));
  on('#delete-btn', 'click', async () => {
    const page = state.pages.find((p) => p.id === id);
    if (!page) return;
    if (state.offline) { toast('You are offline. Try again when you have internet.', true); return; }
    if (!confirm('Delete "' + page.title + '" for good? This cannot be undone.')) return;
    try {
      await api('deletePage', { id: id });
      forgetPage(id);
      toast('Page deleted.');
      go('#/');
    } catch (e) { toast(e.message, true); }
  });
}

/* ------------------------------------------------------------------ */
/* Screen: create or edit a page                                       */
/* ------------------------------------------------------------------ */
function draftKey(id) {
  return 'kc_draft_' + state.chronicleId + '_' + (id || 'new');
}

function viewEditor(id, query) {
  const existing = id ? state.pages.find((p) => p.id === id) : null;
  if (id && !existing) return '<div class="narrow"><h1>Page not found</h1><a class="btn" href="#/">Back</a></div>';

  const base = existing || {
    title: query.title || '',
    category: query.category || 'Other',
    tags: '',
    visibility: isGM() ? 'gm' : 'everyone',
    content: '',
    gmNotes: '',
    canSeeSecrets: true
  };
  const draft = store.get(draftKey(id), null);
  const page = draft ? Object.assign({}, base, draft) : base;

  const mayChangeVisibility = !existing || existing.canSeeSecrets;
  const visOptions = ['everyone', 'gm', 'private'].filter((v) => v !== 'gm' || isGM() || page.visibility === 'gm');
  const visHelp = {
    everyone: 'Everyone in this chronicle can read it.',
    gm: 'Only the GM sees it until it is revealed.',
    private: 'Only you can see it.'
  };
  const categories = allCategories();
  if (page.category && categories.indexOf(page.category) < 0) categories.push(page.category);
  const showNotes = !existing || existing.canSeeSecrets;
  const notesLabel = isGM() ? 'GM notes (players never see these)' : 'Secret notes (only you and the GM see these)';

  return '<div class="narrow">' +
    '<h1>' + (existing ? 'Edit page' : 'New page') + '</h1>' +
    (draft ? '<div class="notice">Your unsaved changes were restored. <button type="button" class="btn small" id="discard-draft">Discard them</button></div>' : '') +
    (state.offline ? '<div class="notice notice-gm">You are offline. You can type, and your text is kept on this phone, but saving needs internet.</div>' : '') +
    '<form id="editor" class="form">' +
      '<label>Title<input name="title" required maxlength="200" value="' + esc(page.title) + '" placeholder="e.g. Prince Vitel"></label>' +
      '<div class="two-col">' +
        '<label>Category<select name="category">' +
          categories.map((c) => '<option' + (c === page.category ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
        '</select></label>' +
        '<label>Who can see it?<select name="visibility"' + (mayChangeVisibility ? '' : ' disabled') + '>' +
          visOptions.map((v) => '<option value="' + v + '"' + (v === page.visibility ? ' selected' : '') + '>' + VISIBILITY_LABELS[v] + '</option>').join('') +
        '</select><span class="hint" id="vis-help">' + esc(visHelp[page.visibility] || '') + '</span></label>' +
      '</div>' +
      '<label>Tags <span class="hint">separate with commas</span><input name="tags" value="' + esc(page.tags) + '" placeholder="e.g. Tremere, Vienna, 1990s"></label>' +
      '<div class="editor-head"><span>Text</span>' +
        '<span class="toolbar">' +
          '<button type="button" data-wrap="**|**" title="Bold"><b>B</b></button>' +
          '<button type="button" data-wrap="*|*" title="Italic"><i>I</i></button>' +
          '<button type="button" data-line="## " title="Heading">H</button>' +
          '<button type="button" data-line="- " title="List">•</button>' +
          '<button type="button" data-wrap="[[|]]" title="Link to another page">[[ ]]</button>' +
          '<button type="button" id="preview-toggle" title="Preview">👁</button>' +
        '</span></div>' +
      '<textarea name="content" rows="14" placeholder="Write here. Link to another page like this: [[Page name]]">' + esc(page.content) + '</textarea>' +
      '<div id="preview" class="content preview" hidden></div>' +
      '<details class="format-help"><summary>Formatting help</summary>' +
        '<p><code>**bold**</code> · <code>*italic*</code> · <code>## Heading</code> · <code>- list item</code> · <code>&gt; quote</code> · <code>---</code> line<br>' +
        '<code>[[Page name]]</code> links to a page (a link to a page that does not exist yet lets you create it).<br>' +
        '<code>[[Page name|other words]]</code> shows other words as the link.</p></details>' +
      (showNotes ? '<label class="gm-notes-label">' + notesLabel +
        '<textarea name="gmNotes" rows="6" placeholder="Secrets, plans, true identities…">' + esc(page.gmNotes || '') + '</textarea></label>' : '') +
      '<div class="row actions sticky-actions">' +
        '<button class="btn primary" type="submit">Save</button>' +
        '<button class="btn" type="button" id="cancel-edit">Cancel</button>' +
      '</div>' +
    '</form>' +
  '</div>';
}

function bindEditor(id, query) {
  const form = $('#editor');
  if (!form) return;
  const textarea = form.content;
  const visHelp = {
    everyone: 'Everyone in this chronicle can read it.',
    gm: 'Only the GM sees it until it is revealed.',
    private: 'Only you can see it.'
  };

  const saveDraft = () => {
    store.set(draftKey(id), {
      title: form.title.value,
      category: form.category.value,
      tags: form.tags.value,
      visibility: form.visibility.value,
      content: form.content.value,
      gmNotes: form.gmNotes ? form.gmNotes.value : undefined
    });
  };
  form.addEventListener('input', saveDraft);
  form.visibility.addEventListener('change', () => { $('#vis-help').textContent = visHelp[form.visibility.value] || ''; });

  on('#discard-draft', 'click', () => { store.remove(draftKey(id)); render(); });

  $$('.toolbar [data-wrap]').forEach((b) => b.addEventListener('click', () => {
    const [before, after] = b.dataset.wrap.split('|');
    wrapSelection(textarea, before, after);
    saveDraft();
  }));
  $$('.toolbar [data-line]').forEach((b) => b.addEventListener('click', () => {
    prefixLine(textarea, b.dataset.line);
    saveDraft();
  }));
  on('#preview-toggle', 'click', () => {
    const preview = $('#preview');
    const showing = !preview.hidden;
    preview.hidden = showing;
    textarea.hidden = !showing;
    if (!showing) preview.innerHTML = renderMarkdown(textarea.value);
  });

  on('#cancel-edit', 'click', () => {
    const dirty = store.get(draftKey(id), null);
    if (dirty && !confirm('Throw away your changes?')) return;
    store.remove(draftKey(id));
    if (id) go('#/p/' + encodeURIComponent(id)); else history.length > 1 ? history.back() : go('#/');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.offline) { toast('You are offline. Your text is kept on this phone; save again when you have internet.', true); return; }
    const title = form.title.value.trim();
    if (/[[\]|]/.test(title)) { toast('A page title cannot contain [ ] or |', true); return; }
    const duplicate = state.pages.find((p) => p.id !== id && p.title.toLowerCase() === title.toLowerCase());
    if (duplicate && !confirm('Another page is already called "' + duplicate.title + '". Save anyway?')) return;

    const button = $('button[type=submit]', form);
    button.disabled = true;
    button.textContent = 'Saving…';
    const input = {
      id: id || '',
      chronicleId: state.chronicleId,
      title: title,
      category: form.category.value,
      tags: form.tags.value,
      visibility: form.visibility.value,
      content: form.content.value
    };
    if (form.gmNotes) input.gmNotes = form.gmNotes.value;
    try {
      const saved = await api('savePage', { page: input });
      rememberPage(saved);
      store.remove(draftKey(id));
      toast('Saved.');
      go('#/p/' + encodeURIComponent(saved.id));
    } catch (e) {
      if (e instanceof NetworkError) setOffline(true);
      toast(e.message + ' Your text is kept on this phone.', true);
      button.disabled = false;
      button.textContent = 'Save';
    }
  });
}

function wrapSelection(textarea, before, after) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const selected = value.slice(start, end);
  textarea.value = value.slice(0, start) + before + selected + after + value.slice(end);
  textarea.focus();
  textarea.selectionStart = start + before.length;
  textarea.selectionEnd = start + before.length + selected.length;
}

function prefixLine(textarea, prefix) {
  const start = textarea.selectionStart;
  const value = textarea.value;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  textarea.value = value.slice(0, lineStart) + prefix + value.slice(lineStart);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + prefix.length;
}

/* ------------------------------------------------------------------ */
/* Screen: search                                                      */
/* ------------------------------------------------------------------ */
function searchPages(query, category) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const results = [];
  state.pages.forEach((page) => {
    if (category && page.category !== category) return;
    const title = page.title.toLowerCase();
    const tags = tagList(page).map((t) => t.toLowerCase());
    const text = plainText(page.content).toLowerCase();
    const notes = page.canSeeSecrets ? plainText(page.gmNotes).toLowerCase() : '';
    let score = 0;
    for (const word of words) {
      if (word.startsWith('#') && word.length > 1) {
        const tag = word.slice(1);
        if (tags.indexOf(tag) >= 0) { score += 5; continue; }
        return;
      }
      let s = 0;
      if (title === word) s += 10;
      if (title.indexOf(word) >= 0) s += 5;
      if (tags.some((t) => t.indexOf(word) >= 0)) s += 3;
      if (text.indexOf(word) >= 0) s += 1;
      if (notes.indexOf(word) >= 0) s += 1;
      if (!s) return; // every word must match somewhere
      score += s;
    }
    results.push({ page: page, score: score });
  });
  results.sort((a, b) => b.score - a.score || byTitle(a.page, b.page));
  return results.map((r) => r.page);
}

function snippet(page, query) {
  const text = plainText(page.content);
  const word = String(query || '').toLowerCase().split(/\s+/).find((w) => w && !w.startsWith('#'));
  if (!word) return esc(text.slice(0, 140));
  const i = text.toLowerCase().indexOf(word);
  if (i < 0) return esc(text.slice(0, 140));
  const start = Math.max(0, i - 50);
  const piece = text.slice(start, i + word.length + 90);
  const j = i - start;
  return (start > 0 ? '…' : '') + esc(piece.slice(0, j)) + '<mark>' + esc(piece.slice(j, j + word.length)) + '</mark>' + esc(piece.slice(j + word.length)) + '…';
}

function viewSearch(query) {
  return '<div class="narrow">' +
    '<h1>Search</h1>' +
    '<form id="search-form" class="search-row">' +
      '<input name="q" type="search" value="' + esc(query.q || '') + '" placeholder="Name, word, or #tag" autofocus aria-label="Search">' +
      '<select name="category" aria-label="Category"><option value="">All categories</option>' +
        allCategories().map((c) => '<option' + (c === query.category ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
      '</select>' +
    '</form>' +
    '<div id="search-results">' + searchResultsHtml(query.q || '', query.category || '') + '</div>' +
  '</div>';
}

function searchResultsHtml(q, category) {
  if (!q.trim() && !category) {
    const tags = {};
    state.pages.forEach((p) => tagList(p).forEach((t) => { tags[t] = (tags[t] || 0) + 1; }));
    const tagNames = Object.keys(tags).sort((a, b) => tags[b] - tags[a]).slice(0, 40);
    return '<p class="muted">Type a name or any word. Use <code>#tag</code> to find pages with a tag.</p>' +
      (tagNames.length ? '<h2>Tags</h2><p class="tag-cloud">' + tagNames.map((t) =>
        '<a class="tag" href="#/search?q=' + encodeURIComponent('#' + t) + '">#' + esc(t) + ' <small>' + tags[t] + '</small></a>').join(' ') + '</p>' : '');
  }
  const results = searchPages(q, category);
  if (!results.length) {
    return '<div class="card empty">Nothing found.' + (q.trim() && !q.trim().startsWith('#')
      ? ' <a href="#/new?title=' + encodeURIComponent(q.trim()) + '">Create a page called “' + esc(q.trim()) + '”</a>' : '') + '</div>';
  }
  return '<p class="muted small">' + results.length + ' result' + (results.length === 1 ? '' : 's') + '</p>' +
    '<ul class="page-list">' + results.slice(0, 100).map((p) =>
      '<li class="page-item"><a href="#/p/' + encodeURIComponent(p.id) + '">' +
        '<span class="page-item-title">' + esc(p.title) + ' ' + visibilityBadge(p) + '</span>' +
        '<span class="page-item-meta">' + esc(p.category) + '</span>' +
        '<span class="snippet">' + snippet(p, q) + '</span>' +
      '</a></li>').join('') + '</ul>';
}

function bindSearch() {
  const form = $('#search-form');
  const update = () => {
    $('#search-results').innerHTML = searchResultsHtml(form.q.value, form.category.value);
    const hash = '#/search?q=' + encodeURIComponent(form.q.value) + (form.category.value ? '&category=' + encodeURIComponent(form.category.value) : '');
    history.replaceState(null, '', hash);
  };
  form.q.addEventListener('input', update);
  form.category.addEventListener('change', update);
  form.addEventListener('submit', (event) => { event.preventDefault(); form.q.blur(); update(); });
}

/* ------------------------------------------------------------------ */
/* Screen: settings                                                    */
/* ------------------------------------------------------------------ */
function viewSettings() {
  const c = currentChronicle();
  return '<div class="narrow">' +
    '<h1>Settings</h1>' +

    '<section class="card">' +
      '<h2>Chronicle</h2>' +
      '<p>Open now: <strong>' + esc(c.name) + '</strong><br>' +
        (c.role === 'gm' ? 'You are the GM.' : 'You are a player. GM: ' + esc(userName(c.gm)) + '.') + '</p>' +
      '<div class="row">' +
        '<a class="btn primary" href="#/chronicles">Switch chronicle</a>' +
        '<a class="btn" href="#/chronicle/' + encodeURIComponent(c.id) + '">Edit this chronicle</a>' +
      '</div>' +
    '</section>' +

    '<section class="card">' +
      '<h2>Account</h2>' +
      '<p>Logged in as <strong>' + esc(state.user.displayName) + '</strong> (' + esc(state.user.username) + ').</p>' +
      '<details><summary>Change my password</summary>' +
        '<form id="password-form" class="form">' +
          '<label>Current password<input name="old" type="password" autocomplete="current-password" required></label>' +
          '<label>New password<input name="new1" type="password" autocomplete="new-password" minlength="6" required></label>' +
          '<label>New password again<input name="new2" type="password" autocomplete="new-password" minlength="6" required></label>' +
          '<button class="btn primary" type="submit">Change password</button>' +
        '</form>' +
      '</details>' +
      '<div class="row"><button class="btn danger" id="logout-btn">Log out on this device</button></div>' +
    '</section>' +

    '<section class="card">' +
      '<h2>App</h2>' +
      '<div class="row">' +
        '<button class="btn" id="settings-refresh">Refresh everything</button>' +
        (state.installPrompt ? '<button class="btn primary" id="install-btn">Install on this device</button>' : '') +
      '</div>' +
      '<p class="muted small">Version ' + APP_VERSION + ' · ' + state.pages.length + ' pages saved on this device for offline reading.</p>' +
    '</section>' +

    '<section class="card">' +
      '<h2>Who sees what</h2>' +
      '<ul class="help-list">' +
        '<li><strong>Everyone:</strong> all players in this chronicle and the GM.</li>' +
        '<li><strong>GM only:</strong> only the GM (and the page’s author) until the GM taps <em>Reveal</em>.</li>' +
        '<li><strong>Private:</strong> only the person who wrote it.</li>' +
        '<li><strong>GM notes</strong> on a page are never shown to other players, even after the page is revealed.</li>' +
      '</ul>' +
    '</section>' +
  '</div>';
}

function bindSettings() {
  on('#logout-btn', 'click', () => { if (confirm('Log out on this device?')) logout(); });
  on('#settings-refresh', 'click', () => refreshAll(true));
  on('#install-btn', 'click', async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    render();
  });
  on('#password-form', 'submit', async (event) => {
    event.preventDefault();
    const f = event.target;
    if (f.new1.value !== f.new2.value) { toast('The two new passwords are not the same.', true); return; }
    try {
      await api('changePassword', { oldPassword: f.old.value, newPassword: f.new1.value });
      toast('Password changed.');
      f.reset();
    } catch (e) { toast(e.message, true); }
  });
}

/* ------------------------------------------------------------------ */
/* Start the app                                                       */
/* ------------------------------------------------------------------ */
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.installPrompt = event;
  if (parseRoute().name === 'settings') render();
});

window.addEventListener('online', () => { if (state.token) refreshAll(false); });

document.addEventListener('visibilitychange', () => {
  // When the app comes back to the screen after a while, fetch fresh pages
  if (document.visibilityState === 'visible' && state.token && state.chronicleId &&
      Date.now() - state.pagesLoadedAt > 60 * 1000 && !$('#editor')) {
    refreshAll(false);
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode not available */ });
  });
}

(async function start() {
  if (state.chronicleId) state.pages = store.get('kc_pages_' + state.chronicleId, []);
  render(); // show the saved copy straight away
  if (state.token && API_URL.indexOf('PASTE-YOUR') !== 0) {
    if ($('#editor')) {
      // do not redraw an editor the user is typing in
      try { await loadBootstrap(); await loadPages(); } catch (e) { if (e instanceof NetworkError) setOffline(true); }
      return;
    }
    await refreshAll(false);
  }
})();
