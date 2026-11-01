/**
 * Step 2: Organise progress execution, destination folder tree, and chunked pane renderer.
 */
import { startOrganise, fetchProgress, scanOrganised, openFolder } from './api.js';
import { createTile, cleanupMedia } from './media.js';
import { updateCount } from './select-tab.js';

const ICON_FOLDER = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>';

let organising = false;
let cards = {};
let treeRoot = null;
let treeSel = '';
let treeOpen = new Set(['']);
let paneRenderId = 0;
let paneSentinelObserver = null;

export function isOrganising() {
  return organising;
}

// Dialog options persistence for export preferences (copy vs move, layout)
const exportOpts = Object.assign(
  { mode: 'copy', layout: 'ym' },
  JSON.parse(localStorage.getItem('galleryExport') || '{}')
);

export function askExportOptions(count, dest) {
  const dlg = document.getElementById('export-dlg');
  document.getElementById('ex-summary').textContent = `${count} file(s) → ${dest}`;
  dlg.querySelector(`input[name=mode][value=${exportOpts.mode}]`).checked = true;
  document.getElementById('ex-layout').value = exportOpts.layout;

  const sync = () => {
    document.getElementById('ex-warn').hidden = dlg.querySelector('input[name=mode]:checked').value !== 'move';
  };
  dlg.querySelectorAll('input[name=mode]').forEach(r => r.onchange = sync);
  sync();

  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'ok') return resolve(null);
      exportOpts.mode = dlg.querySelector('input[name=mode]:checked').value;
      exportOpts.layout = document.getElementById('ex-layout').value;
      localStorage.setItem('galleryExport', JSON.stringify(exportOpts));
      resolve({ ...exportOpts });
    }, { once: true });

    dlg.returnValue = '';
    dlg.showModal();
  });
}

export async function runOrganiseJob(chosenFiles, destPath, showTabCallback) {
  if (!chosenFiles.length) return;
  if (!destPath) {
    alert('Choose a target folder first.');
    return;
  }

  const opts = await askExportOptions(chosenFiles.length, destPath);
  if (!opts) return;

  organising = true;
  updateCount();
  showTabCallback('result');

  const resBarEl = document.getElementById('res-bar');
  const resEmptyEl = document.getElementById('res-empty');
  if (resBarEl) resBarEl.hidden = false;
  if (resEmptyEl) resEmptyEl.hidden = true;

  document.getElementById('res-path').textContent = destPath;
  document.getElementById('res-split').hidden = true;
  document.getElementById('tree').innerHTML = '';
  document.getElementById('folders').innerHTML = '';
  cards = {};

  document.getElementById('progress').hidden = false;
  document.getElementById('bar').style.width = '0';
  document.getElementById('res-meta').textContent = 'Starting…';

  try {
    await startOrganise({
      dest: destPath,
      move: opts.mode === 'move',
      layout: opts.layout,
      files: chosenFiles.map(i => ({ path: i.path, date: i.date })),
    });
  } catch (e) {
    return finishJob(`<span class="err">${e.message}</span>`, false, destPath);
  }

  let from = 0;
  const total = chosenFiles.length;
  let count = 0;

  const timer = setInterval(async () => {
    let p;
    try {
      p = await fetchProgress(from);
    } catch (e) {
      clearInterval(timer);
      return finishJob(`<span class="err">${e.message}</span>`, false, destPath);
    }

    from += p.events.length;
    for (const ev of p.events) {
      if (ev.type !== 'file') continue;
      count++;
      let c = cards[ev.folder];
      if (!c) {
        const el = document.createElement('div');
        el.className = 'folder';
        el.innerHTML = '<h3><b></b><span>0</span></h3><div class="strip"></div>';
        el.querySelector('b').textContent = ev.folder;
        document.getElementById('folders').prepend(el);
        c = cards[ev.folder] = { el, n: 0, items: [] };
      }
      c.n++;
      c.el.querySelector('span').textContent = c.n + ' items';
      c.items.push({ path: ev.path, name: ev.name });
      const strip = c.el.querySelector('.strip');
      strip.prepend(createTile(ev.path, ev.name, { cls: 'pop', list: c.items, idx: c.items.length - 1 }));

      while (strip.children.length > 5) {
        const last = strip.lastChild;
        cleanupMedia(last);
        last.remove();
      }
    }

    document.getElementById('bar').style.width = (count / total * 100) + '%';
    document.getElementById('res-meta').textContent = `Organising… ${count} / ${total}`;

    if (p.done) {
      clearInterval(timer);
      if (p.error) {
        finishJob(`<span class="err">${p.error}</span>`, false, destPath);
      } else {
        finishJob(`<span class="done">Done — ${count} files organised.</span>`, true, destPath);
      }
    }
  }, 400);
}

function finishJob(msg, ok, destPath) {
  organising = false;
  updateCount();
  document.getElementById('progress').hidden = true;
  cleanupMedia(document.getElementById('folders'));

  if (ok) {
    document.getElementById('folders').innerHTML = '';
    loadResult(destPath, msg);
  } else {
    document.getElementById('res-meta').innerHTML = msg;
  }
}

// ================= Tree and Pane Layout =================
export function buildTree(list, rootName) {
  const root = { name: rootName, path: '', children: new Map(), files: [], total: 0 };
  for (const f of list) {
    const parts = f.folder === '(root)' ? [] : f.folder.split('/');
    let n = root;
    n.total++;
    parts.forEach((part, k) => {
      const path = parts.slice(0, k + 1).join('/');
      if (!n.children.has(part)) {
        n.children.set(part, { name: part, path, children: new Map(), files: [], total: 0 });
      }
      n = n.children.get(part);
      n.total++;
    });
    n.files.push(f);
  }
  return root;
}

export const findNode = (n, path) =>
  !path ? n : path.split('/').reduce((cur, part) => cur && cur.children.get(part), n);

export const sortedKids = (n) =>
  [...n.children.values()].sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));

export function renderTree() {
  const nav = document.getElementById('tree');
  nav.innerHTML = '';

  const walk = (n, depth, parent) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'treeitem');
    const hasKids = n.children.size > 0;
    const open = treeOpen.has(n.path);

    const row = document.createElement('div');
    row.className = 'trow' + (n.path === treeSel ? ' sel' : '');
    row.style.paddingLeft = (8 + depth * 16) + 'px';
    row.innerHTML = `<span class="chev ${hasKids ? (open ? 'open' : '') : 'none'}"></span><span class="ico">${ICON_FOLDER}</span><span class="tname"></span><span class="tcount">${n.total}</span>`;
    row.querySelector('.tname').textContent = n.name;
    row.title = n.name;

    row.onclick = (e) => {
      const wasOpen = open;
      if (hasKids && (e.target.classList.contains('chev') || n.path === treeSel)) {
        wasOpen ? treeOpen.delete(n.path) : treeOpen.add(n.path);
      } else if (hasKids) {
        treeOpen.add(n.path);
      }
      treeSel = n.path;
      renderTree();
      renderPane();
    };

    li.append(row);

    if (hasKids && open) {
      li.setAttribute('aria-expanded', 'true');
      const ul = document.createElement('ul');
      ul.setAttribute('role', 'group');
      sortedKids(n).forEach(c => walk(c, depth + 1, ul));
      li.append(ul);
    }
    parent.append(li);
  };

  const ul = document.createElement('ul');
  ul.setAttribute('role', 'tree');
  walk(treeRoot, 0, ul);
  nav.append(ul);
}

export function renderPane() {
  const renderId = ++paneRenderId;
  const pane = document.getElementById('pane');

  cleanupMedia(pane);
  if (paneSentinelObserver) {
    paneSentinelObserver.disconnect();
    paneSentinelObserver = null;
  }
  pane.innerHTML = '';

  const node = findNode(treeRoot, treeSel) || treeRoot;
  if (!node) {
    pane.innerHTML = '<div class="empty">No folder selected.</div>';
    return;
  }

  const groups = [];
  const all = [];
  (function collect(n) {
    if (n.files.length) groups.push({ path: n.path, files: n.files });
    sortedKids(n).forEach(collect);
  })(node);
  groups.forEach(g => all.push(...g.files));

  if (!all.length) {
    pane.innerHTML = `
      <div class="empty">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"/>
        </svg>
        <h3>Empty folder</h3>
        <p>No media files found in this folder or its subfolders.</p>
      </div>`;
    return;
  }

  const crumbs = document.createElement('div');
  crumbs.className = 'crumbs';
  crumbs.textContent = `${node.path ? treeRoot.name + ' / ' + node.path.replace(/\//g, ' / ') : treeRoot.name}  ·  ${all.length} items`;
  pane.append(crumbs);

  const renderQueue = [];
  let offset = 0;
  for (const g of groups) {
    renderQueue.push({ type: 'header', path: g.path, count: g.files.length });
    g.files.forEach((f, n) => {
      renderQueue.push({ type: 'item', file: f, globalIdx: offset + n });
    });
    offset += g.files.length;
  }

  const CHUNK_SIZE = 150;
  let nextQueueIdx = 0;
  let currentGrid = null;
  const totalFiles = all.length;

  const sentinel = document.createElement('div');
  sentinel.className = 'sentinel-loader';
  sentinel.innerHTML = `
    <div class="spinner"></div>
    <div class="sentinel-info">
      <span class="sentinel-status">Loading more files…</span>
      <span class="sentinel-counts">Showing 0 of ${totalFiles} items</span>
    </div>
    <button class="btn btn-sm" type="button" id="btn-load-all-pane">Load All (${totalFiles})</button>
  `;
  pane.append(sentinel);

  const countsEl = sentinel.querySelector('.sentinel-counts');
  const loadAllBtn = sentinel.querySelector('#btn-load-all-pane');

  function renderNextPaneChunk(batchSize = CHUNK_SIZE) {
    if (renderId !== paneRenderId) return;
    const end = Math.min(nextQueueIdx + batchSize, renderQueue.length);

    while (nextQueueIdx < end) {
      const entry = renderQueue[nextQueueIdx++];
      if (entry.type === 'header') {
        const h = document.createElement('h2');
        const titleSpan = document.createElement('span');
        titleSpan.textContent = entry.path || '(root)';
        const countSmall = document.createElement('small');
        countSmall.textContent = `${entry.count} items`;
        h.append(titleSpan, ' ', countSmall);
        pane.insertBefore(h, sentinel);

        currentGrid = document.createElement('div');
        currentGrid.className = 'grid';
        pane.insertBefore(currentGrid, sentinel);
      } else if (entry.type === 'item') {
        if (!currentGrid) {
          currentGrid = document.createElement('div');
          currentGrid.className = 'grid';
          pane.insertBefore(currentGrid, sentinel);
        }
        currentGrid.append(createTile(entry.file.path, entry.file.name, {
          list: all,
          idx: entry.globalIdx,
          size: entry.file.size,
          duration: entry.file.duration,
        }));
      }
    }

    if (nextQueueIdx >= renderQueue.length) {
      if (paneSentinelObserver) {
        paneSentinelObserver.disconnect();
        paneSentinelObserver = null;
      }
      window.removeEventListener('scroll', onWindowScroll);
      sentinel.remove();
    } else {
      const renderedFilesCount = renderQueue.slice(0, nextQueueIdx).filter(e => e.type === 'item').length;
      if (countsEl) {
        countsEl.textContent = `Showing ${renderedFilesCount} of ${totalFiles} items`;
      }
      if (loadAllBtn) {
        loadAllBtn.textContent = `Load All (${totalFiles - renderedFilesCount} more)`;
      }
    }
  }

  if (loadAllBtn) {
    loadAllBtn.onclick = () => {
      renderNextPaneChunk(renderQueue.length - nextQueueIdx);
    };
  }

  function checkAndFill() {
    if (renderId !== paneRenderId || nextQueueIdx >= renderQueue.length) return;
    const rect = sentinel.getBoundingClientRect();
    if (rect.top <= window.innerHeight + 800) {
      renderNextPaneChunk();
      if (nextQueueIdx < renderQueue.length) {
        requestAnimationFrame(checkAndFill);
      }
    }
  }

  const onWindowScroll = () => {
    if (renderId === paneRenderId && nextQueueIdx < renderQueue.length) {
      checkAndFill();
    }
  };
  window.addEventListener('scroll', onWindowScroll, { passive: true });

  renderNextPaneChunk();

  if (nextQueueIdx < renderQueue.length) {
    paneSentinelObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && renderId === paneRenderId) {
        checkAndFill();
      }
    }, { rootMargin: '800px' });
    paneSentinelObserver.observe(sentinel);
  }
}

export async function loadResult(destPath, prefix = '') {
  const dest = destPath?.trim();
  const resBarEl = document.getElementById('res-bar');
  const resEmptyEl = document.getElementById('res-empty');
  const resPathEl = document.getElementById('res-path');
  const resMetaEl = document.getElementById('res-meta');
  const resSplitEl = document.getElementById('res-split');
  const treeEl = document.getElementById('tree');
  const paneEl = document.getElementById('pane');

  if (!dest) {
    if (resBarEl) resBarEl.hidden = true;
    resSplitEl.hidden = true;
    treeEl.innerHTML = '';
    cleanupMedia(paneEl);
    paneEl.innerHTML = '';
    if (resEmptyEl) resEmptyEl.hidden = false;
    return;
  }

  if (resEmptyEl) resEmptyEl.hidden = true;
  if (resBarEl) resBarEl.hidden = false;
  resPathEl.textContent = dest;
  resMetaEl.innerHTML = prefix || 'Loading…';
  resSplitEl.hidden = false;

  const resRefreshBtn = document.getElementById('res-refresh');
  if (resRefreshBtn) {
    resRefreshBtn.disabled = true;
  }

  paneEl.innerHTML = `
    <div class="empty">
      <div class="spinner large"></div>
      <h3>Scanning organised folder…</h3>
      <p>Reading folder hierarchy and media files.</p>
    </div>
  `;

  try {
    const list = await scanOrganised(dest);
    resMetaEl.innerHTML = (prefix ? prefix + ' · ' : '') + `${list.length} items in folder`;
    const rootName = dest.split(/[\\/]/).filter(Boolean).pop() || dest;
    treeRoot = buildTree(list, rootName);

    if (!findNode(treeRoot, treeSel)) treeSel = '';
    treeOpen.add('');

    if (treeOpen.size === 1) {
      sortedKids(treeRoot).forEach(k => treeOpen.add(k.path));
    }

    renderTree();
    renderPane();
  } catch (e) {
    resMetaEl.innerHTML = `<span class="err">${e.message}</span>`;
  } finally {
    if (resRefreshBtn) {
      resRefreshBtn.disabled = false;
    }
  }
}

export function initOrganiseTab() {
  document.getElementById('res-open').onclick = async () => {
    const dest = document.getElementById('dst').value.trim();
    if (!dest) return;
    try {
      await openFolder(dest);
    } catch (e) {
      alert(e.message);
    }
  };
}

