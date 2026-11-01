/**
 * Main application entry point: wires together tabs, events, and lifecycle.
 */
import { pickFolder, fetchConfig } from './api.js';
import { initViewer } from './media.js';
import { initSelectTab, loadImport, getSelectedItems, setOrganisingChecker } from './select-tab.js';
import { initOrganiseTab, runOrganiseJob, loadResult, isOrganising } from './organise-tab.js';

const $ = (id) => document.getElementById(id);

export function showTab(name) {
  $('view-select').hidden = name !== 'select';
  $('view-result').hidden = name !== 'result';
  $('tab-select').classList.toggle('active', name === 'select');
  $('tab-result').classList.toggle('active', name === 'result');
}

async function handlePick(inputId) {
  try {
    const { path } = await pickFolder();
    if (path) {
      $(inputId).value = path.replace(/\//g, '\\');
      if (inputId === 'src') {
        loadImport($(inputId).value);
      }
    }
  } catch (e) {
    alert(e.message);
  }
}

function initApp() {
  // Connect cross-module state check
  setOrganisingChecker(isOrganising);

  // Initialize modular domain handlers
  initViewer();
  initSelectTab();
  initOrganiseTab();

  // Tab switching
  $('tab-select').onclick = () => showTab('select');
  $('tab-result').onclick = () => {
    showTab('result');
    const dest = $('dst').value.trim();
    if (!isOrganising() && !$('tree').children.length) {
      loadResult(dest);
    }
  };

  // Folder picker buttons
  $('src-pick').onclick = () => handlePick('src');
  $('dst-pick').onclick = () => handlePick('dst');

  // Auto-load if the user types or pastes a path directly into the "From" input
  $('src').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = $('src').value.trim();
      if (val) loadImport(val);
    }
  });
  $('src').addEventListener('change', () => {
    const val = $('src').value.trim();
    if (val) loadImport(val);
  });

  // Step 1 Refresh button
  $('src-refresh').onclick = () => loadImport($('src').value);

  // Step 1 -> Step 2 "Organise" button
  $('go').onclick = () => {
    runOrganiseJob(getSelectedItems(), $('dst').value.trim(), showTab);
  };

  // Step 2 Refresh
  $('res-refresh').onclick = () => loadResult($('dst').value.trim());

  // Step 2 Empty state pick button
  const resEmptyPick = $('res-empty-pick');
  if (resEmptyPick) {
    resEmptyPick.onclick = async () => {
      await handlePick('dst');
      const dest = $('dst').value.trim();
      if (dest) {
        loadResult(dest);
      }
    };
  }

  // Clean state on startup / refresh:
  try {
    localStorage.removeItem('galleryPaths');
  } catch (e) {}

  $('src').value = '';
  $('dst').value = '';

  // Confirm server connectivity
  fetchConfig().catch((e) => console.warn('Server connection check:', e));
}

// Start application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

