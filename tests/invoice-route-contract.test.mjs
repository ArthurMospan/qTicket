import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('invoice creation is owner/admin-only and validates project scope in one transaction', async () => {
  const route = await read('../src/app/api/invoices/route.js');

  assert.match(
    route,
    /authorizeOrgRequest\([\s\S]{0,180}\['owner', 'admin'\]/,
  );
  assert.match(route, /await db\.runTransaction\(async transaction =>/);
  assert.match(route, /transaction\.get\(projectRef\)/);
  assert.match(route, /projectSnapshot\.data\(\)\.organizationId !== organizationId/);
  assert.match(route, /projectSnapshot\.data\(\)\.deletionPending === true/);
  assert.match(route, /invoiceMutationVersion:\s*FieldValue\.increment\(1\)/);
  assert.match(route, /transaction\.get\(invoiceNumberSequenceRef\)/);
  assert.match(
    route,
    /transaction\.set\(invoiceNumberSequenceRef,\s*\{[\s\S]{0,180}counter:\s*nextInvoiceCounter/,
  );
  assert.match(route, /number:\s*serverInvoiceNumber/);
});

test('invoice transaction checks legacy overlap and every source time log before writes', async () => {
  const route = await read('../src/app/api/invoices/route.js');
  const legacyRead = route.indexOf('transaction.get(legacyInvoiceQuery)');
  const timeLogRead = route.indexOf('transaction.getAll(...timeLogRefs)');
  const invoiceWrite = route.indexOf('transaction.create(invoiceRef');

  assert.ok(legacyRead > 0 && legacyRead < invoiceWrite);
  assert.ok(timeLogRead > 0 && timeLogRead < invoiceWrite);
  assert.match(route, /legacyInvoiceOverlap\(/);
  assert.match(route, /legacyInvoiceAmbiguousItemOverlap\(/);
  assert.match(route, /validateInvoiceTimeLog\(/);
  assert.match(route, /validateInvoiceItemMinutes\(/);
  assert.match(route, /validateSourceLessInvoiceIssue\(/);
  assert.match(route, /collection\('timeLogs'\)\.doc\(timeLogId\)/);
  assert.match(route, /transaction\.getAll\(\.\.\.sourceIssueRefs\)/);
  assert.match(route, /issue\.deletionPending === true/);
  assert.match(route, /where\('parentIssueId', 'in', issueIdChunk\)/);
  assert.match(route, /where\('parentEpicId', 'in', issueIdChunk\)/);
  assert.match(route, /where\('issueId', 'in', issueIdChunk\)/);
});

test('invoice and deterministic reservations are created atomically with server-owned metadata', async () => {
  const route = await read('../src/app/api/invoices/route.js');

  assert.match(route, /invoiceReservationId\(organizationId, projectId, timeLogId\)/);
  assert.match(route, /collection\('invoiceTimeLogReservations'\)/);
  assert.match(route, /transaction\.create\(reservationRef,\s*\{/);
  assert.match(route, /invoiceSourcelessReservationId\(organizationId, projectId, itemId\)/);
  assert.match(route, /collection\('invoiceEstimateReservations'\)/);
  assert.match(route, /legacyInvoiceItemOverlap\(/);
  assert.match(route, /createdBy:\s*authorization\.user\.uid/);
  assert.match(route, /createdAt:\s*now/);
  assert.match(route, /status:\s*'draft'/);
  assert.match(
    route,
    /transaction\.update\(timeLogRef,\s*\{[\s\S]{0,100}invoiceId:\s*invoiceRef\.id,[\s\S]{0,100}billedAt:\s*now/,
  );
  assert.match(route, /isFirestoreAlreadyExists\(error\)/);
  assert.match(route, /INVOICE_TIME_LOG_CONFLICT/);
});

test('BillingTab sends invoice drafts through the authenticated API service', async () => {
  const [billing, service] = await Promise.all([
    read('../src/components/workspace/BillingTab.jsx'),
    read('../src/lib/services/invoices.js'),
  ]);

  assert.match(
    billing,
    /import \{[^}]*\bcreateInvoiceViaApi\b[^}]*\} from '@\/lib\/services\/invoices'/s,
  );
  assert.match(billing, /await createInvoiceViaApi\(\{/);
  assert.doesNotMatch(billing, /addDoc\(collection\(db, 'invoices'\)/);
  assert.match(service, /fetch\('\/api\/invoices'/);
  assert.match(service, /Authorization:\s*`Bearer \$\{token\}`/);
  assert.match(service, /INVOICE_TIME_LOG_CONFLICT|result\.code/);
});

test('project deletion blocks accounting evidence and calendar references before cascading', async () => {
  const route = await read('../src/app/api/projects/[projectId]/route.js');
  const accountingGuard = route.indexOf("scoped('invoiceTimeLogReservations')");
  const deletionMarker = route.indexOf('deletionPending: true');
  const cascadeSnapshot = route.indexOf(
    "db.collection('issues').where('organizationId'",
  );

  assert.ok(accountingGuard > 0 && accountingGuard < deletionMarker);
  assert.ok(deletionMarker > accountingGuard && deletionMarker < cascadeSnapshot);
  assert.match(route, /PROJECT_HAS_ACCOUNTING_EVIDENCE/);
  assert.match(route, /PROJECT_HAS_CALENDAR_EVENTS/);
  assert.doesNotMatch(route, /\.\.\.invoiceReservations\.docs\.map\(document => document\.ref\)/);
  assert.doesNotMatch(route, /\.\.\.invoiceEstimateReservations\.docs\.map\(document => document\.ref\)/);
  assert.doesNotMatch(route, /\.\.\.invoices\.docs\.map\(document => document\.ref\)/);
});

test('draft voiding atomically releases immutable sources but preserves invoice history', async () => {
  const [route, billing, service] = await Promise.all([
    read('../src/app/api/invoices/[invoiceId]/void/route.js'),
    read('../src/components/workspace/BillingTab.jsx'),
    read('../src/lib/services/invoices.js'),
  ]);

  assert.match(route, /authorizeOrgRequest\([\s\S]{0,180}\['owner', 'admin'\]/);
  assert.match(route, /await db\.runTransaction\(async transaction =>/);
  assert.match(route, /currentInvoice\.status !== 'draft'/);
  assert.match(route, /status:\s*'void'/);
  assert.match(route, /invoiceId:\s*FieldValue\.delete\(\)/);
  assert.match(route, /billedAt:\s*FieldValue\.delete\(\)/);
  assert.match(route, /transaction\.delete\(snapshot\.ref\)/);
  assert.doesNotMatch(route, /transaction\.delete\(invoiceRef\)/);
  assert.match(service, /export async function voidInvoiceViaApi/);
  assert.match(billing, /await voidInvoiceViaApi\(invoice\.id\)/);
});
