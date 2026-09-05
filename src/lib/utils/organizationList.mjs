import { hasActiveQuickTeamEntitlement } from './quickTeamManaged.mjs';

// src/lib/utils/organizationList.mjs
// The workspaces a person belongs to, assembled from their memberships.

/**
 * Order asynchronous membership publications without mistaking arrival order
 * for authority. Browser-backed results may race until a verified directory
 * response starts; after that, only the newest verified response may publish.
 */
export function createMembershipSnapshotGate() {
  let sequence = 0;
  let authoritativeSequence = 0;

  return {
    begin(authoritative = false) {
      if (!authoritative && authoritativeSequence > 0) return null;
      sequence += 1;
      const ownSequence = sequence;
      if (authoritative) authoritativeSequence = ownSequence;

      return {
        isCurrent() {
          return authoritative
            ? ownSequence === authoritativeSequence
            : authoritativeSequence === 0 && ownSequence === sequence;
        },
      };
    },
  };
}

/**
 * Stable identity of the access-relevant part of a membership snapshot.
 * Firestore may emit metadata-only snapshots repeatedly; the directory route
 * only needs another verification when an organization or role actually moved.
 */
export function organizationMembershipSignature(memberships = []) {
  return memberships
    .filter(membership => membership?.orgId)
    .map(membership => `${membership.orgId}:${membership.role || ''}`)
    .sort()
    .join('|');
}

/**
 * Validate the server directory before it is allowed to replace visible state.
 * A malformed successful response is a load failure, never proof that the
 * account has zero organizations.
 */
export function parseOrganizationDirectory(payload) {
  const memberships = payload?.memberships;
  const organizations = payload?.organizations;
  const validMemberships = Array.isArray(memberships) && memberships.every(membership => (
    membership
    && typeof membership.orgId === 'string'
    && membership.orgId.length > 0
    && (membership.role == null || typeof membership.role === 'string')
  ));
  const validOrganizations = Array.isArray(organizations) && organizations.every(organization => (
    organization
    && typeof organization.id === 'string'
    && organization.id.length > 0
  ));

  if (!validMemberships || !validOrganizations) {
    const error = new Error('Organization directory response is invalid');
    error.code = 'invalid-organization-directory';
    throw error;
  }

  return { memberships, organizations };
}

/**
 * One entry per membership, always.
 *
 * A membership is the proof that a workspace exists for this person — access is
 * `orgMemberships` and nothing else. The organization document only supplies the
 * name, the logo and the branding, so a document that did not come back is a
 * read that fell short, never a workspace that stopped existing: organization
 * deletion is disabled in the rules, and the membership naming it was just read
 * from the same database.
 *
 * Building the list out of the documents instead let a short read delete a
 * workspace from the switcher — and leave it deleted, because nothing re-runs
 * until a membership changes. `getDocs` answers from the local cache whenever
 * the SDK believes it is offline, and a cache that never held one of those
 * documents answers short without failing, so there is nothing to catch.
 *
 * An entry whose document is missing keeps whatever was last known about it and
 * is marked `pending`, so the workspace stays reachable and the caller can go
 * back for the document rather than pretend the workspace is gone.
 *
 * What *is* dropped is an organization the product refuses to open. Access needs
 * a QuickTeam source organization and an active entitlement — `firestore.rules`
 * and `authorizeOrgRequest` both require them — so a seat in one of these buys
 * nothing: every read inside is refused and the screen says the organization is
 * not connected through QuickTeam. A workspace switcher that offers a door onto
 * that is not a switcher, it is a list of disappointments.
 *
 * Provisioning stopped creating such seats, but that only covered the ones it
 * made. The older standalone organizations from before the QuickTeam contract
 * have no source id at all and were never in scope for it, so their owners kept
 * seeing them. This is the read side of the same rule, and it holds whatever the
 * reason: nothing is deleted, and a seat somebody still has stays exactly where
 * it is — it simply stops being offered as somewhere to go.
 *
 * Which is why `verified` exists. Whether a missing document means "short read"
 * or "not a workspace" depends entirely on who was asked. The browser SDK cannot
 * read an organization without an active entitlement — the rules refuse it — so
 * on a cache-backed pass the organizations this filter most needs to catch are
 * exactly the ones whose document never arrives, and dropping them there would
 * be indistinguishable from dropping a live workspace on a short read. The
 * `/api/organizations` directory answers through the Admin SDK and therefore
 * sees every document there is: once *it* has answered, a membership with no
 * organization behind it is not a workspace, and `pending` is no longer an
 * honest thing to call it.
 *
 * The first version of this filter looked at the document alone and quietly did
 * nothing for the two standalone organizations it was written for — they predate
 * the QuickTeam contract, the rules refuse to read them, and so they stayed
 * `pending` and stayed in the switcher.
 *
 * @param {Array<{orgId?: string, role?: string}>} memberships the `orgMemberships` documents' data, in snapshot order
 * @param {Array<{id?: string}>} organizationDocuments whatever the organizations read returned
 * @param {Array<{id?: string}>} knownOrganizations the list published last, so a name survives a short read
 */
export function buildOrganizationList(
  memberships = [],
  organizationDocuments = [],
  knownOrganizations = [],
  { verified = false } = {},
) {
  const byId = new Map();
  for (const organization of knownOrganizations) {
    if (organization?.id) byId.set(organization.id, organization);
  }
  for (const organization of organizationDocuments) {
    if (organization?.id) byId.set(organization.id, organization);
  }

  const organizations = [];
  const roles = {};
  const seen = new Set();

  for (const membership of memberships) {
    const orgId = membership?.orgId;
    if (!orgId || seen.has(orgId)) continue;
    seen.add(orgId);
    if (membership.role) roles[orgId] = membership.role;
    const known = byId.get(orgId);
    const openable = known
      ? hasActiveQuickTeamEntitlement(known)
      // No document, and the Admin SDK was the one asked. There is nothing to
      // be short about: this membership names an organization the product will
      // refuse to open.
      : !verified;
    if (!openable) {
      delete roles[orgId];
      continue;
    }
    organizations.push(known ? { ...known, id: orgId } : { id: orgId, pending: true });
  }

  return { organizations, roles };
}

/**
 * Чи це справжня організація, а не заглушка на час читання.
 *
 * `buildOrganizationList` публікує `{ id, pending: true }` за членство, чий
 * документ ще не приїхав, — щоб робочий простір лишався досяжним, поки по
 * документ ідуть ще раз. Для маршрутизації цього досить, і для нічого іншого:
 * назви в заглушці немає, логотипа немає, кольору немає.
 *
 * А брендинг питав рівно «чи є організація», і заглушка на це відповідала
 * «є». Тож рейка підписувалась дефолтом — у qTicket це слово «Підтримка» — і
 * фарбувалась стандартною темною темою. Гірше: обидва кеші анти-мигання
 * записувались із тієї ж заглушки, тому наступне завантаження стартувало з
 * дефолту знову. Кеш, який існує проти мигання, сам його й відтворював.
 *
 * @param {{pending?: boolean} | null | undefined} organization запис зі списку організацій
 */
export function isResolvedOrganization(organization) {
  return Boolean(organization) && organization.pending !== true;
}
