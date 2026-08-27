// Resolving `#QT-12` to the task it names.
//
// This used to go through `/api/search`, and that was a serious mistake about
// cost. Search cannot know which documents match a word, so it reads every task,
// every project, every membership and every calendar event in the organization
// and ranks them in memory. That is defensible once, for a person typing a
// question. It is indefensible per capsule: a chat with eight different tasks
// mentioned in it did eight full scans of four collections on every single
// page view, which is how a free-tier daily read quota disappeared in an
// afternoon and the product answered «Database is temporarily unavailable
// because its quota is exhausted».
//
// A mention is not a search. It is an exact key, and Firestore can answer an
// exact key with an equality query: the whole page now costs one request and a
// handful of document reads.
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, enforceRateLimit, getAdminDb } from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import { taskDisplayKey } from '@/lib/utils/issueKeys.mjs';

// Firestore takes up to 30 values in an `in` filter; one page of chat never
// needs anything like that many distinct tasks.
const MAX_KEYS = 20;
// `issueKey` alone, deliberately: every field carries a single-field index by
// default, so this needs no composite index to be deployed before it works.
// The organization is checked in memory afterwards — the keys are few, and the
// documents behind them are counted in single digits.
const KEY_FIELD = 'issueKey';

function normalizeKeys(raw) {
  return [...new Set(String(raw || '')
    .split(',')
    .map(key => key.trim().toLocaleUpperCase('uk-UA'))
    .filter(key => /^[\p{L}\p{N}-]{1,40}$/u.test(key)))]
    .slice(0, MAX_KEYS);
}

/** `QUI-7` displayed for a task still stored under the pre-prefix `WS-7`. */
function legacyCandidates(keys) {
  return [...new Set(keys
    .map(key => key.match(/^[\p{L}\p{N}]+-(\d+)$/u))
    .filter(Boolean)
    .map(match => `WS-${match[1]}`))];
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get('organizationId') || '';
    const keys = normalizeKeys(searchParams.get('keys'));

    const authorization = await authorizeOrgRequest(request, organizationId);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    if (keys.length === 0) return NextResponse.json({ results: [] });
    if (!(await enforceRateLimit('issueLookup', authorization.user.uid, 120, 60))) {
      return NextResponse.json({ error: 'Too many lookups' }, { status: 429 });
    }

    const db = getAdminDb();
    const uid = authorization.user.uid;
    const wanted = [...keys, ...legacyCandidates(keys)].slice(0, MAX_KEYS + 10);
    const snapshot = await db.collection('issues')
      .where(KEY_FIELD, 'in', wanted)
      .select('issueKey', 'title', 'projectId', 'type', 'assigneeIds', 'columnId', 'status', 'dueDate', 'organizationId')
      .get();

    const found = snapshot.docs
      .map(document => ({ ...document.data(), id: document.id }))
      .filter(issue => issue.organizationId === organizationId);
    if (found.length === 0) return NextResponse.json({ results: [] });

    // Only the projects those tasks belong to, by id — never the collection.
    // They are needed twice: a legacy key is displayed with its project's
    // prefix, and a plain member may not be shown a task in a project they
    // cannot open. Search enforces the same rule; a cheaper lookup must not be
    // a way around it.
    const projectIds = [...new Set(found.map(issue => issue.projectId).filter(Boolean))];
    const projectSnapshots = projectIds.length
      ? await db.getAll(...projectIds.map(id => db.collection('projects').doc(id)))
      : [];
    const projectsById = new Map(projectSnapshots
      .filter(document => document.exists)
      .map(document => [document.id, { ...document.data(), id: document.id }]));

    const isPrivileged = ['owner', 'admin'].includes(authorization.membership?.role);
    const results = found
      .filter(issue => {
        const project = projectsById.get(issue.projectId);
        if (!project || project.organizationId !== organizationId) return false;
        return isPrivileged || (Array.isArray(project.team) && project.team.includes(uid));
      })
      .map(issue => ({
        id: issue.id,
        issueKey: taskDisplayKey(issue, projectsById.get(issue.projectId)),
        storedIssueKey: issue.issueKey || '',
        title: issue.title || '',
        projectId: issue.projectId || '',
        type: issue.type || 'task',
        assigneeIds: Array.isArray(issue.assigneeIds) ? issue.assigneeIds : [],
        columnId: issue.columnId || issue.status || '',
        dueDate: issue.dueDate?.toDate?.()?.toISOString?.() || null,
      }));

    return NextResponse.json({ results });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'issue lookup',
      fallbackMessage: 'Could not resolve the mentioned tasks',
    });
  }
}
