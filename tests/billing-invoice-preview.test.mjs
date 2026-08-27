import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('an unsaved invoice preview never exposes a provisional number or export actions', async () => {
  const billing = await read('../src/components/workspace/BillingTab.jsx');
  const preview = billing.slice(
    billing.indexOf('function InvoicePreview'),
    billing.indexOf('// ── MAIN COMPONENT'),
  );
  const draftBuilder = billing.slice(
    billing.indexOf('const buildInvoice'),
    billing.indexOf('// ── Save invoice'),
  );

  assert.doesNotMatch(
    billing,
    /function invoiceNumber|Math\.random\(\)|draftNumber|server-assigned/,
  );
  assert.doesNotMatch(draftBuilder, /\bnumber\s*:/);
  assert.match(
    billing,
    /setInvoicePreviewState\(\{[\s\S]{0,100}projectKey: billingProjectKey,[\s\S]{0,100}kind: 'draft',[\s\S]{0,100}invoice: buildInvoice\(\)/,
  );
  assert.match(
    preview,
    /Офіційний номер рахунку з’явиться після збереження\./,
  );
  assert.match(preview, /if \(!canExport\) return;/);
  // Один спосіб віддати рахунок — надрукувати його, і з того ж вікна браузер
  // зберігає PDF. Копія віддавала документ простим текстом без оформлення, а
  // таблиця в XLSX — це не рахунок, а його вміст; обидві прибрані. Незбережена
  // чернетка не отримує навіть друку — лише «Закрити».
  assert.match(
    preview,
    /footer=\{[\s\S]{0,120}canExport \? \([\s\S]{0,1400}Друкувати[\s\S]{0,250}Закрити/,
  );
  assert.doesNotMatch(preview, /ExportMenu|Копіювати|handleCopy/);
});

test('saved history opens the persisted snapshot and exports its server number', async () => {
  const billing = await read('../src/components/workspace/BillingTab.jsx');
  const history = billing.slice(
    billing.indexOf("{tab === 'history'"),
    billing.indexOf('{/* RIGHT: always-visible invoice summary rail'),
  );
  const preview = billing.slice(
    billing.indexOf('function InvoicePreview'),
    billing.indexOf('// ── MAIN COMPONENT'),
  );

  assert.match(
    billing,
    /const showSavedInvoice = invoice => \{[\s\S]{0,180}setInvoicePreviewState\(\{[\s\S]{0,100}projectKey: billingProjectKey,[\s\S]{0,100}kind: 'saved',[\s\S]{0,100}invoice,/,
  );
  // Відкриває весь рядок, а не одна кнопка в його кінці: номер, дата й сума —
  // це і є рахунок, і в історію заходять саме по нього.
  assert.match(history, /title=\{`Відкрити рахунок \$\{inv\.number\}`\}/);
  assert.match(history, /showSavedInvoice\(inv\);/);
  assert.doesNotMatch(history, /title="Переглянути збережений рахунок"/);
  assert.match(billing, /invoice=\{invoicePreview\.invoice\}/);
  assert.match(billing, /isSaved=\{invoicePreview\.kind === 'saved'\}/);
  assert.doesNotMatch(billing, /invoice=\{buildInvoice\(\)\}/);
  // Анулювання живе біля самого рахунку, а не іконкою в списку: це рішення про
  // конкретний документ, і ухвалюють його, подивившись на нього.
  assert.match(preview, /const canVoid = Boolean\(onVoid\) && isSaved && invoice\?\.status === 'draft'/);
  assert.match(preview, /\{canVoid && \(/);
  assert.doesNotMatch(history, /icon=\{Ban\}/);
  // The window spans the footer, which carries «OneB Invoice · в розробці»,
  // disabled on purpose until the contract between the two applications exists.
  assert.match(
    billing,
    /title=\{dialogTitle\}[\s\S]{0,3000}\{canExport \? \([\s\S]{0,900}\{officialNumber\}/,
  );
  // Друкований аркуш будується з даних рахунку й має власну таблицю стилів під
  // власну розмітку. Доти в нього віддавали `innerHTML` екранного документа —
  // з утилітами Tailwind, яких у вікні друку немає, і з обома списками позицій
  // одразу, бо `hidden`/`sm:` там теж нічого не означають.
  assert.match(preview, /<title>\$\{escapeHtml\(officialNumber\)\}<\/title>/);
  assert.doesNotMatch(preview, /printRef\.current\?\.innerHTML/);
  assert.match(preview, /class="totals"/);
  assert.match(preview, /class="item-title"/);
});
