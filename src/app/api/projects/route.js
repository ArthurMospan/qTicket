import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, enforceRateLimit, getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  initialProjectIssueCounts,
  organizationCountContext,
} from '@/lib/server/projectIssueCounts';
import { PROJECT_ISSUE_COUNTS_FIELD } from '@/lib/utils/projectIssueCounts.mjs';
import { rolesFor } from '@/lib/utils/can';
import { DEFAULT_STATUS_IDS, workflowIds } from '@/lib/utils/workflowDefaults.mjs';
import {
  suggestAvailableIssuePrefix,
} from '@/lib/utils/issueKeys.mjs';

export async function POST(req) {
  try {
    const body = await readJsonBody(req);
    const { name, description, organizationId, team = [], hiddenColumns = [] } = body;

    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedDescription = typeof description === 'string' ? description.trim() : '';
    if (
      !normalizedName
      || normalizedName.length > 160
      || normalizedDescription.length > 10_000
      || !organizationId
    ) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const authorization = await authorizeOrgRequest(req, organizationId, rolesFor('create:project'));
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    if (!(await enforceRateLimit('project-create', authorization.user.uid, 10, 60))) {
      return NextResponse.json({ error: 'Too many project creation requests' }, { status: 429 });
    }

    const userId = authorization.user.uid;
    const db = getAdminDb();
    const workflowSnap = await db.collection('organizations').doc(organizationId)
      .collection('settings').doc('workflow').get();
    const statusIds = workflowIds(workflowSnap.data()?.statuses, DEFAULT_STATUS_IDS);
    const backlogStatusId = statusIds.includes('backlog') ? 'backlog' : statusIds[0];
    const requestedHidden = Array.isArray(hiddenColumns)
      ? [...new Set(hiddenColumns.filter(value => typeof value === 'string'))]
      : [];
    if (
      requestedHidden.some(statusId => !statusIds.includes(statusId))
      || requestedHidden.includes(backlogStatusId)
      || requestedHidden.length >= statusIds.length
    ) {
      return NextResponse.json({ error: 'Некоректна конфігурація колонок' }, { status: 400 });
    }
    const requestedTeam = [...new Set(
      (Array.isArray(team) ? team : [])
        .filter(memberId => typeof memberId === 'string' && memberId.trim())
        .map(memberId => memberId.trim())
    )].slice(0, 100);
    // Membership lives in `orgMemberships/{orgId}_{uid}` and nowhere else. This
    // used to read `organizations/{orgId}/members/{uid}`, a collection the
    // product never writes, so every snapshot came back missing and the whole
    // chosen team was dropped in silence — the project was created with its
    // author alone, and `team` is the field that decides who can see it. An id
    // that is not a member of this organization is now refused rather than
    // ignored, because dropping it is exactly the failure that hid this bug.
    const memberRefs = requestedTeam.map(memberId =>
      db.collection('orgMemberships').doc(`${organizationId}_${memberId}`)
    );
    const memberSnaps = memberRefs.length ? await db.getAll(...memberRefs) : [];
    const invalidTeamMember = memberSnaps.some((snapshot, index) => (
      !snapshot.exists
      || snapshot.data().orgId !== organizationId
      || snapshot.data().userId !== requestedTeam[index]
    ));
    if (invalidTeamMember) {
      return NextResponse.json({
        error: 'Один із учасників команди не належить цій організації',
        code: 'INVALID_TEAM_SCOPE',
      }, { status: 400 });
    }
    const validTeam = requestedTeam;

    const orgRef = db.collection('organizations').doc(organizationId);
    const projectRef = db.collection('projects').doc();
    const payload = {
      name: normalizedName,
      description: normalizedDescription,
      organizationId,
      team: [...new Set([userId, ...validTeam])],
      hiddenColumns: requestedHidden,
      status: 'active',
      issueCounter: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: userId,
    };

    // The task counters a project starts life with. A project has no tasks yet,
    // so all three are zero — and zero is a total that can be *established*
    // without reading anything, which matters: nothing reads a project's
    // counters until a full count has stood behind them once, and waiting for
    // the twice-daily pass would mean every new project sent the home screen
    // back to reading tasks for up to twelve hours.
    const countContext = await organizationCountContext(db, organizationId);
    await db.runTransaction(async transaction => {
      const orgSnap = await transaction.get(orgRef);
      if (!orgSnap.exists) throw new Error('ORGANIZATION_NOT_FOUND');

      // Reading and then updating the org document serializes concurrent project
      // creations. A retried transaction sees the project created by the winner.
      const organizationProjectsQuery = db.collection('projects')
        .where('organizationId', '==', organizationId);
      const organizationProjectsSnap = await transaction.get(organizationProjectsQuery);
      const organizationProjects = organizationProjectsSnap.docs.map(document => ({
        ...document.data(),
        id: document.id,
      }));
      const issuePrefix = suggestAvailableIssuePrefix(
        { name: normalizedName },
        organizationProjects,
      );
      transaction.create(projectRef, {
        ...payload,
        issuePrefix,
        [PROJECT_ISSUE_COUNTS_FIELD]: initialProjectIssueCounts(countContext.timeZone),
      });
      transaction.update(orgRef, {
        projectMutationVersion: FieldValue.increment(1),
      });
    });

    return NextResponse.json({ success: true, id: projectRef.id });
  } catch (error) {
    if (error.message === 'ORGANIZATION_NOT_FOUND') {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    return routeErrorResponse(error, { context: 'API Projects Create', fallbackMessage: 'Internal Server Error' });
  }
}
