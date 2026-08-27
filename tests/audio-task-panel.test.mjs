import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// «Дзвінок → задачі» exists only inside CreateTaskModal. The old standalone
// route duplicated AudioTaskPanel and drifted away from the live composer.
test('the call-to-tasks screen exists once, as a tab in the task composer', () => {
  assert.equal(
    existsSync(join(ROOT, 'src/app/(app)/ai-call')),
    false,
    'the standalone /ai-call route is a duplicate of AudioTaskPanel and must stay deleted',
  );

  const modal = readFileSync(join(ROOT, 'src/components/CreateTaskModal.jsx'), 'utf8');
  assert.match(modal, /import AudioTaskPanel from '@\/components\/AudioTaskPanel'/);
  assert.match(modal, /<AudioTaskPanel/);
});

test('the call analysis shows every decision returned by AI', () => {
  const panel = readFileSync(join(ROOT, 'src/components/AudioTaskPanel.jsx'), 'utf8');

  assert.match(panel, /Array\.isArray\(result\.decisions\)/);
  assert.match(panel, />Рішення<\/p>/);
  assert.match(panel, /result\.decisions\.map\(\(decision, index\) =>/);
});
