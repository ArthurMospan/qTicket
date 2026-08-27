import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOverviewExport,
  buildTimesheetExport,
  buildVelocityExport,
  buildWorkloadExport,
  cellText,
  cellValue,
  durationLabel,
  exportFileName,
  fileNameDate,
  hoursValue,
  printOrientation,
  safeFileName,
  toCsv,
  toPrintHtml,
} from '../src/lib/utils/analyticsExport.mjs';

const lines = csv => csv.replace(/^﻿/, '').trimEnd().split('\r\n');

test('a duration reads the way the screen writes it, and adds up the way Excel needs', () => {
  assert.equal(durationLabel(380), '6г 20хв');
  assert.equal(durationLabel(120), '2г');
  assert.equal(durationLabel(45), '45хв');
  assert.equal(durationLabel(0), '0г');
  assert.equal(durationLabel(null), '0г');
  assert.equal(hoursValue(380), 6.33);
  assert.equal(hoursValue(120), 2);
  assert.equal(hoursValue(0), 0);
});

test('a figure stays a number, and only its text form carries a decimal comma', () => {
  const hours = { id: 'hours', label: 'Годин', type: 'hours', value: row => row.minutes };
  const money = { id: 'price', label: 'Сума', type: 'money', value: row => row.price };
  const count = { id: 'count', label: 'Задач', type: 'number', value: row => row.count };

  assert.equal(cellValue(hours, { minutes: 380 }), 6.33);
  assert.equal(cellText(hours, { minutes: 380 }), '6,33');
  assert.equal(cellText(money, { price: 1250 }), '1250,00');
  assert.equal(cellText(count, { count: 12 }), '12');
  // A dot on request, for anything that is not the Ukrainian Excel.
  assert.equal(cellText(hours, { minutes: 380 }, { decimal: '.' }), '6.33');
  // A missing value is blank, not `0` and not `NaN`.
  assert.equal(cellText(hours, {}), '0,00');
  assert.equal(cellText({ id: 'title', label: 'Назва', value: row => row.title }, {}), '');
});

test('CSV opens in Excel: BOM, semicolons, CRLF, and a title above each block', () => {
  const document = {
    fileName: 'QuickTeam-Тест',
    title: 'Аналітика · Тест',
    meta: [{ label: 'Період', value: '30 днів' }],
    blocks: [{
      id: 'projects',
      title: 'По проєктах',
      columns: [
        { id: 'project', label: 'Проєкт', value: row => row.project },
        { id: 'hours', label: 'Годин', type: 'hours', value: row => row.minutes },
      ],
      rows: [{ project: 'Сайт', minutes: 380 }],
      total: { project: 'Разом', minutes: 380 },
    }],
  };

  const csv = toCsv(document);
  assert.ok(csv.startsWith('﻿'), 'a file without the BOM opens as mojibake');
  assert.ok(csv.includes('\r\n'), 'Excel expects CRLF');
  assert.deepEqual(lines(csv), [
    'Аналітика · Тест',
    'Період;30 днів',
    '',
    'По проєктах',
    'Проєкт;Годин',
    'Сайт;6,33',
    'Разом;6,33',
  ]);
});

test('a cell that would be read as a formula or as a new row is neutralised', () => {
  const document = {
    fileName: 'x',
    title: 'x',
    meta: [],
    blocks: [{
      id: 'b',
      columns: [{ id: 'title', label: 'Назва', value: row => row.title }],
      rows: [
        { title: '=HYPERLINK("http://evil","click")' },
        { title: 'Ставка 12; знижка' },
        { title: 'Рядок з "лапками"' },
        { title: 'Два\nрядки' },
      ],
    }],
  };

  const rows = lines(toCsv(document)).slice(3);
  // Quoted into text — the characters are kept, the formula is not run.
  assert.equal(rows[0], '"\'=HYPERLINK(""http://evil"",""click"")"');
  assert.equal(rows[1], '"Ставка 12; знижка"');
  assert.equal(rows[2], '"Рядок з ""лапками"""');
  assert.ok(rows[3].startsWith('"Два'));
});

test('the printed page repeats its header and turns sideways when a table is wide', () => {
  const columns = count => Array.from({ length: count }, (_, index) => ({
    id: `c${index}`,
    label: `Колонка ${index}`,
    value: () => 'x',
  }));
  const documentOf = count => ({
    fileName: 'x',
    title: 'Тест',
    meta: [],
    blocks: [{ id: 'b', columns: columns(count), rows: [{}] }],
  });

  assert.equal(printOrientation(documentOf(4)), 'portrait');
  assert.equal(printOrientation(documentOf(8)), 'landscape');

  const html = toPrintHtml(documentOf(4));
  assert.ok(html.includes('display: table-header-group'), 'the header must repeat on every sheet');
  assert.ok(html.includes('<title>Тест</title>'));
});

test('the printed page escapes what a person typed', () => {
  const html = toPrintHtml({
    fileName: 'x',
    title: 'Звіт <script>alert(1)</script>',
    meta: [],
    blocks: [{
      id: 'b',
      columns: [{ id: 'title', label: 'Назва', value: row => row.title }],
      rows: [{ title: '<img src=x onerror=alert(1)>' }],
    }],
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('a file name sorts in a folder and survives Windows', () => {
  assert.equal(fileNameDate(new Date(2026, 7, 5)), '2026-08-05');
  assert.equal(safeFileName('Рахунок 1/2 : чернетка'), 'Рахунок 1-2 - чернетка');
  assert.equal(exportFileName({ fileName: 'QuickTeam-Табель' }, 'csv'), 'QuickTeam-Табель.csv');
});

test('the timesheet is one row per record, newest first, and its total is the sum', () => {
  const document = buildTimesheetExport({
    logs: [
      { id: '1', userId: 'u1', projectId: 'p1', issueId: 'i1', spentMinutes: 90, description: 'Правки' },
      { id: '2', userId: 'u2', projectId: 'p1', issueId: 'i1', spentMinutes: 30 },
      { id: '3', userId: 'u1', projectId: 'p2', eventId: 'e1', spentMinutes: 60 },
    ],
    members: [
      { id: 'u1', name: 'Артур' },
      { id: 'u2', email: 'olena@example.com' },
    ],
    issues: [{ id: 'i1', issueKey: 'QT-12', title: 'Форма замовлення' }],
    events: [{ id: 'e1', title: 'Планерка', startAt: '2026-08-17T09:00:00.000Z' }],
    projects: [{ id: 'p1', name: 'Сайт' }, { id: 'p2', name: 'CRM' }],
    rangeLabel: '11 – 17 серпня 2026',
    memberLabel: 'Вся команда',
    formatDate: date => `${date.getDate()}`,
    dateOf: log => new Date(2026, 7, Number(log.id) + 10),
    eventKeyOf: (source, isLog) => (isLog ? source.eventId : source.id),
    fileDates: ['2026-08-11', '2026-08-17'],
  });

  assert.equal(document.fileName, 'QuickTeam-Табель-2026-08-11_2026-08-17');
  const block = document.blocks[0];
  assert.deepEqual(block.rows.map(row => row.title), ['Планерка', 'Форма замовлення', 'Форма замовлення']);
  assert.deepEqual(block.rows.map(row => row.member), ['Артур', 'olena@example.com', 'Артур']);
  assert.equal(block.rows[1].key, 'QT-12');
  assert.equal(block.rows[0].key, 'ПОДІЯ');
  assert.equal(block.rows[0].project, 'CRM');
  assert.equal(block.total.minutes, 180);

  // The two time columns are the same minutes read two ways, which is the
  // point: one to check against the screen, one to sum.
  const csv = lines(toCsv(document));
  assert.ok(csv.some(line => line.includes('1г 30хв;1,5')));
});

test('the overview file carries the figures its charts draw', () => {
  const document = buildOverviewExport({
    stats: {
      total: 42, open: 24, inProgress: 6, recentDone: 7, periodMin: 380,
      overdue: [{ id: 'a' }, { id: 'b' }],
      noAssignee: [{ id: 'c' }, { id: 'd' }, { id: 'e' }],
      unestimated: [{ id: 'f' }, { id: 'g' }, { id: 'h' }, { id: 'i' }, { id: 'j' }],
      byStatus: [{ id: 'todo', label: 'До виконання', count: 12 }],
      byProject: [{ p: { id: 'p1', name: 'Сайт' }, total: 20, pct: 50, open: 10, overdue: 2, minutes: 380 }],
    },
    timeSplit: [{ id: 'tasks', label: 'Завдання', value: 320 }, { id: 'meetings', label: 'Мітинги', value: 60 }],
    period: 30,
    projects: [{ id: 'p1', name: 'Сайт' }, { id: 'p2', name: 'CRM' }],
    selectedProjectIds: ['p1'],
    today: new Date(2026, 7, 17),
  });

  assert.equal(document.fileName, 'QuickTeam-Огляд-30д-2026-08-17');
  // A filtered screen says so in the file; otherwise a total that looks wrong
  // is impossible to explain a week later.
  assert.deepEqual(document.meta, [
    { label: 'Період', value: '30 днів' },
    { label: 'Проєкти', value: 'Сайт' },
  ]);
  assert.deepEqual(document.blocks.map(block => block.id), ['kpi', 'statuses', 'time-split', 'projects']);
  const kpis = document.blocks.find(block => block.id === 'kpi');
  assert.deepEqual(kpis.rows.slice(0, 4), [
    { label: 'Відкрито зараз', value: '24' },
    { label: 'У роботі зараз', value: '6' },
    { label: 'Закрито за 30 днів', value: '7' },
    { label: 'Прострочено зараз', value: '2' },
  ]);
  assert.ok(kpis.rows.every(row => !String(row.value).includes('undefined')));
  assert.ok(kpis.rows.every(row => row.value !== '[object Object]'));
  const timeSplit = document.blocks.find(block => block.id === 'time-split');
  assert.equal(timeSplit.total.value, 380, 'the split totals the period, not its own rows');
});

test('the timesheet keeps a source name when its task or event is no longer readable', () => {
  const document = buildTimesheetExport({
    logs: [{
      id: 'orphan',
      issueId: 'deleted-task',
      projectId: 'p1',
      userId: 'u1',
      sourceKey: 'QT-9',
      sourceTitle: 'Видалена, але названа задача',
      spentMinutes: 45,
    }],
    members: [{ id: 'u1', name: 'Артур' }],
    projects: [{ id: 'p1', name: 'Сайт' }],
    rangeLabel: 'Тиждень',
    dateOf: () => new Date(2026, 7, 24),
    eventKeyOf: source => source.eventId || source.id,
  });

  const [row] = document.blocks[0].rows;
  assert.equal(row.key, 'QT-9');
  assert.equal(row.title, 'Видалена, але названа задача');
});

test('the productivity file compares created and closed flow without a fake completion rate', () => {
  const document = buildVelocityExport({
    stats: {
      donePeriod: 3,
      createdPeriod: 5,
      openNow: 8,
      velocityTrend: null,
      medianCycleTime: 4,
      p85CycleTime: 9,
      days: [{ label: '24 серп.', values: [3, 5] }],
      byType: [{ label: 'Задача', created: 5, done: 3 }],
    },
    weeklyVelocity: [],
    recentlyClosed: [],
    period: 30,
    today: new Date(2026, 7, 24),
  });

  const kpis = document.blocks.find(block => block.id === 'kpi');
  assert.ok(kpis.rows.some(row => row.label === 'Відкрито зараз' && row.value === '8'));
  const types = document.blocks.find(block => block.id === 'types');
  assert.deepEqual(types.columns.map(column => column.label), ['Тип', 'Створено', 'Закрито']);
  assert.ok(!types.columns.some(column => column.label.includes('%')));
});

test('the team file states each reading in the words the screen used', () => {
  const stat = overrides => ({
    member: { id: 'u1', name: 'Артур' },
    inProgressItems: [{ title: 'Форма замовлення' }],
    open: 4, done: 6, inProgress: 1, overdue: 0, minutes: 380,
    ...overrides,
  });
  const document = buildWorkloadExport({
    stats: [stat(), stat({ member: { id: 'u2', name: 'Олена' }, open: 2, done: 1, inProgress: 0, overdue: 3, minutes: 60 })],
    positions: [{ id: 'dev', label: 'Розробник' }],
    period: 30,
    projects: [],
    activityLabel: () => 'Сьогодні',
    stateLabel: row => (row.overdue > 0 ? `${row.overdue} прострочено` : 'Стабільно'),
    today: new Date(2026, 7, 17),
  });

  const block = document.blocks[0];
  assert.equal(block.rows.length, 2);
  assert.equal(block.total.open, 6);
  assert.equal(block.total.minutes, 440);
  const csv = lines(toCsv(document));
  assert.ok(csv.some(line => line.includes('3 прострочено')));
});
