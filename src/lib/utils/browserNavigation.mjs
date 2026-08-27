export function resolveSameOriginUrl(path, origin) {
  if (typeof path !== 'string' || typeof origin !== 'string') {
    throw new TypeError('A path and origin are required');
  }

  const base = new URL(origin);
  const target = new URL(path, base);
  if (target.origin !== base.origin) {
    throw new Error('Cross-origin browser navigation is not allowed');
  }
  return target.href;
}

// OAuth entry points must perform a full document navigation: their route
// handlers set httpOnly state cookies and may redirect to an external provider.
// Keeping that behavior behind one same-origin guard prevents a future caller
// from accidentally turning an auth hand-off into an open redirect.
export function navigateToSameOrigin(path, { replace = false } = {}) {
  if (typeof window === 'undefined') return;
  const target = resolveSameOriginUrl(path, window.location.origin);
  if (replace) {
    window.location.replace(target);
    return;
  }
  window.location.assign(target);
}
