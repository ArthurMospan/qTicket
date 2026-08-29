import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_SYSTEM_PRIORITIES,
  NO_PRIORITY_ID,
  priorityPresentation,
} from '../src/lib/utils/priorities.mjs';

test('priority presentation keeps the configured semantic colour', () => {
  assert.equal(priorityPresentation('medium', DEFAULT_SYSTEM_PRIORITIES).color, '#eab308');
  assert.equal(priorityPresentation('high', DEFAULT_SYSTEM_PRIORITIES).color, '#f97316');
  assert.equal(priorityPresentation('low', DEFAULT_SYSTEM_PRIORITIES).color, '#9a9a9a');
});

test('ranked priority uses a solid dot and no priority uses a dashed ring', () => {
  const icon = readFileSync(new URL('../src/components/ui/DataDisplay/PriorityIcon.jsx', import.meta.url), 'utf8');
  assert.match(icon, /r="5\.5" fill=\{config\.color\} fillOpacity="0\.4"/);
  assert.match(icon, /r="2\.5" fill=\{config\.color\}/);
  assert.match(icon, /if \(config\.isNoPriority\)/);
  assert.match(icon, /NO_PRIORITY_OUTER_RADIUS = 5\.5/);
  assert.match(icon, /NO_PRIORITY_STROKE_WIDTH = 0\.8/);
  assert.match(icon, /NO_PRIORITY_PATH_RADIUS = NO_PRIORITY_OUTER_RADIUS - \(NO_PRIORITY_STROKE_WIDTH \/ 2\)/);
  assert.match(icon, /strokeDasharray="0\.8 1\.6"/);
  assert.match(icon, /opacity="0\.32"/);
  assert.doesNotMatch(icon, /outerColor|innerColor/);
});

// Explicit, missing, and stale all mean the same thing to a reader: nobody
// ranked this. `priorityPresentation` is the one place that decides it, so an
// id pointing at a priority somebody deleted resolves to the unranked bucket
// rather than to nothing at all.
test('explicit, missing, and stale priorities all read as the unranked bucket', () => {
  assert.equal(priorityPresentation(NO_PRIORITY_ID, DEFAULT_SYSTEM_PRIORITIES).id, NO_PRIORITY_ID);
  assert.equal(priorityPresentation(undefined, DEFAULT_SYSTEM_PRIORITIES).id, NO_PRIORITY_ID);
  assert.equal(priorityPresentation('deleted-custom-priority', DEFAULT_SYSTEM_PRIORITIES).id, NO_PRIORITY_ID);
});

// Nothing said about priority means no priority.
//
// «Середній» used to be the default in nine places — the create form, four
// quick-create call sites, the server that overwrote whatever arrived, the
// public API (which defaulted to «Високий»), and Telegram. Defaulting to the
// middle of the scale is not a neutral choice: it is a claim made on the
// author's behalf about work nobody has ranked, and it made «Середній» the
// most common priority in a workspace while meaning nothing at all.
//
// `none` is a real selectable value that every reader already understands, so
// it is what an unranked task gets — and it has to be the answer on every path
// that creates one, or the default depends on which button you pressed.
test('no path that creates a task invents a priority for it', async () => {
  const paths = [
    'src/components/CreateTaskModal.jsx',
    'src/app/(app)/page.js',
    'src/app/(app)/my/page.js',
    'src/app/(app)/[projectId]/ProjectBoardClient.jsx',
    'src/components/workspace/IssueDetail.jsx',
    'src/app/api/issues/route.js',
  ];
  for (const path of paths) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    // A fallback to medium, not a mention of it: `case 'medium'` in a colour
    // table is the id doing its job.
    assert.doesNotMatch(
      source,
      /\|\| 'medium'|priority: 'medium'|\? 'medium'/,
      `${path} still falls back to «Середній» for a task nobody ranked`,
    );
  }

  // The server is the one that decides, because it is the only place a client
  // cannot go around — it used to rewrite an unranked task to `medium` even
  // when the form sent `none`.
  const route = await readFile(new URL('../src/app/api/issues/route.js', import.meta.url), 'utf8');
  assert.match(route, /priority: freshPriorityIds\.has\(data\.priority\) \? data\.priority : NO_PRIORITY_ID/);
  assert.match(route, /freshPriorityIds\.add\(NO_PRIORITY_ID\)/);
  assert.equal(NO_PRIORITY_ID, 'none');
});
