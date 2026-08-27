import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { isArchivedIssue } from '@/lib/utils/issueArchive.mjs';
import { isCancelledIssue } from '@/lib/utils/issueCancel.mjs';
import { authorizeOrgRequest, enforceRateLimit, getAdminDb } from '@/lib/server/firebaseAdmin';
import { syncCalendarEventReminderRows } from '@/lib/server/reminderJobs';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { assigneesOffProjectTeam, assigneesOutsideProject } from '@/lib/utils/projectAccess.mjs';
import {
  createCalendarNotifications,
  normalizedCalendarEventInput,
  serializeCalendarEvent,
  serializeTimestamp,
} from '@/lib/server/calendarEvents';

// Deadline horizon the calendar can actually display. Matches the client's
// recurrence window in useCalendarEvents.
const DEADLINE_WINDOW_BEHIND_MONTHS = 6;
const DEADLINE_WINDOW_AHEAD_MONTHS = 24;

function calendarCreateError(code, message, status = 409) {
  const error = new Error(code);
  error.calendarEventCreate = { code, message, status };
  return error;
}

export async function GET(request) {
  try {
    const organizationId = new URL(request.url).searchParams.get('organizationId')?.trim() || '';
    const authorization = await authorizeOrgRequest(request, organizationId);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const db = getAdminDb();
    // Deadlines are only shown around the visible horizon, so only issues with
    // a due date in that range are read — this used to pull every issue in the
    // organization, with every field, on every calendar load.
    const deadlineFrom = new Date();
    deadlineFrom.setMonth(deadlineFrom.getMonth() - DEADLINE_WINDOW_BEHIND_MONTHS);
    const deadlineTo = new Date();
    deadlineTo.setMonth(deadlineTo.getMonth() + DEADLINE_WINDOW_AHEAD_MONTHS);

    const [eventsSnapshot, issuesSnapshot, projectsSnapshot, membershipsSnapshot] = await Promise.all([
      db.collection('calendarEvents').where('organizationId', '==', organizationId).get(),
      db.collection('issues')
        .where('organizationId', '==', organizationId)
        .where('dueDate', '>=', Timestamp.fromDate(deadlineFrom))
        .where('dueDate', '<=', Timestamp.fromDate(deadlineTo))
        .select('title', 'issueKey', 'projectId', 'dueDate', 'assigneeIds', 'completedAt', 'archivedAt', 'cancelledAt')
        .get(),
      db.collection('projects')
        .where('organizationId', '==', organizationId)
        .select('team')
        .get(),
      db.collection('orgMemberships').where('orgId', '==', organizationId).get(),
    ]);

    const events = eventsSnapshot.docs
      .map(serializeCalendarEvent)
      .filter(event =>
        event.visibility === 'private'
          ? event.organizerId === authorization.user.uid
          : event.visibility !== 'participants' ||
            event.organizerId === authorization.user.uid ||
            event.participantIds?.includes(authorization.user.uid) ||
            ['owner', 'admin'].includes(authorization.membership?.role),
      );
    const memberships = membershipsSnapshot.docs.map(document => document.data());
    const profileSnapshots = memberships.length
      ? await db.getAll(...memberships.map(membership => db.collection('users').doc(membership.userId)))
      : [];
    const currentYear = new Date().getUTCFullYear();
    const birthdayEvents = memberships.flatMap((membership, index) => {
      const profile = profileSnapshots[index]?.exists ? profileSnapshots[index].data() : {};
      const birthday = typeof profile.birthday === 'string'
        ? profile.birthday
        : typeof profile.profile?.birthday === 'string'
          ? profile.profile.birthday
          : '';
      const match = birthday.match(/^\d{4}-(\d{2})-(\d{2})$/);
      if (!match) return [];
      const month = Number(match[1]);
      const day = Number(match[2]);
      return [currentYear - 1, currentYear, currentYear + 1, currentYear + 2].flatMap(year => {
        let start = new Date(Date.UTC(year, month - 1, day));
        if (start.getUTCMonth() !== month - 1 || start.getUTCDate() !== day) {
          if (month !== 2 || day !== 29) return [];
          start = new Date(Date.UTC(year, 1, 28));
        }
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 1);
        return [{
          id: `birthday_${membership.userId}_${year}`,
          title: `День народження · ${profile.name || profile.email || 'Учасник'}`,
          description: 'Привітайте колегу в загальному чаті 🎉',
          type: 'birthday',
          visibility: 'team',
          allDay: true,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          organizerId: membership.userId,
          participantIds: [],
          participantResponses: {},
          birthdayUserId: membership.userId,
          readOnly: true,
          isSystem: true,
          recurrence: { frequency: 'none', interval: 1, until: '' },
          reminderMinutes: [],
        }];
      });
    });
    const isPrivileged = ['owner', 'admin'].includes(authorization.membership?.role);
    const visibleProjectIds = new Set(projectsSnapshot.docs.flatMap(document => {
      const project = document.data();
      return isPrivileged || project.team?.includes(authorization.user.uid) ? [document.id] : [];
    }));
    const deadlines = issuesSnapshot.docs.flatMap(document => {
      const issue = document.data();
      if (!visibleProjectIds.has(issue.projectId)) return [];
      // A deadline is a claim on somebody's week, so it belongs to work that is
      // still work. A task put aside — archived or cancelled — has no such claim
      // and must not keep a day marked on a calendar it left.
      if (isArchivedIssue(issue) || isCancelledIssue(issue)) return [];
      const dueDate = serializeTimestamp(issue.dueDate);
      if (!dueDate) return [];
      return [{
        id: document.id,
        title: issue.title || '',
        issueKey: issue.issueKey || '',
        projectId: issue.projectId || '',
        dueDate,
        assigneeIds: issue.assigneeIds || [],
        completed: Boolean(issue.completedAt),
      }];
    });

    return NextResponse.json(
      { events: [...events, ...birthdayEvents], deadlines },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'calendar-events GET',
      fallbackMessage: 'Не вдалося завантажити календар',
    });
  }
}

export async function POST(request) {
  try {
    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      return NextResponse.json({
        error: 'Некоректний JSON',
        code: 'CALENDAR_EVENT_JSON_INVALID',
      }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({
        error: 'Тіло запиту має бути об’єктом',
        code: 'CALENDAR_EVENT_JSON_INVALID',
      }, { status: 400 });
    }
    const organizationId = typeof body.organizationId === 'string' ? body.organizationId.trim() : '';
    const authorization = await authorizeOrgRequest(request, organizationId, ['owner', 'admin', 'member']);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    if (!(await enforceRateLimit('calendar-event-create', authorization.user.uid, 30, 60))) {
      return NextResponse.json({ error: 'Забагато подій за короткий час' }, { status: 429 });
    }

    const normalized = normalizedCalendarEventInput(body, null, {
      ownerId: authorization.user.uid,
    });
    if (normalized.error) return NextResponse.json({ error: normalized.error }, { status: 400 });
    const eventData = normalized.value;
    if (eventData.visibility === 'private') {
      eventData.participantIds = [authorization.user.uid];
    } else if (!eventData.participantIds.includes(authorization.user.uid)) {
      eventData.participantIds.unshift(authorization.user.uid);
    }
    // The same consent the task composer asks for. A participant who cannot
    // open the event's project gets an invitation pointing at a 404, and an
    // admin who can open it is still missing from the project's roster — both
    // were unchecked here, because this route only ever asked whether a
    // participant was in the organization.
    const addParticipantsToProjectTeam = body.addParticipantsToProjectTeam === true;
    const db = getAdminDb();
    const ref = db.collection('calendarEvents').doc();
    const now = FieldValue.serverTimestamp();
    const participantResponses = Object.fromEntries(
      eventData.participantIds.map(uid => [
        uid,
        uid === authorization.user.uid ? 'accepted' : 'pending',
      ]),
    );
    await db.runTransaction(async transaction => {
      const membershipRefs = eventData.participantIds.map(
        uid => db.collection('orgMemberships').doc(`${organizationId}_${uid}`),
      );
      const memberships = membershipRefs.length
        ? await transaction.getAll(...membershipRefs)
        : [];
      if (memberships.some((snapshot, index) => (
        !snapshot.exists
        || snapshot.data().orgId !== organizationId
        || snapshot.data().userId !== eventData.participantIds[index]
      ))) {
        throw calendarCreateError(
          'CALENDAR_PARTICIPANT_INVALID',
          'Один або кілька учасників уже не належать до команди',
        );
      }

      const roleByParticipant = new Map(eventData.participantIds.map(
        (uid, index) => [uid, memberships[index].data().role || null],
      ));

      let projectRef = null;
      let participantsToAddToTeam = [];
      if (eventData.projectId) {
        projectRef = db.collection('projects').doc(eventData.projectId);
        const projectSnapshot = await transaction.get(projectRef);
        const project = projectSnapshot.exists ? projectSnapshot.data() : null;
        if (!project || project.organizationId !== organizationId) {
          throw calendarCreateError(
            'CALENDAR_PROJECT_SCOPE_MISMATCH',
            'Обраний проєкт не належить цій організації',
          );
        }
        if (project.deletionPending === true) {
          throw calendarCreateError(
            'CALENDAR_PROJECT_DELETION_IN_PROGRESS',
            'Обраний проєкт уже видаляють',
          );
        }
        if (project.status === 'archived') {
          throw calendarCreateError(
            'CALENDAR_PROJECT_ARCHIVED',
            'Не можна додавати події до архівованого проєкту',
          );
        }
        const isPrivileged = ['owner', 'admin'].includes(
          authorization.membership?.role,
        );
        if (
          !isPrivileged
          && !(
            Array.isArray(project.team)
            && project.team.includes(authorization.user.uid)
          )
        ) {
          throw calendarCreateError(
            'CALENDAR_PROJECT_FORBIDDEN',
            'Ви не належите до команди обраного проєкту',
            403,
          );
        }

        const projectWithId = { ...project, id: projectSnapshot.id };
        const lockedOut = assigneesOutsideProject(
          projectWithId,
          eventData.participantIds,
          uid => roleByParticipant.get(uid) ?? null,
        );
        const offRoster = assigneesOffProjectTeam(projectWithId, eventData.participantIds);
        if (lockedOut.length && (!isPrivileged || !addParticipantsToProjectTeam)) {
          throw calendarCreateError(
            'CALENDAR_PARTICIPANT_OUTSIDE_PROJECT',
            isPrivileged
              // Two screens reach this route — the dialog, which has the tick
              // box, and the event page, which does not — so the sentence names
              // the remedy rather than a control that may not be on screen.
              ? 'Учасник не входить до складу проєкту. Додайте його до складу проєкту, щоб запросити на цю подію.'
              : 'Учасник не входить до складу проєкту. Попросіть власника або адміністратора додати його до проєкту.',
            403,
          );
        }
        if (addParticipantsToProjectTeam && !isPrivileged) {
          throw calendarCreateError(
            'CALENDAR_PROJECT_TEAM_FORBIDDEN',
            'Додавати учасників до проєкту може лише власник або адміністратор',
            403,
          );
        }
        if (addParticipantsToProjectTeam) participantsToAddToTeam = offRoster;
      }

      transaction.create(ref, {
        ...eventData,
        organizationId,
        organizerId: authorization.user.uid,
        participantResponses,
        createdAt: now,
        updatedAt: now,
      });
      if (projectRef) {
        transaction.update(projectRef, {
          invoiceMutationVersion: FieldValue.increment(1),
          // Written only because the request asked for it, exactly as the task
          // create route does — never as a side effect of inviting somebody.
          ...(participantsToAddToTeam.length
            ? { team: FieldValue.arrayUnion(...participantsToAddToTeam) }
            : {}),
        });
      }
    });

    await createCalendarNotifications({
      organizationId,
      eventId: ref.id,
      recipientIds: eventData.participantIds,
      actorId: authorization.user.uid,
      type: 'calendar_invite',
      title: `Запрошення: ${eventData.title}`,
      body: eventData.allDay
        ? 'Вас додали до події на весь день'
        : `Початок: ${eventData.startAt.toDate().toLocaleString('uk-UA')}`,
    }).catch(error => {
      console.warn('[calendar] create notification failed after commit:', error);
    });

    const created = await ref.get();
    // «Нагадати за 15 хвилин» is knowable the moment the event is saved, so
    // the queue rows are written here rather than found by a scan minutes
    // before the meeting. A moved start rewrites them; a deleted event or a
    // dropped participant leaves nothing wanted, and the rows are cancelled.
    await syncCalendarEventReminderRows({
      eventId: ref.id,
      event: { ...created.data(), id: ref.id },
    }).catch(error => console.warn('[calendar POST] reminder rows failed:', error.message));

    return NextResponse.json({ event: serializeCalendarEvent(created) }, { status: 201 });
  } catch (error) {
    if (error?.calendarEventCreate) {
      const { message, status, ...payload } = error.calendarEventCreate;
      return NextResponse.json({ error: message, ...payload }, { status });
    }
    return routeErrorResponse(error, {
      context: 'calendar-events POST',
      fallbackMessage: 'Не вдалося створити подію',
    });
  }
}
