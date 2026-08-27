const BLOCKED_AUTH_DESTINATIONS = ['/api', '/login', '/oauth2'];

export function getSafeAuthRedirect(value, fallback = '/') {
  if (typeof value !== 'string') return fallback;
  const destination = value.trim();
  if (!destination) return fallback;
  if (!destination.startsWith('/') || destination.startsWith('//')) return fallback;

  try {
    const parsed = new URL(destination, 'https://quickteam.local');
    if (parsed.origin !== 'https://quickteam.local') return fallback;
    const pathname = parsed.pathname === '/workspace'
      ? '/'
      : parsed.pathname.startsWith('/workspace/')
        ? parsed.pathname.slice('/workspace'.length)
        : parsed.pathname;
    const isBlocked = BLOCKED_AUTH_DESTINATIONS.some(prefix =>
      pathname === prefix || pathname.startsWith(`${prefix}/`)
    );
    if (isBlocked) return fallback;
    return `${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
