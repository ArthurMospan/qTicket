import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_EXPIRY_DAYS,
  DEFAULT_MAX_USES,
  MAX_EXPIRY_DAYS,
  MAX_USES,
  acceptedInviteLinkRole,
  createInviteToken,
  hashInviteToken,
  inviteLinkExpiryDays,
  inviteLinkMaxUses,
  inviteLinkPreview,
  inviteLinkRole,
  inviteLinkUsable,
  inviteTokenLooksWellFormed,
} from '../src/lib/server/inviteLinks.mjs';

const HOUR = 60 * 60 * 1000;

const usableLink = (overrides = {}) => ({
  type: 'link',
  status: 'pending',
  role: 'client_member',
  organizationId: 'org-a',
  projectId: 'client-a',
  expiresAt: Date.now() + HOUR,
  maxUses: 10,
  usedCount: 0,
  ...overrides,
});

// ── The door that stays shut ──────────────────────────────────────────────
//
// 1717ab1 deleted the inherited invite link because it could mint `member` and
// `admin` in a tenant whose staff only QuickTeam may enable. These are the
// assertions that let the mechanism come back for clients only.

test('a link cannot be minted for any internal role', () => {
  for (const role of ['owner', 'admin', 'member']) {
    assert.throws(
      () => inviteLinkRole(role, 'admin'),
      error => error.message === 'INTERNAL_ROLE_REFUSED',
      `staff must not be able to mint a ${role} link`,
    );
  }
});

test('an unknown or missing role is refused rather than defaulted', () => {
  // `invitedRoleFor` falls back to `member` for the email invitation, which is
  // safe there and would be the whole bug here.
  for (const role of [undefined, null, '', 'MEMBER', 'client', {}]) {
    assert.throws(
      () => inviteLinkRole(role, 'owner'),
      error => error.message === 'INTERNAL_ROLE_REFUSED',
    );
  }
});

test('only owner, admin and client_admin may author a link at all', () => {
  for (const inviterRole of ['member', 'client_member', '', undefined]) {
    assert.throws(
      () => inviteLinkRole('client_admin', inviterRole),
      error => error.message === 'LINK_AUTHOR_REFUSED',
    );
  }
});

test('staff mint a client administrator, a client administrator mints their own company', () => {
  assert.equal(inviteLinkRole('client_admin', 'owner'), 'client_admin');
  assert.equal(inviteLinkRole('client_admin', 'admin'), 'client_admin');
  assert.equal(inviteLinkRole('client_member', 'admin'), 'client_member');
  // A client administrator hands out either seat of their own company — the
  // second administrator included, because one of them going on holiday must
  // not take the invitations with them.
  assert.equal(inviteLinkRole('client_admin', 'client_admin'), 'client_admin');
  assert.equal(inviteLinkRole('client_member', 'client_admin'), 'client_member');
  // Nothing they send widens the link past their own side of the desk: a
  // support seat asked for here lands on the floor of what they may give, and
  // the link is still refused every internal role by the two checks above.
  assert.equal(inviteLinkRole('admin', 'client_admin'), 'client_member');
  assert.equal(inviteLinkRole('owner', 'client_admin'), 'client_member');
  assert.equal(inviteLinkRole(undefined, 'client_admin'), 'client_member');
});

test('a stored link claiming an internal role seats nobody', () => {
  // The accept transaction asks this before it writes a membership, so a
  // document that acquired `role: "admin"` by any route — a rules hole, a
  // migration, a hand edit in the console — still opens nothing.
  for (const role of ['owner', 'admin', 'member', '', undefined]) {
    assert.throws(
      () => acceptedInviteLinkRole(role),
      error => error.message === 'INTERNAL_ROLE_REFUSED',
    );
  }
  assert.equal(acceptedInviteLinkRole('client_admin'), 'client_admin');
  assert.equal(acceptedInviteLinkRole('client_member'), 'client_member');
});

test('a link whose stored role is internal is not even usable', () => {
  assert.equal(inviteLinkUsable(usableLink({ role: 'admin' })), false);
});

// ── Expired, revoked, exhausted and unknown are one answer ────────────────

test('every way a link can be dead answers the same', () => {
  assert.equal(inviteLinkUsable(usableLink()), true);

  assert.equal(inviteLinkUsable(null), false, 'unknown token');
  assert.equal(inviteLinkUsable(usableLink({ status: 'revoked' })), false, 'revoked');
  assert.equal(inviteLinkUsable(usableLink({ status: 'accepted' })), false, 'consumed');
  assert.equal(inviteLinkUsable(usableLink({ expiresAt: Date.now() - 1 })), false, 'expired');
  assert.equal(inviteLinkUsable(usableLink({ expiresAt: 0 })), false, 'never expires');
  assert.equal(inviteLinkUsable(usableLink({ usedCount: 10 })), false, 'exhausted');
  assert.equal(inviteLinkUsable(usableLink({ usedCount: 11 })), false, 'over-consumed');
  assert.equal(inviteLinkUsable(usableLink({ type: 'email' })), false, 'not a link at all');
  assert.equal(inviteLinkUsable(usableLink({ projectId: '' })), false, 'unscoped');
  assert.equal(inviteLinkUsable(usableLink({ organizationId: '' })), false, 'orgless');
});

test('the expiry is read from a Firestore Timestamp as readily as from a number', () => {
  const future = Date.now() + HOUR;
  assert.equal(inviteLinkUsable(usableLink({ expiresAt: { toMillis: () => future } })), true);
  assert.equal(inviteLinkUsable(usableLink({ expiresAt: { toMillis: () => 1 } })), false);
});

// ── The token itself ─────────────────────────────────────────────────────

test('the raw token is never what Firestore stores', () => {
  const token = createInviteToken();
  assert.ok(inviteTokenLooksWellFormed(token));
  const hash = hashInviteToken(token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, token);
  assert.equal(hashInviteToken(token), hash, 'the same token always finds the same document');
  assert.notEqual(hashInviteToken(createInviteToken()), hash);
});

test('a token that cannot be one is rejected before it reaches Firestore', () => {
  assert.equal(inviteTokenLooksWellFormed('short'), false);
  assert.equal(inviteTokenLooksWellFormed('a'.repeat(129)), false);
  assert.equal(inviteTokenLooksWellFormed('has spaces in it and is long'), false);
  assert.equal(inviteTokenLooksWellFormed('../../etc/passwd-and-more-chars'), false);
  assert.equal(inviteTokenLooksWellFormed(null), false);
  assert.equal(inviteTokenLooksWellFormed(12345678901234567890), false);
});

// ── Budgets ──────────────────────────────────────────────────────────────

test('expiry and uses are clamped, never taken as sent', () => {
  assert.equal(inviteLinkExpiryDays(undefined), DEFAULT_EXPIRY_DAYS);
  assert.equal(inviteLinkExpiryDays(0), DEFAULT_EXPIRY_DAYS);
  assert.equal(inviteLinkExpiryDays(-4), DEFAULT_EXPIRY_DAYS);
  assert.equal(inviteLinkExpiryDays('nonsense'), DEFAULT_EXPIRY_DAYS);
  assert.equal(inviteLinkExpiryDays(3), 3);
  assert.equal(inviteLinkExpiryDays(9999), MAX_EXPIRY_DAYS);

  assert.equal(inviteLinkMaxUses(undefined), DEFAULT_MAX_USES);
  assert.equal(inviteLinkMaxUses(-1), DEFAULT_MAX_USES);
  assert.equal(inviteLinkMaxUses(2), 2);
  assert.equal(inviteLinkMaxUses(10000), MAX_USES);
});

// ── What a stranger holding the link may see ─────────────────────────────

test('the public preview carries the tenant brand and nothing about the link', () => {
  const preview = inviteLinkPreview({
    brand: {
      name: 'ACME Support',
      logo: 'https://cdn.example/acme.png',
      sidebarTheme: 'custom',
      sidebarColor: '#0b5cd5',
      source: 'quickteam',
    },
    projectName: 'ACME Retail',
    role: 'client_admin',
  });

  assert.deepEqual(preview, {
    organizationName: 'ACME Support',
    organizationLogo: 'https://cdn.example/acme.png',
    sidebarTheme: 'custom',
    sidebarColor: '#0b5cd5',
    clientSpaceName: 'ACME Retail',
    role: 'client_admin',
  });

  // Everything that would help somebody who found the link in a forwarded
  // message rather than the person it was sent to.
  for (const leak of ['tokenHash', 'invitedBy', 'organizationId', 'projectId', 'maxUses', 'usedCount', 'expiresAt', 'email']) {
    assert.equal(leak in preview, false, `preview must not carry ${leak}`);
  }
});
