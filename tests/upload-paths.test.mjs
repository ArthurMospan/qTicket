import test from 'node:test';
import assert from 'node:assert/strict';

// These are the checks standing between one tenant and another tenant's files:
// /api/upload/delete derives the owning organization from the path alone, so a
// caller can never widen their own scope by naming a different organizationId.
import {
  isOrganizationChatStoragePath,
  isOrganizationChatUploadFolder,
  isSafeStoragePath,
  isSafeUploadFolder,
  organizationIdFromPath,
} from '../src/lib/utils/uploadPaths.mjs';

test('the organization is read out of the storage path, never from the caller', () => {
  assert.equal(
    organizationIdFromPath('quickteam/organizations/org-a/attachments/1699_file'),
    'org-a',
  );
  assert.equal(organizationIdFromPath('quickteam/organizations/org-a'), 'org-a');
  assert.equal(organizationIdFromPath('quickteam/organizations/org-a/chat/x'), 'org-a');
});

test('paths that prove no ownership yield no organization', () => {
  // Legacy, non-scoped uploads: the delete route refuses these outright rather
  // than letting anyone claim them.
  for (const path of [
    'quickteam/avatars/1699_face',
    'quickteam/chat/attachments/1699_file',
    'organizations/org-a/attachments/x',
    '',
    null,
    undefined,
  ]) {
    assert.equal(organizationIdFromPath(path), '', String(path));
  }
});

test('a traversal or injected segment cannot smuggle in another tenant', () => {
  // The id segment is a single path component; anything with a separator or an
  // unexpected character fails the whole match instead of matching a prefix.
  assert.equal(organizationIdFromPath('quickteam/organizations/../../etc/passwd'), '');
  assert.equal(organizationIdFromPath('quickteam/organizations/org-a$evil/attachments/x'), '');
  assert.equal(organizationIdFromPath('evil/quickteam/organizations/org-a/x'), '');
  // A different tenant's id is reported as that tenant, so the membership check
  // is the thing that rejects it — not a silent match on the caller's own org.
  assert.equal(organizationIdFromPath('quickteam/organizations/org-b/attachments/x'), 'org-b');
});

test('upload folders must live under the app namespace', () => {
  assert.equal(isSafeUploadFolder('quickteam/organizations/org-a/attachments'), true);
  assert.equal(isSafeUploadFolder('quickteam/avatars'), true);
  assert.equal(isSafeUploadFolder('other-app/organizations/org-a'), false);
  assert.equal(isSafeUploadFolder('quickteam/../other'), false);
  assert.equal(isSafeUploadFolder(''), false);
  assert.equal(isSafeUploadFolder(null), false);
});

test('storage paths are validated before reaching the delete API', () => {
  assert.equal(isSafeStoragePath('quickteam/organizations/org-a/attachments/1699_f'), true);
  assert.equal(isSafeStoragePath('quickteam/' + 'a'.repeat(400)), false);
  assert.equal(isSafeStoragePath('../../secrets'), false);
  assert.equal(isSafeStoragePath('quickteam/a b'), false);
  assert.equal(isSafeStoragePath(42), false);
});

test('private chat paths are exact and organization-scoped', () => {
  assert.equal(
    isOrganizationChatUploadFolder('quickteam/organizations/org-a/chat', 'org-a'),
    true,
  );
  assert.equal(
    isOrganizationChatUploadFolder('quickteam/organizations/org-a/chat/files', 'org-a'),
    false,
  );
  assert.equal(
    isOrganizationChatStoragePath('quickteam/organizations/org-a/chat/1699_file', 'org-a'),
    true,
  );
  assert.equal(
    isOrganizationChatStoragePath('quickteam/organizations/org-a/chat/1699_file', 'org-b'),
    false,
  );
  assert.equal(
    isOrganizationChatStoragePath('quickteam/chat/attachments/1699_file', 'org-a'),
    false,
  );
});

// Розмір, який назвав браузер, і розмір, який він насправді надсилає.
//
// `uploadFilePolicy` читає `params.file` — `{ name, size, type }` зі слів
// клієнта. Підпис при цьому покриває формат і не покриває розмір, тож клієнт,
// який оголосив «1 КБ» і надіслав 500 МБ, проходить усе. Стеля в Cloudinary
// живе на upload preset, а підписаний `upload_preset` — це те, що привʼязує її
// до нашого підпису.
test('ліміт розміру вмикається пресетом і обидві сторони збігаються', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

  const route = await read('src/app/api/upload/sign/route.js');
  const client = await read('src/lib/services/fileUpload.js');

  // Підписується, а не просто надсилається: поле поза підписом Cloudinary
  // відхиляє, і саме це робить ліміт неоминним.
  assert.match(route, /upload_preset: uploadPreset/);
  assert.match(route, /process\.env\.CLOUDINARY_UPLOAD_PRESET/);

  // Умовно з обох боків. Без змінної поведінка рівно попередня — інакше це була
  // б зміна, що ламає завантаження, доки хтось не зайде в консоль.
  assert.match(route, /\.\.\.\(uploadPreset \? \{ upload_preset: uploadPreset \} : \{\}\)/);
  assert.match(client, /if \(uploadPreset\) formData\.append\('upload_preset', uploadPreset\)/);

  // І сервер має повернути назву клієнтові, інакше той нічого не додасть.
  assert.match(route, /\.\.\.\(uploadPreset \? \{ uploadPreset \} : \{\}\)/);
});
