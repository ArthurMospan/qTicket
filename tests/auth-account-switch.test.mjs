import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('overlapping auth callbacks cannot publish the previous account', async () => {
  const source = await read('../src/lib/hooks/useAuth.js');
  assert.match(source, /const generation = \+\+authGeneration;/);
  assert.match(source, /const isCurrent = \(\) => !cancelled && generation === authGeneration;/);
  assert.match(source, /if \(!isCurrent\(\)\) return;[\s\S]*setUser\(fallbackProfile\)/);
  assert.match(source, /if \(!isCurrent\(\) \|\| !docSnap\.exists\(\)\) return;/);
  assert.match(source, /sessionUserRef\.current !== firebaseUser\.uid/);
  assert.match(source, /setUser\(null\);[\s\S]*setLoading\(true\);/);
});

test('server-session cookie exchanges finish in account-change order', async () => {
  const source = await read('../src/lib/hooks/useAuth.js');
  assert.match(source, /let sessionSyncChain = Promise\.resolve\(\);/);
  assert.match(source, /sessionSyncChain\.catch\(\(\) => \{\}\)\.then\(synchronize\)/);
  assert.match(source, /sessionSyncChain = queuedSync;[\s\S]*await queuedSync;/);
});

test('sign-out clears tab-scoped organization intent', async () => {
  const source = await read('../src/lib/hooks/useAuth.js');
  assert.match(source, /sessionStorage\.removeItem\('qt_active_org_id'\)/);
});
