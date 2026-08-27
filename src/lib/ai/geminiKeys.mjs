// src/lib/ai/geminiKeys.mjs
// Gemini credentials and the rules for moving between them.
//
// The free tier is rate-limited per key, per minute and per day. With a single
// key the first feature to run in a day could already be the one that finds it
// spent, which is exactly how «Аудіо-завдання» came to fail on its first use of
// the morning — nothing was wrong with the request, the key had nothing left.
//
// So the key is a *list*. `GEMINI_API_KEY` accepts one key or several separated
// by commas, whitespace or newlines, and `GEMINI_API_KEYS` is an alias for the
// same thing, so adding capacity never means changing code. Requests start at a
// rotating offset rather than always at the first key, so ordinary traffic is
// spread instead of grinding one key to its ceiling before touching the next.
//
// Pure and dependency-free on purpose: this is the part with rules worth
// testing, and a test should not have to stand up a route to reach them.

// Long enough that a stray value (a URL, a JSON blob) is not mistaken for a
// key; short enough not to guess at Google's exact format.
const MIN_KEY_LENGTH = 20;

/**
 * Every configured key, in declaration order, de-duplicated.
 *
 * @param {Record<string, string | undefined>} env Environment to read.
 * @returns {string[]}
 */
export function parseGeminiApiKeys(env = {}) {
  const raw = [env.GEMINI_API_KEY, env.GEMINI_API_KEYS].filter(Boolean).join(',');
  return [...new Set(
    raw
      .split(/[\s,;]+/)
      .map(key => key.trim())
      .filter(key => key.length >= MIN_KEY_LENGTH),
  )];
}

let rotationCursor = 0;

/**
 * The configured keys, rotated so consecutive requests do not all open with the
 * same one. Every key is still present exactly once, so a caller that walks the
 * whole list tries them all.
 *
 * @param {string[]} keys
 * @returns {string[]}
 */
export function rotateKeys(keys) {
  if (keys.length < 2) return [...keys];
  const offset = rotationCursor % keys.length;
  rotationCursor = (rotationCursor + 1) % keys.length;
  return [...keys.slice(offset), ...keys.slice(0, offset)];
}

/**
 * What to do about an upstream response.
 *
 * `next-key` — this key is spent or rejected, another one may still work.
 * `retry`    — the model is momentarily overloaded; the same key is fine.
 * `fail`     — the request itself is wrong; no key will help.
 *
 * @param {number} status HTTP status from generativelanguage.googleapis.com.
 * @returns {'next-key' | 'retry' | 'fail'}
 */
export function classifyGeminiFailure(status) {
  if (status === 429) return 'next-key';          // quota / rate limit
  if (status === 401 || status === 403) return 'next-key'; // key invalid, disabled or unbilled
  if (status === 404) return 'next-key';          // model not available to this key
  if (status === 503 || status === 500) return 'retry';    // model overloaded
  return 'fail';                                  // 400 and friends: our request
}

/**
 * The message the user should see when nothing worked, given the last upstream
 * status. Deliberately says what to do next — «Internal Server Error» told them
 * nothing and made a spent quota look like a broken product.
 *
 * @param {number} status
 * @param {number} keyCount How many keys were tried.
 * @returns {string}
 */
export function geminiFailureMessage(status, keyCount) {
  if (status === 429) {
    return keyCount > 1
      ? `Ліміт Gemini вичерпано на всіх ${keyCount} ключах — спробуйте пізніше або додайте ще один ключ у GEMINI_API_KEY.`
      : 'Ліміт безкоштовного Gemini вичерпано. Додайте ще один ключ у GEMINI_API_KEY через кому — запити підуть по черзі.';
  }
  if (status === 401 || status === 403) return 'Gemini відхилив ключ — перевірте GEMINI_API_KEY.';
  if (status === 404) return 'Модель Gemini недоступна для цього ключа.';
  if (status === 503 || status === 500) return 'Gemini зараз перевантажений — спробуйте ще раз за хвилину.';
  if (status === 0) return 'Не вдалося досягти Gemini — мережа або таймаут.';
  return 'Gemini відхилив запит.';
}
