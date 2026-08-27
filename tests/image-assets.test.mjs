import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  cloudinaryAssetFromUrl,
  organizationImageFolder,
  organizationOwnedImageAsset,
} from '../src/lib/utils/cloudinaryAssets.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('Cloudinary delivery transformations do not hide the deletable public id', () => {
  assert.deepEqual(
    cloudinaryAssetFromUrl(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/v123/quickteam/organizations/org-a/avatars/123_face.jpg',
    ),
    {
      storagePath: 'quickteam/organizations/org-a/avatars/123_face',
      resourceType: 'image',
    },
  );
  assert.equal(cloudinaryAssetFromUrl('https://example.com/avatar.jpg'), null);
  assert.equal(cloudinaryAssetFromUrl('not a URL'), null);
});

test('image folders and deletions are constrained to the active organization', () => {
  assert.equal(
    organizationImageFolder('org-a', 'logos'),
    'quickteam/organizations/org-a/logos',
  );
  assert.throws(() => organizationImageFolder('../org-a', 'avatars'));
  assert.throws(() => organizationImageFolder('org-a', 'attachments'));

  const asset = {
    value: 'https://res.cloudinary.com/demo/image/upload/v1/quickteam/organizations/org-a/logos/logo.png',
  };
  assert.equal(organizationOwnedImageAsset(asset, 'org-a')?.storagePath, 'quickteam/organizations/org-a/logos/logo');
  assert.equal(organizationOwnedImageAsset(asset, 'org-b'), null);
});

test('ImageUpload persists storage metadata and performs a real delete', async () => {
  const [component, signingRoute, uploadService] = await Promise.all([
    read('../src/components/ui/ImageUpload.jsx'),
    read('../src/app/api/upload/sign/route.js'),
    read('../src/lib/services/fileUpload.js'),
  ]);

  assert.match(component, /organizationImageFolder\(organizationId, kind\)/);
  assert.match(component, /await deleteFileFromCloudinary\(asset\.storagePath, asset\.resourceType\)/);
  assert.match(component, /await onChange\('', \{ storagePath: '', resourceType: '' \}\)/);
  assert.match(signingRoute, /if \(!organizationId\)/);
  assert.doesNotMatch(uploadService, /folder = 'quickteam\/avatars'/);
});

test('the image migration is explicit, dry-run-first and retry-safe', async () => {
  const migration = await read('../scripts/migrate-image-assets.mjs');

  assert.match(migration, /const APPLY = process\.argv\.includes\('--apply'\)/);
  assert.match(migration, /--confirm-project/);
  assert.match(migration, /--confirm-organization/);
  assert.match(migration, /--confirm-writes-frozen/);
  assert.match(migration, /existingCloudinaryAsset/);
  assert.match(migration, /liveData\[operation\.urlField\] !== operation\.sourceUrl/);
  assert.doesNotMatch(migration, /onAuthStateChanged|signInWith/);
});
