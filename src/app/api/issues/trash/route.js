import { NextResponse } from 'next/server';
import { authorizeOrgRequest, getAdminDb } from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import { hasProjectAccess } from '@/lib/utils/projectAccess.mjs';
import { canRestoreIssueTombstone } from '@/lib/utils/issueTrash.mjs';

// What has been deleted and can still be brought back.
//
// A tombstone holds the whole issue record, so `deletedIssues` is closed to
// browsers outright (`firestore.rules`) and this route is the only way to look
// at one. It returns the few fields a list needs — never the snapshot itself —
// and drops anything the caller's projects do not include.
//
// The window is short on purpose: 24 hours is a grace period for a mistake, not
// a place to keep things. Keeping a task is what «Архів» is for.

const MAX_TRASH_ITEMS = 200;

function serializeMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request) {
  try {
    const organizationId = new URL(request.url).searchParams.get('organizationId') || '';
    const authorization = await authorizeOrgRequest(request, organizationId);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const db = getAdminDb();
    const [tombstones, projects] = await Promise.all([
      db.collection('deletedIssues')
        .where('organizationId', '==', organizationId)
        .limit(MAX_TRASH_ITEMS)
        .get(),
      db.collection('projects').where('organizationId', '==', organizationId).get(),
    ]);
    const projectById = new Map(projects.docs.map(document => [document.id, document.data()]));
    const role = authorization.membership?.role;
    const uid = authorization.user.uid;

    const items = tombstones.docs
      .map(document => ({ ...document.data(), id: document.id }))
      // Still restorable only. An entry the sweep has already claimed, or whose
      // window has run out, is not something a button should offer to undo.
      .filter(tombstone => canRestoreIssueTombstone(tombstone))
      .filter(tombstone => hasProjectAccess(projectById.get(tombstone.projectId), role, uid))
      .map(tombstone => ({
        issueId: tombstone.issueId,
        projectId: tombstone.projectId,
        projectName: projectById.get(tombstone.projectId)?.name || '',
        issueKey: tombstone.issue?.issueKey || tombstone.issueId,
        title: tombstone.issue?.title || '',
        childCount: Number(tombstone.childCount) || 0,
        deletedBy: tombstone.deletedBy || '',
        deletedAt: serializeMillis(tombstone.deletedAt),
        purgeAfter: serializeMillis(tombstone.purgeAfter),
      }))
      .sort((left, right) => (right.deletedAt || 0) - (left.deletedAt || 0));

    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'issue-trash',
      fallbackMessage: 'Не вдалося прочитати нещодавно видалені завдання',
    });
  }
}
