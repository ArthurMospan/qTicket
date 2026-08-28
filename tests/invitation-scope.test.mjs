import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveInvitationScope } from '../src/lib/server/invitationScope.mjs';

function projectDb(projects) {
  return {
    collection(name) {
      assert.equal(name, 'projects');
      return { doc: id => ({ id }) };
    },
    async getAll(...references) {
      return references.map(reference => {
        const data = projects[reference.id];
        return {
          id: reference.id,
          exists: Boolean(data),
          data: () => data,
        };
      });
    },
  };
}

test('staff invites the first client administrator into exactly one client project', async () => {
  const scope = await resolveInvitationScope(projectDb({
    'client-a': { organizationId: 'org-a', team: ['support-agent'] },
  }), {
    requestedProjectIds: ['client-a'],
    organizationId: 'org-a',
    inviterUid: 'support-admin',
    inviterRole: 'admin',
    requestedRole: 'client_admin',
  });

  assert.deepEqual(scope, {
    role: 'client_admin',
    clientInvitee: true,
    projectIds: ['client-a'],
    scope: 'client-project',
    restoreArchivedProjects: false,
  });
});

test('client administrator can invite only a client member into their own project', async () => {
  const scope = await resolveInvitationScope(projectDb({
    'client-a': { organizationId: 'org-a', team: ['client-admin'] },
  }), {
    requestedProjectIds: ['client-a'],
    organizationId: 'org-a',
    inviterUid: 'client-admin',
    inviterRole: 'client_admin',
    requestedRole: 'owner',
  });

  assert.equal(scope.role, 'client_member');
  assert.deepEqual(scope.projectIds, ['client-a']);
  assert.equal(scope.scope, 'client-project');
});

test('an invitation cannot carry a project from another organization', async () => {
  await assert.rejects(
    resolveInvitationScope(projectDb({
      foreign: { organizationId: 'org-b', team: ['client-admin'] },
    }), {
      requestedProjectIds: ['foreign'],
      organizationId: 'org-a',
      inviterUid: 'client-admin',
      inviterRole: 'client_admin',
      requestedRole: 'client_member',
    }),
    error => error.message === 'INVALID_PROJECT_SCOPE',
  );
});
