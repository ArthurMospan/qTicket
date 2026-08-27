import { NextResponse } from 'next/server';
import {
  authenticateRequest,
  authorizeOrgRequest,
  enforceRateLimit,
  getAdminDb,
} from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import { syncIssueReminderRows } from '@/lib/server/reminderJobs';

// «The deadline moved — rewrite what is queued for this task.»
//
// Reminders are written down when they become knowable, not found later by a
// scan. Every server route that changes a task calls `syncIssueReminderRows`
// itself; this route exists for the one path that is not a server route. A
// task's own fields — the deadline among them — are still written straight from
// the browser through `updateDoc`, and the browser cannot touch
// `scheduledNotifications`: no Firestore rule describes that collection, so it
// is closed to everything except the Admin SDK, which is exactly right for a
// queue nobody should be able to forge a row in.
//
// So the composer writes the deadline and then asks here, and this route
// recomputes from what is actually stored rather than from anything the caller
// says. The request body carries nothing at all: there is nothing a caller
// could tell us that the task document does not already say, and a route that
// accepts a delivery time is a route that can be asked to notify anybody at any
// hour.
//
// Cost: one read of the task, two cached reads of the organization's workflow
// and timezone, one indexed query over this task's pending rows, and the writes
// the difference implies. It is paid on an action somebody just performed,
// which is the moment when a few reads are affordable and a scan is not.
export async function POST(request, context) {
  try {
    const { issueId } = await context.params;
    if (!issueId || typeof issueId !== 'string' || issueId.length > 200) {
      return NextResponse.json({ error: 'Некоректне завдання' }, { status: 400 });
    }

    // The token is checked before anything is read, and this order is the whole
    // security of the route. Reading the task first to find out which
    // organization to authorize against reads on behalf of a caller who has not
    // said who they are — which is an unauthenticated Firestore read that
    // anybody can ask for, at any rate they like, against a project on a daily
    // read cap. Verifying an ID token costs no read at all, so it goes first
    // and the rate limit goes second, keyed to a person rather than to nobody.
    const identity = await authenticateRequest(request);
    if (identity.error) {
      return NextResponse.json({ error: identity.error }, { status: identity.status });
    }
    if (!(await enforceRateLimit('issue-reminders', identity.user.uid, 60, 60))) {
      return NextResponse.json({ error: 'Забагато запитів' }, { status: 429 });
    }

    const db = getAdminDb();
    const issueSnapshot = await db.collection('issues').doc(issueId).get();
    // A task that is gone still has rows to take away, but there is no
    // organization left to authorize against — and the route that deleted it
    // has already cancelled them. Nothing to do.
    if (!issueSnapshot.exists) {
      return NextResponse.json({ ok: true, issueId, missing: true });
    }
    const issue = { ...issueSnapshot.data(), id: issueSnapshot.id };

    // Being in the organization is enough to ask. This changes no task data and
    // reveals none: the answer is a count of rows, and the rows are derived from
    // a task the caller has just been shown.
    const authorization = await authorizeOrgRequest(
      request,
      issue.organizationId,
      ['owner', 'admin', 'member'],
    );
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const result = await syncIssueReminderRows({ issueId, issue });
    return NextResponse.json({ ok: true, issueId, ...result });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'issue reminders',
      fallbackMessage: 'Не вдалося оновити нагадування завдання',
    });
  }
}
