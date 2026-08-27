import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const projectPage = readFileSync(new URL('../src/app/(app)/page.js', import.meta.url), 'utf8');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('project cards keep the familiar team-first composition', () => {
  assert.match(projectPage, /project\.team \|\| \[\][\s\S]{0,500}<UserAvatar/);
  assert.match(projectPage, /md:col-span-2 md:row-span-2/);
  assert.doesNotMatch(projectPage, />Ви в команді</);
  assert.doesNotMatch(projectPage, />Внутрішній</);
  assert.doesNotMatch(projectPage, />Спільний</);
  // A face in the stack says whose it is on hover; nothing else on the card
  // names the project's people.
  assert.match(projectPage, /<UserAvatar key=\{uid\}[^/]*tooltip/);
});

test('a small card carries nothing under its description', () => {
  // A row of counts, then a status band: both were numbers in a place too small
  // to say what they were numbers of, on the screen you pass through rather
  // than the one you read. The project's own board answers all of it in a click.
  assert.match(projectPage, /if \(!isLarge\) return null;/);
  assert.doesNotMatch(projectPage, /ProjectStatusBand/);
  assert.doesNotMatch(projectPage, /STATUS_CATEGORY_IDS/);
  assert.doesNotMatch(projectPage, /\{stats\.overdue\}/);
  assert.doesNotMatch(projectPage, /\{stats\.active\}/);
  // (`stats.total` still exists on this page and is not the card's: it is how
  // many projects the plan allows, read by the new-project dialog.)
  assert.doesNotMatch(projectPage, /AtSign/);
});

test('the featured card shows the last three actions, not one', () => {
  assert.match(projectPage, /const RECENT_ACTIONS = 3;/);
  // Three is now the query's limit rather than a slice after the fact: the card
  // asks Firestore for three documents of this project instead of filtering
  // them out of every task in the workspace. A small card asks for none.
  assert.match(projectPage, /isLarge \? RECENT_ACTIONS : 0/);
  assert.match(projectPage, /useProjectActivity\(/);
  // Ordered by what the activity record says, never `updatedAt`: a card whose
  // position was renumbered by somebody else's drag had its document written
  // and nothing else.
  assert.match(projectPage, /issueActivity\(issue\)/);
  assert.match(projectPage, /recentActions\.map\(action =>/);
  // Being named is still on the card, above the actions — those are things
  // other people did, this is a thing addressed to you.
  assert.match(projectPage, /<TaskCounters mentions=\{mentionCount\}/);
});

test('an action row is a target, and looks like one under the pointer', () => {
  // The whole row links to the task; only the title used to, with nothing on
  // the card saying so, so the block behaved like a caption you could hit by
  // accident.
  assert.match(projectPage, /recentActions\.map\(action => \([\s\S]{0,900}<Link/);
  // And the hover is visible. A row sitting on `canvas` that hovered to
  // `canvas` was a transition whose two ends were four points apart on a
  // 255-point scale — a hover you could not see. One step darker is one you
  // can point at.
  assert.match(projectPage, /bg-canvas[^"]*hover:bg-line/);
  assert.doesNotMatch(projectPage, /hover:bg-canvas/);
});

// «@ 3» on a project card, end to end.
//
// The counter has been on the card the whole time and had never once been seen,
// which is the same evidence for "it is broken" as for "nobody has been named
// in a task lately". So the contract is pinned instead of argued about: the
// three places that have to agree on one notification shape are read together,
// and if any of them stops carrying the project, this fails rather than the
// card quietly going blank for another few months.
test('a mention in a task counts towards its project on the dashboard', () => {
  const timeline = read('../src/components/workspace/UnifiedTimeline.jsx');
  const route = read('../src/app/api/notifications/route.js');

  // 1. The task chat says which project it is naming you in.
  assert.match(timeline, /type: 'mentioned',[\s\S]{0,300}projectId,/);
  // 2. The route that writes the document keeps that field.
  assert.match(route, /const projectId = cleanText\(payload\.projectId, 128\)/);
  assert.match(route, /type, title, body, link: scopedLink, issueId, projectId, organizationId/);
  // 3. The card counts exactly that, unread, in this organization — no other
  //    notification type, and never one belonging to a different workspace.
  assert.match(projectPage, /!item\.read[\s\S]{0,120}item\.type === 'mentioned'[\s\S]{0,120}item\.projectId === project\.id[\s\S]{0,120}item\.organizationId === activeOrgId/);
  // And it is drawn by the task card's own mark, so being named looks the same
  // wherever it is counted.
  assert.match(projectPage, /<TaskCounters mentions=\{mentionCount\}/);
});
