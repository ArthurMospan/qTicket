import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isStaleDeploymentError } from '../src/lib/utils/errors.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

// A tab left open across a deploy asks for route chunks that have left the CDN.
// The pages already rendered keep working and every navigation out of them
// fails, which is reported as «half the site stopped loading» and is cured by
// reopening the tab — so it is never reported as what it is. The boundary now
// recognises it and reloads once instead of offering a Retry that asks the same
// missing file for itself again.

test('a stale build is recognised however the engine words it', () => {
  // webpack's own class, which is what Next throws most often.
  const chunk = new Error('Loading chunk 4821 failed.');
  chunk.name = 'ChunkLoadError';
  assert.equal(isStaleDeploymentError(chunk), true);

  // The same failure without the name, and the three module-script wordings the
  // engines disagree about.
  assert.equal(isStaleDeploymentError(new Error('Loading chunk app-layout failed.')), true);
  assert.equal(isStaleDeploymentError(new Error('Failed to fetch dynamically imported module: https://x/_next/static/chunks/9.js')), true);
  assert.equal(isStaleDeploymentError(new Error('Importing a module script failed.')), true);
  assert.equal(isStaleDeploymentError(new Error('error loading dynamically imported module')), true);
});

test('an ordinary failure is not mistaken for one, or the boundary would reload on every bug', () => {
  assert.equal(isStaleDeploymentError(null), false);
  assert.equal(isStaleDeploymentError(undefined), false);
  assert.equal(isStaleDeploymentError(new Error('Missing or insufficient permissions.')), false);
  assert.equal(isStaleDeploymentError(new Error('Quota exceeded.')), false);
  assert.equal(isStaleDeploymentError(new Error('Cannot read properties of undefined')), false);
  // The word alone is not the failure: a chunk mentioned in passing must not
  // trigger a reload.
  assert.equal(isStaleDeploymentError(new Error('chunk size above budget')), false);
});

test('the boundary reloads once and only once', async () => {
  const boundary = await read('../src/app/(app)/error.js');

  // It asks about the cause too: the thrown error is often a wrapper.
  assert.match(boundary, /isStaleDeploymentError(error)s*||s*isStaleDeploymentError(error?.cause)/);
  // A hard reload, because the build this page wants no longer exists — there is
  // nothing for React's own retry to re-render.
  assert.match(boundary, /window.location.reload()/);
  // And a mark that survives the reload, so a deploy that is genuinely broken
  // shows the boundary the second time instead of spinning.
  assert.match(boundary, /sessionStorage/);
  assert.match(boundary, /qt-stale-deployment-reload/);
  // The mark is written BEFORE the reload, or the guard never takes effect.
  const guard = boundary.slice(boundary.indexOf('qt-stale-deployment-reload'));
  assert.ok(
    guard.indexOf('setItem') < guard.indexOf('window.location.reload()'),
    'the session mark has to be written before the reload, or the page loops',
  );
  // Storage can throw (private mode); the boundary must still render then.
  assert.match(boundary, /catch/);
});
