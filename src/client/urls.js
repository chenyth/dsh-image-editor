export const EDITOR_ORIGIN = 'https://www.shenhuoai.com';
export const EDITOR_HOME = `${EDITOR_ORIGIN}/home/tools/layer-editor`;

// Only clean official editor locations are accepted as external launch targets.
// Authentication stays in the user's browser; no tokens are passed in the URL.
export function editorUrl(value = EDITOR_HOME) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid Shenhuo editor URL.'); }
  if (url.origin !== EDITOR_ORIGIN || url.username || url.password || url.search || url.hash
      || !(/^\/home\/tools\/layer-editor\/?$/.test(url.pathname)
        || /^\/agent\/layer-editor\/(?:project\/)?[A-Za-z0-9_-]{1,80}\/?$/.test(url.pathname))) {
    throw new Error('Use the official Shenhuo layer editor address without credentials or query parameters.');
  }
  return url.href;
}
