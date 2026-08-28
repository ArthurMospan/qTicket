import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_TYPE_IDS,
  STATUS_LABELS,
  localizeBuiltInWorkflowItems,
} from '../src/lib/utils/workflowDefaults.mjs';
import {
  ORGANIZATION_ROLE_LABELS,
  organizationRoleLabel,
} from '../src/lib/utils/orgMembership.mjs';

test('built-in workflow labels localize by stable id without changing ids', () => {
  assert.deepEqual(
    localizeBuiltInWorkflowItems('statuses', [
      { id: 'backlog', label: 'Backlog' },
      { id: 'todo', label: 'To Do' },
      { id: 'in-progress', label: 'In Progress' },
      { id: 'done', label: 'Done', isDone: true },
    ]),
    [
      { id: 'backlog', label: 'Новий' },
      { id: 'todo', label: 'Прийнято' },
      { id: 'in-progress', label: 'У роботі' },
      { id: 'done', label: 'Вирішено', isDone: true },
    ],
  );
  assert.equal(STATUS_LABELS.backlog, 'Новий');
  assert.deepEqual(DEFAULT_TYPE_IDS, ['task', 'feature', 'bug']);
});

test('workflow localization never rewrites a custom id with a familiar label', () => {
  const custom = [
    { id: 'customer-bug', label: 'Bug' },
    { id: 'brand-design', label: 'Design' },
  ];
  assert.deepEqual(localizeBuiltInWorkflowItems('labels', custom), custom);
});

test('legacy built-in positions localize while custom positions remain intact', () => {
  assert.deepEqual(
    localizeBuiltInWorkflowItems('positions', [
      { id: 'dev', label: 'Developer', hourlyRate: 30 },
      { id: 'designer', label: 'Designer', hourlyRate: 35 },
      { id: 'pm', label: 'Project Manager', hourlyRate: 40 },
      { id: 'custom-pm', label: 'Project Manager', hourlyRate: 50 },
    ]),
    [
      { id: 'dev', label: 'Розробник', hourlyRate: 30 },
      { id: 'designer', label: 'Дизайнер', hourlyRate: 35 },
      { id: 'pm', label: 'PM', hourlyRate: 40 },
      { id: 'custom-pm', label: 'Project Manager', hourlyRate: 50 },
    ],
  );
});

// A role has a stored id and a written name, and only one of them is Ukrainian.
//
// `owner`, `admin` and `member` are business semantics that rules, routes and
// `can.js` key off; what a person reads is a separate thing. It was written out
// by hand in four files with three different words — «Адміністратор» in the
// settings, «Адмін» on a project's team tab, and nothing at all in the
// organization switcher, which printed the raw `owner` capitalised into
// English. One map now, because a workspace that calls the same role three
// things depending on the screen is a workspace nobody can describe.
test('an organization role is written in one place, in Ukrainian', async () => {
  assert.deepEqual(ORGANIZATION_ROLE_LABELS, {
    owner: 'Власник',
    admin: 'Адміністратор',
    member: 'Менеджер підтримки',
    client_admin: 'Адміністратор клієнта',
    client_member: 'Співробітник клієнта',
  });
  assert.equal(organizationRoleLabel('owner'), 'Власник');
  assert.equal(organizationRoleLabel('admin'), 'Адміністратор');
  // An unknown or missing role reads as the least privileged thing it could be,
  // never as a raw id.
  assert.equal(organizationRoleLabel('member'), 'Менеджер підтримки');
  assert.equal(organizationRoleLabel(undefined), 'Менеджер підтримки');
  assert.equal(organizationRoleLabel('archivist'), 'Менеджер підтримки');

  for (const path of [
    'src/components/OrgSwitcherScreen.jsx',
    'src/app/(app)/settings/page.js',
    'src/components/workspace/HoverCard.jsx',
  ]) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(source, /orgMembership\.mjs/, `${path} must take the label from the shared map`);
    assert.doesNotMatch(
      source,
      /'Адмін'/,
      `${path} must not shorten «Адміністратор» on its own account`,
    );
  }

  // And the switcher takes the role from membership, which is where access
  // lives — not from the `members` array denormalized onto the organization
  // document, which nothing maintains any more. Reading that array is how the
  // owner of a workspace came to be labelled a participant in it.
  const switcher = await readFile(
    new URL('../src/components/OrgSwitcherScreen.jsx', import.meta.url),
    'utf8',
  );
  assert.match(switcher, /organizationRoleLabel\(orgRoles\?\.\[org\.id\]\)/);
  assert.doesNotMatch(switcher, /org\.members\?\./);
  // Nothing is title-cased on the way to the screen either — that was the CSS
  // turning `owner` into `Owner`.
  assert.doesNotMatch(switcher, /className="[^"]*\bcapitalize\b/);

  const context = await readFile(
    new URL('../src/lib/context/OrgContext.js', import.meta.url),
    'utf8',
  );
  // The map is keyed off the membership documents themselves and handed to the
  // provider whole, so a workspace still waiting for its organization document
  // is labelled with the role its membership already states.
  assert.match(context, /const \{ organizations, roles \} = buildOrganizationList\(memberships, documents, publishedOrgs\);/);
  assert.match(context, /setOrgRoles\(roles\);/);
  assert.match(context, /allOrgs, orgRoles, activeOrgId/);

  const organizationList = await readFile(
    new URL('../src/lib/utils/organizationList.mjs', import.meta.url),
    'utf8',
  );
  assert.match(organizationList, /if \(membership\.role\) roles\[orgId\] = membership\.role;/);
});
