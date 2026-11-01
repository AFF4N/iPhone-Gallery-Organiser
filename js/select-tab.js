/**
 * Step 1: Import folder scanning, selection state, master checkbox, and chunked grid.
 */
import { scanFolder } from './api.js';
import { createTile, cleanupMedia, openViewer, isViewerOpen } from './media.js';

let items = [];
let els = [];
let anchor = -1;
let importRenderId = 0;
let importSentinelObserver = null;
let onWindowScroll = null;
let isOrganisingCallback = () => false;

export function setOrganisingChecker(fn) {
  isOrganisingCallback = fn;
}

export function getSelectedItems() {
  return items.filter(i => i.sel);
}

function getExt(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function sortItems(sortKey) {
  switch (sortKey) {
    case 'date-desc':
      items.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name));
      break;
    case 'date-asc':
      items.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.name.localeCompare(b.name));
      break;
    case 'size-desc':
      items.sort((a, b) => ((b.size || 0) - (a.size || 0)) || a.name.localeCompare(b.name));
      break;
    case 'size-asc':
      items.sort((a, b) => ((a.size || 0) - (b.size || 0)) || a.name.localeCompare(b.name));
      break;
    case 'type-asc':
      items.sort((a, b) => getExt(a.name).localeCompare(getExt(b.name)) || a.name.localeCompare(b.name));
      break;
    case 'type-desc':
      items.sort((a, b) => getExt(b.name).localeCompare(getExt(a.name)) || a.name.localeCompare(b.name));
      break;
    case 'name-asc':
      items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      break;
    case 'name-desc':
      items.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }));
      break;
    default:
      items.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name));
      break;
  }
}

export function updateCount() {
  const n = items.filter(i => i.sel).length;
  const countEl = document.getElementById('count');
  const masterCb = document.getElementById('sel-master');
  const goBtn = document.getElementById('go');

  countEl.textContent = `${n} of ${items.length} selected`;
  masterCb.checked = items.length > 0 && n === items.length;
  masterCb.indeterminate = n > 0 && n < items.length;
  goBtn.disabled = n === 0 || isOrganisingCallback();
}

export function setSel(i, v) {
  if (items[i]) items[i].sel = v;
  if (els[i]) els[i].classList.toggle('sel', v);
}

export function selectOnly(indices) {
  const keep = new Set(indices);
  items.forEach((_, i) => setSel(i, keep.has(i)));
}

function range(a, b) {
  const out = [];
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i);
  return out;
}

export function onTileClick(e, i) {
  const toggleOnly = e.target.classList.contains('box');
  if (e.shiftKey) {
    const base = anchor < 0 ? 0 : anchor;
    const r = range(base, i);
    if (e.ctrlKey || e.metaKey) {
      r.forEach(k => setSel(k, true));
    } else {
      selectOnly(r);
    }
  } else if (e.ctrlKey || e.metaKey || toggleOnly) {
    setSel(i, !items[i].sel);
    anchor = i;
  } else {
    anchor = i;
    openViewer(items, i);
  }
  updateCount();
}

export function selectAll() {
  items.forEach((it, i) => {
    it.sel = true;
    if (els[i]) els[i].classList.add('sel');
  });
  updateCount();
}

export function selectNone() {
  items.forEach((it, i) => {
    it.sel = false;
    if (els[i]) els[i].classList.remove('sel');
  });
  updateCount();
}

function renderItemsGrid() {
  const gridEl = document.getElementById('import-grid');
  const renderId = ++importRenderId;

  cleanupMedia(gridEl);
  if (importSentinelObserver) {
    importSentinelObserver.disconnect();
    importSentinelObserver = null;
  }
  if (onWindowScroll) {
    window.removeEventListener('scroll', onWindowScroll);
    onWindowScroll = null;
  }

  gridEl.innerHTML = '';
  els = new Array(items.length);
  anchor = -1;

  if (!items.length) {
    gridEl.innerHTML = `
      <div class="empty">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
        </svg>
        <h3>No photos or videos found</h3>
        <p>The selected folder doesn't contain any supported media files.</p>
      </div>`;
    updateCount();
    return;
  }

  const CHUNK_SIZE = 150;
  let nextIdx = 0;

  const sentinel = document.createElement('div');
  sentinel.className = 'sentinel-loader';
  sentinel.innerHTML = `
    <div class="spinner"></div>
    <div class="sentinel-info">
      <span class="sentinel-status">Loading more files…</span>
      <span class="sentinel-counts">Showing 0 of ${items.length} items</span>
    </div>
    <button class="btn btn-sm" type="button" id="btn-load-all-import">Load All (${items.length})</button>
  `;
  gridEl.append(sentinel);

  const countsEl = sentinel.querySelector('.sentinel-counts');
  const loadAllBtn = sentinel.querySelector('#btn-load-all-import');

  function renderNextImportChunk(batchSize = CHUNK_SIZE) {
    if (renderId !== importRenderId) return;
    const frag = document.createDocumentFragment();
    const end = Math.min(nextIdx + batchSize, items.length);

    for (let n = nextIdx; n < end; n++) {
      const it = items[n];
      const t = createTile(it.path, it.name, {
        onClick: (e) => onTileClick(e, n),
        size: it.size,
        duration: it.duration,
      });

      const box = document.createElement('div');
      box.className = 'box';
      t.prepend(box);
      t.classList.toggle('sel', it.sel);
      els[n] = t;
      frag.append(t);
    }
    nextIdx = end;
    gridEl.insertBefore(frag, sentinel);

    if (nextIdx >= items.length) {
      if (importSentinelObserver) {
        importSentinelObserver.disconnect();
        importSentinelObserver = null;
      }
      if (onWindowScroll) {
        window.removeEventListener('scroll', onWindowScroll);
        onWindowScroll = null;
      }
      sentinel.remove();
    } else {
      if (countsEl) {
        countsEl.textContent = `Showing ${nextIdx} of ${items.length} items`;
      }
      if (loadAllBtn) {
        loadAllBtn.textContent = `Load All (${items.length - nextIdx} more)`;
      }
    }
  }

  if (loadAllBtn) {
    loadAllBtn.onclick = () => {
      renderNextImportChunk(items.length - nextIdx);
    };
  }

  function checkAndFill() {
    if (renderId !== importRenderId || nextIdx >= items.length) return;
    const rect = sentinel.getBoundingClientRect();
    if (rect.top <= window.innerHeight + 800) {
      renderNextImportChunk();
      if (nextIdx < items.length) {
        requestAnimationFrame(checkAndFill);
      }
    }
  }

  onWindowScroll = () => {
    if (renderId === importRenderId && nextIdx < items.length) {
      checkAndFill();
    }
  };
  window.addEventListener('scroll', onWindowScroll, { passive: true });

  // Initial render
  renderNextImportChunk();

  if (nextIdx < items.length) {
    importSentinelObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && renderId === importRenderId) {
        checkAndFill();
      }
    }, { rootMargin: '800px' });
    importSentinelObserver.observe(sentinel);
  }

  updateCount();
}

export async function loadImport(srcPath) {
  if (!srcPath || !srcPath.trim()) {
    alert('Please enter or choose an import folder path first.');
    return;
  }

  const renderId = ++importRenderId;
  const excluded = new Set(items.filter(i => !i.sel).map(i => i.path));

  const metaEl = document.getElementById('import-meta');
  const gridEl = document.getElementById('import-grid');
  const selbar = document.getElementById('selbar');
  const refreshBtn = document.getElementById('src-refresh');
  const sortSelect = document.getElementById('import-sort');

  metaEl.textContent = '';
  cleanupMedia(gridEl);
  if (importSentinelObserver) {
    importSentinelObserver.disconnect();
    importSentinelObserver = null;
  }
  if (onWindowScroll) {
    window.removeEventListener('scroll', onWindowScroll);
    onWindowScroll = null;
  }

  // Single centered scanning state in the grid area
  if (refreshBtn) refreshBtn.disabled = true;
  selbar.hidden = true;

  gridEl.innerHTML = `
    <div class="empty" id="import-scanning">
      <div class="spinner large"></div>
      <h3>Scanning folder…</h3>
      <p>Reading files and extracting date metadata with ExifTool.<br>This may take a moment for large galleries.</p>
    </div>
  `;

  try {
    items = await scanFolder(srcPath.trim());
    if (renderId !== importRenderId) return;

    items.forEach(i => i.sel = !excluded.has(i.path));

    const sortKey = sortSelect ? sortSelect.value : 'date-desc';
    sortItems(sortKey);

    metaEl.textContent = items.length ? `${items.length} items` : '';
    selbar.hidden = !items.length;

    renderItemsGrid();
  } catch (e) {
    if (renderId === importRenderId) {
      items = [];
      els = [];
      metaEl.textContent = '';
      gridEl.innerHTML = `
        <div class="err empty">
          <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <h3>Error scanning folder</h3>
          <p>${e.message}</p>
        </div>`;
    }
  } finally {
    if (renderId === importRenderId) {
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }
}

export function initSelectTab() {
  document.getElementById('sel-master').onclick = () => {
    items.some(i => i.sel) ? selectNone() : selectAll();
  };

  const sortSelect = document.getElementById('import-sort');
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      if (!items.length) return;
      sortItems(sortSelect.value);
      renderItemsGrid();
    });
  }

  document.addEventListener('keydown', (e) => {
    const isTyping = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'checkbox';
    const exportDlg = document.getElementById('export-dlg');
    const viewSelect = document.getElementById('view-select');

    if (isViewerOpen() || exportDlg.open || isTyping || viewSelect.hidden || !items.length) {
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectAll();
    } else if (e.key === 'Escape') {
      selectNone();
    } else if (e.key === 'Enter' && anchor >= 0) {
      openViewer(items, anchor);
    }
  });
}

