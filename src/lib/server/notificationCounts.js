import 'server-only';

// One question, one answer: how many unread in-app notifications does this
// person have in this organization. The bell asks it for the organizations
// somebody belongs to, and the QuickTeam rail asks it for one — through a
// signed server request, for a staff member who is not signed into qTicket in
// that browser at all. Two callers, one definition of «unread», because the
// subtraction below is not obvious and a second copy of it would drift.

/**
 * Legacy notification documents have no `inapp` field and still belong in the
 * bell. A Firestore `inapp != false` query omits documents missing the field,
 * so the exact count is total unread minus the explicit external-only claims.
 * The second aggregation is skipped when the first is zero — an idle account
 * costs one read, not two.
 *
 * @param {FirebaseFirestore.Firestore} db Admin Firestore.
 * @param {string} uid Whose notifications.
 * @param {string} organizationId Which organization.
 * @returns {Promise<number>} Unread in-app notifications, never negative.
 */
export async function unreadInAppCount(db, uid, organizationId) {
  if (!uid || !organizationId) return 0;
  const notifications = db.collection('notifications');
  const unread = notifications
    .where('userId', '==', uid)
    .where('organizationId', '==', organizationId)
    .where('read', '==', false);
  const total = await aggregateCount(unread);
  if (total === 0) return 0;
  const externalOnly = await aggregateCount(unread.where('inapp', '==', false));
  return Math.max(0, total - externalOnly);
}

export async function aggregateCount(query) {
  const snapshot = await query.count().get();
  return Number(snapshot.data().count) || 0;
}
