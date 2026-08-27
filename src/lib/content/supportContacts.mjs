// Verified against the public OneB help/support pages on 2026-08-15. Keep the
// HTTPS redirect for Viber: browsers and the app can validate it, while OneB
// remains free to rotate the deep-link destination without a QuickTeam deploy.
export const ONEB_LEGAL_ENTITY = Object.freeze({
  name: 'ТОВ «АІВ СІСТЕМС»',
  registrationCode: '40259603',
  address: '03186, м. Київ, вул. Сурікова, 3, корпус 37',
  jurisdiction: 'Україна',
  effectiveDate: '2026-08-15',
  officialSource: 'https://oneb.app/offer',
});

export const ONEB_SUPPORT_CONTACTS = Object.freeze([
  Object.freeze({
    id: 'email',
    label: 'Email OneB',
    value: 'sale@oneb.app',
    href: 'mailto:sale@oneb.app',
  }),
  Object.freeze({
    id: 'telegram',
    label: 'Telegram OneB',
    value: '@onebapp_bot',
    href: 'https://t.me/onebapp_bot',
  }),
  Object.freeze({
    id: 'viber',
    label: 'Viber OneB',
    value: 'OneB Service Desk',
    href: 'https://oneb.app/i/vb',
  }),
]);

export const SUPPORT_CONTACT_BY_ID = new Map(
  ONEB_SUPPORT_CONTACTS.map(contact => [contact.id, contact]),
);

export function isAllowedSupportHref(href) {
  if (typeof href !== 'string') return false;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}
