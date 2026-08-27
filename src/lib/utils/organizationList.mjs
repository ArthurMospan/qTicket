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
 * @param {Array<{orgId?: string, role?: string}>} memberships the `orgMemberships` documents' data, in snapshot order
 * @param {Array<{id?: string}>} organizationDocuments whatever the organizations read returned
 * @param {Array<{id?: string}>} knownOrganizations the list published last, so a name survives a short read
 */
export function buildOrganizationList(
  memberships = [],
  organizationDocuments = [],
  knownOrganizations = [],
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
    organizations.push(known ? { ...known, id: orgId } : { id: orgId, pending: true });
  }

  return { organizations, roles };
}
