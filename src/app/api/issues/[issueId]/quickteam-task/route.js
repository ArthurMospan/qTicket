import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { rolesFor, isClientRole } from '@/lib/utils/can';
import { issuePath } from '@/lib/utils/issueKeys.mjs';
import {
  createQuickTeamTask,
  quickTeamSourceUserId,
  quickTeamTransferConfigured,
} from '@/lib/server/quickteamTransfer';

// «Створити завдання в QuickTeam».
//
// A request stays a request: the client keeps writing in it, support keeps
// answering, and this only says that the work it asks for is being done
// somewhere else. Nothing here closes it, moves it or hides it — the transfer
// is a link and a line in the history, and the owner chose that deliberately
// over a status change nobody asked for.
//
// Idempotence lives in QuickTeam, where the task does: a second press returns
// the first task rather than making a second one. This side stores the answer
// so the button becomes a link, but the guarantee is not the stored document —
// a document can be missing while the task exists.
//
// Where it is stored is the other half of a decision this product has already
// made twice. The incident document is read by the customer, and where their
// supplier tracks the work internally is routing: their board draws no
// assignee and their history is not readable, so a link into somebody else's
// tracker does not belong on a record they can read either. It goes in
// `issues/{id}/internal/quickteam`, which `firestore.rules` opens to internal
// contributors only — and the incident document is not touched at all, so a
// transfer does not push the request to the top of the customer's list as
// activity they were never shown.

function transferError(code, status, message) {
  const error = new Error(code);
  error.transfer = { code, status, message };
  return error;
}

export async function POST(request, context) {
  try {
    const { issueId } = await context.params;
    const body = await readJsonBody(request);
    const projectId = String(body?.quickTeamProjectId || '').trim();
    if (!projectId) {
      return NextResponse.json({
        error: 'Оберіть проєкт QuickTeam',
        code: 'PROJECT_REQUIRED',
      }, { status: 400 });
    }

    const db = getAdminDb();
    const issueRef = db.collection('issues').doc(issueId);
    const issueSnap = await issueRef.get();
    if (!issueSnap.exists) {
      return NextResponse.json({ error: 'Звернення не знайдено', code: 'ISSUE_NOT_FOUND' }, { status: 404 });
    }
    const issue = issueSnap.data();

    // Transferring is an internal decision about internal work. A client role
    // holds `create:issue` and must never reach this.
    const authorization = await authorizeOrgRequest(
      request,
      issue.organizationId,
      rolesFor('edit:issue'),
    );
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    if (isClientRole(authorization.membership?.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Asked after the session is verified, like the projects proxy beside it:
    // whether this deployment can reach QuickTeam is not something an anonymous
    // caller needs told.
    if (!quickTeamTransferConfigured()) {
      return NextResponse.json({
        error: 'Перенесення в QuickTeam не налаштоване на сервері',
        code: 'NOT_CONFIGURED',
      }, { status: 503 });
    }

    const sourceOrganizationId = authorization.organization?.quickTeam?.sourceOrganizationId || '';
    const sourceUserId = await quickTeamSourceUserId(authorization.user.uid);
    if (!sourceOrganizationId || !sourceUserId) {
      throw transferError(
        'QUICKTEAM_IDENTITY_MISSING',
        403,
        'Ваш акаунт не звʼязаний із QuickTeam, тому перенести звернення не вийде',
      );
    }

    const [projectSnap] = await Promise.all([
      db.collection('projects').doc(issue.projectId).get(),
    ]);
    const clientName = projectSnap.data()?.name || '';
    const appOrigin = String(process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\/$/, '');
    const incidentUrl = `${appOrigin}${issuePath(issue, issue.projectId)}`;
    // qTicket composes the words about its own record. QuickTeam stores what it
    // is given and invents no prose about a product it cannot read.
    const description = [
      issue.description ? String(issue.description).slice(0, 40_000) : '',
      '',
      '---',
      `Перенесено зі звернення ${issue.issueKey || ''}${clientName ? ` · клієнт: ${clientName}` : ''}`,
      incidentUrl,
    ].join('\n').trim();

    const answer = await createQuickTeamTask({
      sourceOrganizationId,
      sourceUserId,
      projectId,
      incident: {
        id: issueId,
        key: issue.issueKey || '',
        title: issue.title || 'Звернення',
        description,
      },
    });

    const now = FieldValue.serverTimestamp();
    const quickTeamTask = {
      taskId: answer.taskId || '',
      issueKey: answer.issueKey || '',
      projectId: answer.projectId || projectId,
      url: answer.url || '',
      transferredAt: now,
      transferredBy: authorization.user.uid,
    };
    await issueRef.collection('internal').doc('quickteam').set(quickTeamTask, { merge: true });
    // The history says it happened, and says it once: a repeated press returns
    // the same task, and one document id per incident means one line about it.
    // The history is staff-only (`audit/` in firestore.rules), which is what
    // makes it the right place to name the other product.
    await issueRef.collection('audit').doc('quickteam-transfer').set({
      userId: authorization.user.uid,
      userName: authorization.user.name || authorization.user.email || '',
      action: 'quickteam-transferred',
      from: null,
      to: answer.issueKey || answer.taskId || '',
      createdAt: now,
    }, { merge: true });

    return NextResponse.json({
      status: answer.status === 'existing' ? 'existing' : 'created',
      quickTeamTask: { ...quickTeamTask, transferredAt: null },
    }, { status: answer.status === 'existing' ? 200 : 201 });
  } catch (error) {
    if (error?.transfer) {
      return NextResponse.json({
        error: error.transfer.message,
        code: error.transfer.code,
      }, { status: error.transfer.status });
    }
    if (Number(error?.status) >= 400 && Number(error?.status) < 500) {
      return NextResponse.json({
        error: error.message,
        code: error.code || 'QUICKTEAM_REFUSED',
      }, { status: error.status });
    }
    return routeErrorResponse(error, {
      context: 'quickteam-task-transfer',
      fallbackMessage: 'Не вдалося створити завдання в QuickTeam',
    });
  }
}
