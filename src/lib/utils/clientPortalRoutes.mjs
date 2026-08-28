// The external client has a portal, not a smaller copy of the staff workspace.
// Keep this route boundary pure so the authenticated layout and its regression
// tests ask exactly the same question.
export function isClientPortalRoute(pathname = '') {
  const path = String(pathname || '').trim();
  if (path === '/') return true;
  if (path === '/settings' || path.startsWith('/settings/')) return true;
  return /^\/[^/]+\/issue\/[^/]+\/?$/.test(path);
}
