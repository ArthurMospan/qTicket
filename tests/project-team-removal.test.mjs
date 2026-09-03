import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { resolveProjectTeamRemoval } from '../src/lib/server/projectTeamRemoval.mjs';
import { can, rolesFor } from '../src/lib/utils/can.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

// The other half of «Запросити клієнта». Until 2026-09-03 qTicket had no way
// to take a client seat away from any screen: the help article, a hint in
// «Налаштування проєкту» and the project form all pointed at the «Учасники»
// tab, and the tab held an invite button and two read-only lists. The
// organization-level removal route existed and would have worked on a client
// seat, unreachable; a client administrator had nothing at all.

const ORG = 'org-a';
const project = {
  id: 'client-a',
  organizationId: ORG,
  team: ['support-admin', 'client-admin', 'client-member'],
};
const memberships = {
  [`${ORG}_client-admin`]: { orgId: ORG, userId: 'client-admin', role: 'client_admin' },
  [`${ORG}_client-member`]: { orgId: ORG, userId: 'client-member', role: 'client_member' },
  [`${ORG}_support-admin`]: { orgId: ORG, userId: 'support-admin', role: 'admin', managedBy: 'quickteam' },
};

function fakeDb({ projects = {} } = {}) {
  return {
    collection(name) {
      if (name === 'orgMemberships') {
        return {
          doc: id => ({
            async get() {
              const data = memberships[id];
              return { exists: Boolean(data), data: () => data };
            },
          }),
        };
      }
      if (name === 'projects') {
        return {
          where(field, operator, value) {
            // One field only. No composite index exists in production, so a
            // two-field query here would pass this test and fail there.
            assert.equal(field, 'team');
            assert.equal(operator, 'array-contains');
            return {
              async get() {
                const docs = Object.entries(projects)
                  .filter(([, data]) => (data.team || []).includes(value))
                  .map(([id, data]) => ({ id, data: () => data }));
                return { docs, size: docs.length };
              },
            };
          },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };
}

const desk = { project, organizationId: ORG, actorUid: 'support-admin', actorRole: 'admin' };
const clientAdmin = { project, organizationId: ORG, actorUid: 'client-admin', actorRole: 'client_admin' };

test('the desk removes a client administrator, and their only project archives the seat', async () => {
  const decision = await resolveProjectTeamRemoval(fakeDb({ projects: { 'client-a': project } }), {
    ...desk,
    memberId: 'client-admin',
  });
  assert.deepEqual(decision, { role: 'client_admin', archiveSeat: true, remainingProjectIds: [] });
});

test('a person who holds another project of this organization keeps their seat', async () => {
  const decision = await resolveProjectTeamRemoval(fakeDb({
    projects: {
      'client-a': project,
      'client-b': { organizationId: ORG, team: ['client-member'] },
      // The same person in another organization: not this desk's business.
      foreign: { organizationId: 'org-b', team: ['client-member'] },
    },
  }), { ...desk, memberId: 'client-member' });
  assert.deepEqual(decision, { role: 'client_member', archiveSeat: false, remainingProjectIds: ['client-b'] });
});

test('a client administrator removes their own colleague from their own project', async () => {
  const decision = await resolveProjectTeamRemoval(fakeDb({ projects: { 'client-a': project } }), {
    ...clientAdmin,
    memberId: 'client-member',
  });
  assert.equal(decision.role, 'client_member');
  assert.equal(decision.archiveSeat, true);
});

test('a client administrator cannot remove an administrator, nor anyone from a project they are not on', async () => {
  await assert.rejects(
    resolveProjectTeamRemoval(fakeDb(), { ...clientAdmin, memberId: 'client-admin' }),
    error => error.message === 'SELF',
  );
  const otherAdmin = { ...project, team: [...project.team, 'client-admin-2'] };
  memberships[`${ORG}_client-admin-2`] = { orgId: ORG, userId: 'client-admin-2', role: 'client_admin' };
  await assert.rejects(
    resolveProjectTeamRemoval(fakeDb(), { ...clientAdmin, project: otherAdmin, memberId: 'client-admin-2' }),
    error => error.message === 'ADMIN_SEAT' && error.projectTeamRemoval.status === 403,
  );
  await assert.rejects(
    resolveProjectTeamRemoval(fakeDb(), {
      ...clientAdmin,
      project: { ...project, team: ['client-member'] },
      memberId: 'client-member',
    }),
    error => error.message === 'FOREIGN_PROJECT' && error.projectTeamRemoval.status === 403,
  );
});

test('a support seat never leaves this way, and nobody removes themselves', async () => {
  await assert.rejects(
    resolveProjectTeamRemoval(fakeDb(), { ...clientAdmin, memberId: 'support-admin' }),
    error => error.message === 'NOT_A_CLIENT_SEAT' && error.projectTeamRemoval.status === 409,
  );
  memberships[`${ORG}_support-agent`] = { orgId: ORG, userId: 'support-agent', role: 'member', managedBy: 'quickteam' };
  await assert.rejects(
    resolveProjectTeamRemoval(fakeDb(), {
      ...desk,
      project: { ...project, team: [...project.team, 'support-agent'] },
      memberId: 'support-agent',
    }),
    error => error.message === 'NOT_A_CLIENT_SEAT',
  );
  await assert.rejects(
    resolveProjectTeamRemoval(fakeDb(), { ...desk, memberId: 'support-admin', actorUid: 'support-admin' }),
    error => error.message === 'SELF' && error.projectTeamRemoval.status === 409,
  );
  await assert.rejects(
    resolveProjectTeamRemoval(fakeDb(), { ...desk, memberId: 'nobody' }),
    error => error.message === 'NOT_ON_PROJECT' && error.projectTeamRemoval.status === 404,
  );
  await assert.rejects(
    resolveProjectTeamRemoval(fakeDb(), { ...desk, memberId: 'a/b' }),
    error => error.message === 'INVALID_MEMBER',
  );
});

test('the permission is the mirror of inviting, and the route names it', async () => {
  assert.deepEqual([...rolesFor('remove:client_member')].sort(), ['admin', 'client_admin', 'owner']);
  assert.equal(can('client_member', 'remove:client_member'), false);
  assert.equal(can('member', 'remove:client_member'), false);

  const route = await read('../src/app/api/projects/[projectId]/team/[memberId]/route.js');
  assert.match(route, /rolesFor\('remove:client_member'\)/);
  assert.match(route, /resolveProjectTeamRemoval\(db, \{/);
  assert.match(route, /team: FieldValue\.arrayRemove\(memberId\)/);
  // The seat is archived where the organization-level removal archives it,
  // so reactivation and a new invitation read one shape.
  assert.match(route, /transaction\.set\(archiveRef, \{/);
  assert.match(route, /reason: 'removed'/);
  // The record of what happened is not rewritten on the way out.
  assert.doesNotMatch(route, /assigneeIds|watcherIds|'comments'/);
});

test('the «Учасники» tab offers the removal from a kebab, to the reader who may', async () => {
  const board = await read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx');
  assert.match(board, /can\(orgRole, 'remove:client_member'\)/);
  assert.match(board, /member\.role === 'client_member' && isOnProjectTeam\(project, me\)/);
  assert.match(board, /label: 'Вилучити з проєкту'/);
  assert.match(board, /removeProjectMember\(activeOrgId, project\.id, memberId\)/);
  // The row still opens on a click, as it always has. The kebab is a button
  // and the row is a button, so the kebab is a sibling drawn over the row's
  // edge — never a menu item standing in for the click.
  assert.match(board, /onClick=\{onOpen \? \(\) => onOpen\(memberId\) : undefined\}/);
  assert.doesNotMatch(board, /label: 'Профіль'/);
  assert.match(board, /<div className="absolute right-3 top-1\/2 -translate-y-1\/2">\s*<ContextMenu/);

  const help = await read('../src/lib/content/helpArticles.mjs');
  assert.match(help, /«Вилучити з проєкту»/);
});
