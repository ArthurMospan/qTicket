import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { authorizeOrgRequest, getAdminDb } from '@/lib/server/firebaseAdmin';
import {
  canAccessCalendarEventProject,
  canViewCalendarEvent,
} from '@/lib/server/calendarEvents';
import { calendarEventSupportsTracking } from '@/lib/utils/calendarEventTypes.mjs';
import { isCalendarEventOccurrence, isCanonicalCalendarOccurrence } from '@/lib/utils/calendarTimeLog.mjs';
import {
  cleanTimerId,
  serializeTimerState,
  timerStateError,
  timerStateErrorResponse,
  timerStateRef,
} from '@/lib/server/userTimerState';
import { timerStartBlock } from '@/lib/utils/timerState.mjs';

export async function POST(request) {
  try {
    const body = await readJsonBody(request);
    const organizationId = cleanTimerId(body?.organizationId);
    const entityType = body?.entityType === 'calendar_event' ? 'calendar_event' : 'issue';
    if (!organizationId) {
      throw timerStateError('TIMER_ORGANIZATION_REQUIRED', 400, 'Не вказано організацію таймера');
    }
    const authorization = await authorizeOrgRequest(
      request,
      organizationId,
      ['owner', 'admin', 'member'],
    );
    if (authorization.error) {
      throw timerStateError(
        authorization.status === 401 ? 'TIMER_UNAUTHORIZED' : 'TIMER_FORBIDDEN',
        authorization.status,
        authorization.status === 401 ? 'Потрібно увійти в акаунт' : 'Немає доступу до цієї організації',
      );
    }

    const uid = authorization.user.uid;
    const projectId = cleanTimerId(body?.projectId) || '';
    const issueId = entityType === 'issue' ? cleanTimerId(body?.issueId) : '';
    const eventId = entityType === 'calendar_event' ? cleanTimerId(body?.eventId) : '';
    const occurrenceStartAt = entityType === 'calendar_event' ? String(body?.occurrenceStartAt || '') : '';
    if (
      (entityType === 'issue' && (!issueId || !projectId))
      || (entityType === 'calendar_event' && (!eventId || !isCanonicalCalendarOccurrence(occurrenceStartAt)))
    ) {
      throw timerStateError('TIMER_RESOURCE_INVALID', 400, 'Некоректний ресурс таймера');
    }

    const db = getAdminDb();
    const stateRef = timerStateRef(db, uid);
    const membershipRef = db.collection('orgMemberships').doc(`${organizationId}_${uid}`);
    const resourceRef = entityType === 'issue'
      ? db.collection('issues').doc(issueId)
      : db.collection('calendarEvents').doc(eventId);
    const projectRef = projectId ? db.collection('projects').doc(projectId) : null;
    const timerId = randomUUID();
    const state = await db.runTransaction(async transaction => {
      const [stateSnapshot, membershipSnapshot, resourceSnapshot, projectSnapshot] = await Promise.all([
        transaction.get(stateRef),
        transaction.get(membershipRef),
        transaction.get(resourceRef),
        projectRef ? transaction.get(projectRef) : Promise.resolve(null),
      ]);
      const membership = membershipSnapshot.exists ? membershipSnapshot.data() : null;
      if (
        !membership
        || membership.userId !== uid
        || membership.orgId !== organizationId
        || !['owner', 'admin', 'member'].includes(membership.role)
      ) {
        throw timerStateError('TIMER_MEMBERSHIP_CHANGED', 403, 'Доступ до організації змінився');
      }
      const current = stateSnapshot.exists ? stateSnapshot.data() : null;
      const startBlock = timerStartBlock(current);
      if (startBlock === 'pending') {
        throw timerStateError('TIMER_PENDING_EXISTS', 409, 'Спершу збережіть або відхиліть попередній відстежений час');
      }
      if (startBlock === 'active') {
        throw timerStateError('TIMER_ALREADY_ACTIVE', 409, 'Інший таймер уже запущено');
      }

      const resource = resourceSnapshot.exists ? resourceSnapshot.data() : null;
      const project = projectSnapshot?.exists ? projectSnapshot.data() : null;
      const privileged = ['owner', 'admin'].includes(membership.role);
      if (entityType === 'issue') {
        if (
          !resource
          || resource.organizationId !== organizationId
          || resource.projectId !== projectId
          || resource.deletionPending === true
        ) {
          throw timerStateError('TIMER_ISSUE_NOT_FOUND', 404, 'Завдання не знайдено');
        }
        if (
          !project
          || project.organizationId !== organizationId
          || project.deletionPending === true
          || project.status === 'archived'
        ) {
          throw timerStateError('TIMER_PROJECT_UNAVAILABLE', 409, 'Проєкт недоступний для трекінгу часу');
        }
        if (!privileged && !(Array.isArray(project.team) && project.team.includes(uid))) {
          throw timerStateError('TIMER_PROJECT_FORBIDDEN', 403, 'Ви не належите до команди цього проєкту');
        }
      } else {
        const liveAuthorization = { ...authorization, membership };
        if (
          !resource
          || resource.organizationId !== organizationId
          || !canViewCalendarEvent(resource, liveAuthorization)
          || resource.visibility !== 'team'
          || !calendarEventSupportsTracking(resource.type)
          || !isCalendarEventOccurrence(resource, occurrenceStartAt)
        ) {
          throw timerStateError('TIMER_EVENT_UNAVAILABLE', 409, 'Подія недоступна для трекінгу часу');
        }
        if (resource.projectId !== projectId) {
          throw timerStateError('TIMER_EVENT_PROJECT_CHANGED', 409, 'Проєкт події змінився');
        }
        if (projectId && !canAccessCalendarEventProject(resource, project, liveAuthorization)) {
          throw timerStateError('TIMER_PROJECT_FORBIDDEN', 403, 'Ви не належите до команди цього проєкту');
        }
      }

      const startedAt = Timestamp.now();
      const active = entityType === 'issue' ? {
        id: timerId,
        entityType,
        organizationId,
        projectId,
        issueId,
        issueKey: String(resource.issueKey || '').slice(0, 120),
        sourceTitle: String(resource.title || '').slice(0, 500),
        startedAt,
      } : {
        id: timerId,
        entityType,
        organizationId,
        projectId,
        issueId: `calendar-event:${eventId}:${occurrenceStartAt}`,
        eventId,
        occurrenceStartAt,
        sourceTitle: String(resource.title || '').slice(0, 500),
        startedAt,
      };
      const next = {
        userId: uid,
        active,
        pending: null,
        revision: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      };
      transaction.set(stateRef, next, { merge: true });
      return { userId: uid, active, pending: null, revision: (Number(current?.revision) || 0) + 1 };
    });

    return NextResponse.json({ state: serializeTimerState(state), serverNow: Date.now() }, { status: 201 });
  } catch (error) {
    if (error?.userTimer) return timerStateErrorResponse(error);
    return routeErrorResponse(error, {
      context: 'timer start',
      fallbackMessage: 'Не вдалося запустити таймер',
    });
  }
}
