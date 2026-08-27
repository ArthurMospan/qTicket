/**
 * Select a Ukrainian cardinal plural form.
 *
 * Forms are ordered as: one (1, 21), few (2–4, except 12–14), many (0, 5–20).
 * The helper intentionally returns only the noun so callers can keep the
 * surrounding sentence natural instead of coupling formatting to one layout.
 *
 * @param {number} count
 * @param {[string, string, string]} forms
 */
export function plural(count, forms) {
  if (!Array.isArray(forms) || forms.length !== 3) {
    throw new TypeError('plural() expects exactly three Ukrainian forms');
  }

  const value = Math.abs(Math.trunc(Number(count)));
  if (!Number.isFinite(value)) return forms[2];

  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return forms[2];

  const last = value % 10;
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}
