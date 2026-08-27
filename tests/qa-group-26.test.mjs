import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { plural } from '../src/lib/utils/plural.mjs';
import {
  issueCycleStartMillis,
  summarizeCycleTimes,
} from '../src/lib/utils/velocityMetrics.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const timestamp = millis => ({ toMillis: () => millis });

test('Ukrainian plural forms handle teens, compound counts and negative values', () => {
  const forms = ['завдання', 'завдання', 'завдань'];
  const expected = new Map([
    [0, 'завдань'],
    [1, 'завдання'],
    [2, 'завдання'],
    [4, 'завдання'],
    [5, 'завдань'],
    [11, 'завдань'],
    [14, 'завдань'],
    [21, 'завдання'],
    [22, 'завдання'],
    [25, 'завдань'],
    [111, 'завдань'],
    [122, 'завдання'],
    [-2, 'завдання'],
  ]);

  for (const [count, form] of expected) assert.equal(plural(count, forms), form);
  assert.equal(plural(Number.NaN, forms), 'завдань');
  assert.throws(() => plural(2, ['одна', 'дві']), /three Ukrainian forms/);
});

test('cycle time uses source dates and exposes contradictory dates', () => {
  const day = 86_400_000;
  const imported = {
    id: 'imported',
    source: 'youtrack',
    createdAt: timestamp(day),
    importedAt: timestamp(10 * day),
    completedAt: timestamp(13 * day),
  };
  const invalid = {
    id: 'invalid',
    importMetadata: { provider: 'youtrack', importedAt: timestamp(20 * day) },
    createdAt: timestamp(20 * day),
    completedAt: timestamp(19 * day),
  };
  const native = {
    id: 'native',
    createdAt: timestamp(5 * day),
    completedAt: timestamp(7 * day),
  };
  const completedAt = issue => issue.completedAt.toMillis();

  assert.equal(issueCycleStartMillis(imported), day);
  assert.equal(issueCycleStartMillis(native), 5 * day);
  // Two valid samples. The mean survives because the exported file has always
  // carried it, but the readings the screen leads with are the median and the
  // 85th percentile: a mean cycle time is dragged by the handful of tasks that
  // sat open for months until it describes nothing anybody worked on.
  assert.deepEqual(summarizeCycleTimes([imported, native, invalid], completedAt), {
    averageDays: 7,
    medianDays: 2,
    p85Days: 12,
    sampleSize: 2,
    invalidIssueIds: ['invalid'],
  });
});

test('group 26 copy and layout contracts stay role-aware and concise', async () => {
  const [projects, sprints, settings, toast, globals, filterBar, filtersStory] = await Promise.all([
    read('../src/app/(app)/page.js'),
    read('../src/app/(app)/sprints/page.js'),
    read('../src/app/(app)/settings/page.js'),
    read('../src/components/ui/Feedback/Toast.jsx'),
    read('../src/app/globals.css'),
    read('../src/components/ui/FilterBar.jsx'),
    read('../src/app/ui-kit/sections/filters.jsx'),
  ]);

  assert.match(projects, /Попросіть адміністратора створити перший проєкт/);
  assert.match(projects, /<FilterBar context="projects">/);
  assert.match(sprints, /Попросіть адміністратора створити спринт/);
  // The empty sprint names both ways in, because on a phone only one of them
  // exists: dragging a card between two stacked lists is not a real gesture, so
  // the header's «+» is what actually fills a sprint there.
  assert.match(sprints, /У цьому спринті ще немає задач — додайте їх кнопкою «\+» у шапці спринта або перетягніть зі списку «Без спринта»/);
  // The «Без спринта» header is a board column header — see ux-regressions.
  assert.match(filterBar, /projects:\s*\{[\s\S]*?w-max max-w-full/);
  assert.match(filtersStory, /<FilterBar context="projects">/);

  assert.match(settings, /Інтеграцію не налаштовано в цьому середовищі/);
  assert.match(settings, /Наразі інтерфейс доступний лише українською/);
  assert.match(settings, /value=\{language\}[\s\S]{0,100}disabled/);
  assert.doesNotMatch(toast, /<style>|toastSlideUp/);
  assert.match(toast, /className="ui-toast/);
  assert.match(globals, /@keyframes qt-toast-slide-up/);
});

test('sprint labels and YouTrack import metadata use the new contracts everywhere', async () => {
  const [createTask, issueDetail, myTasks, kitStory, importer, velocity, chatSearch] = await Promise.all([
    read('../src/components/CreateTaskModal.jsx'),
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/app/(app)/my/page.js'),
    read('../src/app/ui-kit/sections/task-attributes.jsx'),
    read('../src/lib/server/youtrackImporter.js'),
    read('../src/components/workspace/VelocityTab.jsx'),
    read('../src/components/ui/Chat/ChatSearchBanner.jsx'),
  ]);

  for (const source of [createTask, issueDetail, myTasks, kitStory]) {
    assert.doesNotMatch(source, /Без спринта \(Беклог\)|Беклог \(без спринта\)/);
  }
  assert.match(importer, /importedAt: firstImportedAt/);
  assert.match(importer, /importedAt: currentImportAt/);
  assert.match(velocity, /Помилка дат завершення/);
  assert.doesNotMatch(velocity, /\.filter\(v => v !== null && v >= 0\)/);
  assert.doesNotMatch(issueDetail, /length === 1 \? 'запис'/);
  assert.doesNotMatch(chatSearch, /count < 5/);
});
