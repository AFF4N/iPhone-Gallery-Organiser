/**
 * API client functions for communicating with the Python backend server.
 */

export async function fetchJson(endpoint, options = {}) {
  const res = await fetch(endpoint, options);
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}

export function fileUrl(path, width = 0) {
  return '/file?path=' + encodeURIComponent(path) + (width ? '&w=' + width : '');
}

export async function fetchConfig() {
  return fetchJson('/api/config');
}

export async function scanFolder(path) {
  return fetchJson('/api/scan?path=' + encodeURIComponent(path));
}

export async function scanOrganised(path) {
  return fetchJson('/api/organised?path=' + encodeURIComponent(path));
}

export async function fetchMediaInfo(path) {
  return fetchJson('/api/info?path=' + encodeURIComponent(path));
}

export async function pickFolder() {
  return fetchJson('/api/pick');
}

export async function openFolder(path) {
  return fetchJson('/api/open_folder?path=' + encodeURIComponent(path));
}

export async function startOrganise(data) {
  return fetchJson('/api/organise', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function fetchProgress(from = 0) {
  return fetchJson('/api/progress?from=' + from);
}

