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
// `phone` and `telegram` are here, and a customer gets them for their own side
// only.
//
// A customer fills them in so the desk can reach them when a thread is the
// wrong shape for the question; support's own numbers are not a customer's to
// read, and that half is unchanged — the desk is reached through the request.
// What the flat refusal also withheld was a customer's own colleagues from each
// other: a `client_admin` opened «Співробітники», picked one of their own
// people, and the profile had a name, a photo and nothing else, on a screen
// whose whole purpose is administering those people. They work at the same
// company and typed the number in themselves. So the answer is per person
// rather than per reader — `CLIENT_SIDE_PROFILE_FIELDS` for somebody on the
// customer's own side of the desk, `CLIENT_PROFILE_FIELDS` for the desk.
const PUBLIC_PROFILE_FIELDS = [
  'name', 'email', 'customAvatar', 'avatar', 'photoURL', 'title',
  'phone', 'telegram', 'skills', 'timezone', 'birthday',
];
const CLIENT_PROFILE_FIELDS = ['name', 'email', 'customAvatar', 'avatar', 'photoURL', 'title', 'timezone'];
const CLIENT_SIDE_PROFILE_FIELDS = [...CLIENT_PROFILE_FIELDS, 'phone', 'telegram'];
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
      // Who is being read decides, not only who is reading: a customer sees
      // their own colleagues' contacts and never the desk's.
      const visibleProfileFields = !clientViewer
        ? PUBLIC_PROFILE_FIELDS
        : isClientRole(membership.role)
          ? CLIENT_SIDE_PROFILE_FIELDS
          : CLIENT_PROFILE_FIELDS;
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
