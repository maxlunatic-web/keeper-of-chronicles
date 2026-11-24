/* KEEPER OF CHRONICLES - THE APP
 * Version 2.0 (build step 2: pictures, timeline, realities and versions)
 * You do not need to change anything in this file. Your settings live in config.js.
 */
'use strict';

const APP_VERSION = '2.0';
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

const VISIBILITY_HELP = {
  everyone: 'Everyone in this chronicle can see it.',
  gm: 'Only the GM sees it until it is revealed.',
  private: 'Only you can see it.'
};

const REALITY_COLORS = ['#4fb3a9', '#d9a441', '#9b7fe0', '#e07a9b', '#7cbf6a', '#5aa9e6', '#e0874f', '#a8b0bd'];

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
  realities: [],
  events: [],
  realityFilter: '',
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
    let message = json.error || 'Something went wrong.';
    if (/^Unknown action/.test(message)) {
      message = 'The Google backend is still the old version. Paste the new Code.gs into Apps Script and deploy it as a new version (see the update guide).';
    } else if (/DriveApp|permission/i.test(message) && /^(uploadImage|getImages)$/.test(action)) {
      message = 'Picture storage is not switched on yet. In the Google Sheet, choose Keeper > 3. Set up picture storage, then deploy a new version.';
    }
    throw new Error(message);
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
  state.realities = [];
  state.events = [];
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

function loadSavedChronicleData(id) {
  state.pages = id ? store.get('kc_pages_' + id, []) : [];
  state.realities = id ? store.get('kc_realities_' + id, []) : [];
  state.events = id ? store.get('kc_events_' + id, []) : [];
  state.realityFilter = id ? store.get('kc_rf_' + id, '') : '';
}

function chooseChronicle(id) {
  state.chronicleId = id;
  if (id) store.set('kc_chronicle', id); else store.remove('kc_chronicle');
  loadSavedChronicleData(id);
  state.pagesLoadedAt = 0;
}

async function loadPages() {
  if (!state.chronicleId) return;
  const id = state.chronicleId;
  try {
    const data = await api('listPages', { chronicleId: id });
    if (state.chronicleId !== id) return; // switched chronicle meanwhile
    state.pages = data.pages;
    state.realities = data.realities || [];
    state.events = data.events || [];
    state.pagesLoadedAt = Date.now();
    saveChronicleData();
    if (state.realityFilter && !realityById(state.realityFilter)) setRealityFilter('');
  } catch (e) {
    if (e instanceof NetworkError) {
      setOffline(true);
      loadSavedChronicleData(id);
    } else {
      throw e;
    }
  }
}

function saveChronicleData() {
  store.set('kc_pages_' + state.chronicleId, state.pages);
  store.set('kc_realities_' + state.chronicleId, state.realities);
  store.set('kc_events_' + state.chronicleId, state.events);
}

function isTyping() {
  return !!$('.keep-open');
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
  if (!isTyping()) render(); // never redraw a form someone is typing in
}

function rememberItem(listName, item) {
  const list = state[listName];
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item; else list.push(item);
  saveChronicleData();
}

function rememberPage(page) {
  if (page.createdIdentity) {
    rememberItem('pages', page.createdIdentity);
    delete page.createdIdentity;
  }
  rememberItem('pages', page);
}

function forgetPage(id) {
  state.pages = state.pages.filter((p) => p.id !== id);
  state.pages.forEach((p) => { if (p.identityId === id) p.identityId = ''; });
  saveChronicleData();
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

function pageById(id) {
  return id ? state.pages.find((p) => p.id === id) || null : null;
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

function visibilityBadge(item) {
  if (item.visibility === 'gm') return '<span class="badge badge-gm" title="Hidden from players">🔒 GM only</span>';
  if (item.visibility === 'private') return '<span class="badge badge-private" title="Only the author sees this">👁 Private</span>';
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

// Does this text contain a [[link]] to a page with this title?
function linksTo(text, title) {
  if (!text || !title) return false;
  const pattern = new RegExp('\\[\\[\\s*' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(\\||\\]\\])', 'i');
  return pattern.test(text);
}

/* ------------------------------------------------------------------ */
/* Realities                                                           */
/* ------------------------------------------------------------------ */
function realityById(id) {
  return id ? state.realities.find((r) => r.id === id) || null : null;
}

function sortedRealities() {
  return state.realities.slice().sort((a, b) =>
    (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) ||
    String(a.created).localeCompare(String(b.created)) ||
    a.name.localeCompare(b.name));
}

function realityOrder(id) {
  const i = sortedRealities().findIndex((r) => r.id === id);
  return i < 0 ? 9999 : i;
}

function safeColor(color) {
  return /^#[0-9a-f]{6}$/i.test(String(color || '')) ? color : '#a8b0bd';
}

function realityChip(id, asLink) {
  if (!id) return '';
  const r = realityById(id);
  if (!r) return '<span class="reality-chip unknown">Unknown reality</span>';
  const inner = esc(r.name) + (r.visibility === 'gm' ? ' 🔒' : '');
  return asLink
    ? '<a class="reality-chip" style="--rc:' + safeColor(r.color) + '" href="#/r/' + encodeURIComponent(r.id) + '">' + inner + '</a>'
    : '<span class="reality-chip" style="--rc:' + safeColor(r.color) + '">' + inner + '</span>';
}

function statusChip(item) {
  return item.status ? '<span class="status-chip">' + esc(item.status) + '</span>' : '';
}

function setRealityFilter(id) {
  state.realityFilter = id || '';
  store.set('kc_rf_' + state.chronicleId, state.realityFilter);
}

// Items without a reality belong to every reality, so they always show.
function inFilter(item) {
  return !state.realityFilter || !item.realityId || item.realityId === state.realityFilter;
}

function filteredPages() {
  return state.pages.filter(inFilter);
}

function realityBar() {
  if (!state.realities.length) return '';
  const current = state.realityFilter;
  const chip = (id, label, color) =>
    '<button type="button" class="rchip' + (current === id ? ' active' : '') + '" data-reality-filter="' + esc(id) + '"' +
    (color ? ' style="--rc:' + safeColor(color) + '"' : '') + '>' + label + '</button>';
  return '<div class="reality-bar" aria-label="Show reality">' +
    chip('', '🌌 All realities') +
    sortedRealities().map((r) => chip(r.id, esc(r.name) + (r.visibility === 'gm' ? ' 🔒' : ''), r.color)).join('') +
  '</div>' +
  (current ? '<p class="muted small filter-note">Showing ' + realityChip(current) + ' and everything that is not tied to one reality.</p>' : '');
}

function realityOptions(selectedId, emptyLabel) {
  let html = '<option value="">' + esc(emptyLabel || '— Not tied to one reality —') + '</option>';
  html += sortedRealities().map((r) => '<option value="' + esc(r.id) + '"' + (r.id === selectedId ? ' selected' : '') + '>' +
    esc(r.name) + (r.visibility === 'gm' ? ' (GM only)' : '') + '</option>').join('');
  if (selectedId && !realityById(selectedId)) {
    html += '<option value="' + esc(selectedId) + '" selected>(a reality hidden from you)</option>';
  }
  return html;
}

/* ------------------------------------------------------------------ */
/* In-story dates for the timeline                                     */
/* Understands: 1997 · 1997-03 · 1997-03-12 · 12 March 1997 ·           */
/* March 12, 1997 · March 1997 · 12.03.1997 · 1990s · 500 BC · c. 1200  */
/* ------------------------------------------------------------------ */
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthNumber(word) {
  const w = String(word || '').toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return -1;
  const i = MONTH_NAMES.findIndex((m) => m.toLowerCase().startsWith(w));
  return i < 0 ? -1 : i + 1;
}

function parseStoryDate(text) {
  let s = String(text || '').trim().toLowerCase();
  if (!s) return null;
  let approx = false;
  s = s.replace(/^(c\.|ca\.|circa|about|around|~)\s*/, () => { approx = true; return ''; });
  let era = 1;
  s = s.replace(/\s*(b\.?\s?c\.?\s?e?\.?)$/, () => { era = -1; return ''; });
  s = s.replace(/\s*(a\.?\s?d\.?|c\.?e\.?)$/, '').replace(/^(a\.?d\.?)\s+/, '');
  s = s.trim().replace(/\.$/, '').trim();

  let y = NaN, m = 0, d = 0, decade = false, mm;
  if ((mm = s.match(/^(\d{1,5})s$/))) { y = +mm[1]; decade = true; }
  else if ((mm = s.match(/^(-?\d{1,6})(?:\s?[-/.]\s?(\d{1,2})(?:\s?[-/.]\s?(\d{1,2}))?)?$/))) { y = +mm[1]; m = +(mm[2] || 0); d = +(mm[3] || 0); }
  else if ((mm = s.match(/^(\d{1,2})\s?[./-]\s?(\d{1,2})\s?[./-]\s?(\d{3,6})$/))) { d = +mm[1]; m = +mm[2]; y = +mm[3]; }
  else if ((mm = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\.?\s+(?:of\s+)?([a-z]+)\.?,?\s+(-?\d{1,6})$/))) { d = +mm[1]; m = monthNumber(mm[2]); y = +mm[3]; }
  else if ((mm = s.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(-?\d{1,6})$/))) { m = monthNumber(mm[1]); d = +mm[2]; y = +mm[3]; }
  else if ((mm = s.match(/^([a-z]+)\.?,?\s+(-?\d{1,6})$/))) { m = monthNumber(mm[1]); y = +mm[2]; }
  else return null;

  if (!isFinite(y) || m < 0 || m > 12 || d < 0 || d > 31 || (d && !m)) return null;
  if (era < 0) y = -Math.abs(y);
  const yearLabel = y < 0 ? (-y) + ' BC' : String(y);
  let label;
  if (decade) label = y < 0 ? (-y) + 's BC' : y + 's';
  else label = (d ? d + ' ' : '') + (m ? MONTH_NAMES[m - 1] + ' ' : '') + yearLabel;
  return { sort: y * 10000 + m * 100 + d, year: y, yearLabel: decade ? label : yearLabel, label: (approx ? 'around ' : '') + label, approx: approx };
}

function sortedEvents(list) {
  return list.map((ev) => ({ ev: ev, when: parseStoryDate(ev.date) }))
    .sort((a, b) => {
      if (a.when && b.when && a.when.sort !== b.when.sort) return a.when.sort - b.when.sort;
      if (a.when && !b.when) return -1;
      if (!a.when && b.when) return 1;
      return String(a.ev.created).localeCompare(String(b.ev.created));
    });
}

/* ------------------------------------------------------------------ */
/* Pictures: shrunk on the phone, stored in Google Drive, kept on the   */
/* phone after the first download so they also work offline.           */
/* ------------------------------------------------------------------ */
const IMAGE_CACHE = 'keeper-images';
const imageUrls = {};
const imagePending = {};
const imageQueue = { thumb: [], full: [] };
let imageFlushTimer = null;

function imageCacheRequest(key) {
  return new Request(location.origin + '/__keeper-image/' + encodeURIComponent(key));
}

async function imageCacheGet(key) {
  try {
    if (!window.caches) return null;
    const cache = await caches.open(IMAGE_CACHE);
    const response = await cache.match(imageCacheRequest(key));
    return response ? await response.blob() : null;
  } catch (e) { return null; }
}

async function imageCachePut(key, blob) {
  try {
    if (!window.caches) return;
    const cache = await caches.open(IMAGE_CACHE);
    await cache.put(imageCacheRequest(key), new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } }));
  } catch (e) { /* no room: the picture will be downloaded again next time */ }
}

function rememberImage(key, blob) {
  if (!imageUrls[key]) imageUrls[key] = URL.createObjectURL(blob);
  return imageUrls[key];
}

function base64ToBlob(data, mimeType) {
  const bytes = atob(data);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mimeType || 'image/jpeg' });
}

function requestImage(id, size) {
  const key = id + '_' + size;
  if (imageUrls[key]) return Promise.resolve(imageUrls[key]);
  if (imagePending[key]) return imagePending[key];
  imagePending[key] = (async () => {
    const cached = await imageCacheGet(key);
    if (cached) return rememberImage(key, cached);
    return new Promise((resolve, reject) => {
      imageQueue[size].push({ id: id, key: key, resolve: resolve, reject: reject });
      clearTimeout(imageFlushTimer);
      imageFlushTimer = setTimeout(flushImageQueue, 30);
    });
  })().catch((e) => { delete imagePending[key]; throw e; });
  return imagePending[key];
}

async function flushImageQueue() {
  for (const size of ['full', 'thumb']) {
    const items = imageQueue[size].splice(0);
    const chunk = size === 'full' ? 1 : 8;
    for (let i = 0; i < items.length; i += chunk) {
      const part = items.slice(i, i + chunk);
      try {
        const data = await api('getImages', { ids: part.map((p) => p.id), size: size });
        part.forEach((p) => {
          const found = (data.images || []).find((x) => x.id === p.id);
          if (!found || found.missing) { p.reject(new Error('missing')); return; }
          const blob = base64ToBlob(found.data, found.mimeType);
          imageCachePut(p.key, blob);
          p.resolve(rememberImage(p.key, blob));
        });
      } catch (e) {
        if (e instanceof NetworkError) setOffline(true);
        part.forEach((p) => p.reject(e));
      }
    }
  }
}

function hydrateImages(root) {
  $$('img[data-img]', root).forEach((img) => {
    if (img.dataset.loading) return;
    img.dataset.loading = '1';
    requestImage(img.dataset.img, img.dataset.size === 'full' ? 'full' : 'thumb')
      .then((url) => { img.src = url; img.classList.add('ready'); })
      .catch(() => { img.classList.add('failed'); });
  });
}

function picture(id, size, extraClass, zoom) {
  return '<span class="pic-frame ' + (extraClass || '') + '"' + (zoom ? ' data-zoom="' + esc(id) + '"' : '') + '>' +
    '<img data-img="' + esc(id) + '" data-size="' + (size === 'full' ? 'full' : 'thumb') + '" alt=""></span>';
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img: img, url: url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('"' + file.name + '" is not a picture this phone can read. Try a JPEG or PNG.')); };
    img.src = url;
  });
}

function shrinkTo(img, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) => canvas.toBlob((blob) =>
    blob ? resolve({ blob: blob, width: w, height: h }) : reject(new Error('The picture could not be prepared.')), 'image/jpeg', quality));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('The picture could not be read.'));
    reader.readAsDataURL(blob);
  });
}

async function uploadPicture(file) {
  const loaded = await loadImageFile(file);
  try {
    const full = await shrinkTo(loaded.img, 2000, 0.85);
    const thumb = await shrinkTo(loaded.img, 480, 0.8);
    const result = await api('uploadImage', {
      chronicleId: state.chronicleId,
      name: file.name || 'picture',
      width: full.width,
      height: full.height,
      full: { mimeType: 'image/jpeg', data: await blobToBase64(full.blob) },
      thumb: { mimeType: 'image/jpeg', data: await blobToBase64(thumb.blob) }
    });
    // Keep both sizes on this phone straight away, so nothing needs downloading again.
    rememberImage(result.id + '_full', full.blob);
    rememberImage(result.id + '_thumb', thumb.blob);
    imageCachePut(result.id + '_full', full.blob);
    imageCachePut(result.id + '_thumb', thumb.blob);
    return result.id;
  } finally {
    URL.revokeObjectURL(loaded.url);
  }
}

function openViewer(id) {
  let viewer = document.getElementById('viewer');
  if (!viewer) {
    viewer = document.createElement('div');
    viewer.id = 'viewer';
    viewer.className = 'viewer';
    viewer.innerHTML = '<button class="viewer-close" aria-label="Close">✕</button><div class="viewer-body"></div>';
    viewer.addEventListener('click', (event) => {
      if (event.target.closest('.viewer-close') || !event.target.closest('img')) closeViewer();
    });
    document.body.appendChild(viewer);
  }
  $('.viewer-body', viewer).innerHTML = '<img data-img="' + esc(id) + '" data-size="full" alt="">' +
    '<p class="muted small">Pinch to zoom. Tap outside the picture to close.</p>';
  viewer.hidden = false;
  document.body.classList.add('viewer-open');
  hydrateImages(viewer);
}

function closeViewer() {
  const viewer = document.getElementById('viewer');
  if (viewer) viewer.hidden = true;
  document.body.classList.remove('viewer-open');
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

function renderMarkdown(source, emptyText) {
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
  if (html) return html;
  return emptyText === '' ? '' : '<p class="muted">' + esc(emptyText || 'This page is still empty.') + '</p>';
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

window.addEventListener('hashchange', () => { closeViewer(); render(); window.scrollTo(0, 0); });

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
    case 'p':         content = viewPage(route.id); bind = () => bindPage(route.id); break;
    case 'edit':      content = viewEditor(route.id, route.query); bind = () => bindEditor(route.id, route.query); break;
    case 'new':       content = viewEditor('', route.query); bind = () => bindEditor('', route.query); break;
    case 'c':         content = viewCategory(route.id); break;
    case 'search':    content = viewSearch(route.query); bind = () => bindSearch(); break;
    case 'timeline':  content = viewTimeline(); bind = () => bindTimeline(route.query); break;
    case 'event':     content = viewEventForm(route.id, route.query); bind = () => bindEventForm(route.id); break;
    case 'realities': content = viewRealities(); break;
    case 'r':         content = viewReality(route.id); bind = () => bindReality(route.id); break;
    case 'reality':   content = viewRealityForm(route.id); bind = () => bindRealityForm(route.id); break;
    case 'settings':  content = viewSettings(); bind = () => bindSettings(); break;
    default:          content = viewHome(); bind = () => bindHome();
  }
  app.innerHTML = shell(content, true);
  bindShell();
  bind();
  hydrateImages(app);
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
  const tab = (names, hash, icon, label) =>
    '<a class="tab' + (names.indexOf(route) >= 0 ? ' active' : '') + '" href="' + hash + '"><span class="tab-icon">' + icon + '</span><span>' + label + '</span></a>';

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
      tab(['home', 'c', 'p', 'realities', 'r', 'reality'], '#/', '⌂', 'Home') +
      tab(['search'], '#/search', '⌕', 'Search') +
      tab(['timeline', 'event'], '#/timeline', '⏳', 'Timeline') +
      tab(['new', 'edit'], '#/new', '＋', 'New page') +
      tab(['settings'], '#/settings', '⚙', 'Settings') +
    '</nav>' : '');
}

function bindShell() {
  on('#refresh-btn', 'click', () => refreshAll(true));
}

// Clicks that work on every screen
document.addEventListener('click', (event) => {
  const filter = event.target.closest('[data-reality-filter]');
  if (filter) {
    event.preventDefault();
    setRealityFilter(filter.dataset.realityFilter);
    render();
    return;
  }
  const zoom = event.target.closest('[data-zoom]');
  if (zoom) {
    event.preventDefault();
    openViewer(zoom.dataset.zoom);
  }
});

document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeViewer(); });

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
    '<form id="chronicle-form" class="card form keep-open">' +
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
  const reality = page.realityId && state.realityFilter !== page.realityId ? ' ' + realityChip(page.realityId) : '';
  const thumb = page.images && page.images.length ? picture(page.images[0], 'thumb', 'pic-thumb') : '';
  return '<li class="page-item">' +
    '<a href="#/p/' + encodeURIComponent(page.id) + '">' + thumb +
      '<span class="page-item-text">' +
        '<span class="page-item-title">' + esc(page.title) + ' ' + visibilityBadge(page) + '</span>' +
        '<span class="page-item-meta">' + esc(page.category) + reality + (page.status ? ' ' + statusChip(page) : '') +
          ' · ' + esc(formatDate(page.updated)) + (tags ? ' ' + tags : '') + '</span>' +
      '</span>' +
    '</a>' + (extra || '') +
  '</li>';
}

function viewHome() {
  const c = currentChronicle();
  const pages = filteredPages();
  const counts = {};
  pages.forEach((p) => { counts[p.category] = (counts[p.category] || 0) + 1; });

  const intro = '<section class="hero">' +
    '<h1>' + esc(c.name) + '</h1>' +
    (c.description ? '<p class="muted">' + esc(c.description) + '</p>' : '') +
    '<p class="hero-role">' + (isGM()
      ? 'You are the <strong>Game Master</strong> of this chronicle. Hidden pages and GM notes are visible to you.'
      : 'You are a <strong>player</strong> in this chronicle. Your GM is ' + esc(userName(c.gm)) + '.') + '</p>' +
    realityBar() +
    '<form id="home-search" class="search-row"><input name="q" type="search" placeholder="Search ' + pages.length + (pages.length === 1 ? ' page' : ' pages') + '…" aria-label="Search"></form>' +
  '</section>';

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

  const categories = '<section><h2>Categories</h2><div class="cat-grid">' +
    allCategories().map((cat) =>
      '<a class="cat" href="#/c/' + encodeURIComponent(cat) + '">' +
        '<span class="cat-icon">' + (CATEGORY_ICONS[cat] || '📁') + '</span>' +
        '<span class="cat-name">' + esc(cat) + '</span>' +
        '<span class="cat-count">' + (counts[cat] || 0) + '</span>' +
      '</a>').join('') +
  '</div></section>';

  const realities = state.realities.length
    ? '<section><h2>🌌 Realities</h2><p class="reality-list">' +
        sortedRealities().map((r) => realityChip(r.id, true)).join(' ') +
        ' <a class="btn small" href="#/realities">All realities</a></p></section>'
    : '<section class="card hint-card"><strong>🌌 Does this chronicle travel between realities?</strong> ' +
        'Add the realities, then tag each page with the reality it belongs to. ' +
        '<a href="#/reality/new">Add the first reality</a></section>';

  const mine = pages.filter((p) => p.visibility === 'private' && p.author === state.user.username).sort(byUpdated);
  const myPrivate = mine.length ? '<section><h2>👁 My private pages</h2><ul class="page-list">' +
    mine.slice(0, 8).map((p) => pageItem(p)).join('') + '</ul></section>' : '';

  const recent = pages.slice().sort(byUpdated).slice(0, 10);
  const recentHtml = '<section><h2>Recently updated</h2>' + (recent.length
    ? '<ul class="page-list">' + recent.map((p) => pageItem(p)).join('') + '</ul>'
    : '<div class="card empty">No pages yet. Tap <strong>＋ New page</strong> below to write the first one.</div>') +
  '</section>';

  return intro + special + categories + realities + myPrivate + recentHtml;
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
  const pages = filteredPages().filter((p) => p.category === category).sort(byTitle);
  const reality = state.realityFilter ? '&reality=' + encodeURIComponent(state.realityFilter) : '';
  return '<div class="narrow">' +
    '<p class="crumbs"><a href="#/">Home</a> ›</p>' +
    '<h1>' + (CATEGORY_ICONS[category] || '📁') + ' ' + esc(category) + '</h1>' +
    realityBar() +
    (pages.length ? '<ul class="page-list">' + pages.map((p) => pageItem(p)).join('') + '</ul>'
      : '<div class="card empty">No pages in this category yet.</div>') +
    '<a class="btn primary block" href="#/new?category=' + encodeURIComponent(category) + reality + '">＋ New page in ' + esc(category) + '</a>' +
  '</div>';
}

/* ------------------------------------------------------------------ */
/* Screen: one wiki page                                               */
/* ------------------------------------------------------------------ */
function versionCard(p) {
  return '<a class="version-card" href="#/p/' + encodeURIComponent(p.id) + '" style="--rc:' +
      safeColor((realityById(p.realityId) || {}).color) + '">' +
    (p.images && p.images.length ? picture(p.images[0], 'thumb', 'pic-version') : '<span class="pic-frame pic-version empty">' + (CATEGORY_ICONS[p.category] || '👤') + '</span>') +
    '<span class="version-text">' +
      '<span class="version-title">' + esc(p.title) + ' ' + visibilityBadge(p) + '</span>' +
      '<span>' + (p.realityId ? realityChip(p.realityId) : '<span class="muted small">No reality chosen</span>') + ' ' + statusChip(p) + '</span>' +
    '</span>' +
  '</a>';
}

function byReality(a, b) {
  return realityOrder(a.realityId) - realityOrder(b.realityId) || byTitle(a, b);
}

function versionsHtml(page) {
  let html = '';
  // This page ties versions together
  const versions = state.pages.filter((p) => p.identityId === page.id).sort(byReality);
  if (versions.length) {
    html += '<section class="versions"><h2>🌀 Versions across the realities (' + versions.length + ')</h2>' +
      '<div class="version-grid">' + versions.map(versionCard).join('') + '</div>' +
      '<a class="btn small" href="#/new?identity=' + encodeURIComponent(page.id) + '&category=' + encodeURIComponent(page.category) + '">＋ Add another version</a>' +
    '</section>';
  }
  // This page is one version of someone
  if (page.identityId) {
    const identity = pageById(page.identityId);
    const others = state.pages.filter((p) => p.identityId === page.identityId && p.id !== page.id).sort(byReality);
    html = '<div class="versions-banner">' +
      '🌀 ' + (identity
        ? 'One version of <a href="#/p/' + encodeURIComponent(identity.id) + '">' + esc(identity.title) + '</a>.'
        : 'One version of a person whose main page is hidden from you.') +
      (others.length ? '<div class="other-versions"><span class="muted small">Other versions:</span> ' +
        others.map((p) => '<a class="version-chip" href="#/p/' + encodeURIComponent(p.id) + '">' +
          (p.realityId ? realityChip(p.realityId) + ' ' : '') + esc(p.title) + (p.status ? ' · ' + esc(p.status) : '') + '</a>').join(' ') + '</div>'
        : '<div class="muted small">No other versions written yet.</div>') +
      (identity ? '<a class="btn small" href="#/new?identity=' + encodeURIComponent(identity.id) + '&category=' + encodeURIComponent(page.category) + '">＋ Add another version</a>' : '') +
    '</div>' + html;
  }
  return html;
}

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

  const backlinks = state.pages.filter((p) => p.id !== page.id &&
    (linksTo(p.content, page.title) || (p.canSeeSecrets && linksTo(p.gmNotes, page.title)))).sort(byTitle);

  const events = sortedEvents(state.events.filter((ev) => linksTo(ev.text, page.title) || linksTo(ev.title, page.title)));
  const images = page.images || [];
  const cover = images.length ? '<div class="cover">' + picture(images[0], 'full', 'pic-cover', true) + '</div>' : '';
  const gallery = images.length > 1 ? '<section class="gallery-section"><h2>Pictures</h2><div class="gallery">' +
    images.slice(1).map((imgId) => picture(imgId, 'thumb', 'pic-gallery', true)).join('') + '</div></section>' : '';

  const addEventLink = '#/event/new?link=' + encodeURIComponent(page.title) + (page.realityId ? '&reality=' + encodeURIComponent(page.realityId) : '');

  return '<article class="narrow page">' +
    '<p class="crumbs"><a href="#/">Home</a> › <a href="#/c/' + encodeURIComponent(page.category) + '">' + esc(page.category) + '</a></p>' +
    cover +
    '<h1 class="page-title">' + esc(page.title) + '</h1>' +
    '<p class="page-meta">' + realityChip(page.realityId, true) + ' ' + statusChip(page) + ' ' + visibilityBadge(page) + ' ' + tags + '</p>' +
    hiddenNotice +
    versionsHtml(page) +
    '<div class="content">' + renderMarkdown(page.content) + '</div>' +
    gallery +
    gmNotes +
    '<section class="page-timeline"><h2>⏳ On the timeline</h2>' +
      (events.length ? '<ul class="mini-timeline">' + events.map((x) =>
        '<li><a href="#/timeline?focus=' + encodeURIComponent(x.ev.id) + '"><span class="mini-date">' + esc(x.when ? x.when.label : (x.ev.date || 'No date')) + '</span> ' +
        esc(x.ev.title) + '</a> ' + realityChip(x.ev.realityId) + ' ' + visibilityBadge(x.ev) + '</li>').join('') + '</ul>'
        : '<p class="muted small">No timeline events mention this page yet.</p>') +
      '<a class="btn small" href="' + addEventLink + '">＋ Add an event about ' + esc(page.title) + '</a>' +
    '</section>' +
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
    const versions = state.pages.filter((p) => p.identityId === id).length;
    if (!confirm('Delete "' + page.title + '" for good? This cannot be undone.' +
      (versions ? '\n\nThe ' + versions + ' version page(s) linked to it are kept, but lose their link.' : ''))) return;
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

function withRealitySuffix(title, realityId) {
  const r = realityById(realityId);
  return r ? title + ' (' + r.name + ')' : title;
}

function viewEditor(id, query) {
  const existing = id ? state.pages.find((p) => p.id === id) : null;
  if (id && !existing) return '<div class="narrow"><h1>Page not found</h1><a class="btn" href="#/">Back</a></div>';

  const identityFromQuery = pageById(query.identity);
  const startReality = query.reality || state.realityFilter || '';
  const base = existing ? Object.assign({}, existing, {
    identity: existing.identityId ? (pageById(existing.identityId) || { title: '' }).title : '',
    images: (existing.images || []).slice()
  }) : {
    title: identityFromQuery ? withRealitySuffix(identityFromQuery.title, startReality) : (query.title || ''),
    category: query.category || (identityFromQuery ? identityFromQuery.category : 'Other'),
    tags: '',
    visibility: isGM() ? 'gm' : 'everyone',
    content: '',
    gmNotes: '',
    realityId: startReality,
    identity: identityFromQuery ? identityFromQuery.title : '',
    status: '',
    images: [],
    canSeeSecrets: true
  };
  const draft = store.get(draftKey(id), null);
  const page = draft ? Object.assign({}, base, draft) : base;

  const mayChangeVisibility = !existing || existing.canSeeSecrets;
  const visOptions = ['everyone', 'gm', 'private'].filter((v) => v !== 'gm' || isGM() || page.visibility === 'gm');
  const categories = allCategories();
  if (page.category && categories.indexOf(page.category) < 0) categories.push(page.category);
  const showNotes = !existing || existing.canSeeSecrets;
  const notesLabel = isGM() ? 'GM notes (players never see these)' : 'Secret notes (only you and the GM see these)';
  const hiddenIdentity = existing && existing.identityId && !pageById(existing.identityId);
  const identityCandidates = state.pages.filter((p) => p.id !== id && !p.identityId).sort(byTitle);

  return '<div class="narrow">' +
    '<h1>' + (existing ? 'Edit page' : 'New page') + '</h1>' +
    (draft ? '<div class="notice">Your unsaved changes were restored. <button type="button" class="btn small" id="discard-draft">Discard them</button></div>' : '') +
    (state.offline ? '<div class="notice notice-gm">You are offline. You can type, and your text is kept on this phone, but saving needs internet.</div>' : '') +
    '<form id="editor" class="form keep-open">' +
      '<label>Title<input name="title" required maxlength="200" value="' + esc(page.title) + '" placeholder="e.g. Prince Vitel"></label>' +
      '<div class="two-col">' +
        '<label>Category<select name="category">' +
          categories.map((c) => '<option' + (c === page.category ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
        '</select></label>' +
        '<label>Who can see it?<select name="visibility"' + (mayChangeVisibility ? '' : ' disabled') + '>' +
          visOptions.map((v) => '<option value="' + v + '"' + (v === page.visibility ? ' selected' : '') + '>' + VISIBILITY_LABELS[v] + '</option>').join('') +
        '</select><span class="hint" id="vis-help">' + esc(VISIBILITY_HELP[page.visibility] || '') + '</span></label>' +
      '</div>' +
      '<label>Tags <span class="hint">separate with commas</span><input name="tags" value="' + esc(page.tags) + '" placeholder="e.g. Tremere, Vienna, 1990s"></label>' +

      '<fieldset class="multiverse">' +
        '<legend>🌌 Reality and versions</legend>' +
        '<label>Reality<select name="realityId">' + realityOptions(page.realityId) + '</select>' +
          '<span class="hint">' + (state.realities.length ? 'Which reality does this page belong to?' : 'No realities yet. <a href="#/reality/new">Add realities</a> if this chronicle has several.') + '</span></label>' +
        (hiddenIdentity
          ? '<p class="hint">This page is one version of a person whose main page is hidden from you. That link stays as it is.</p>'
          : '<label>Version of <span class="hint">the same person or place in another reality</span>' +
              '<input name="identity" list="identity-options" value="' + esc(page.identity || '') + '" placeholder="e.g. Heinrich Hardestadt" autocomplete="off">' +
              '<datalist id="identity-options">' + identityCandidates.map((p) => '<option value="' + esc(p.title) + '">').join('') + '</datalist>' +
              '<span class="hint">Leave empty if there is only one version. If no page has this name yet, one is created to link all the versions together.</span></label>') +
        '<label>Status in this reality <span class="hint">optional</span><input name="status" maxlength="100" value="' + esc(page.status || '') + '" placeholder="e.g. Alive, Dead, Returned from death"></label>' +
      '</fieldset>' +

      '<div class="editor-pictures">' +
        '<div class="editor-head"><span>Pictures</span>' +
          '<label class="btn small upload-btn">＋ Add pictures<input type="file" id="pic-input" accept="image/*" multiple hidden></label></div>' +
        '<div id="pic-list" class="pic-list"></div>' +
        '<p class="hint">Portraits, maps, handouts. The first picture is the main one, shown at the top of the page. Pictures upload straight away and need internet.</p>' +
      '</div>' +

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

function bindEditor(id) {
  const form = $('#editor');
  if (!form) return;
  const textarea = form.content;
  const existing = id ? state.pages.find((p) => p.id === id) : null;
  const draft = store.get(draftKey(id), null);
  const images = (draft && draft.images) ? draft.images.slice() : (existing ? (existing.images || []).slice() : []);
  let uploading = 0;

  const saveDraft = () => {
    store.set(draftKey(id), {
      title: form.title.value,
      category: form.category.value,
      tags: form.tags.value,
      visibility: form.visibility.value,
      realityId: form.realityId.value,
      identity: form.identity ? form.identity.value : undefined,
      status: form.status.value,
      images: images,
      content: form.content.value,
      gmNotes: form.gmNotes ? form.gmNotes.value : undefined
    });
  };

  const drawPictures = () => {
    const list = $('#pic-list');
    if (!list) return;
    list.innerHTML = images.map((imgId, i) =>
      '<div class="pic-item' + (i === 0 ? ' main' : '') + '">' +
        picture(imgId, 'thumb', 'pic-edit', true) +
        (i === 0 ? '<span class="pic-label">Main</span>' : '<button type="button" class="pic-btn" data-main="' + i + '" title="Make this the main picture">★</button>') +
        '<button type="button" class="pic-btn remove" data-remove="' + i + '" title="Remove from this page">✕</button>' +
      '</div>').join('') +
      (uploading ? '<div class="pic-item uploading"><span>Uploading ' + uploading + '…</span></div>' : '') +
      (!images.length && !uploading ? '<p class="muted small">No pictures yet.</p>' : '');
    hydrateImages(list);
  };
  drawPictures();

  $('#pic-list').addEventListener('click', (event) => {
    const main = event.target.closest('[data-main]');
    const remove = event.target.closest('[data-remove]');
    if (main) {
      images.unshift(images.splice(Number(main.dataset.main), 1)[0]);
    } else if (remove) {
      images.splice(Number(remove.dataset.remove), 1);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    saveDraft();
    drawPictures();
  });

  $('#pic-input').addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    if (state.offline) { toast('Pictures need internet to upload.', true); return; }
    uploading += files.length;
    drawPictures();
    let added = 0;
    for (const file of files) {
      try {
        images.push(await uploadPicture(file));
        added++;
        saveDraft();
      } catch (e) {
        if (e instanceof NetworkError) setOffline(true);
        toast(e.message, true);
      }
      uploading--;
      drawPictures();
    }
    if (added) toast((added === 1 ? 'Picture' : added + ' pictures') + ' added. Remember to tap Save.');
  });

  form.addEventListener('input', saveDraft);
  form.visibility.addEventListener('change', () => { $('#vis-help').textContent = VISIBILITY_HELP[form.visibility.value] || ''; });

  // For a version, keep "(Reality name)" at the end of the title in step with the chosen reality.
  let lastReality = form.realityId.value;
  form.realityId.addEventListener('change', () => {
    const versionOf = form.identity ? form.identity.value.trim() : '';
    const oldR = realityById(lastReality);
    const title = form.title.value.trim();
    let base = title;
    if (oldR && title.endsWith(' (' + oldR.name + ')')) base = title.slice(0, -(' (' + oldR.name + ')').length);
    if (base !== title || (versionOf && (!base || base.toLowerCase() === versionOf.toLowerCase()))) {
      form.title.value = withRealitySuffix(base || versionOf, form.realityId.value);
    }
    lastReality = form.realityId.value;
    saveDraft();
  });

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
    if (uploading) { toast('Please wait until the pictures have finished uploading.', true); return; }
    const title = form.title.value.trim();
    if (/[[\]|]/.test(title)) { toast('A page title cannot contain [ ] or |', true); return; }

    const input = {
      id: id || '',
      chronicleId: state.chronicleId,
      title: title,
      category: form.category.value,
      tags: form.tags.value,
      visibility: form.visibility.value,
      content: form.content.value,
      realityId: form.realityId.value,
      status: form.status.value,
      images: images
    };
    if (form.gmNotes) input.gmNotes = form.gmNotes.value;
    if (form.identity) {
      const versionOf = form.identity.value.trim();
      if (/[[\]|]/.test(versionOf)) { toast('The "Version of" name cannot contain [ ] or |', true); return; }
      if (versionOf && versionOf.toLowerCase() === title.toLowerCase()) {
        toast('A version needs its own title, different from "' + versionOf + '". For example: ' + versionOf + ' (Reality A).', true);
        return;
      }
      const target = versionOf ? state.pages.find((p) => p.id !== id && p.title.toLowerCase() === versionOf.toLowerCase()) : null;
      if (!versionOf) input.identityId = '';
      else if (target) input.identityId = target.id;
      else {
        if (!confirm('There is no page called "' + versionOf + '" yet.\n\nCreate it now? It will list every version of ' + versionOf + ' across the realities.')) return;
        input.identityTitle = versionOf;
      }
    }
    const duplicate = state.pages.find((p) => p.id !== id && p.title.toLowerCase() === title.toLowerCase());
    if (duplicate && !confirm('Another page is already called "' + duplicate.title + '". Save anyway?')) return;

    const button = $('button[type=submit]', form);
    button.disabled = true;
    button.textContent = 'Saving…';
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
/* Screen: timeline                                                    */
/* ------------------------------------------------------------------ */
function timelineEvent(x) {
  const ev = x.ev;
  const r = realityById(ev.realityId);
  return '<li class="tl-event' + (ev.visibility !== 'everyone' ? ' tl-hidden' : '') + '" id="ev-' + esc(ev.id) + '" style="--rc:' +
      (r ? safeColor(r.color) : 'var(--accent)') + '">' +
    '<div class="tl-date">' + esc(x.when ? x.when.label : (ev.date || 'No date')) +
      (ev.date && !x.when ? ' <span class="hint">(date not understood)</span>' : '') + '</div>' +
    '<h3 class="tl-title">' + esc(ev.title) + ' ' + visibilityBadge(ev) + '</h3>' +
    (ev.realityId ? '<div>' + realityChip(ev.realityId, true) + '</div>' : '') +
    '<div class="content tl-text">' + renderMarkdown(ev.text, '') + '</div>' +
    '<div class="tl-actions">' +
      '<a class="btn small" href="#/event/' + encodeURIComponent(ev.id) + '">✎ Edit</a>' +
      (ev.canReveal && ev.visibility === 'gm' ? ' <button class="btn small primary reveal-event" data-id="' + esc(ev.id) + '">Reveal</button>' : '') +
    '</div>' +
  '</li>';
}

function viewTimeline() {
  const list = sortedEvents(state.events.filter(inFilter));
  let html = '';
  let lastYear = null;
  list.forEach((x) => {
    const year = x.when ? x.when.yearLabel : 'No date';
    if (year !== lastYear) {
      html += '<li class="tl-year">' + esc(year) + '</li>';
      lastYear = year;
    }
    html += timelineEvent(x);
  });
  const reality = state.realityFilter ? '?reality=' + encodeURIComponent(state.realityFilter) : '';
  return '<div class="narrow">' +
    '<h1>⏳ Timeline</h1>' +
    realityBar() +
    '<a class="btn primary block" href="#/event/new' + reality + '">＋ Add an event</a>' +
    (list.length ? '<ol class="timeline">' + html + '</ol>'
      : '<div class="card empty">No events yet' + (state.realityFilter ? ' in this reality' : '') + '. Add the first one: a birth, a battle, a death, a session.</div>') +
  '</div>';
}

function bindTimeline(query) {
  on('.reveal-event', 'click', async (event) => {
    const ev = state.events.find((x) => x.id === event.currentTarget.dataset.id);
    if (!ev) return;
    if (state.offline) { toast('You are offline. Try again when you have internet.', true); return; }
    if (!confirm('Reveal the event "' + ev.title + '" to the players?')) return;
    try {
      const saved = await api('saveEvent', { event: Object.assign({}, ev, { visibility: 'everyone' }) });
      rememberItem('events', saved);
      toast('Revealed to the players.');
      render();
    } catch (e) { toast(e.message, true); }
  });
  if (query.focus) {
    const el = document.getElementById('ev-' + query.focus);
    if (el) {
      el.classList.add('focus');
      setTimeout(() => el.scrollIntoView({ block: 'center' }), 50);
    }
  }
}

function dateHelp(text, when) {
  if (!String(text || '').trim()) return 'Leave empty if you do not know. Events without a date go to the end.';
  if (!when) return '⚠ I could not understand this date, so it goes to the end. Try 1997, March 1997 or 12 March 1997.';
  return 'Understood as: <strong>' + esc(when.label) + '</strong>';
}

function viewEventForm(id, query) {
  const existing = id && id !== 'new' ? state.events.find((x) => x.id === id) : null;
  if (id && id !== 'new' && !existing) return '<div class="narrow"><h1>Event not found</h1><a class="btn" href="#/timeline">Back to the timeline</a></div>';
  const ev = existing || {
    date: '', title: '', text: query.link ? '[[' + query.link + ']] ' : '',
    realityId: query.reality || state.realityFilter || '',
    visibility: isGM() ? 'gm' : 'everyone'
  };
  const mayChangeVisibility = !existing || existing.canSeeSecrets;
  const visOptions = ['everyone', 'gm', 'private'].filter((v) => v !== 'gm' || isGM() || ev.visibility === 'gm');
  return '<div class="narrow">' +
    '<p class="crumbs"><a href="#/timeline">Timeline</a> ›</p>' +
    '<h1>' + (existing ? 'Edit event' : 'New event') + '</h1>' +
    '<form id="event-form" class="form keep-open">' +
      '<label>When (in the story)<input name="date" value="' + esc(ev.date) + '" placeholder="e.g. 12 March 1997, 1242, 500 BC, c. 1890s" autocomplete="off">' +
        '<span class="hint" id="date-help">' + dateHelp(ev.date, parseStoryDate(ev.date)) + '</span></label>' +
      '<label>What happened<input name="title" required maxlength="200" value="' + esc(ev.title) + '" placeholder="e.g. Lady Vasilisa dies"></label>' +
      '<div class="two-col">' +
        '<label>Reality<select name="realityId">' + realityOptions(ev.realityId, '— All realities / shared history —') + '</select></label>' +
        '<label>Who can see it?<select name="visibility"' + (mayChangeVisibility ? '' : ' disabled') + '>' +
          visOptions.map((v) => '<option value="' + v + '"' + (v === ev.visibility ? ' selected' : '') + '>' + VISIBILITY_LABELS[v] + '</option>').join('') +
        '</select></label>' +
      '</div>' +
      '<label>Details <span class="hint">optional · link people and places with [[Page name]]</span>' +
        '<textarea name="text" rows="6" placeholder="What happened, who was there…">' + esc(ev.text) + '</textarea></label>' +
      '<div class="row actions sticky-actions">' +
        '<button class="btn primary" type="submit">Save</button>' +
        '<a class="btn" href="#/timeline' + (existing ? '?focus=' + encodeURIComponent(existing.id) : '') + '">Cancel</a>' +
        (existing && existing.canDelete ? '<button class="btn danger" type="button" id="delete-event">Delete</button>' : '') +
      '</div>' +
    '</form>' +
  '</div>';
}

function bindEventForm(id) {
  const form = $('#event-form');
  if (!form) return;
  const existing = id && id !== 'new' ? state.events.find((x) => x.id === id) : null;
  form.date.addEventListener('input', () => { $('#date-help').innerHTML = dateHelp(form.date.value, parseStoryDate(form.date.value)); });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.offline) { toast('You are offline. Try again when you have internet.', true); return; }
    const button = $('button[type=submit]', form);
    button.disabled = true;
    try {
      const saved = await api('saveEvent', {
        event: {
          id: existing ? existing.id : '',
          chronicleId: state.chronicleId,
          date: form.date.value,
          title: form.title.value,
          realityId: form.realityId.value,
          visibility: form.visibility.value,
          text: form.text.value
        }
      });
      rememberItem('events', saved);
      toast('Saved.');
      go('#/timeline?focus=' + encodeURIComponent(saved.id));
    } catch (e) {
      if (e instanceof NetworkError) setOffline(true);
      toast(e.message, true);
      button.disabled = false;
    }
  });

  on('#delete-event', 'click', async () => {
    if (!existing) return;
    if (state.offline) { toast('You are offline. Try again when you have internet.', true); return; }
    if (!confirm('Delete the event "' + existing.title + '"? This cannot be undone.')) return;
    try {
      await api('deleteEvent', { id: existing.id });
      state.events = state.events.filter((x) => x.id !== existing.id);
      saveChronicleData();
      toast('Event deleted.');
      go('#/timeline');
    } catch (e) { toast(e.message, true); }
  });
}

/* ------------------------------------------------------------------ */
/* Screens: realities                                                  */
/* ------------------------------------------------------------------ */
function viewRealities() {
  const list = sortedRealities();
  return '<div class="narrow">' +
    '<p class="crumbs"><a href="#/">Home</a> ›</p>' +
    '<h1>🌌 Realities</h1>' +
    '<p class="muted">Each reality is its own version of the world. Tag pages and timeline events with their reality. ' +
      'When the same person exists in several realities, write one page per version and fill in <em>Version of</em>. The app links them all together.</p>' +
    (list.length ? list.map((r) => {
      const pages = state.pages.filter((p) => p.realityId === r.id).length;
      const events = state.events.filter((e) => e.realityId === r.id).length;
      return '<a class="card reality-card" href="#/r/' + encodeURIComponent(r.id) + '" style="--rc:' + safeColor(r.color) + '">' +
        '<span class="reality-card-name">' + esc(r.name) + ' ' + visibilityBadge(r) + '</span>' +
        (r.description ? '<span class="muted small">' + esc(plainText(r.description).slice(0, 160)) + '</span>' : '') +
        '<span class="muted small">' + pages + ' page' + (pages === 1 ? '' : 's') + ' · ' + events + ' event' + (events === 1 ? '' : 's') + '</span>' +
      '</a>';
    }).join('') : '<div class="card empty">No realities yet.</div>') +
    '<a class="btn primary block" href="#/reality/new">＋ Add a reality</a>' +
  '</div>';
}

function viewReality(id) {
  const r = realityById(id);
  if (!r) return '<div class="narrow"><h1>Reality not found</h1><a class="btn" href="#/realities">All realities</a></div>';
  const pages = state.pages.filter((p) => p.realityId === r.id);
  const groups = {};
  pages.forEach((p) => { (groups[p.category] = groups[p.category] || []).push(p); });
  const events = state.events.filter((e) => e.realityId === r.id).length;
  return '<div class="narrow reality-view" style="--rc:' + safeColor(r.color) + '">' +
    '<p class="crumbs"><a href="#/">Home</a> › <a href="#/realities">Realities</a> ›</p>' +
    '<h1 class="reality-title">' + esc(r.name) + '</h1>' +
    (r.visibility !== 'everyone' ? '<p>' + visibilityBadge(r) + '</p>' : '') +
    '<div class="content">' + renderMarkdown(r.description, 'No description yet.') + '</div>' +
    '<div class="row">' +
      '<button class="btn primary" data-reality-only="' + esc(r.id) + '">Show only this reality</button>' +
      '<button class="btn" data-reality-timeline="' + esc(r.id) + '">⏳ Its timeline (' + events + ')</button>' +
      '<a class="btn" href="#/reality/' + encodeURIComponent(r.id) + '">✎ Edit</a>' +
    '</div>' +
    '<h2>Pages in this reality (' + pages.length + ')</h2>' +
    (pages.length ? Object.keys(groups).sort().map((cat) =>
      '<h3>' + (CATEGORY_ICONS[cat] || '📁') + ' ' + esc(cat) + '</h3><ul class="page-list">' +
      groups[cat].sort(byTitle).map((p) => pageItem(p)).join('') + '</ul>').join('')
      : '<div class="card empty">No pages in this reality yet.</div>') +
    '<a class="btn primary block" href="#/new?reality=' + encodeURIComponent(r.id) + '">＋ New page in ' + esc(r.name) + '</a>' +
  '</div>';
}

function bindReality(id) {
  on('[data-reality-only]', 'click', () => { setRealityFilter(id); go('#/'); });
  on('[data-reality-timeline]', 'click', () => { setRealityFilter(id); go('#/timeline'); });
}

function viewRealityForm(id) {
  const existing = id && id !== 'new' ? realityById(id) : null;
  if (id && id !== 'new' && !existing) return '<div class="narrow"><h1>Reality not found</h1><a class="btn" href="#/realities">All realities</a></div>';
  const r = existing || {
    name: '', description: '', color: REALITY_COLORS[state.realities.length % REALITY_COLORS.length],
    visibility: 'everyone', sortOrder: state.realities.length + 1
  };
  const mayChangeVisibility = !existing || existing.canChangeVisibility;
  const visOptions = ['everyone', 'gm'].filter((v) => v !== 'gm' || isGM() || r.visibility === 'gm');
  return '<div class="narrow">' +
    '<p class="crumbs"><a href="#/realities">Realities</a> ›</p>' +
    '<h1>' + (existing ? 'Edit reality' : 'New reality') + '</h1>' +
    '<form id="reality-form" class="form keep-open">' +
      '<label>Name<input name="name" required maxlength="100" value="' + esc(r.name) + '" placeholder="e.g. Reality A, Prime, The Burning World"></label>' +
      '<label>Description <span class="hint">optional · how is this world different?</span>' +
        '<textarea name="description" rows="5" maxlength="5000">' + esc(r.description) + '</textarea></label>' +
      '<div class="form-label">Colour</div><div class="swatches">' +
        REALITY_COLORS.map((c) => '<label class="swatch" style="--rc:' + c + '"><input type="radio" name="color" value="' + c + '"' +
          (c === r.color ? ' checked' : '') + '><span></span></label>').join('') +
      '</div>' +
      '<div class="two-col">' +
        '<label>Position in lists<input name="sortOrder" type="number" step="1" value="' + esc(r.sortOrder) + '"><span class="hint">1 comes first</span></label>' +
        (visOptions.length > 1 ? '<label>Who can see it?<select name="visibility"' + (mayChangeVisibility ? '' : ' disabled') + '>' +
          visOptions.map((v) => '<option value="' + v + '"' + (v === r.visibility ? ' selected' : '') + '>' + VISIBILITY_LABELS[v] + '</option>').join('') +
          '</select><span class="hint">A "GM only" reality shows to players as "Unknown reality".</span></label>' : '') +
      '</div>' +
      '<div class="row actions">' +
        '<button class="btn primary" type="submit">Save</button>' +
        '<a class="btn" href="' + (existing ? '#/r/' + encodeURIComponent(existing.id) : '#/realities') + '">Cancel</a>' +
        (existing && existing.canDelete ? '<button class="btn danger" type="button" id="delete-reality">Delete</button>' : '') +
      '</div>' +
    '</form>' +
  '</div>';
}

function bindRealityForm(id) {
  const form = $('#reality-form');
  if (!form) return;
  const existing = id && id !== 'new' ? realityById(id) : null;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.offline) { toast('You are offline. Try again when you have internet.', true); return; }
    const button = $('button[type=submit]', form);
    button.disabled = true;
    try {
      const color = $('input[name=color]:checked', form);
      const saved = await api('saveReality', {
        reality: {
          id: existing ? existing.id : '',
          chronicleId: state.chronicleId,
          name: form.name.value,
          description: form.description.value,
          color: color ? color.value : '',
          sortOrder: form.sortOrder.value,
          visibility: form.visibility ? form.visibility.value : 'everyone'
        }
      });
      rememberItem('realities', saved);
      toast('Reality saved.');
      go('#/r/' + encodeURIComponent(saved.id));
    } catch (e) {
      if (e instanceof NetworkError) setOffline(true);
      toast(e.message, true);
      button.disabled = false;
    }
  });
  on('#delete-reality', 'click', async () => {
    if (state.offline) { toast('You are offline. Try again when you have internet.', true); return; }
    if (!confirm('Delete the reality "' + existing.name + '"?')) return;
    try {
      await api('deleteReality', { id: existing.id });
      state.realities = state.realities.filter((r) => r.id !== existing.id);
      if (state.realityFilter === existing.id) setRealityFilter('');
      saveChronicleData();
      toast('Reality deleted.');
      go('#/realities');
    } catch (e) { toast(e.message, true); }
  });
}

/* ------------------------------------------------------------------ */
/* Screen: search                                                      */
/* ------------------------------------------------------------------ */
function searchPages(query, category) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const results = [];
  filteredPages().forEach((page) => {
    if (category && page.category !== category) return;
    const title = page.title.toLowerCase();
    const tags = tagList(page).map((t) => t.toLowerCase());
    const text = plainText(page.content).toLowerCase();
    const notes = page.canSeeSecrets ? plainText(page.gmNotes).toLowerCase() : '';
    const extra = ((page.status || '') + ' ' + ((realityById(page.realityId) || {}).name || '')).toLowerCase();
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
      if (extra.indexOf(word) >= 0) s += 2;
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

function searchEvents(query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter((w) => w && !w.startsWith('#'));
  if (!words.length) return [];
  return sortedEvents(state.events.filter(inFilter).filter((ev) => {
    const text = (ev.title + ' ' + ev.date + ' ' + plainText(ev.text)).toLowerCase();
    return words.every((w) => text.indexOf(w) >= 0);
  }));
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
    realityBar() +
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
    filteredPages().forEach((p) => tagList(p).forEach((t) => { tags[t] = (tags[t] || 0) + 1; }));
    const tagNames = Object.keys(tags).sort((a, b) => tags[b] - tags[a]).slice(0, 40);
    return '<p class="muted">Type a name or any word. Use <code>#tag</code> to find pages with a tag.</p>' +
      (tagNames.length ? '<h2>Tags</h2><p class="tag-cloud">' + tagNames.map((t) =>
        '<a class="tag" href="#/search?q=' + encodeURIComponent('#' + t) + '">#' + esc(t) + ' <small>' + tags[t] + '</small></a>').join(' ') + '</p>' : '');
  }
  const results = searchPages(q, category);
  const events = category ? [] : searchEvents(q);
  if (!results.length && !events.length) {
    return '<div class="card empty">Nothing found.' + (q.trim() && !q.trim().startsWith('#')
      ? ' <a href="#/new?title=' + encodeURIComponent(q.trim()) + '">Create a page called “' + esc(q.trim()) + '”</a>' : '') + '</div>';
  }
  return '<p class="muted small">' + results.length + ' page' + (results.length === 1 ? '' : 's') +
      (events.length ? ' · ' + events.length + ' timeline event' + (events.length === 1 ? '' : 's') : '') + '</p>' +
    (results.length ? '<ul class="page-list">' + results.slice(0, 100).map((p) =>
      '<li class="page-item"><a href="#/p/' + encodeURIComponent(p.id) + '">' +
        (p.images && p.images.length ? picture(p.images[0], 'thumb', 'pic-thumb') : '') +
        '<span class="page-item-text">' +
          '<span class="page-item-title">' + esc(p.title) + ' ' + visibilityBadge(p) + '</span>' +
          '<span class="page-item-meta">' + esc(p.category) + ' ' + realityChip(p.realityId) + ' ' + statusChip(p) + '</span>' +
          '<span class="snippet">' + snippet(p, q) + '</span>' +
        '</span>' +
      '</a></li>').join('') + '</ul>' : '') +
    (events.length ? '<h2>⏳ On the timeline</h2><ul class="mini-timeline">' + events.slice(0, 50).map((x) =>
      '<li><a href="#/timeline?focus=' + encodeURIComponent(x.ev.id) + '"><span class="mini-date">' + esc(x.when ? x.when.label : (x.ev.date || 'No date')) + '</span> ' +
      esc(x.ev.title) + '</a> ' + realityChip(x.ev.realityId) + '</li>').join('') + '</ul>' : '');
}

function bindSearch() {
  const form = $('#search-form');
  const update = () => {
    const results = $('#search-results');
    results.innerHTML = searchResultsHtml(form.q.value, form.category.value);
    hydrateImages(results);
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
        '<a class="btn" href="#/realities">🌌 Realities (' + state.realities.length + ')</a>' +
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
      '<p class="muted small">Version ' + APP_VERSION + ' · ' + state.pages.length + ' pages and ' + state.events.length +
        ' timeline events are saved on this device for offline reading, along with every picture you have opened.</p>' +
    '</section>' +

    '<section class="card">' +
      '<h2>Who sees what</h2>' +
      '<ul class="help-list">' +
        '<li><strong>Everyone:</strong> all players in this chronicle and the GM.</li>' +
        '<li><strong>GM only:</strong> only the GM (and the author) until the GM taps <em>Reveal</em>.</li>' +
        '<li><strong>Private:</strong> only the person who wrote it.</li>' +
        '<li><strong>GM notes</strong> on a page are never shown to other players, even after the page is revealed.</li>' +
        '<li>The same rules apply to <strong>timeline events</strong> and <strong>realities</strong>. A hidden reality shows to players as "Unknown reality".</li>' +
        '<li><strong>Pictures</strong> follow their page: only people who can see the page see its pictures.</li>' +
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
      Date.now() - state.pagesLoadedAt > 60 * 1000 && !isTyping()) {
    refreshAll(false);
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode not available */ });
  });
}

(async function start() {
  if (state.chronicleId) loadSavedChronicleData(state.chronicleId);
  render(); // show the saved copy straight away
  if (state.token && API_URL.indexOf('PASTE-YOUR') !== 0) {
    if (isTyping()) {
      // do not redraw a form the user is typing in
      try { await loadBootstrap(); await loadPages(); } catch (e) { if (e instanceof NetworkError) setOffline(true); }
      return;
    }
    await refreshAll(false);
  }
})();
