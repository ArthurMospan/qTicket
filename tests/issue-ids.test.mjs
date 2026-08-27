import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  canonicalHistoricalIssueKey,
  issueMatchesRouteIdentifier,
  issuePath,
  isValidIssuePrefix,
  legacyStoredIssueKey,
  projectIssuePrefix,
  projectIssuePrefixTaken,
  suggestAvailableIssuePrefix,
} from '../src/lib/utils/issueKeys.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('every project task writer consumes the stable project issue sequence', async () => {
  const [sources, transactionalResolver] = await Promise.all([
    Promise.all([
    read('../src/app/api/issues/route.js'),
    read('../src/lib/server/telegram.js'),
    read('../src/app/api/v1/tasks/route.js'),
    read('../src/lib/server/youtrackImporter.js'),
    ]),
    read('../src/lib/server/issueKeys.js'),
  ]);

  for (const source of sources) {
    assert.match(source, /resolveProjectIssuePrefixInTransaction\(/);
    assert.match(source, /issueCounter: next/);
    assert.match(source, /issueKey = `\$\{issuePrefix\}-\$\{next\}`/);
  }
  assert.match(transactionalResolver, /where\('organizationId', '==', organizationId\)/);
  assert.match(transactionalResolver, /suggestAvailableIssuePrefix\(project, organizationProjects, projectId\)/);
});

test('project prefixes are automatic, unique and absent from project forms', async () => {
  const [createRoute, updateRoute, form, workspace] = await Promise.all([
    read('../src/app/api/projects/route.js'),
    read('../src/app/api/projects/[projectId]/route.js'),
    read('../src/components/ui/TaskManagement/ProjectSettingsForm.jsx'),
    read('../src/app/(app)/page.js'),
  ]);

  assert.match(createRoute, /const issuePrefix = suggestAvailableIssuePrefix\(/);
  // The prefix is written with the project, in the same create — not patched in
  // afterwards by anything that could fail on its own. Other server-owned fields
  // may join that payload; the prefix may not leave it.
  assert.match(createRoute, /transaction\.create\(projectRef, \{\s*\.\.\.payload,\s*issuePrefix,/);
  assert.match(updateRoute, /let resolvedIssuePrefix = projectIssuePrefix\(currentProject\)/);
  assert.match(updateRoute, /resolvedIssuePrefix = suggestAvailableIssuePrefix\(/);
  assert.doesNotMatch(form, /issuePrefix|Код завдань/);
  assert.doesNotMatch(workspace, /issuePrefix|suggestAvailableIssuePrefix/);
});

test('similar project names receive the next readable free prefix', () => {
  const projects = [
    { id: 'p1', name: 'Engineering', issuePrefix: 'ENG' },
    { id: 'p2', name: 'Engagement', issuePrefix: 'ENG2' },
  ];

  assert.equal(projectIssuePrefixTaken(projects, 'eng'), true);
  assert.equal(suggestAvailableIssuePrefix({ name: 'Engine' }, projects), 'ENG3');
  assert.equal(
    suggestAvailableIssuePrefix(
      { name: 'Long project', issuePrefix: 'ABCDEFGH' },
      [{ id: 'p3', issuePrefix: 'ABCDEFGH' }],
    ),
    'ABCDEFG2',
  );
  assert.equal(
    legacyStoredIssueKey('ENG3-12', { issuePrefix: 'ENG3', name: 'Engineering' }),
    'WS-12',
  );
});

test('project prefixes contain a letter and historical keys have deterministic ASCII successors', () => {
  assert.equal(isValidIssuePrefix('111'), false);
  assert.equal(isValidIssuePrefix('A111'), true);
  assert.equal(isValidIssuePrefix('МАЧ'), false);
  assert.equal(projectIssuePrefix({ name: '111', issuePrefix: '111' }), 'WS111');
  assert.equal(canonicalHistoricalIssueKey('МАЧ-1'), 'MACH-1');
  assert.equal(
    canonicalHistoricalIssueKey('МАЧ-1', { name: 'Мачете', issuePrefix: 'MAC' }),
    'MAC-1',
  );
  assert.equal(
    canonicalHistoricalIssueKey('111-2', { name: '111', issuePrefix: '111' }),
    'WS111-2',
  );
  assert.equal(canonicalHistoricalIssueKey('eng-12'), 'ENG-12');
});

test('task routes use the human issue key and still recognize old document-id links', () => {
  const issue = { id: 'firestore-symbols-123', projectId: 'project/one', issueKey: 'eng-12' };

  assert.equal(issuePath(issue), '/project%2Fone/issue/ENG-12');
  assert.equal(issueMatchesRouteIdentifier(issue, 'ENG-12'), true);
  assert.equal(issueMatchesRouteIdentifier(issue, 'eng-12'), true);
  assert.equal(issueMatchesRouteIdentifier(issue, 'firestore-symbols-123'), true);
  assert.equal(issueMatchesRouteIdentifier(issue, 'ENG-13'), false);
  assert.equal(issuePath({ id: 'legacy-id', projectId: 'project-1' }), '/project-1/issue/legacy-id');
  assert.equal(
    issuePath({ id: 'safe-doc-id', projectId: 'project-1', issueKey: 'МАЧ-1' }),
    '/project-1/issue/MACH-1',
  );
  assert.equal(
    issueMatchesRouteIdentifier(
      { id: 'safe-doc-id', projectId: 'project-1', issueKey: 'МАЧ-1' },
      'МАЧ-1',
    ),
    true,
  );

  const migratedIssue = {
    id: 'migrated-id',
    projectId: 'project-1',
    issueKey: 'MACH-1',
    legacyIssueKeys: ['МАЧ-1'],
  };
  assert.equal(issuePath(migratedIssue), '/project-1/issue/MACH-1');
  assert.equal(issueMatchesRouteIdentifier(migratedIssue, 'МАЧ-1'), true);
  assert.equal(issueMatchesRouteIdentifier(migratedIssue, 'MACH-1'), true);

  const legacyIssue = { id: 'old-doc', projectId: 'project-1', issueKey: 'WS-12' };
  const project = { id: 'project-1', name: 'Engineering', issuePrefix: 'ENG' };
  assert.equal(issuePath(legacyIssue, project), '/project-1/issue/ENG-12');
  assert.equal(issueMatchesRouteIdentifier(legacyIssue, 'ENG-12', project), true);
});

test('the task detail route resolves a key then canonicalizes legacy URLs', async () => {
  const detail = await read('../src/components/workspace/IssueDetail.jsx');
  assert.match(detail, /issueMatchesRouteIdentifier\(candidate, issueLocator, project\)/);
  assert.match(detail, /router\.replace\(`\$\{canonicalIssuePath\}/);
});

test('the historical key migration is explicit, dry-run-first and retry-safe', async () => {
  const [migration, documentation, packageJson] = await Promise.all([
    read('../scripts/migrate-issue-keys.mjs'),
    read('../docs/MIGRATIONS.md'),
    read('../package.json'),
  ]);

  assert.match(migration, /const APPLY = process\.argv\.includes\('--apply'\)/);
  assert.match(migration, /--confirm-project/);
  assert.match(migration, /--confirm-organization/);
  assert.match(migration, /--confirm-writes-frozen/);
  assert.match(migration, /collisions\.length > 0/);
  assert.match(migration, /legacyIssueKeys: operation\.targetAliases/);
  assert.match(migration, /liveKey !== operation\.sourceKey/);
  assert.doesNotMatch(migration, /onAuthStateChanged|signInWith/);
  assert.match(documentation, /dry-run/i);
  assert.match(packageJson, /"migrate:issue-keys"/);
});

test('YouTrack imports use the same ASCII prefix rules as every other writer', async () => {
  const importer = await read('../src/lib/server/youtrackImporter.js');

  assert.match(importer, /suggestAvailableIssuePrefix\(/);
  assert.match(importer, /resolveProjectIssuePrefixInTransaction\(/);
  assert.doesNotMatch(importer, /cleanProjectPrefix/);
  assert.doesNotMatch(importer, /А-ЯІЇЄҐ/);
});

test('search shows only persisted task IDs and never invents one from a document id', async () => {
  const [route, modal] = await Promise.all([
    read('../src/app/api/search/route.js'),
    read('../src/components/SearchModal.jsx'),
  ]);

  // The ladders moved into a pure module so the two rankings — asking the
  // workspace a question, and naming one row with `#` — can be argued with in
  // tests/search-ranking.test.mjs.
  const ranking = await read('../src/lib/utils/searchRanking.mjs');
  assert.match(ranking, /scoreField\(issue\.issueKey, term, WEIGHTS\.key\)/);
  assert.match(route, /scoreIssueMention\(issue, term\) : scoreIssue\(issue, term\)/);
  assert.match(route, /issueKey: taskDisplayKey\(storedIssue, projectsById\.get\(storedIssue\.projectId\)\)/);
  assert.match(modal, /issue\.issueKey \|\| 'Без ID'/);
  assert.doesNotMatch(modal, /issue\.id\.slice/);
});
