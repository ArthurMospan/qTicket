import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InvoicePayloadError,
  invoiceSourcelessReservationId,
  invoiceNumberSequenceId,
  invoiceReservationId,
  legacyInvoiceAmbiguousItemOverlap,
  legacyInvoiceItemOverlap,
  legacyInvoiceOverlap,
  normalizeInvoiceRequest,
  validateInvoiceItemMinutes,
  validateSourceLessInvoiceIssue,
  validateInvoiceTimeLog,
} from '../src/lib/server/invoicePayload.mjs';

function request(overrides = {}) {
  const item = {
    itemId: 'issue-1',
    issueId: 'issue-1',
    key: 'QUI-1',
    title: 'Розробка',
    status: 'Виконано',
    minutes: 60,
    price: 100,
    sourceKind: 'actual',
    sourceTimeLogIds: ['log-1'],
    ...(overrides.item || {}),
  };
  return {
    organizationId: 'org-1',
    projectId: 'project-1',
    invoice: {
      number: 'INV-1',
      date: '29.07.2026',
      currency: 'USD',
      clientName: 'Клієнт',
      clientDetails: '',
      fromName: 'QuickTeam',
      fromDetails: '',
      notes: '',
      discountPct: 10,
      taxPct: 20,
      subtotal: 100,
      discount: 10,
      tax: 18,
      total: 108,
      items: [item],
      sourceTimeLogIds: ['log-1'],
      ...overrides.invoice,
    },
    ...overrides.body,
  };
}

test('normalizes a bounded invoice and derives authoritative totals', () => {
  const input = request();
  delete input.invoice.number;
  const normalized = normalizeInvoiceRequest(input);

  assert.equal(normalized.organizationId, 'org-1');
  assert.equal(normalized.projectId, 'project-1');
  assert.deepEqual(normalized.sourceTimeLogIds, ['log-1']);
  assert.deepEqual(normalized.itemIds, ['issue-1']);
  assert.deepEqual(normalized.sourceItemIds, []);
  assert.equal(normalized.transactionWriteCount, 5);
  assert.equal(normalized.invoice.subtotal, 100);
  assert.equal(normalized.invoice.discount, 10);
  assert.equal(normalized.invoice.tax, 18);
  assert.equal(normalized.invoice.total, 108);
  assert.equal(Object.hasOwn(normalized.invoice, 'number'), false);
  assert.equal(normalized.sourceItemByTimeLogId['log-1'].issueId, 'issue-1');
});

test('a source-less position stays valid and reserves its billing item', () => {
  const normalized = normalizeInvoiceRequest(request({
    item: {
      sourceKind: 'none',
      sourceTimeLogIds: [],
      minutes: 0,
    },
    invoice: {
      sourceTimeLogIds: [],
    },
  }));

  assert.deepEqual(normalized.sourceTimeLogIds, []);
  assert.deepEqual(normalized.sourceItemIds, ['issue-1']);
});

test('an estimate can no longer be named as the source of a new position', () => {
  assert.throws(
    () => normalizeInvoiceRequest(request({
      item: {
        sourceKind: 'estimate',
        sourceTimeLogIds: [],
        minutes: 120,
      },
      invoice: {
        sourceTimeLogIds: [],
      },
    })),
    error => error.code === 'INVALID_INVOICE_PAYLOAD',
  );
});

test('issue-backed item ids are stable and arbitrary source-less lines are rejected', () => {
  assert.throws(
    () => normalizeInvoiceRequest(request({
      item: { itemId: 'arbitrary-id' },
    })),
    error => error.code === 'INVOICE_ITEM_ID_MISMATCH',
  );
  assert.throws(
    () => normalizeInvoiceRequest(request({
      item: {
        itemId: 'manual-line',
        issueId: null,
        sourceKind: 'manual',
        sourceTimeLogIds: [],
      },
      invoice: { sourceTimeLogIds: [] },
    })),
    error => error.code === 'INVALID_INVOICE_PAYLOAD',
  );
});

test('root and line source IDs must be identical and unique across items', () => {
  assert.throws(
    () => normalizeInvoiceRequest(request({
      invoice: { sourceTimeLogIds: [] },
    })),
    error => (
      error instanceof InvoicePayloadError
      && error.code === 'INVOICE_SOURCE_IDS_MISMATCH'
    ),
  );

  const duplicated = request();
  duplicated.invoice.items.push({
    ...duplicated.invoice.items[0],
    itemId: 'issue-2',
    issueId: 'issue-2',
  });
  duplicated.invoice.subtotal = 200;
  duplicated.invoice.discount = 20;
  duplicated.invoice.tax = 36;
  duplicated.invoice.total = 216;
  assert.throws(
    () => normalizeInvoiceRequest(duplicated),
    error => error.code === 'INVOICE_SOURCE_IDS_MISMATCH',
  );

  const duplicatedItem = request();
  duplicatedItem.invoice.items.push({
    ...duplicatedItem.invoice.items[0],
    sourceTimeLogIds: ['log-2'],
  });
  duplicatedItem.invoice.sourceTimeLogIds.push('log-2');
  duplicatedItem.invoice.subtotal = 200;
  duplicatedItem.invoice.discount = 20;
  duplicatedItem.invoice.tax = 36;
  duplicatedItem.invoice.total = 216;
  assert.throws(
    () => normalizeInvoiceRequest(duplicatedItem),
    error => error.code === 'INVOICE_DUPLICATE_ITEM',
  );
});

test('negative, non-finite and inconsistent money is rejected', () => {
  assert.throws(
    () => normalizeInvoiceRequest(request({
      item: { price: -1 },
    })),
    error => error.code === 'INVALID_INVOICE_PAYLOAD',
  );
  assert.throws(
    () => normalizeInvoiceRequest(request({
      item: { minutes: Number.NaN },
    })),
    error => error.code === 'INVALID_INVOICE_PAYLOAD',
  );
  assert.throws(
    () => normalizeInvoiceRequest(request({
      invoice: { total: 109 },
    })),
    error => error.code === 'INVOICE_TOTAL_MISMATCH',
  );
});

test('payload item and source counts are bounded', () => {
  const tooManyItems = request();
  tooManyItems.invoice.items = Array.from({ length: 351 }, (_, index) => ({
    ...tooManyItems.invoice.items[0],
    itemId: `estimate-${index}`,
    issueId: `estimate-${index}`,
    price: 0,
    sourceKind: 'estimate',
    sourceTimeLogIds: [],
  }));
  tooManyItems.invoice.sourceTimeLogIds = [];
  tooManyItems.invoice.subtotal = 0;
  tooManyItems.invoice.discount = 0;
  tooManyItems.invoice.tax = 0;
  tooManyItems.invoice.total = 0;

  assert.throws(
    () => normalizeInvoiceRequest(tooManyItems),
    error => error.code === 'INVOICE_TOO_LARGE' && error.status === 413,
  );

  const tooManySources = request({
    item: {
      sourceTimeLogIds: Array.from({ length: 351 }, (_, index) => `log-${index}`),
    },
    invoice: {
      sourceTimeLogIds: Array.from({ length: 351 }, (_, index) => `log-${index}`),
    },
  });
  assert.throws(
    () => normalizeInvoiceRequest(tooManySources),
    error => error.code === 'INVOICE_TOO_LARGE' && error.status === 413,
  );

  const tooManyTransactionalWrites = request({
    item: {
      sourceTimeLogIds: Array.from({ length: 225 }, (_, index) => `log-${index}`),
    },
    invoice: {
      sourceTimeLogIds: Array.from({ length: 225 }, (_, index) => `log-${index}`),
    },
  });
  assert.throws(
    () => normalizeInvoiceRequest(tooManyTransactionalWrites),
    error => (
      error.code === 'INVOICE_TOO_LARGE'
      && error.status === 413
      && error.details.transactionWriteCount > error.details.maxTransactionWrites
    ),
  );
});

test('document IDs and user-facing strings have explicit limits', () => {
  assert.throws(
    () => normalizeInvoiceRequest(request({
      body: { projectId: 'project/escape' },
    })),
    error => error.code === 'INVALID_INVOICE_PAYLOAD',
  );
  assert.throws(
    () => normalizeInvoiceRequest(request({
      invoice: { notes: 'x'.repeat(10_001) },
    })),
    error => error.code === 'INVALID_INVOICE_PAYLOAD',
  );
});

test('reservation IDs are stable and scoped by organization, project and log', () => {
  const first = invoiceReservationId('org-1', 'project-1', 'log-1');
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, invoiceReservationId('org-1', 'project-1', 'log-1'));
  assert.notEqual(first, invoiceReservationId('org-1', 'project-2', 'log-1'));
  assert.notEqual(first, invoiceReservationId('org-2', 'project-1', 'log-1'));

  const estimate = invoiceSourcelessReservationId('org-1', 'project-1', 'issue-1');
  assert.match(estimate, /^[a-f0-9]{64}$/);
  assert.equal(
    estimate,
    invoiceSourcelessReservationId('org-1', 'project-1', 'issue-1'),
  );
  assert.notEqual(
    estimate,
    invoiceSourcelessReservationId('org-1', 'project-1', 'issue-2'),
  );

  const sequence = invoiceNumberSequenceId('org-1', 2026);
  assert.match(sequence, /^[a-f0-9]{64}$/);
  assert.equal(sequence, invoiceNumberSequenceId('org-1', 2026));
  assert.notEqual(sequence, invoiceNumberSequenceId('org-1', 2027));
  assert.notEqual(sequence, invoiceNumberSequenceId('org-2', 2026));
});

test('legacy overlap includes drafts but ignores cancelled invoices', () => {
  const overlap = legacyInvoiceOverlap(['log-1', 'log-2'], [
    { status: 'draft', items: [{ sourceTimeLogIds: ['log-1'] }] },
    { status: 'cancelled', sourceTimeLogIds: ['log-2'] },
  ]);
  assert.deepEqual(overlap, ['log-1']);
});

test('legacy source-less invoice items reserve estimates but cancelled drafts release them', () => {
  const overlap = legacyInvoiceItemOverlap(['issue-1', 'issue-2'], [
    {
      status: 'draft',
      items: [{ itemId: 'issue-1', sourceTimeLogIds: [] }],
    },
    {
      status: 'cancelled',
      items: [{ itemId: 'issue-2', sourceTimeLogIds: [] }],
    },
  ]);
  assert.deepEqual(overlap, ['issue-1']);
});

test('legacy invoices without source metadata conservatively reserve matching issue keys', () => {
  const overlap = legacyInvoiceAmbiguousItemOverlap([
    { itemId: 'issue-1', key: 'QUI-1' },
    { itemId: 'issue-2', key: 'QUI-2' },
  ], [
    {
      status: 'draft',
      items: [{ key: 'QUI-1', title: 'Old line without source metadata' }],
    },
    {
      status: 'cancelled',
      items: [{ key: 'QUI-2', title: 'Released legacy line' }],
    },
  ]);
  assert.deepEqual(overlap, ['issue-1']);
});

test('time logs must match project scope and their invoice item', () => {
  assert.equal(validateInvoiceTimeLog({
    timeLog: {
      organizationId: 'org-1',
      projectId: 'project-1',
      issueId: 'issue-1',
      spentMinutes: 60,
    },
    organizationId: 'org-1',
    projectId: 'project-1',
    item: { issueId: 'issue-1', itemId: 'issue-1' },
  }), true);

  assert.throws(
    () => validateInvoiceTimeLog({
      timeLog: {
        organizationId: 'org-1',
        projectId: 'project-2',
        issueId: 'issue-1',
        spentMinutes: 60,
      },
      organizationId: 'org-1',
      projectId: 'project-1',
      item: { issueId: 'issue-1', itemId: 'issue-1' },
    }),
    error => error.code === 'INVOICE_TIME_LOG_INVALID',
  );

  assert.throws(
    () => validateInvoiceTimeLog({
      timeLog: {
        organizationId: 'org-1',
        projectId: 'project-1',
        issueId: 'issue-1',
        spentMinutes: 60,
        invoiceId: 'invoice-existing',
      },
      organizationId: 'org-1',
      projectId: 'project-1',
      item: { issueId: 'issue-1', itemId: 'issue-1' },
    }),
    error => (
      error.code === 'INVOICE_TIME_LOG_CONFLICT'
      && error.status === 409
    ),
  );

  assert.throws(
    () => validateInvoiceTimeLog({
      timeLog: {
        organizationId: 'org-1',
        projectId: 'project-1',
        issueId: 'issue-1',
        sourceType: 'calendar_event',
        eventId: 'event-1',
        occurrenceStartAt: '2026-07-29T09:00:00.000Z',
        spentMinutes: 60,
      },
      organizationId: 'org-1',
      projectId: 'project-1',
      item: { issueId: 'issue-1', itemId: 'issue-1' },
    }),
    error => error.code === 'INVOICE_TIME_LOG_INVALID',
  );
});

test('calendar logs must match the exact billed occurrence', () => {
  const timeLog = {
    organizationId: 'org-1',
    projectId: 'project-1',
    issueId: '',
    sourceType: 'calendar_event',
    eventId: 'event-1',
    occurrenceStartAt: '2026-07-29T09:00:00.000Z',
    spentMinutes: 45,
  };
  assert.equal(validateInvoiceTimeLog({
    timeLog,
    organizationId: 'org-1',
    projectId: 'project-1',
    item: {
      issueId: null,
      itemId: 'billing:event:event-1:2026-07-29T09:00:00.000Z',
    },
  }), true);
  assert.throws(
    () => validateInvoiceTimeLog({
      timeLog,
      organizationId: 'org-1',
      projectId: 'project-1',
      item: {
        issueId: null,
        itemId: 'billing:event:event-1:2026-07-30T09:00:00.000Z',
      },
    }),
    error => error.code === 'INVOICE_TIME_LOG_INVALID',
  );
});

test('invoice item minutes must equal the immutable raw source sum', () => {
  const items = [{
    itemId: 'issue-1',
    minutes: 60,
    sourceTimeLogIds: ['log-1', 'log-2'],
  }];
  assert.equal(validateInvoiceItemMinutes({
    items,
    timeLogsById: {
      'log-1': { spentMinutes: 20 },
      'log-2': { spentMinutes: 40 },
    },
  }), true);
  assert.throws(
    () => validateInvoiceItemMinutes({
      items,
      timeLogsById: {
        'log-1': { spentMinutes: 20 },
        'log-2': { spentMinutes: 41 },
      },
    }),
    error => (
      error.code === 'INVOICE_TIME_CHANGED'
      && error.status === 409
      && error.details.sourceItemIds[0] === 'issue-1'
    ),
  );
});

// Позиція без логів — це не «оцінка». Екран рахунку шле для неї нуль хвилин і
// суму вручну, бо оцінка ніколи не стає грошима (docs/ARCHITECTURE.md →
// «Рахунки»). Перевірка ж вимагала рівності оцінці від усіх позицій без логів,
// тож задача, якій колись поставили оцінку, робила збереження неможливим:
// «Оцінка завдання змінилася» на першому ж натисканні, щоразу.
test('a line with no time logs bills no time, and says so when it tries to', () => {
  const item = {
    itemId: 'issue-1',
    issueId: 'issue-1',
    minutes: 0,
    sourceKind: 'none',
    sourceTimeLogIds: [],
  };
  const issue = { id: 'issue-1', estimateMinutes: 120 };
  // Оцінка задачі жодної ролі не грає: позиція виставляє нуль годин.
  assert.equal(validateSourceLessInvoiceIssue({ item, issue }), true);
  // Так само для позиції з ручною ціною, і так само з підзавданнями: ієрархія
  // на рахунок не впливає, коли ніхто не виставляє оцінку.
  assert.equal(
    validateSourceLessInvoiceIssue({
      item: { ...item, sourceKind: 'manual' },
      issue,
      hasLiveChildren: true,
    }),
    true,
  );
  // Але години з нізвідки — це розходження, і воно називається.
  assert.throws(
    () => validateSourceLessInvoiceIssue({ item: { ...item, minutes: 120 }, issue }),
    error => error.code === 'INVOICE_SOURCELESS_MINUTES',
  );
  // Задача з фактичним часом не може приїхати як позиція без джерел.
  assert.throws(
    () => validateSourceLessInvoiceIssue({ item, issue, hasAnyTimeLogs: true }),
    error => error.code === 'INVOICE_ESTIMATE_HAS_ACTUAL_TIME',
  );
});

// Стара модель лишилася тільки на вже виставлених рахунках, і поки вона там є,
// її перевірки лишаються теж.
test('source-less task billing revalidates estimate, hierarchy and actual time', () => {
  const item = {
    itemId: 'issue-1',
    issueId: 'issue-1',
    minutes: 120,
    sourceKind: 'estimate',
    sourceTimeLogIds: [],
  };
  const issue = { id: 'issue-1', estimateMinutes: 120 };
  assert.equal(validateSourceLessInvoiceIssue({ item, issue }), true);
  assert.throws(
    () => validateSourceLessInvoiceIssue({
      item,
      issue,
      hasLiveChildren: true,
    }),
    error => error.code === 'INVOICE_SUMMARY_ESTIMATE_CONFLICT',
  );
  assert.throws(
    () => validateSourceLessInvoiceIssue({
      item,
      issue,
      hasAnyTimeLogs: true,
    }),
    error => error.code === 'INVOICE_ESTIMATE_HAS_ACTUAL_TIME',
  );
  assert.throws(
    () => validateSourceLessInvoiceIssue({
      item,
      issue: { ...issue, estimateMinutes: 121 },
    }),
    error => error.code === 'INVOICE_ESTIMATE_CHANGED',
  );
});
