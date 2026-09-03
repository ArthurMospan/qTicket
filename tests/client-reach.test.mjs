import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clientMayDeleteStoragePath } from '../src/lib/utils/uploadPaths.mjs';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// A customer is a member of the tenant, and three server routes took «member
// of the tenant» for «may do this to anything in the tenant». Each of these
// holds the line the route now draws.

// The content PATCH accepted any value for a whitelisted key — a title that was
// an object, a description of any length, a customer naming somebody off their
// space, support assigning somebody who cannot open the request — where the
// create route refused every one of them.
test('the content PATCH holds the bounds the create route holds', async () => {
  const [patch, create] = await Promise.all([
    source('src/app/api/issues/[issueId]/route.js'),
    source('src/app/api/issues/route.js'),
  ]);
  assert.match(patch, /patch\.title\.trim\(\)\.length > 240/);
  assert.match(patch, /patch\.description = patch\.description\.slice\(0, 50_000\)/);
  assert.match(create, /data\.title\.trim\(\)\.length > 240/);
  assert.match(create, /data\.description\.slice\(0, 50_000\)/);
  assert.match(patch, /patch\.type === 'epic' && issue\.type !== 'epic'/);
  assert.match(patch, /code: 'LEGACY_EPIC_TYPE'/);
  assert.match(patch, /'CLIENT_ASSIGNEE_OUTSIDE_PROJECT'/);
  assert.match(patch, /assigneesOutsideProject\(project, patch\.assigneeIds/);
  assert.match(patch, /'ASSIGNEE_NOT_MEMBER'/);
  // Priority and labels are read off the workflow the transaction itself reads.
  const transaction = patch.slice(patch.indexOf('await db.runTransaction'), patch.indexOf('transaction.update(issueRef'));
  assert.match(transaction, /\.collection\('settings'\)\.doc\('workflow'\)/);
  assert.match(transaction, /priorityIds\.add\(NO_PRIORITY_ID\)/);
  assert.match(transaction, /patch\.labelIds\.filter\(id => labelIds\.has\(id\)\)\.slice\(0, 20\)/);
  // And every check sits before the write.
  assert.ok(transaction.indexOf('CLIENT_ASSIGNEE_OUTSIDE_PROJECT') < transaction.length);
});

// The Cloudinary delete route asked only «member of this tenant?» — which a
// customer is — so a client could name the desk's logo or an agent's avatar by
// the public id every URL carries. A client reaches the folders their own
// files go to and nothing else.
test('a client deletes files only where their own files go', async () => {
  const route = await source('src/app/api/upload/delete/route.js');
  assert.match(route, /isClientRole\(membership\.role\) && !clientMayDeleteStoragePath\(storagePath\)/);
  // A Cloudinary public id carries no extension, and the safe-path rule
  // admits no dot — the same alphabet the upload signer accepts.
  assert.ok(clientMayDeleteStoragePath('quickteam/organizations/qto_1/attachments/1725000000000_scan'));
  assert.ok(clientMayDeleteStoragePath('quickteam/organizations/qto_1/comments/1725000000000_photo'));
  assert.ok(!clientMayDeleteStoragePath('quickteam/organizations/qto_1/logos/desk'));
  assert.ok(!clientMayDeleteStoragePath('quickteam/organizations/qto_1/avatars/agent'));
  assert.ok(!clientMayDeleteStoragePath('quickteam/organizations/qto_1/attachments'));
  assert.ok(!clientMayDeleteStoragePath('quickteam/organizations/qto_1/attachmentsx/file'));
  assert.ok(!clientMayDeleteStoragePath('quickteam/shared/attachments/file'));
});

// The notification route took any requestable type from anybody, with any words,
// to fifty people on every channel. A customer's screens send two kinds; the
// rest are the desk's.
test('a client asks for the two notification kinds the conversation sends, and a test goes to oneself', async () => {
  const route = await source('src/app/api/notifications/route.js');
  assert.match(route, /const CLIENT_REQUESTABLE_TYPES = new Set\(\['commented', 'mentioned'\]\)/);
  assert.match(route, /isClientRole\(authorization\.membership\?\.role\) && !CLIENT_REQUESTABLE_TYPES\.has\(type\)/);
  assert.match(route, /type === 'test' && \(userIds\.length !== 1 \|\| userIds\[0\] !== authorization\.user\.uid\)/);
  // The two kinds are exactly what the customer-facing timeline sends.
  const timeline = await source('src/components/workspace/UnifiedTimeline.jsx');
  const sent = [...timeline.matchAll(/sendNotification\(\{[\s\S]*?type: '([a-z_]+)'/g)].map(match => match[1]);
  assert.ok(sent.length > 0);
  for (const type of sent) assert.ok(['commented', 'mentioned'].includes(type), type);
});
