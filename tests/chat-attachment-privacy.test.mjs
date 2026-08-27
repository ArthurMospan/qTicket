import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('new chat files are authenticated assets without a stored public URL', async () => {
  const [signRoute, uploadService, uploadWrapper] = await Promise.all([
    read('../src/app/api/upload/sign/route.js'),
    read('../src/lib/services/fileUpload.js'),
    read('../src/lib/utils/uploadFile.js'),
  ]);

  assert.match(signRoute, /isOrganizationChatUploadFolder\(folder, organizationId\)/);
  assert.match(signRoute, /deliveryType = [\s\S]*?'authenticated'[\s\S]*?: 'upload'/);
  assert.match(signRoute, /type: deliveryType/);
  assert.match(uploadService, /formData\.append\('type', deliveryType\)/);
  assert.match(uploadWrapper, /url: deliveryType === 'authenticated' \? '' : downloadUrl/);
  assert.match(uploadWrapper, /deliveryType,/);
  assert.match(uploadWrapper, /format,/);
});

test('signed chat delivery verifies membership and the stored message attachment', async () => {
  const [route, hook, chatHook] = await Promise.all([
    read('../src/app/api/chat/attachments/access/route.js'),
    read('../src/lib/hooks/useChatAttachmentAccess.js'),
    read('../src/lib/hooks/useWorkspaceChat.js'),
  ]);

  assert.match(route, /authorizeOrgRequest\(request, organizationId\)/);
  assert.match(route, /canAccessChatChannel\(channel, authorization\.user\.uid\)/);
  assert.match(route, /messageSnapshot\.data\(\)\?\.attachments\?\.\[attachmentIndex\]/);
  assert.match(route, /isOrganizationChatStoragePath\(attachment\.storagePath, organizationId\)/);
  assert.match(route, /private_download_url\(/);
  assert.match(route, /type: 'authenticated'/);
  assert.match(route, /'Cache-Control': 'private, no-store'/);
  assert.match(hook, /Authorization: `Bearer \$\{token\}`/);
  assert.match(hook, /fetch\('\/api\/chat\/attachments\/access'/);
  assert.match(chatHook, /attachment\?\.deliveryType === 'authenticated'/);
  assert.match(chatHook, /attachmentIndex,/);
});

test('authenticated chat assets are deleted with their delivery type', async () => {
  const [deleteRoute, uploadService, chatHook] = await Promise.all([
    read('../src/app/api/upload/delete/route.js'),
    read('../src/lib/services/fileUpload.js'),
    read('../src/lib/hooks/useWorkspaceChat.js'),
  ]);

  assert.match(deleteRoute, /type: assetDeliveryType/);
  assert.match(deleteRoute, /isOrganizationChatStoragePath\(storagePath, organizationId\)/);
  assert.match(uploadService, /JSON\.stringify\(\{ storagePath, resourceType, deliveryType \}\)/);
  assert.match(chatHook, /item\.deliveryType/);
});

test('chat attachment migration is explicit, dry-run-first and retry-safe', async () => {
  const [migration, packageJson, documentation] = await Promise.all([
    read('../scripts/migrate-chat-attachments.mjs'),
    read('../package.json'),
    read('../docs/MIGRATIONS.md'),
  ]);

  assert.match(migration, /const APPLY = process\.argv\.includes\('--apply'\)/);
  assert.match(migration, /--confirm-project/);
  assert.match(migration, /--confirm-organization/);
  assert.match(migration, /--confirm-writes-frozen/);
  assert.match(migration, /authenticatedAsset\(operation\.destinationPath/);
  assert.match(migration, /JSON\.stringify\(liveAttachments\) !== JSON\.stringify\(plan\.sourceAttachments\)/);
  assert.match(packageJson, /"migrate:chat-attachments"/);
  assert.match(documentation, /Dry-run is the default/);
});
