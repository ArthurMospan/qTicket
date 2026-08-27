export function getOneBRedirectUri(origin) {
  try {
    const url = new URL(origin);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return `${origin}/oauth2/result`;
    }
  } catch {}

  return process.env.NEXT_PUBLIC_ONEB_REDIRECT_URI || `${origin}/oauth2/result`;
}
