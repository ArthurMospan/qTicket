// External links may come from integrations or persisted user input. Keep the
// protocol decision in one dependency-free helper so saving, rendering and
// notification delivery cannot drift apart.
export function safeExternalUrl(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!/^https?:\/\/[^\s<>"]+$/i.test(url)) return '';

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : '';
  } catch {
    return '';
  }
}
