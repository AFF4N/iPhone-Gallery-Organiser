/**
 * Media components: Tile rendering, lazy media observer, cleanup, and full-screen viewer.
 */
import { fileUrl, fetchMediaInfo } from './api.js';

export const VIDEO = /\.(mov|mp4|m4v)$/i;
export const IMG = /\.(jpe?g|png|gif|webp|heic|heif)$/i;

// Lazy video loader: attach src only when tile is near viewport to conserve hardware decoders and memory
export const lazyVideoObserver = new IntersectionObserver((entries, obs) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const video = entry.target;
      obs.unobserve(video);
      const dataSrc = video.getAttribute('data-src');
      if (dataSrc) {
        video.src = dataSrc;
      }
    }
  });
}, { rootMargin: '250px' });

/**
 * Clean up all media elements in a container before removal to prevent GPU decoder leaks.
 */
export function cleanupMedia(container) {
  if (!container) return;
  const videos = container.querySelectorAll('video');
  videos.forEach(v => {
    lazyVideoObserver.unobserve(v);
    try {
      v.pause();
      v.removeAttribute('src');
      v.load();
    } catch (e) {}
  });
}

export function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

/**
 * Creates a tile DOM element for an image or video item with corner metadata badges.
 */
export function createTile(path, name, { cls = '', list = null, idx = 0, onClick = null, size = 0, duration = null } = {}) {
  const d = document.createElement('div');
  d.className = 'tile ' + cls;

  if (onClick) {
    d.onclick = onClick;
  } else if (list) {
    d.style.cursor = 'zoom-in';
    d.onclick = () => openViewer(list, idx);
  }

  const ext = (name.split('.').pop() || '').toUpperCase();
  const fallback = () => {
    d.querySelector('img,video')?.remove();
    const e = document.createElement('div');
    e.className = 'ext';
    e.textContent = ext;
    d.prepend(e);
  };

  // Top-Right badge: file format
  const typeBadge = document.createElement('div');
  typeBadge.className = 'tile-badge-tr';
  typeBadge.textContent = ext;
  d.append(typeBadge);

  // Bottom-Left badge: file size
  if (size > 0) {
    const sizeBadge = document.createElement('div');
    sizeBadge.className = 'tile-badge-bl';
    sizeBadge.textContent = formatSize(size);
    d.append(sizeBadge);
  }

  if (IMG.test(name)) {
    const img = new Image();
    img.loading = 'lazy';
    img.src = fileUrl(path, 360);
    img.onerror = fallback;
    d.append(img);
  } else if (VIDEO.test(name)) {
    const v = document.createElement('video');
    v.setAttribute('data-src', fileUrl(path) + '#t=0.1');
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;
    v.onerror = fallback;
    lazyVideoObserver.observe(v);
    d.append(v);

    // Bottom-Right badge: video duration
    const durBadge = document.createElement('div');
    durBadge.className = 'tile-badge-br';
    durBadge.innerHTML = `<svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>${duration || ''}</span>`;
    if (!duration) durBadge.style.display = 'none';
    d.append(durBadge);

    v.addEventListener('loadedmetadata', () => {
      if (v.duration && !durBadge.querySelector('span').textContent) {
        const sec = Math.floor(v.duration);
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        durBadge.querySelector('span').textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
        durBadge.style.display = 'flex';
      }
    }, { once: true });
  } else {
    fallback();
  }

  const cap = document.createElement('div');
  cap.className = 'cap';
  cap.textContent = name;
  d.append(cap);

  return d;
}

// ================= Full-Screen Media Viewer =================
let vList = [];
let vIdx = 0;

function clearViewerStage() {
  const stage = document.getElementById('v-stage');
  const v = stage.querySelector('video');
  if (v) {
    try {
      v.pause();
      v.removeAttribute('src');
      v.load();
    } catch (e) {}
  }
  stage.innerHTML = '';
}

export function openViewer(list, idx) {
  vList = list;
  vIdx = idx;
  document.getElementById('viewer').hidden = false;
  renderViewer();
}

export function closeViewer() {
  document.getElementById('viewer').hidden = true;
  clearViewerStage();
}

export function stepViewer(delta) {
  clearViewerStage();
  vIdx = (vIdx + delta + vList.length) % vList.length;
  renderViewer();
}

export function isViewerOpen() {
  return !document.getElementById('viewer').hidden;
}

async function loadInfo() {
  const box = document.getElementById('v-meta');
  const it = vList[vIdx];
  box.textContent = 'Loading…';
  try {
    const groups = await fetchMediaInfo(it.path);
    if (vList[vIdx] !== it) return;
    box.innerHTML = '';
    Object.entries(groups).forEach(([g, tags], n) => {
      const det = document.createElement('details');
      det.open = n < 2;
      const sum = document.createElement('summary');
      sum.textContent = `${g} (${Object.keys(tags).length})`;
      const dl = document.createElement('dl');
      for (const [k, v] of Object.entries(tags)) {
        const dt = document.createElement('dt');
        const dd = document.createElement('dd');
        dt.textContent = k;
        dd.textContent = v;
        dl.append(dt, dd);
      }
      det.append(sum, dl);
      box.append(det);
    });
  } catch (e) {
    box.textContent = e.message;
  }
}

export function toggleInfo(force) {
  const drawer = document.getElementById('v-drawer');
  const btn = document.getElementById('v-info');
  const open = force ?? drawer.hidden;
  drawer.hidden = !open;
  btn.classList.toggle('on', open);
  document.body.classList.toggle('drawer-open', open);
  if (open) {
    loadInfo();
  }
}

function renderViewer() {
  clearViewerStage();
  const it = vList[vIdx];
  const stage = document.getElementById('v-stage');
  document.getElementById('v-title').textContent = `${it.name}  ·  ${vIdx + 1} / ${vList.length}`;

  const fail = () => {
    stage.innerHTML = '<div class="empty">This format can\u2019t be previewed in the browser.<br>Open it from the folder instead.</div>';
  };

  let el;
  if (VIDEO.test(it.name)) {
    el = document.createElement('video');
    el.controls = true;
    el.autoplay = true;
    el.playsInline = true;
  } else if (IMG.test(it.name)) {
    el = new Image();
  } else {
    return fail();
  }

  el.src = fileUrl(it.path, 2400);
  el.onerror = fail;
  stage.append(el);

  if (!document.getElementById('v-drawer').hidden) {
    loadInfo();
  }
}

export function initViewer() {
  document.getElementById('v-close').onclick = closeViewer;
  document.getElementById('v-info').onclick = () => toggleInfo();
  document.getElementById('v-prev').onclick = () => stepViewer(-1);
  document.getElementById('v-next').onclick = () => stepViewer(1);
  document.getElementById('viewer').onclick = (e) => {
    if (e.target.id === 'viewer' || e.target.id === 'v-stage') {
      closeViewer();
    }
  };
}

