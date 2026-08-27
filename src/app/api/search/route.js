// QUI-104. Search used to read one collection — `issues` — and answer with
// tasks only. Typing a colleague's name, a project's name or the title of a
// meeting therefore returned nothing at all, which reads as "search is broken"
// rather than "search does not cover that". It now answers across the four
// things a workspace is made of: tasks, people, projects and calendar events.
//
// Each kind keeps its own visibility rule. Widening what search *finds* must
// never widen what a member can *see* — a plain member could once read the
// titles of tasks in projects they cannot open, and that regression is not
// worth repeating three more times.
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, enforceRateLimit, getAdminDb } from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import { taskDisplayKey } from '@/lib/utils/issueKeys.mjs';
import { isArchivedIssue } from '@/lib/utils/issueArchive.mjs';
import { isCancelledIssue } from '@/lib/utils/issueCancel.mjs';
// One ladder for every kind, so a project called "Design" and a task called
// "Design" rank against each other consistently. The ladders and both issue
// scorers live in a pure module, next to the tests that argue with them.
import {
  scoreField,
  scoreIssue,
  scoreIssueMention,
  searchMinimumLength,
} from '@/lib/utils/searchRanking.mjs';

const WEIGHTS = { key: [100, 80, 50], name: [90, 60, 40], body: [0, 0, 20] };

// Ranking happens in memory, so answering a question means reading the whole
// corpus first — and a person typing «design» asks six questions, one per
// settled keystroke, each of which used to re-read every task, project,
// membership and event in the organization. The scan is kept for a minute and
// shared by every request that lands on the same instance, which turns a word
// typed into a search box from six scans into one.
//
// Only what was read is kept, never who may see it: the visibility rules below
// run per request, against the caller's own membership, on every hit.
const CORPUS_TTL_MS = 60_000;
// A corpus too big to hold is a corpus not worth holding; those organizations
// need a search index rather than a cache, and must not exhaust the instance
// trying to pretend otherwise.
const CORPUS_MAX_DOCS = 5000;
const corpusCache = new Map();

function corpusKey(organizationId, projectId, mention) {
  return `${organizationId}|${projectId}|${mention ? 'mention' : 'full'}`;
}

async function readCorpus(key, load) {
  const cached = corpusCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = await load();
  const size = Object.values(value).reduce(
    (total, part) => total + (Array.isArray(part?.docs) ? part.docs.length : 0),
    0,
  );
  if (size <= CORPUS_MAX_DOCS) {
    corpusCache.set(key, { value, expiresAt: Date.now() + CORPUS_TTL_MS });
    // Nothing here is worth a leak: expired organizations are dropped whenever
    // another one is written.
    for (const [id, entry] of corpusCache) {
      if (entry.expiresAt <= Date.now()) corpusCache.delete(id);
    }
  }
  return value;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get('organizationId') || '';
    const term = (searchParams.get('q') || '').trim().toLowerCase().slice(0, 100);
    const projectId = (searchParams.get('projectId') || '').trim().slice(0, 200);
    // Picking a task to mention is not the same search as asking the workspace
    // a question, and one ranking cannot serve both. See searchRanking.mjs.
    const mention = searchParams.get('mention') === 'issue';
    const authorization = await authorizeOrgRequest(request, organizationId);
    if (authorization.error) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    if (term.length < searchMinimumLength(mention)) {
      return NextResponse.json({ results: [], people: [], projects: [], events: [] });
    }
    if (!(await enforceRateLimit('search', authorization.user.uid, 60, 60))) {
      return NextResponse.json({ error: 'Too many search requests' }, { status: 429 });
    }

    const db = getAdminDb();
    const uid = authorization.user.uid;
    let issuesQuery = db.collection('issues').where('organizationId', '==', organizationId);
    let eventsQuery = db.collection('calendarEvents').where('organizationId', '==', organizationId);
    if (projectId) {
      issuesQuery = issuesQuery.where('projectId', '==', projectId);
      eventsQuery = eventsQuery.where('projectId', '==', projectId);
    }
    // Search must honour the same per-project access model as the rest of the
    // app: a plain member could previously find the titles of tasks in projects
    // they are not on and cannot open. Owners/admins still see everything.
    const isPrivileged = ['owner', 'admin'].includes(authorization.membership?.role);
    let scopedProject = null;
    let scopedProjectSnapshot = null;
    if (projectId) {
      scopedProjectSnapshot = await db.collection('projects').doc(projectId).get();
      const data = scopedProjectSnapshot.exists ? scopedProjectSnapshot.data() : null;
      const canOpen = data?.organizationId === organizationId
        && data.status !== 'archived'
        && (isPrivileged || (Array.isArray(data.team) && data.team.includes(uid)));
      if (!canOpen) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }
      scopedProject = { ...data, id: scopedProjectSnapshot.id };
    }
    // Picking a task to mention asks about tasks. It used to read the people,
    // the projects' calendars and every membership beside them and then throw
    // all three away — three organization-wide scans, per keystroke, for an
    // answer that could not contain a person or an event. On a free-tier read
    // quota that is not an inefficiency, it is the outage.
    const EMPTY_SNAPSHOT = { docs: [] };
    const {
      issues: issuesSnapshot,
      projects: projectsSnapshot,
      memberships: membershipsSnapshot,
      profiles: profilesSnapshot,
      events: eventsSnapshot,
    } = await readCorpus(corpusKey(organizationId, projectId, mention), async () => {
    const [issues, projects, memberships, events] = await Promise.all([
      issuesQuery
        .select('issueKey', 'title', 'description', 'projectId', 'type', 'assigneeIds', 'createdAt', 'columnId', 'status', 'dueDate', 'archivedAt', 'cancelledAt')
        .get(),
      scopedProjectSnapshot
        ? Promise.resolve({ docs: [scopedProjectSnapshot] })
        : db.collection('projects')
          .where('organizationId', '==', organizationId)
          .select('name', 'description', 'issuePrefix', 'team', 'status')
          .get(),
      mention
        ? EMPTY_SNAPSHOT
        : db.collection('orgMemberships').where('orgId', '==', organizationId)
          .select('userId', 'role', 'orgId')
          .get(),
      mention
        ? EMPTY_SNAPSHOT
        : eventsQuery
          .select('title', 'description', 'location', 'type', 'visibility', 'organizerId', 'participantIds', 'projectId', 'startAt')
          .get(),
    ]);
      const profiles = mention || memberships.docs.length === 0
        ? EMPTY_SNAPSHOT
        : {
          docs: await db.getAll(...memberships.docs.map(document =>
            db.collection('users').doc(document.data().userId))),
        };
      // Snapshots are held as their documents' data, so a cached corpus cannot
      // keep a Firestore query object alive behind it.
      const plain = snapshot => ({
        docs: snapshot.docs.map(document => {
          const data = document.data();
          return { id: document.id, data: () => data };
        }),
      });
      return {
        issues: plain(issues),
        projects: plain(projects),
        memberships: plain(memberships),
        profiles: plain(profiles),
        events: plain(events),
      };
    });

    const projectRecords = projectsSnapshot.docs.map(document => ({ ...document.data(), id: document.id }));
    const projectsById = new Map(projectRecords.map(project => [project.id, project]));
    const visibleProjectIds = isPrivileged
      ? null
      : new Set(
        projectRecords
          .filter(project => Array.isArray(project.team) && project.team.includes(uid))
          .map(project => project.id),
      );
    const results = issuesSnapshot.docs
      // Archived tasks are out of the working set everywhere else, and search
      // is where an exception would be least expected: you would find a task,
      // click it, and land on a read-only page explaining it is not in use.
      .filter(item => !isArchivedIssue(item.data()) && !isCancelledIssue(item.data()))
      .map(item => {
        const storedIssue = item.data();
        const issue = {
          ...storedIssue,
          storedIssueKey: storedIssue.issueKey,
          issueKey: taskDisplayKey(storedIssue, projectsById.get(storedIssue.projectId)),
        };
        const score = mention ? scoreIssueMention(issue, term) : scoreIssue(issue, term);
        return { ...issue, id: item.id, score };
      })
      .filter(issue => issue.score > 0)
      .filter(issue => !visibleProjectIds || visibleProjectIds.has(issue.projectId))
      .filter(issue => !projectId || issue.projectId === projectId)
      .sort((a, b) => b.score - a.score || (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
      .slice(0, 50)
      .map(issue => ({
        id: issue.id,
        issueKey: issue.issueKey || '',
        title: issue.title || '',
        projectId: issue.projectId || '',
        type: issue.type || 'task',
        assigneeIds: Array.isArray(issue.assigneeIds) ? issue.assigneeIds : [],
        // Enough for a hovercard to draw the task without a second lookup of
        // its own — which is what the `#` mention used to do, with a client
        // query that had to solve display-key drift and project access all over
        // again. `select` already reads these fields; nothing extra is fetched.
        columnId: issue.columnId || issue.status || '',
        dueDate: issue.dueDate ? issue.dueDate.toDate?.()?.toISOString?.() || null : null,
      }));

    // An archived project is not somewhere to be sent, so it is not an answer.
    const projects = projectRecords
      .filter(project => project.status !== 'archived')
      .filter(project => !visibleProjectIds || visibleProjectIds.has(project.id))
      .filter(project => !projectId || project.id === projectId)
      .map(project => ({
        project,
        score: Math.max(
          scoreField(project.name, term, WEIGHTS.name),
          scoreField(project.issuePrefix, term, WEIGHTS.key),
          scoreField(project.description, term, WEIGHTS.body),
        ),
      }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(entry => ({ id: entry.project.id, name: entry.project.name || 'Проєкт' }));

    // Membership is organization-wide, and so is the team list every member can
    // already open — so people carry no extra visibility rule of their own.
    const scopedMemberIds = projectId
      ? new Set(Array.isArray(scopedProject.team) ? scopedProject.team : [])
      : null;
    const memberships = membershipsSnapshot.docs
      .map(document => document.data())
      .filter(membership => !scopedMemberIds || scopedMemberIds.has(membership.userId));
    const profilesById = new Map(profilesSnapshot.docs.map(document => [
      document.id,
      document.data(),
    ]));
    const people = memberships
      .map(membership => {
        const profile = profilesById.get(membership.userId) || {};
        return {
          membership,
          profile,
          score: Math.max(
            scoreField(profile.name, term, WEIGHTS.name),
            scoreField(profile.email, term, WEIGHTS.name),
          ),
        };
      })
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(entry => ({
        id: entry.membership.userId,
        name: entry.profile.name || entry.profile.email || 'Учасник',
        email: entry.profile.email || '',
      }));

    // The same visibility rule the calendar itself applies: a private event is
    // the organizer's alone, a participant-only event reaches its participants.
    const events = eventsSnapshot.docs
      .map(document => ({ ...document.data(), id: document.id }))
      .filter(event => (
        event.visibility === 'private'
          ? event.organizerId === uid
          : event.visibility !== 'participants'
            || event.organizerId === uid
            || event.participantIds?.includes(uid)
            || isPrivileged
      ))
      .filter(event => !projectId || event.projectId === projectId)
      .map(event => ({
        event,
        score: Math.max(
          scoreField(event.title, term, WEIGHTS.name),
          scoreField(event.location, term, WEIGHTS.body),
          scoreField(event.description, term, WEIGHTS.body),
        ),
      }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score || (b.event.startAt?.toMillis?.() || 0) - (a.event.startAt?.toMillis?.() || 0))
      .slice(0, 8)
      .map(entry => ({
        id: entry.event.id,
        title: entry.event.title || 'Подія',
        startAt: entry.event.startAt?.toDate?.()?.toISOString() || null,
      }));

    return NextResponse.json(
      { results, people, projects, events },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return routeErrorResponse(error, { context: 'search', fallbackMessage: 'Search failed' });
  }
}
