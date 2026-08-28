import { createHash, randomBytes } from 'node:crypto';

import { isClientRole } from '../utils/can.js';

// An invite link into a qTicket client space, and nothing else.
//
// The inherited QuickTeam mechanism was deleted in 1717ab1 because it could
// mint `member`/`admin`: a link went around the invitation route's role check
// entirely and seated whoever opened it on the support side, in a tenant whose
// staff only QuickTeam is allowed to enable. This version exists because the
// client half of that mechanism is genuinely needed — no email provider is
// connected, so the supported rollout is copying a link into a messenger —
// and it is written so that the internal door cannot be reopened by accident.
//
// The refusal is stated three times on purpose, because three different things
// could go wrong: `inviteLinkRole` refuses a request to mint one,
// `acceptedInviteLinkRole` refuses to seat one that somehow reached the stored
// document, and `firestore.rules` refuses a browser the read and the write
// that would put it there. This file is `.mjs` and free of Next imports so all
// three claims are covered by `tests/invite-link-scope.test.mjs` rather than
// by reading the route.

export const INVITE_LINK_TYPE = 'link';
export const INVITE_LINK_SCOPE = 'client-project';

// Who may author a link at all. `member` — the internal support agent — is
// deliberately absent: the invitation route already limits invitations to
// `invite:client_member`, and a link is an invitation that keeps working.
const LINK_AUTHOR_ROLES = new Set(['owner', 'admin', 'client_admin']);

export const DEFAULT_EXPIRY_DAYS = 7;
export const MAX_EXPIRY_DAYS = 30;
export const DEFAULT_MAX_USES = 10;
export const MAX_USES = 50;

// 32 bytes of randomness, base64url — 43 characters. The bounds below accept
// nothing shorter than 20 so a guess is not cheap and nothing longer than 128
// so a probe cannot make the server hash a megabyte.
const TOKEN_BYTES = 32;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,128}$/;

export function createInviteToken() {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

// Firestore stores only this. The raw token leaves the server once, in the
// response to the person who created the link; neither a database leak nor a
// readable invitation document can be turned back into a working link.
export function hashInviteToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function inviteTokenLooksWellFormed(token) {
  return typeof token === 'string' && TOKEN_SHAPE.test(token);
}

/**
 * The role a new link may carry.
 *
 * `invitedRoleFor` in the permission matrix answers the same question for the
 * email invitation, but it falls back to `member` for an unknown role — which
 * is correct there, where the route then refuses an internal invitee in a
 * QuickTeam-managed tenant, and would be exactly the wrong default here. A
 * link is a standing offer: anything but a client role is refused outright.
 *
 * @throws {Error} `LINK_AUTHOR_REFUSED` or `INTERNAL_ROLE_REFUSED`
 */
export function inviteLinkRole(requestedRole, inviterRole) {
  if (!LINK_AUTHOR_ROLES.has(inviterRole)) throw new Error('LINK_AUTHOR_REFUSED');
  // A client administrator has exactly one link to give, and it is for their
  // own colleagues. Nothing in the request can widen that.
  if (inviterRole === 'client_admin') return 'client_member';
  if (!isClientRole(requestedRole)) throw new Error('INTERNAL_ROLE_REFUSED');
  return requestedRole;
}

/**
 * The role a stored link may seat, read back with the same suspicion.
 *
 * A document saying `admin` — however it came to say it — seats nobody.
 *
 * @throws {Error} `INTERNAL_ROLE_REFUSED`
 */
export function acceptedInviteLinkRole(storedRole) {
  if (!isClientRole(storedRole)) throw new Error('INTERNAL_ROLE_REFUSED');
  return storedRole;
}

const clamp = (value, fallback, max) => {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(number, max);
};

export function inviteLinkExpiryDays(value) {
  return clamp(value, DEFAULT_EXPIRY_DAYS, MAX_EXPIRY_DAYS);
}

export function inviteLinkMaxUses(value) {
  return clamp(value, DEFAULT_MAX_USES, MAX_USES);
}

// Firestore hands back a Timestamp; a test and the create response hand back a
// number. Both are the same question.
const millisOf = value => (
  typeof value?.toMillis === 'function' ? value.toMillis() : Number(value) || 0
);

/**
 * Whether a stored link may still be used, asked in exactly one place.
 *
 * Expired, revoked, exhausted, wrongly-roled and unknown all come back `false`
 * so both callers — the public preview and the accept transaction — answer a
 * stranger identically and probing learns nothing about which links exist.
 */
export function inviteLinkUsable(invitation, now = Date.now()) {
  if (!invitation) return false;
  if (invitation.type !== INVITE_LINK_TYPE) return false;
  if (invitation.status !== 'pending') return false;
  if (!isClientRole(invitation.role)) return false;
  if (!invitation.organizationId || !invitation.projectId) return false;
  const expiresAt = millisOf(invitation.expiresAt);
  if (!expiresAt || expiresAt <= now) return false;
  return Number(invitation.usedCount || 0) < Number(invitation.maxUses || 0);
}

/**
 * Everything a stranger holding a valid token may learn, and nothing else.
 *
 * The landing page has to show the tenant's brand before sign-in — that is the
 * whole reason the link carries the organization identity — so this returns
 * the portal brand, the client space it opens and the role it grants. It never
 * returns the inviter, the member list, the token budget or the organization
 * id, because none of those help the invited person and all of them help
 * somebody who found the link in a forwarded message.
 */
export function inviteLinkPreview({ brand, projectName, role }) {
  return {
    organizationName: brand.name,
    organizationLogo: brand.logo,
    sidebarTheme: brand.sidebarTheme,
    sidebarColor: brand.sidebarColor,
    clientSpaceName: String(projectName || '').trim(),
    role,
  };
}
