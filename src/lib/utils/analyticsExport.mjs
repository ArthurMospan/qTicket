// src/lib/utils/analyticsExport.mjs — what a screen of figures looks like as a file.
//
// Analytics could be read and never carried: the numbers lived on the screen
// and nowhere else, so anything that had to reach a client or an accountant was
// retyped. This is the other end of that — and the rule it follows is that the
// file is the screen, not a second query. Every builder here takes the rows the
// tab has already computed and shows, so a total in Excel cannot disagree with
// the total above it. Nothing in this file reads Firestore, and nothing in it
// decides what a period or a filter means.
//
// One model, three renderers. A document is blocks of columns and rows; `toCsv`
// writes it for Excel, `toPrintHtml` writes the page the browser prints to PDF,
// and the spreadsheet writer in `exportFile.js` — not pure, it loads a library
// and touches the DOM — reads the same model. Adding a format therefore means
// adding a renderer, never a second description of the same table.
//
// Dates are never formatted here. The organization has a timezone and the
// person has a date format, and both live in React state, so a builder is
// handed the `formatDate` the screen itself uses.

// ── The model ───────────────────────────────────────────────────────────────
//
/**
 * @typedef {object} ExportColumn
 * @property {string} id
 * @property {string} label Header text. A money column carries its currency here.
 * @property {'text'|'number'|'duration'|'hours'|'money'|'percent'} [type]
 * @property {number} [width] Characters, for the spreadsheet's column width.
 * @property {(row: object) => any} value What this column reads out of a row.
 */
/**
 * @typedef {object} ExportBlock
 * @property {string} id
 * @property {string} [title] Drawn above the header row.
 * @property {ExportColumn[]} columns
 * @property {object[]} rows
 * @property {object} [total] One row set apart: bold in the sheet, ruled off in print.
 */
/**
 * @typedef {object} ExportDocument
 * @property {string} fileName Without an extension.
 * @property {string} title
 * @property {{label: string, value: string}[]} meta The period and filters the figures were read under.
 * @property {ExportBlock[]} blocks
 */

// `duration` is in here even though it renders as words: «3г 5хв» is a figure,
// and a column of them reads down its right edge like every other one. It is
// still written to the spreadsheet as text — only the alignment is shared.
const FIGURE_TYPES = new Set(['number', 'hours', 'money', 'percent', 'duration']);

/** Right-aligned in every renderer: a column of figures reads down its last digit. */
export function isFigureColumn(column) {
  return FIGURE_TYPES.has(column?.type);
}

// ── Values ──────────────────────────────────────────────────────────────────

/**
 * `380` → `6г 20хв`. The spelling the analytics screens use, so a cell in the
 * file reads exactly like the chip it came from.
 */
export function durationLabel(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  if (!total) return '0г';
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest}хв`;
  return rest ? `${hours}г ${rest}хв` : `${hours}г`;
}

/** The same duration as a number Excel can add up. */
export function hoursValue(minutes) {
  return Math.round(((Number(minutes) || 0) / 60) * 100) / 100;
}

export function moneyValue(amount) {
  return Math.round((Number(amount) || 0) * 100) / 100;
}

/** What a cell holds before any format is chosen: a number stays a number. */
export function cellValue(column, row) {
  const raw = column.value ? column.value(row) : row?.[column.id];
  switch (column.type) {
    case 'hours':
      return hoursValue(raw);
    case 'money':
      return moneyValue(raw);
    case 'number':
    case 'percent':
      return Number.isFinite(Number(raw)) ? Number(raw) : null;
    case 'duration':
      return raw === null || raw === undefined ? null : durationLabel(raw);
    default:
      return raw === null || raw === undefined ? '' : String(raw);
  }
}

/**
 * The same cell as text, for the two renderers that write text.
 *
 * `decimal` is the separator: a comma for CSV, because an Excel set to Ukrainian
 * reads `6.33` as a word and `6,33` as a number.
 */
export function cellText(column, row, { decimal = ',' } = {}) {
  const value = cellValue(column, row);
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'number') return String(value);
  const digits = column.type === 'money' || column.type === 'hours' ? 2 : 0;
  const text = value.toFixed(digits);
  return decimal === ',' ? text.replace('.', decimal) : text;
}

// ── CSV ─────────────────────────────────────────────────────────────────────

// Excel picks the list separator from the machine's locale, and a Ukrainian one
// is `;`. Handing it a comma-separated file puts every row in a single column.
const CSV_DELIMITER = ';';

// Without this Excel reads a UTF-8 file as CP1251 and every Ukrainian word
// arrives as mojibake. It is three bytes and the entire difference between a
// file that opens and a file that gets mailed back.
const BOM = '﻿';

// A cell that starts like a formula is executed by Excel and Sheets when the
// file is opened. Task titles and invoice notes are written by people, and this
// file is made to be sent to somebody else, so a leading `=`, `+`, `-` or `@`
// is quoted into being text. Losing the character would be worse than the
// apostrophe: it is part of what somebody wrote.
const FORMULA_START = /^[=+\-@\t\r]/;

// …but a discount is a negative number, and quoting `-125,00` into text is how
// a column of money stops adding up. Anything that is only a number is left
// exactly as it is; the guard is for a cell that begins like an instruction.
const PLAIN_NUMBER = /^-?\d+([.,]\d+)?$/;

function csvCell(text) {
  const safe = FORMULA_START.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * The document as one CSV file: blocks separated by a blank line, each under
 * its own title. Excel treats a blank line as a break and keeps reading, which
 * is what lets four charts arrive in one file instead of four.
 */
export function toCsv(document) {
  const lines = [];
  lines.push(csvCell(document.title));
  for (const item of document.meta || []) {
    lines.push([csvCell(item.label), csvCell(item.value)].join(CSV_DELIMITER));
  }

  for (const block of document.blocks || []) {
    lines.push('');
    if (block.title) lines.push(csvCell(block.title));
    lines.push(block.columns.map(column => csvCell(column.label)).join(CSV_DELIMITER));
    for (const row of block.rows) {
      lines.push(block.columns.map(column => csvCell(cellText(column, row))).join(CSV_DELIMITER));
    }
    if (block.total) {
      lines.push(block.columns.map(column => csvCell(cellText(column, block.total))).join(CSV_DELIMITER));
    }
  }

  // CRLF: the line ending every spreadsheet on Windows expects.
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

// ── Print (→ PDF) ───────────────────────────────────────────────────────────

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => HTML_ESCAPES[character]);
}

// A table wider than six columns does not fit an A4 portrait page, and a
// timesheet is eight. Choosing the orientation from the widest block is the
// difference between a readable page and one with the last two columns cut off.
const LANDSCAPE_FROM_COLUMNS = 6;

export function printOrientation(document) {
  const widest = Math.max(0, ...(document.blocks || []).map(block => block.columns.length));
  return widest > LANDSCAPE_FROM_COLUMNS ? 'landscape' : 'portrait';
}

/**
 * The document as a printable page. `thead` repeats on every sheet, which is
 * the whole reason this is a real table and not a grid of divs.
 *
 * Deliberately its own stylesheet rather than the product's: the print window
 * is a separate document, and dragging the app's CSS into it would make a page
 * meant for paper depend on the theme of a screen.
 */
export function toPrintHtml(document) {
  const meta = (document.meta || [])
    .map(item => `<p><span>${escapeHtml(item.label)}</span>${escapeHtml(item.value)}</p>`)
    .join('');

  const blocks = (document.blocks || []).map(block => {
    const header = block.columns
      .map(column => `<th class="${isFigureColumn(column) ? 'num' : ''}">${escapeHtml(column.label)}</th>`)
      .join('');
    const body = block.rows.map(row => `<tr>${block.columns
      .map(column => `<td class="${isFigureColumn(column) ? 'num' : ''}">${escapeHtml(cellText(column, row))}</td>`)
      .join('')}</tr>`).join('');
    const total = block.total
      ? `<tr class="total">${block.columns
        .map(column => `<td class="${isFigureColumn(column) ? 'num' : ''}">${escapeHtml(cellText(column, block.total))}</td>`)
        .join('')}</tr>`
      : '';
    return `<section>${block.title ? `<h2>${escapeHtml(block.title)}</h2>` : ''}<table><thead><tr>${header}</tr></thead><tbody>${body}${total}</tbody></table></section>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="utf-8">
<title>${escapeHtml(document.title)}</title>
<style>
  @page { size: A4 ${printOrientation(document)}; margin: 14mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Inter, -apple-system, "Segoe UI", sans-serif; color: #1f1f1f; font-size: 11px; }
  h1 { font-size: 20px; font-weight: 800; letter-spacing: -0.01em; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 20px; margin: 6px 0 18px; }
  .meta p { font-size: 11px; color: #4a4a4a; }
  .meta span { color: #9a9a9a; margin-right: 5px; }
  section { margin-bottom: 20px; break-inside: auto; }
  h2 { font-size: 12px; font-weight: 700; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.07em; color: #6a6a6a; padding: 5px 8px 5px 0; border-bottom: 1.5px solid #1f1f1f; }
  td { padding: 5px 8px 5px 0; border-bottom: 1px solid #ededed; vertical-align: top; }
  th.num, td.num { text-align: right; padding-right: 0; }
  tr.total td { font-weight: 700; border-top: 1.5px solid #1f1f1f; border-bottom: none; }
</style>
</head>
<body>
<h1>${escapeHtml(document.title)}</h1>
<div class="meta">${meta}</div>
${blocks}
</body>
</html>`;
}

// ── The file's name ─────────────────────────────────────────────────────────

// Windows forbids these outright, and a slash would silently make a folder.
const UNSAFE_IN_FILE_NAME = /[\\/:*?"<>|]+/g;

export function safeFileName(name) {
  return String(name || 'export')
    .replace(UNSAFE_IN_FILE_NAME, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * `2026-08-17` — ISO, always, and deliberately not the person's date format.
 * A name is what a folder sorts on, and `17.08.2026` sorts between the 16th of
 * every other month. The dates *inside* the file follow the settings.
 */
export function fileNameDate(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.getTime())) return '';
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

export function exportFileName(document, extension) {
  return `${safeFileName(document.fileName)}.${extension}`;
}

// ── Shared column shapes ────────────────────────────────────────────────────
//
// Time is two columns everywhere, and the pair is written once. «Час» is the
// string the screen shows, so a reader can check the file against it; «Годин»
// is the number, because a column of `6г 20хв` cannot be summed and somebody
// would have to retype it — which is the whole thing this feature exists to
// stop.

export function timeColumns(minutesOf) {
  return [
    { id: 'time', label: 'Час', type: 'duration', width: 12, value: minutesOf },
    { id: 'hours', label: 'Годин', type: 'hours', width: 9, value: minutesOf },
  ];
}

const projectName = project => project?.name || 'Без проєкту';
const memberName = member => member?.name || member?.displayName || member?.email || 'Без імені';

function filtersMeta({ period, projects, selectedProjectIds = [], extra = [] }) {
  const chosen = selectedProjectIds.length > 0
    ? projects.filter(project => selectedProjectIds.includes(project.id)).map(projectName).join(', ')
    : 'Усі';
  return [
    ...(period ? [{ label: 'Період', value: `${period} днів` }] : []),
    { label: 'Проєкти', value: chosen || 'Усі' },
    ...extra,
  ].filter(item => item.value);
}

// ── Огляд ───────────────────────────────────────────────────────────────────

/**
 * The overview screen is four charts and a table, and all five are counts. This
 * is those counts, in the order the screen reads them.
 */
export function buildOverviewExport({
  stats,
  timeSplit = [],
  period,
  projects = [],
  selectedProjectIds = [],
  filters = [],
  today = new Date(),
}) {
  return {
    fileName: `QuickTeam-Огляд-${period}д-${fileNameDate(today)}`,
    title: 'Аналітика · Огляд',
    meta: filtersMeta({ period, projects, selectedProjectIds, extra: filters }),
    blocks: [
      {
        id: 'kpi',
        title: 'Показники',
        columns: [
          { id: 'label', label: 'Показник', width: 32, value: row => row.label },
          { id: 'value', label: 'Значення', width: 16, value: row => row.value },
        ],
        rows: [
          { label: 'Відкрито зараз', value: String(stats.open) },
          { label: 'У роботі зараз', value: String(stats.inProgress) },
          { label: `Закрито за ${period} днів`, value: String(stats.recentDone) },
          { label: 'Прострочено зараз', value: String(stats.overdue.length) },
          { label: 'Зафіксовано часу', value: durationLabel(stats.periodMin) },
          { label: 'Зафіксовано годин', value: String(hoursValue(stats.periodMin)).replace('.', ',') },
          { label: 'Без виконавця', value: String(stats.noAssignee.length) },
          { label: 'Без оцінки', value: String(stats.unestimated.length) },
        ],
      },
      {
        id: 'statuses',
        title: 'По статусах',
        columns: [
          { id: 'label', label: 'Статус', width: 26, value: row => row.label },
          { id: 'count', label: 'Завдань', type: 'number', width: 10, value: row => row.count },
        ],
        rows: stats.byStatus.map(status => ({ label: status.label, count: status.count })),
      },
      {
        id: 'time-split',
        title: 'Куди пішов час',
        columns: [
          { id: 'label', label: 'Категорія', width: 22, value: row => row.label },
          ...timeColumns(row => row.value),
        ],
        rows: timeSplit.map(item => ({ label: item.label, value: item.value })),
        total: { label: 'Разом', value: stats.periodMin },
      },
      {
        id: 'projects',
        title: 'По проєктах',
        columns: [
          { id: 'project', label: 'Проєкт', width: 30, value: row => projectName(row.p) },
          { id: 'total', label: 'Задач', type: 'number', width: 9, value: row => row.total },
          { id: 'pct', label: 'Прогрес %', type: 'percent', width: 11, value: row => row.pct },
          { id: 'open', label: 'Відкрито', type: 'number', width: 10, value: row => row.open },
          { id: 'overdue', label: 'Прострочено', type: 'number', width: 12, value: row => row.overdue },
          ...timeColumns(row => row.minutes),
        ],
        rows: stats.byProject,
      },
    ],
  };
}

// ── Табель ──────────────────────────────────────────────────────────────────

/**
 * One row per record of time, which is what the grid on screen is made of. The
 * week grid answers «did this person fill their days»; a file is opened to sum,
 * pivot and attach to an invoice, and a matrix has to be taken apart before any
 * of that. The totals are the same figures either way.
 */
export function buildTimesheetExport({
  logs = [],
  members = [],
  issues = [],
  events = [],
  projects = [],
  rangeLabel,
  memberLabel = 'Вся команда',
  formatDate = value => String(value ?? ''),
  dateOf,
  eventKeyOf,
  fileDates = [],
}) {
  const memberById = new Map(members.map(member => [member.id || member.uid, member]));
  const issueById = new Map(issues.map(issue => [issue.id, issue]));
  const projectById = new Map(projects.map(project => [project.id, project]));
  const eventByKey = new Map(events.map(event => [eventKeyOf?.(event) ?? event.id, event]));

  const rows = logs.map(log => {
    const date = dateOf ? dateOf(log) : null;
    const issue = log.issueId ? issueById.get(log.issueId) : null;
    const event = !issue && eventKeyOf ? eventByKey.get(eventKeyOf(log, true)) : null;
    return {
      sortAt: date ? date.getTime() : 0,
      date: date ? formatDate(date) : '',
      member: memberName(memberById.get(log.userId)) ,
      project: projectName(projectById.get(log.projectId)),
      key: issue?.issueKey || log.sourceKey || (event || log.eventId ? 'ПОДІЯ' : ''),
      title: issue?.title || event?.title || log.sourceTitle || log.description || 'Запис часу',
      minutes: Number(log.spentMinutes) || 0,
      description: log.description || '',
    };
  }).sort((left, right) => right.sortAt - left.sortAt || left.member.localeCompare(right.member, 'uk'));

  const totalMinutes = rows.reduce((sum, row) => sum + row.minutes, 0);

  return {
    fileName: `QuickTeam-Табель-${fileDates.filter(Boolean).join('_') || fileNameDate()}`,
    title: 'Аналітика · Табель',
    meta: [
      { label: 'Період', value: rangeLabel || '' },
      { label: 'Хто', value: memberLabel },
      { label: 'Записів', value: String(rows.length) },
    ].filter(item => item.value),
    blocks: [
      {
        id: 'time-logs',
        columns: [
          { id: 'date', label: 'Дата', width: 12, value: row => row.date },
          { id: 'member', label: 'Учасник', width: 22, value: row => row.member },
          { id: 'project', label: 'Проєкт', width: 20, value: row => row.project },
          { id: 'key', label: 'Ключ', width: 10, value: row => row.key },
          { id: 'title', label: 'Завдання або подія', width: 40, value: row => row.title },
          ...timeColumns(row => row.minutes),
          { id: 'description', label: 'Опис', width: 36, value: row => row.description },
        ],
        rows,
        total: { date: 'Разом', member: '', project: '', key: '', title: '', minutes: totalMinutes, description: '' },
      },
    ],
  };
}

// ── Команда ─────────────────────────────────────────────────────────────────

export function buildWorkloadExport({
  stats = [],
  positions = [],
  period,
  projects = [],
  selectedProjectIds = [],
  activityLabel = () => '',
  stateLabel = () => '',
  today = new Date(),
}) {
  const positionLabel = member => positions.find(position => position.id === member?.positionId)?.label
    || member?.title
    || '';

  return {
    fileName: `QuickTeam-Команда-${period}д-${fileNameDate(today)}`,
    title: 'Аналітика · Команда',
    meta: filtersMeta({ period, projects, selectedProjectIds }),
    blocks: [
      {
        id: 'members',
        columns: [
          { id: 'member', label: 'Учасник', width: 26, value: row => memberName(row.member) },
          { id: 'position', label: 'Посада', width: 18, value: row => positionLabel(row.member) },
          { id: 'activity', label: 'Активність', width: 14, value: row => activityLabel(row) },
          { id: 'focus', label: 'Поточний фокус', width: 34, value: row => row.inProgressItems[0]?.title || '' },
          { id: 'open', label: 'Відкрито', type: 'number', width: 10, value: row => row.open },
          { id: 'done', label: 'Готово', type: 'number', width: 9, value: row => row.done },
          { id: 'inProgress', label: 'В роботі', type: 'number', width: 10, value: row => row.inProgress },
          { id: 'overdue', label: 'Прострочено', type: 'number', width: 12, value: row => row.overdue },
          ...timeColumns(row => row.minutes),
          { id: 'state', label: 'Стан', width: 18, value: row => stateLabel(row) },
        ],
        rows: stats,
        total: {
          member: 'Разом',
          inProgressItems: [],
          open: stats.reduce((sum, row) => sum + row.open, 0),
          done: stats.reduce((sum, row) => sum + row.done, 0),
          inProgress: stats.reduce((sum, row) => sum + row.inProgress, 0),
          overdue: stats.reduce((sum, row) => sum + row.overdue, 0),
          minutes: stats.reduce((sum, row) => sum + row.minutes, 0),
        },
      },
    ],
  };
}

/**
 * One person, when the team table has been opened on them. Exporting the whole
 * team from a screen showing one member would be a file that does not match
 * what is on it.
 */
export function buildMemberExport({
  stat,
  projects = [],
  period,
  formatDate = value => String(value ?? ''),
  dateOf = () => null,
  today = new Date(),
}) {
  const projectById = new Map(projects.map(project => [project.id, project]));
  const name = memberName(stat?.member);
  const issueRow = issue => ({
    key: issue.issueKey || '',
    title: issue.title || '',
    project: projectName(projectById.get(issue.projectId)),
    due: issue.dueDate ? formatDate(issue.dueDate) : '',
  });

  return {
    fileName: `QuickTeam-${safeFileName(name)}-${period}д-${fileNameDate(today)}`,
    title: `Аналітика · ${name}`,
    meta: [
      { label: 'Період', value: `${period} днів` },
      { label: 'Посада', value: stat?.member?.title || '' },
      { label: 'Пошта', value: stat?.member?.email || '' },
    ].filter(item => item.value),
    blocks: [
      {
        id: 'kpi',
        title: 'Показники',
        columns: [
          { id: 'label', label: 'Показник', width: 30, value: row => row.label },
          { id: 'value', label: 'Значення', width: 16, value: row => row.value },
        ],
        rows: [
          { label: 'Зафіксовано часу', value: durationLabel(stat.minutes) },
          { label: 'Зафіксовано годин', value: String(hoursValue(stat.minutes)).replace('.', ',') },
          { label: `Завершено за ${period} днів`, value: String(stat.done) },
          { label: 'Зараз у роботі', value: String(stat.inProgress) },
          { label: 'Відкритих', value: String(stat.open) },
          { label: 'Прострочених', value: String(stat.overdue) },
        ],
      },
      {
        id: 'open',
        title: 'Відкриті завдання',
        columns: [
          { id: 'key', label: 'Ключ', width: 10, value: row => row.key },
          { id: 'title', label: 'Завдання', width: 44, value: row => row.title },
          { id: 'project', label: 'Проєкт', width: 22, value: row => row.project },
          { id: 'due', label: 'Дедлайн', width: 12, value: row => row.due },
        ],
        rows: (stat.openItems || []).map(issueRow),
      },
      {
        id: 'logs',
        title: 'Записи часу за період',
        columns: [
          {
            id: 'date',
            label: 'Дата',
            width: 12,
            value: row => {
              const date = dateOf(row);
              return date ? formatDate(date) : '';
            },
          },
          { id: 'project', label: 'Проєкт', width: 22, value: row => projectName(projectById.get(row.projectId)) },
          { id: 'description', label: 'Опис', width: 40, value: row => row.description || '' },
          ...timeColumns(row => row.spentMinutes),
        ],
        rows: stat.logs || [],
        total: { projectId: null, description: 'Разом', spentMinutes: stat.minutes },
      },
    ].filter(block => block.rows.length > 0 || block.id === 'kpi'),
  };
}

// ── Продуктивність ──────────────────────────────────────────────────────────

export function buildVelocityExport({
  stats,
  weeklyVelocity = [],
  recentlyClosed = [],
  period,
  projects = [],
  selectedProjectIds = [],
  formatDate = value => String(value ?? ''),
  completedAtOf = () => null,
  today = new Date(),
}) {
  const projectById = new Map(projects.map(project => [project.id, project]));
  return {
    fileName: `QuickTeam-Продуктивність-${period}д-${fileNameDate(today)}`,
    title: 'Аналітика · Продуктивність',
    meta: filtersMeta({ period, projects, selectedProjectIds }),
    blocks: [
      {
        id: 'kpi',
        title: 'Показники',
        columns: [
          { id: 'label', label: 'Показник', width: 32, value: row => row.label },
          { id: 'value', label: 'Значення', width: 16, value: row => row.value },
        ],
        rows: [
          { label: `Закрито за ${period} днів`, value: String(stats.donePeriod) },
          { label: 'Створено за період', value: String(stats.createdPeriod) },
          { label: 'Відкрито зараз', value: String(stats.openNow || 0) },
          ...(stats.velocityTrend === null || stats.velocityTrend === undefined
            ? []
            : [{ label: 'Зміна до попереднього періоду', value: `${stats.velocityTrend}%` }]),
          // Median first, and the 85th percentile beside it. A mean cycle time
          // is dragged by the handful of tasks that sat open for months until
          // it describes nothing anybody worked on; the file says what the
          // screen says, and the screen stopped leading with the mean.
          ...(stats.medianCycleTime === null || stats.medianCycleTime === undefined
            ? []
            : [{ label: 'Від створення до завершення, днів', value: String(stats.medianCycleTime) }]),
          ...(stats.p85CycleTime === null || stats.p85CycleTime === undefined
            ? []
            : [{ label: '85% закриваються за, днів', value: String(stats.p85CycleTime) }]),
        ],
      },
      {
        id: 'days',
        title: 'Активність по днях',
        columns: [
          { id: 'label', label: 'День', width: 14, value: row => row.label },
          { id: 'closed', label: 'Закрито', type: 'number', width: 10, value: row => row.values[0] },
          { id: 'created', label: 'Відкрито', type: 'number', width: 10, value: row => row.values[1] },
        ],
        rows: stats.days,
      },
      {
        id: 'weeks',
        title: 'Пропускна здатність по тижнях',
        columns: [
          { id: 'label', label: 'Тиждень з', width: 14, value: row => row.label },
          { id: 'closed', label: 'Закрито', type: 'number', width: 10, value: row => row.values[0] },
          { id: 'created', label: 'Відкрито', type: 'number', width: 10, value: row => row.values[1] },
        ],
        rows: weeklyVelocity,
      },
      {
        id: 'types',
        title: 'Потік по типах',
        columns: [
          { id: 'label', label: 'Тип', width: 20, value: row => row.label },
          { id: 'created', label: 'Створено', type: 'number', width: 10, value: row => row.created },
          { id: 'done', label: 'Закрито', type: 'number', width: 10, value: row => row.done },
        ],
        rows: stats.byType,
      },
      {
        id: 'recently-closed',
        title: 'Нещодавно закриті',
        columns: [
          { id: 'key', label: 'Ключ', width: 10, value: row => row.issueKey || '' },
          { id: 'title', label: 'Завдання', width: 44, value: row => row.title || '' },
          { id: 'project', label: 'Проєкт', width: 22, value: row => projectName(projectById.get(row.projectId)) },
          {
            id: 'closedAt',
            label: 'Закрито',
            width: 12,
            value: row => {
              const at = completedAtOf(row);
              return at ? formatDate(new Date(at)) : '';
            },
          },
        ],
        rows: recentlyClosed,
      },
    ].filter(block => block.rows.length > 0),
  };
}

// ── Рахунок ─────────────────────────────────────────────────────────────────
