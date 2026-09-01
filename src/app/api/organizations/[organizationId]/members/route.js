import { NextResponse } from 'next/server';
import { authorizeOrgRequest, getAdminDb } from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import {
  MEMBER_STATUS,
  MEMBERSHIP_ARCHIVE,
  MEMBERSHIP_COLLECTION,
} from '@/lib/utils/orgMembership.mjs';
import { isClientRole } from '@/lib/utils/can';

// `status` here is the membership — `active` | `deactivated`, which decides
// whether somebody can still be given work. There used to be a second one on
// the same record, the mood line a person set for themselves, and the directory
// announced every profile as "active" because that one was written last.
// `phone` and `telegram` go to everybody this directory answers to, and that is
// what they are for.
//
// They are qTicket's own fields. Nothing syncs them from QuickTeam, they are
// blank until a person types them into «Особистий профіль» here, and both sides
// of the desk have that screen — support since 2026-09-01. Somebody who fills
// one in is publishing a way to be reached inside this workspace, and the
// person on the other end of a request is exactly who ends up needing it.
//
// Two readings were wrong before this one. First the field was refused to every
// client reader — «support's numbers are not a customer's to read» — which also
// hid a customer's own colleagues from each other, on the very screen a
// `client_admin` administers those colleagues from. Then it was split per
// person, which fixed that half and kept the other. Neither was the rule: a
// contact somebody enters here is entered to be used.
//
// What limits the answer is the roster, not the field list. A client reader
// only ever receives the people on their own projects (`clientProjectMemberIds`
// below) — their colleagues and the agents on those projects, never the rest of
// the organization. `skills` and `birthday` stay out: they are the social card
// this product deleted, listed only because a legacy profile may still hold one.
const PUBLIC_PROFILE_FIELDS = [
  'name', 'email', 'customAvatar', 'avatar', 'photoURL', 'title',
  'phone', 'telegram', 'skills', 'timezone', 'birthday',
];
const CLIENT_PROFILE_FIELDS = [
  'name', 'email', 'customAvatar', 'avatar', 'photoURL', 'title', 'timezone',
  'phone', 'telegram',
];
const NESTED_PROFILE_FIELDS = ['skills', 'timezone', 'birthday'];

function serializeValue(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeValue(item)]));
  }
  return value;
}

export async function GET(request, context) {
  try {
    const { organizationId } = await context.params;
    const authorization = await authorizeOrgRequest(request, organizationId);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const db = getAdminDb();
    const clientViewer = isClientRole(authorization.membership.role);
    let clientProjectMemberIds = null;
    if (clientViewer) {
      const accessibleProjects = await db.collection('projects')
        .where('organizationId', '==', organizationId)
        .where('team', 'array-contains', authorization.user.uid)
        .get();
      clientProjectMemberIds = new Set([authorization.user.uid]);
      accessibleProjects.docs.forEach(project => {
        const team = Array.isArray(project.data().team) ? project.data().team : [];
        team.forEach(userId => clientProjectMemberIds.add(userId));
      });
    }
    // Deactivated people stay in the directory. Every task they were assigned,
    // every comment they wrote and every hour they logged still names them, and
    // a directory that forgets them turns all of that into an unknown id. They
    // come back flagged, so a picker can leave them out while history keeps
    // rendering their name and face.
    const [membershipsSnap, archivedSnap] = await Promise.all([
      db.collection(MEMBERSHIP_COLLECTION).where('orgId', '==', organizationId).get(),
      db.collection(MEMBERSHIP_ARCHIVE).where('orgId', '==', organizationId).get(),
    ]);
    const activeMemberships = membershipsSnap.docs
      .map(item => item.data())
      .filter(membership => membership.removalPending !== true)
      .map(membership => ({ ...membership, status: MEMBER_STATUS.active }));
    const archivedMemberships = archivedSnap.docs
      .map(item => item.data())
      .map(membership => ({ ...membership, status: MEMBER_STATUS.deactivated }));
    // An active membership always wins over an archived one. The two flows are
    // transactional and should never both exist for one person, but a directory
    // that listed somebody twice would break every list keyed by user id — and
    // it would do so quietly, long after whatever caused it.
    const activeUserIds = new Set(activeMemberships.map(membership => membership.userId));
    const memberships = [
      ...activeMemberships,
      ...archivedMemberships.filter(membership => !activeUserIds.has(membership.userId)),
    ].filter(membership => !clientViewer || clientProjectMemberIds.has(membership.userId));
    const profileSnaps = memberships.length
      ? await db.getAll(...memberships.map(item => db.collection('users').doc(item.userId)))
      : [];

    const members = memberships.map((membership, index) => {
      const profile = profileSnaps[index]?.exists ? profileSnaps[index].data() : {};
      const safeProfile = {};
      const visibleProfileFields = clientViewer ? CLIENT_PROFILE_FIELDS : PUBLIC_PROFILE_FIELDS;
      for (const field of visibleProfileFields) {
        if (profile[field] !== undefined) safeProfile[field] = serializeValue(profile[field]);
      }
      if (!clientViewer && profile.profile && typeof profile.profile === 'object') {
        safeProfile.profile = Object.fromEntries(NESTED_PROFILE_FIELDS
          .filter(field => profile.profile[field] !== undefined)
          .map(field => [field, serializeValue(profile.profile[field])]));
      }
      // A deleted account leaves an archived seat and no profile at all — that
      // is the point of deleting it. Without a name every incident they touched
      // renders as «Невідомий», so the directory says what actually happened
      // instead.
      const accountDeleted = membership.accountDeleted === true;
      if (accountDeleted && !safeProfile.name) safeProfile.name = 'Видалений акаунт';

      return {
        ...safeProfile,
        id: membership.userId,
        uid: membership.userId,
        role: membership.role,
        status: membership.status,
        accountDeleted,
        deactivatedAt: serializeValue(membership.deactivatedAt) || null,
        joinedAt: serializeValue(membership.joinedAt) || null,
        positionId: membership.positionId || '',
      };
    });

    return NextResponse.json({ members }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return routeErrorResponse(error, { context: 'organization-members', fallbackMessage: 'Failed to load organization members' });
  }
}
