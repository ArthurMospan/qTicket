import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

// A project's own numbers, on a tab of their own.
//
// This narrows the «не другий дашборд» guardrail rather than breaking it. That
// rule was about counter tiles standing over a board and answering the question
// its columns already answer. Numbers about *one* customer are a question
// «Огляд» cannot answer at all, because it counts every customer at once — and
// nobody opens a tab named «Аналітика» by accident.
test('the project carries an analytics tab, and no tiles over the board', async () => {
  const page = await read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx');

  assert.match(page, /\{ id: 'analytics', label: 'Аналітика' \}/);
  assert.match(page, /activeTab === 'analytics' && \(/);

  // Still no tiles above the queue: the KPI cards live behind the tab, and the
  // incidents branch goes straight from the filters to the board.
  const incidents = page.slice(page.indexOf("activeTab === 'incidents' && ("), page.indexOf("activeTab === 'analytics' && ("));
  assert.doesNotMatch(incidents, /<KpiCard/);

  // No counts beside the tabs at all. They counted what the tab you are
  // standing on already shows, and on the tab you are not standing on they
  // reported a filtered number whose rule is on another screen.
  assert.match(page, /const tabs = PROJECT_TABS;/);
  assert.doesNotMatch(page, /projectMembers\.length : undefined/);
  assert.doesNotMatch(page, /count: tab\.id === 'incidents'/);
});

// A gap is drawn by a box, and a box with nothing in it is still a box.
test('the header draws no action group for a role that holds no action', async () => {
  const page = await read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx');

  // Every control in that group belongs to somebody: the gear to whoever may
  // change the project, «Створити звернення» to the customer and only the
  // customer. A «Менеджер підтримки» holds neither, and the group rendered
  // anyway — an empty flex item, zero pixels wide, still taking the row's 8px
  // gap, so the tabs stopped 40px from the edge while the view switcher
  // directly under them stopped at the page's own 32px.
  assert.match(
    page,
    /actions=\{\(canManageProject && !clientViewer\) \|\| canOpenIncident \? \(/,
  );
  assert.doesNotMatch(page, /actions=\{\(\s+<div className="flex items-center gap-2">/);
});

test('the numbers are measured, never promised, and never leak the other customers', async () => {
  const page = await read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx');

  // Cycle time is how long requests have actually taken. qTicket promises no
  // resolution time — the owner rejected SLAs outright — so nothing here is a
  // target, and the sample size is on the card because a median of two requests
  // is not a fact about a desk.
  assert.match(page, /summarizeCycleTimes\(issues, reliableCompletedAtMillis\)/);
  assert.match(page, /analytics\.cycle\.sampleSize/);
  // The label says «медіанний час до вирішення» — what happened — and not a
  // target. Asked of the label rather than of the file: the comment beside it
  // explains why there is no SLA here, and a note about an absent feature is
  // not the feature.
  assert.match(page, /label="Медіанний час до вирішення"/);

  // «Чекають на нас» is support's question and «Чекають на вас» is the
  // customer's — one predicate, read from two chairs, and neither says which
  // agent owes the answer.
  assert.match(page, /clientViewer \? analytics\.metrics\.waitingOnClient : analytics\.metrics\.waitingOnUs/);

  // Everything is derived from the requests this screen already streams: one
  // customer's project, never the organization's whole queue.
  assert.match(page, /const analytics = useMemo\(/);
  assert.doesNotMatch(page, /useOrganizationIssues|useAllMyTasks/);
});

test('a distribution row is a label, a proportional bar and a count', async () => {
  const bar = await read('../src/components/ui/Charts/DistributionBar.jsx');

  // Scaled against the largest bucket rather than the total: a 60/20/20 split
  // reads as one full bar and two thirds, where against the total it would be
  // three stubs saying only «none of these is most of it».
  assert.match(bar, /\(value \/ largest\) \* 100/);
  // The colour is data — a status, type or priority's own — with the chart's
  // measure token behind it where a bucket carries none.
  assert.match(bar, /item\.color \|\| 'var\(--color-chart-1\)'/);
  // Every bucket empty is a sentence, not an empty frame.
  assert.match(bar, /emptyLabel/);
});
