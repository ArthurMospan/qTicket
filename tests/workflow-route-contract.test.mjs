import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('workflow mutations are authenticated and transactional', async () => {
  const route = await read(
    '../src/app/api/organizations/[organizationId]/workflow/route.js',
  );

  // The board's columns are project settings, and the matrix owns that gate:
  // widening `edit:project_settings` has to widen this route in the same edit.
  assert.match(
    route,
    /authorizeOrgRequest\([\s\S]{0,300}rolesFor\('edit:project_settings'\)/,
  );
  assert.match(route, /normalizeWorkflowMutationInput\(body\)/);
  assert.match(route, /await db\.runTransaction\(async transaction =>/);
  assert.match(route, /where\('organizationId', '==', organizationId\)/);
  assert.match(route, /introducedIssueExecutionViolations\(\{/);
  assert.match(route, /STATUS_MIGRATION_REQUIRED/);
  assert.match(route, /WORKFLOW_EXECUTION_CONFLICT/);
  assert.match(route, /workflow-status-migrated/);
  assert.match(route, /updates\.completedAt = now/);
  assert.match(
    route,
    /updates\.completedAt = FieldValue\.delete\(\)/,
  );
});

test('the workflow a read hands back carries no price on a position', async () => {
  const [route, hook] = await Promise.all([
    read('../src/app/api/organizations/[organizationId]/workflow/route.js'),
    read('../src/lib/hooks/useWorkflowConfig.js'),
  ]);

  // A position is a job title. Documents written before the rates went away
  // still carry an `hourlyRate` beside one, so the route drops it on the way
  // out rather than echoing a price back into a product that has none.
  assert.match(route, /export async function GET\(request, context\)/);
  assert.match(route, /workflow: publicWorkflow\(workflow\)/);
  assert.match(route, /positions\.map\(\(\{ hourlyRate, \.\.\.position \}\) => position\)/);
  assert.match(route, /workflowVersion: FieldValue\.increment\(1\)/);
  // And the workflow is read through the route, never straight off the
  // document the route is the only writer of.
  assert.match(hook, /fetchWorkflowViaApi\(organizationId\)/);
  assert.doesNotMatch(hook, /settings', 'workflow'/);
});

test('settings use the workflow API and never batch issue status changes directly', async () => {
  const [settings, service] = await Promise.all([
    read('../src/app/(app)/settings/page.js'),
    read('../src/lib/services/workflow.js'),
  ]);

  assert.match(settings, /updateWorkflowViaApi/);
  assert.match(settings, /queueWorkflowMutation/);
  assert.match(settings, /statusMigrations:\s*\[\{/);
  assert.doesNotMatch(
    settings,
    /setDoc\(doc\(db, 'organizations', activeOrgId, 'settings', 'workflow'/,
  );
  assert.doesNotMatch(settings, /writeBatch\(db\)[\s\S]{0,500}completedAt/);
  assert.match(
    service,
    /authenticatedRequest\([\s\S]{0,180}\/api\/organizations\/\$\{encodeURIComponent\(organizationId\)\}\/workflow/,
  );
  assert.match(service, /import \{ authenticatedRequest \} from '@\/lib\/services\/authenticatedRequest'/);
});
