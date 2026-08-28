import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const QUICKTEAM_CONTRACT_VERSION = 1;
export const QUICKTEAM_SIGNATURE_WINDOW_SECONDS = 5 * 60;
export const QUICKTEAM_LAUNCH_TTL_SECONDS = 90;
export const QUICKTEAM_STAFF_ROLES = Object.freeze(['owner', 'admin', 'member']);

const cleanText = (value, max = 200) => String(value || '').trim().slice(0, max);
const digest = value => createHash('sha256').update(String(value)).digest('hex');

export function quickTeamOrganizationId(sourceOrganizationId) {
  return `qto_${digest(`quickteam:organization:${cleanText(sourceOrganizationId)}`).slice(0, 32)}`;
}

export function quickTeamStaffUid(sourceUserId) {
  return `qts_${digest(`quickteam:user:${cleanText(sourceUserId)}`).slice(0, 40)}`;
}

export function quickTeamIdentityId(sourceUserId) {
  return `quickteam_${digest(cleanText(sourceUserId)).slice(0, 40)}`;
}

export function quickTeamNonceId(nonce) {
  return `quickteam_${digest(cleanText(nonce, 180)).slice(0, 48)}`;
}

export function quickTeamLaunchCode() {
  return randomBytes(32).toString('base64url');
}

export function quickTeamLaunchId(code) {
  return `quickteam_${digest(cleanText(code, 180)).slice(0, 48)}`;
}

export function signQuickTeamRequest(secret, { timestamp, nonce, body }) {
  const key = String(secret || '');
  if (key.length < 32) throw new Error('QuickTeam shared secret must contain at least 32 characters');
  return createHmac('sha256', key)
    .update(`v${QUICKTEAM_CONTRACT_VERSION}\n${timestamp}\n${nonce}\n${body}`)
    .digest('hex');
}

export function verifyQuickTeamRequest({
  secret,
  timestamp,
  nonce,
  signature,
  body,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const numericTimestamp = Number(timestamp);
  if (!Number.isSafeInteger(numericTimestamp)) return { ok: false, code: 'timestamp' };
  if (Math.abs(nowSeconds - numericTimestamp) > QUICKTEAM_SIGNATURE_WINDOW_SECONDS) {
    return { ok: false, code: 'expired' };
  }
  if (!/^[A-Za-z0-9_-]{16,180}$/.test(String(nonce || ''))) {
    return { ok: false, code: 'nonce' };
  }
  if (!/^[a-f0-9]{64}$/i.test(String(signature || ''))) {
    return { ok: false, code: 'signature' };
  }

  let expected;
  try {
    expected = signQuickTeamRequest(secret, {
      timestamp: numericTimestamp,
      nonce,
      body,
    });
  } catch {
    return { ok: false, code: 'configuration' };
  }
  const suppliedBuffer = Buffer.from(String(signature).toLowerCase(), 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return suppliedBuffer.length === expectedBuffer.length
    && timingSafeEqual(suppliedBuffer, expectedBuffer)
    ? { ok: true, timestamp: numericTimestamp, nonce: String(nonce) }
    : { ok: false, code: 'signature' };
}

function normalizeStaffMember(value) {
  const sourceUserId = cleanText(value?.sourceUserId);
  const email = cleanText(value?.email, 320).toLowerCase();
  const name = cleanText(value?.name, 160);
  const avatar = cleanText(value?.avatar, 2000);
  const role = QUICKTEAM_STAFF_ROLES.includes(value?.role) ? value.role : '';
  if (!sourceUserId || !email || !/^\S+@\S+\.\S+$/.test(email) || !name || !role) return null;
  return { sourceUserId, email, name, avatar, role };
}

export function normalizeQuickTeamProvision(value) {
  if (value?.version !== QUICKTEAM_CONTRACT_VERSION) {
    return { error: 'unsupported_version' };
  }
  const sourceOrganizationId = cleanText(value?.sourceOrganizationId);
  const revision = Number(value?.revision);
  const name = cleanText(value?.organization?.name, 160);
  const staff = Array.isArray(value?.staff)
    ? value.staff.map(normalizeStaffMember)
    : [];
  if (!sourceOrganizationId || !Number.isSafeInteger(revision) || revision < 1 || !name) {
    return { error: 'invalid_payload' };
  }
  if (staff.length < 1 || staff.length > 100 || staff.some(member => !member)) {
    return { error: 'invalid_staff' };
  }
  const sourceIds = staff.map(member => member.sourceUserId);
  const emails = staff.map(member => member.email);
  if (new Set(sourceIds).size !== sourceIds.length || new Set(emails).size !== emails.length) {
    return { error: 'duplicate_staff' };
  }
  if (staff.filter(member => member.role === 'owner').length !== 1) {
    return { error: 'owner_required' };
  }

  const sidebarTheme = ['dark', 'light', 'custom'].includes(value?.organization?.sidebarTheme)
    ? value.organization.sidebarTheme
    : 'dark';
  return {
    data: {
      version: QUICKTEAM_CONTRACT_VERSION,
      sourceOrganizationId,
      revision,
      entitlement: value?.entitlement === 'inactive' ? 'inactive' : 'active',
      organization: {
        name,
        logo: cleanText(value?.organization?.logo, 2000),
        sidebarTheme,
        sidebarColor: cleanText(value?.organization?.sidebarColor, 80),
        timezone: cleanText(value?.organization?.timezone, 80) || 'Europe/Kyiv',
      },
      staff,
    },
  };
}

export function normalizeQuickTeamLaunch(value) {
  if (value?.version !== QUICKTEAM_CONTRACT_VERSION) return { error: 'unsupported_version' };
  const sourceOrganizationId = cleanText(value?.sourceOrganizationId);
  const sourceUserId = cleanText(value?.sourceUserId);
  const returnTo = String(value?.returnTo || '/overview');
  if (!sourceOrganizationId || !sourceUserId) return { error: 'invalid_payload' };
  return {
    data: {
      sourceOrganizationId,
      sourceUserId,
      returnTo: returnTo.startsWith('/') && !returnTo.startsWith('//')
        ? returnTo.slice(0, 500)
        : '/overview',
    },
  };
}
