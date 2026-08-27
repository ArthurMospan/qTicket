import { createHash } from 'node:crypto';
import { plural } from '../utils/plural.mjs';

export const MAX_INVOICE_ITEMS = 350;
export const MAX_INVOICE_SOURCE_LOGS = 350;
export const MAX_INVOICE_TRANSACTION_WRITES = 450;
export const MAX_INVOICE_JSON_BYTES = 512_000;
export const MAX_TIME_LOG_MINUTES = 525_600;

const MAX_MONEY = 1_000_000_000_000;
const MAX_MINUTES = 100_000_000;
const SUPPORTED_CURRENCIES = new Set(['USD', 'EUR', 'UAH', 'GBP', 'PLN']);
// 'estimate' is a historical kind: invoices created before billing dropped the
// estimate fallback keep it, but nothing may create one again.
const SOURCE_KINDS = new Set(['actual', 'manual', 'none']);
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'void', 'voided']);

export class InvoicePayloadError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'InvoicePayloadError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function reject(code, message, status = 400, details = {}) {
  throw new InvoicePayloadError(code, message, status, details);
}

function objectRecord(value, message = 'Некоректні дані рахунку') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    reject('INVALID_INVOICE_PAYLOAD', message);
  }
  return value;
}

function limitedString(
  value,
  {
    label,
    max,
    required = false,
    fallback = '',
  },
) {
  if (value == null && !required) return fallback;
  if (typeof value !== 'string') {
    reject('INVALID_INVOICE_PAYLOAD', `${label} має бути текстом`);
  }
  const normalized = value.trim();
  if (required && !normalized) {
    reject('INVALID_INVOICE_PAYLOAD', `${label} є обов’язковим`);
  }
  if (normalized.length > max) {
    reject('INVALID_INVOICE_PAYLOAD', `${label} перевищує допустиму довжину`);
  }
  return normalized;
}

function documentId(value, label) {
  const normalized = limitedString(value, {
    label,
    max: 256,
    required: true,
  });
  if (normalized.includes('/') || normalized.includes('\0')) {
    reject('INVALID_INVOICE_PAYLOAD', `${label} має некоректний формат`);
  }
  return normalized;
}

function optionalDocumentId(value, label) {
  if (value == null || value === '') return null;
  return documentId(value, label);
}

function finiteNonnegative(value, label, max = MAX_MONEY) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
    reject('INVALID_INVOICE_PAYLOAD', `${label} має бути невід’ємним числом`);
  }
  return value;
}

function percent(value, label) {
  const normalized = finiteNonnegative(value, label, 100);
  return normalized;
}

function money(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function closeMoney(left, right) {
  return Math.abs(money(left) - money(right)) <= 0.02;
}

function sourceIds(value, label) {
  if (!Array.isArray(value)) {
    reject('INVALID_INVOICE_PAYLOAD', `${label} має бути списком`);
  }
  if (value.length > MAX_INVOICE_SOURCE_LOGS) {
    reject(
      'INVOICE_TOO_LARGE',
      `Рахунок може містити не більше ${MAX_INVOICE_SOURCE_LOGS} ${plural(MAX_INVOICE_SOURCE_LOGS, ['запису', 'записів', 'записів'])} часу`,
      413,
    );
  }
  const ids = value.map((id, index) => documentId(id, `${label} #${index + 1}`));
  return [...new Set(ids)];
}

function normalizeItem(item, index) {
  objectRecord(item, `Некоректна позиція рахунку #${index + 1}`);
  const itemId = limitedString(item.itemId, {
    label: `ID позиції #${index + 1}`,
    max: 500,
    required: true,
  });
  const normalizedSourceIds = sourceIds(
    item.sourceTimeLogIds || [],
    `Записи часу позиції #${index + 1}`,
  );
  const sourceKind = typeof item.sourceKind === 'string'
    ? item.sourceKind.trim()
    : normalizedSourceIds.length > 0
      ? 'actual'
      : 'none';
  if (!SOURCE_KINDS.has(sourceKind)) {
    reject('INVALID_INVOICE_PAYLOAD', `Некоректне джерело позиції #${index + 1}`);
  }
  if (sourceKind === 'actual' && normalizedSourceIds.length === 0) {
    reject(
      'INVALID_INVOICE_PAYLOAD',
      `Фактична позиція #${index + 1} не містить записів часу`,
    );
  }

  const issueId = optionalDocumentId(
    item.issueId,
    `ID завдання позиції #${index + 1}`,
  );
  if (issueId && itemId !== issueId) {
    reject(
      'INVOICE_ITEM_ID_MISMATCH',
      `ID позиції #${index + 1} має збігатися з ID завдання`,
    );
  }
  if (!issueId && normalizedSourceIds.length === 0) {
    reject(
      'INVALID_INVOICE_PAYLOAD',
      `Позиція #${index + 1} без фактичного часу має належати завданню`,
    );
  }

  return {
    itemId,
    issueId,
    key: limitedString(item.key, {
      label: `Ключ позиції #${index + 1}`,
      max: 100,
    }),
    title: limitedString(item.title, {
      label: `Назва позиції #${index + 1}`,
      max: 500,
      required: true,
    }),
    status: limitedString(item.status, {
      label: `Статус позиції #${index + 1}`,
      max: 120,
    }),
    minutes: finiteNonnegative(
      item.minutes,
      `Хвилини позиції #${index + 1}`,
      MAX_MINUTES,
    ),
    price: finiteNonnegative(item.price, `Сума позиції #${index + 1}`),
    sourceKind,
    sourceTimeLogIds: normalizedSourceIds,
  };
}

function serializedBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    reject('INVALID_INVOICE_PAYLOAD', 'Рахунок не вдалося серіалізувати');
  }
}

export function normalizeInvoiceRequest(body) {
  objectRecord(body, 'Некоректний запит на створення рахунку');
  const organizationId = documentId(body.organizationId, 'Організація');
  const projectId = documentId(body.projectId, 'Проєкт');
  const invoice = objectRecord(body.invoice);

  if (serializedBytes(body) > MAX_INVOICE_JSON_BYTES) {
    reject('INVOICE_TOO_LARGE', 'Рахунок перевищує допустимий розмір', 413);
  }
  if (!Array.isArray(invoice.items) || invoice.items.length === 0) {
    reject('INVALID_INVOICE_PAYLOAD', 'Додайте хоча б одну позицію рахунку');
  }
  if (invoice.items.length > MAX_INVOICE_ITEMS) {
    reject(
      'INVOICE_TOO_LARGE',
      `Рахунок може містити не більше ${MAX_INVOICE_ITEMS} ${plural(MAX_INVOICE_ITEMS, ['позиції', 'позицій', 'позицій'])}`,
      413,
    );
  }

  const items = invoice.items.map(normalizeItem);
  const sourceItemByTimeLogId = Object.create(null);
  const itemIds = new Set();
  items.forEach(item => {
    if (itemIds.has(item.itemId)) {
      reject(
        'INVOICE_DUPLICATE_ITEM',
        'Одна позиція не може входити до рахунку кілька разів',
      );
    }
    itemIds.add(item.itemId);
    item.sourceTimeLogIds.forEach(logId => {
      if (sourceItemByTimeLogId[logId]) {
        reject(
          'INVOICE_SOURCE_IDS_MISMATCH',
          'Один запис часу не може входити до кількох позицій рахунку',
        );
      }
      sourceItemByTimeLogId[logId] = item;
    });
  });
  const itemSourceIds = Object.keys(sourceItemByTimeLogId);
  if (itemSourceIds.length > MAX_INVOICE_SOURCE_LOGS) {
    reject(
      'INVOICE_TOO_LARGE',
      `Рахунок може містити не більше ${MAX_INVOICE_SOURCE_LOGS} ${plural(MAX_INVOICE_SOURCE_LOGS, ['запису', 'записів', 'записів'])} часу`,
      413,
    );
  }
  const declaredSourceIds = sourceIds(
    invoice.sourceTimeLogIds || [],
    'Записи часу рахунку',
  );
  const declaredSet = new Set(declaredSourceIds);
  if (
    declaredSet.size !== itemSourceIds.length
    || itemSourceIds.some(id => !declaredSet.has(id))
  ) {
    reject(
      'INVOICE_SOURCE_IDS_MISMATCH',
      'Список записів часу рахунку не збігається з його позиціями',
    );
  }
  const sourceLessItemIds = items
    .filter(item => item.sourceTimeLogIds.length === 0)
    .map(item => item.itemId);
  // Each actual source needs one immutable-log update and one deterministic
  // reservation write. Source-less items need one estimate reservation; the
  // invoice, project lock and organization/year number sequence consume
  // another three writes. Stay well below
  // Firestore's 500-write transaction ceiling.
  const transactionWriteCount = (
    3
    + (itemSourceIds.length * 2)
    + sourceLessItemIds.length
  );
  if (transactionWriteCount > MAX_INVOICE_TRANSACTION_WRITES) {
    reject(
      'INVOICE_TOO_LARGE',
      'Рахунок містить забагато джерел для однієї безпечної транзакції',
      413,
      {
        maxTransactionWrites: MAX_INVOICE_TRANSACTION_WRITES,
        transactionWriteCount,
      },
    );
  }

  const currency = limitedString(invoice.currency, {
    label: 'Валюта',
    max: 3,
    required: true,
  }).toUpperCase();
  if (!SUPPORTED_CURRENCIES.has(currency)) {
    reject('INVALID_INVOICE_PAYLOAD', 'Непідтримувана валюта рахунку');
  }

  const discountPct = percent(invoice.discountPct, 'Знижка');
  const taxPct = percent(invoice.taxPct, 'Податок');
  const subtotal = money(items.reduce((sum, item) => sum + item.price, 0));
  const discount = money(subtotal * (discountPct / 100));
  const tax = money((subtotal - discount) * (taxPct / 100));
  const total = money(subtotal - discount + tax);

  const suppliedAmounts = [
    ['Підсумок', invoice.subtotal, subtotal],
    ['Сума знижки', invoice.discount, discount],
    ['Сума податку', invoice.tax, tax],
    ['До оплати', invoice.total, total],
  ];
  suppliedAmounts.forEach(([label, supplied, derived]) => {
    const valid = finiteNonnegative(supplied, label);
    if (!closeMoney(valid, derived)) {
      reject(
        'INVOICE_TOTAL_MISMATCH',
        `${label} не збігається із сумою позицій рахунку`,
      );
    }
  });

  return {
    organizationId,
    projectId,
    itemIds: [...itemIds],
    sourceItemByTimeLogId,
    sourceTimeLogIds: itemSourceIds,
    sourceItemIds: sourceLessItemIds,
    transactionWriteCount,
    invoice: {
      date: limitedString(invoice.date, {
        label: 'Дата рахунку',
        max: 40,
        required: true,
      }),
      currency,
      clientName: limitedString(invoice.clientName, {
        label: 'Назва клієнта',
        max: 240,
      }),
      clientDetails: limitedString(invoice.clientDetails, {
        label: 'Реквізити клієнта',
        max: 10_000,
      }),
      fromName: limitedString(invoice.fromName, {
        label: 'Назва виконавця',
        max: 240,
      }),
      fromDetails: limitedString(invoice.fromDetails, {
        label: 'Реквізити виконавця',
        max: 10_000,
      }),
      notes: limitedString(invoice.notes, {
        label: 'Примітки',
        max: 10_000,
      }),
      discountPct,
      taxPct,
      discount,
      tax,
      subtotal,
      total,
      items,
      sourceTimeLogIds: itemSourceIds,
    },
  };
}

export function invoiceReservationId(organizationId, projectId, timeLogId) {
  return createHash('sha256')
    .update(JSON.stringify([organizationId, projectId, timeLogId]))
    .digest('hex');
}

export function invoiceSourcelessReservationId(organizationId, projectId, itemId) {
  return createHash('sha256')
    .update(JSON.stringify([organizationId, projectId, 'source-less-item', itemId]))
    .digest('hex');
}

export function invoiceNumberSequenceId(organizationId, year) {
  return createHash('sha256')
    .update(JSON.stringify([organizationId, 'invoice-number', year]))
    .digest('hex');
}

export function invoiceIsCancelled(invoice) {
  const status = typeof invoice?.status === 'string'
    ? invoice.status.trim().toLowerCase()
    : '';
  return CANCELLED_STATUSES.has(status);
}

export function invoiceSourceIds(invoice) {
  if (!invoice || invoiceIsCancelled(invoice)) return [];
  const ids = [
    ...(Array.isArray(invoice.sourceTimeLogIds) ? invoice.sourceTimeLogIds : []),
    ...(Array.isArray(invoice.items)
      ? invoice.items.flatMap(item => (
        Array.isArray(item?.sourceTimeLogIds) ? item.sourceTimeLogIds : []
      ))
      : []),
  ].filter(id => typeof id === 'string' && id.trim());
  return [...new Set(ids.map(id => id.trim()))];
}

export function legacyInvoiceOverlap(sourceTimeLogIds = [], invoices = []) {
  const requested = new Set(sourceTimeLogIds);
  const overlap = new Set();
  invoices.forEach(invoice => {
    invoiceSourceIds(invoice).forEach(id => {
      if (requested.has(id)) overlap.add(id);
    });
  });
  return [...overlap];
}

export function invoiceSourceLessItemIds(invoice) {
  if (!invoice || invoiceIsCancelled(invoice)) return [];
  const ids = (Array.isArray(invoice.items) ? invoice.items : []).flatMap(item => {
    const itemId = typeof item?.itemId === 'string' ? item.itemId.trim() : '';
    const sourceIds = Array.isArray(item?.sourceTimeLogIds)
      ? item.sourceTimeLogIds.filter(id => typeof id === 'string' && id.trim())
      : [];
    return itemId && sourceIds.length === 0 ? [itemId] : [];
  });
  return [...new Set(ids)];
}

export function legacyInvoiceItemOverlap(sourceItemIds = [], invoices = []) {
  const requested = new Set(sourceItemIds);
  const overlap = new Set();
  invoices.forEach(invoice => {
    invoiceSourceLessItemIds(invoice).forEach(id => {
      if (requested.has(id)) overlap.add(id);
    });
  });
  return [...overlap];
}

/**
 * Invoices created before source tracking only stored the visible issue key.
 * Matching keys are intentionally blocked for manual reconciliation: allowing
 * them through would silently invoice historical work for a second time.
 */
export function legacyInvoiceAmbiguousItemOverlap(items = [], invoices = []) {
  const legacyKeys = new Set();
  invoices.forEach(invoice => {
    if (!invoice || invoiceIsCancelled(invoice)) return;
    (Array.isArray(invoice.items) ? invoice.items : []).forEach(item => {
      const itemId = typeof item?.itemId === 'string' ? item.itemId.trim() : '';
      const sourceIds = Array.isArray(item?.sourceTimeLogIds)
        ? item.sourceTimeLogIds.filter(id => typeof id === 'string' && id.trim())
        : [];
      const key = typeof item?.key === 'string' ? item.key.trim() : '';
      if (!itemId && sourceIds.length === 0 && key) legacyKeys.add(key);
    });
  });

  return [...new Set((Array.isArray(items) ? items : []).flatMap(item => {
    const key = typeof item?.key === 'string' ? item.key.trim() : '';
    const itemId = typeof item?.itemId === 'string' ? item.itemId.trim() : '';
    return itemId && key && legacyKeys.has(key) ? [itemId] : [];
  }))];
}

export function validateInvoiceItemMinutes({ items = [], timeLogsById = {} } = {}) {
  const changedItemIds = [];
  (Array.isArray(items) ? items : []).forEach(item => {
    const ids = Array.isArray(item?.sourceTimeLogIds)
      ? item.sourceTimeLogIds
      : [];
    if (ids.length === 0) return;
    const rawMinutes = ids.reduce(
      (total, id) => total + Number(timeLogsById[id]?.spentMinutes || 0),
      0,
    );
    if (item.minutes !== rawMinutes) changedItemIds.push(item.itemId);
  });
  if (changedItemIds.length > 0) {
    reject(
      'INVOICE_TIME_CHANGED',
      'Зафіксований час змінився. Оновіть рахунок і перевірте позиції ще раз',
      409,
      { sourceItemIds: changedItemIds },
    );
  }
  return true;
}

export function validateSourceLessInvoiceIssue({
  item,
  issue,
  hasLiveChildren = false,
  hasAnyTimeLogs = false,
} = {}) {
  if (!item?.issueId || !issue || item.issueId !== issue.id) {
    reject(
      'INVOICE_ISSUE_INVALID',
      'Позиція без фактичного часу не належить доступному завданню',
      409,
      { sourceItemIds: item?.itemId ? [item.itemId] : [] },
    );
  }
  if (hasAnyTimeLogs) {
    reject(
      'INVOICE_ESTIMATE_HAS_ACTUAL_TIME',
      'Завдання вже має фактичний час. Виставляйте лише нові невиставлені записи',
      409,
      { sourceItemIds: [item.itemId] },
    );
  }

  // Дві різні позиції без логів, і до цього вони перевірялись як одна.
  //
  // `estimate` — це стара модель, коли оцінка ставала грошима. Її більше немає:
  // «оцінка ніколи не стає грошима, а робота без зафіксованого часу отримує суму
  // вручну» (docs/ARCHITECTURE.md → «Рахунки»), і джерело `estimate` лишилося
  // тільки на вже виставлених рахунках. Екран рахунку так і працює: позиція без
  // логів має нуль хвилин, а ціну їй вписують руками.
  //
  // Перевірка ж вимагала від КОЖНОЇ позиції без логів, щоб її хвилини дорівнювали
  // оцінці задачі, а браузер для таких позицій завжди шле нуль. Наслідок: варто
  // було вибрати задачу, якій колись поставили оцінку, — і «Зберегти чернетку»
  // відмовляло назавжди, з текстом про те, що оцінка «змінилася». Вона не
  // змінювалася; її просто ніхто не збирався виставляти.
  if (item.sourceKind === 'estimate') {
    if (hasLiveChildren) {
      reject(
        'INVOICE_SUMMARY_ESTIMATE_CONFLICT',
        'Оцінку основної задачі з підзавданнями не можна виставляти окремо',
        409,
        { sourceItemIds: [item.itemId] },
      );
    }
    const rawEstimate = Number(issue.estimateMinutes || 0);
    const estimateMinutes = Number.isFinite(rawEstimate) && rawEstimate >= 0
      ? rawEstimate
      : 0;
    if (item.minutes !== estimateMinutes) {
      reject(
        'INVOICE_ESTIMATE_CHANGED',
        'Оцінка завдання змінилася. Оновіть рахунок і перевірте позицію',
        409,
        { sourceItemIds: [item.itemId] },
      );
    }
    return true;
  }

  // Позиція без логів не виставляє часу. Нуль — не «нічого не заповнили», а те
  // саме, що показує екран: годин немає, сума вписана рукою.
  if (item.minutes !== 0) {
    reject(
      'INVOICE_SOURCELESS_MINUTES',
      'Позиція без зафіксованого часу не може виставляти години — вкажіть суму вручну',
      409,
      { sourceItemIds: [item.itemId] },
    );
  }
  return true;
}

export function validateInvoiceTimeLog({
  timeLog,
  organizationId,
  projectId,
  item,
}) {
  if (
    !timeLog
    || timeLog.organizationId !== organizationId
    || timeLog.projectId !== projectId
  ) {
    reject(
      'INVOICE_TIME_LOG_INVALID',
      'Запис часу не належить вибраному проєкту',
    );
  }
  if (
    (typeof timeLog.invoiceId === 'string' && timeLog.invoiceId.trim())
    || timeLog.billedAt
  ) {
    reject(
      'INVOICE_TIME_LOG_CONFLICT',
      'Запис часу вже входить в інший рахунок',
      409,
    );
  }
  if (
    !Number.isSafeInteger(timeLog.spentMinutes)
    || timeLog.spentMinutes <= 0
    || timeLog.spentMinutes > MAX_TIME_LOG_MINUTES
  ) {
    reject(
      'INVOICE_TIME_LOG_INVALID',
      'Запис часу містить некоректну кількість хвилин',
    );
  }
  if (item?.issueId && timeLog.issueId !== item.issueId) {
    reject(
      'INVOICE_TIME_LOG_INVALID',
      'Запис часу не належить позиції рахунку',
    );
  }
  if (
    item?.issueId
    && (
      timeLog.sourceType === 'calendar_event'
      || Boolean(timeLog.eventId)
      || Boolean(timeLog.occurrenceStartAt)
    )
  ) {
    reject(
      'INVOICE_TIME_LOG_INVALID',
      'Позиція завдання містить календарний запис часу',
    );
  }
  if (
    !item?.issueId
    && item?.itemId?.startsWith('billing:')
    && (
      timeLog.sourceType !== 'calendar_event'
      || !timeLog.eventId
      || !timeLog.occurrenceStartAt
      || Boolean(timeLog.issueId)
      || item.itemId !== `billing:event:${timeLog.eventId || ''}:${timeLog.occurrenceStartAt || ''}`
    )
  ) {
    reject(
      'INVOICE_TIME_LOG_INVALID',
      'Позиція події містить сторонній запис часу',
    );
  }
  if (!item?.issueId && !item?.itemId?.startsWith('billing:')) {
    reject(
      'INVOICE_TIME_LOG_INVALID',
      'Запис часу не прив’язаний до позиції рахунку',
    );
  }
  return true;
}

export function isFirestoreAlreadyExists(error) {
  return error?.code === 6
    || error?.code === 'already-exists'
    || error?.code === 'ALREADY_EXISTS';
}
