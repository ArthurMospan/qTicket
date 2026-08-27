import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  convertBillingMemberRates,
  emptyBillingMemberState,
  reconcileBillingMemberState,
  setBillingMemberRate,
} from '../src/lib/utils/billingProjectState.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('member rate edits stay in one project and B-only assignees initialize cleanly', () => {
  const positions = [
    { id: 'developer', hourlyRate: 100 },
    { id: 'qa', hourlyRate: 120 },
  ];
  const projectA = 'org-1:project-a';
  const projectB = 'org-1:project-b';

  let state = reconcileBillingMemberState({
    state: emptyBillingMemberState(),
    projectKey: projectA,
    members: [{ id: 'a-1', positionId: 'developer' }],
    positions,
  });
  assert.deepEqual(state.rates, { 'a-1': 100 });

  state = setBillingMemberRate(state, {
    projectKey: projectA,
    uid: 'a-1',
    rate: 175,
  });
  state = reconcileBillingMemberState({
    state,
    projectKey: projectA,
    members: [
      { id: 'a-1', positionId: 'developer' },
      { id: 'a-2', hourlyRate: 80 },
    ],
    positions,
  });
  assert.deepEqual(state.rates, { 'a-1': 175, 'a-2': 80 });

  state = reconcileBillingMemberState({
    state,
    projectKey: projectB,
    members: [{ id: 'b-only', positionId: 'qa' }],
    positions,
  });
  assert.deepEqual(state.rates, { 'b-only': 120 });
  assert.deepEqual(state.presets, { 'b-only': 'qa' });
  assert.deepEqual(state.touchedRateIds, []);
  assert.equal(Object.hasOwn(state.rates, 'a-1'), false);
  assert.equal(Object.hasOwn(state.rates, 'a-2'), false);
});

test('position refresh updates defaults but never overwrites an in-project edit', () => {
  const projectKey = 'org-1:project-b';
  const member = { id: 'b-only', positionId: 'qa' };
  let state = reconcileBillingMemberState({
    state: emptyBillingMemberState(),
    projectKey,
    members: [member],
    positions: [{ id: 'qa', hourlyRate: 120 }],
  });

  state = reconcileBillingMemberState({
    state,
    projectKey,
    members: [member],
    positions: [{ id: 'qa', hourlyRate: 140 }],
  });
  assert.equal(state.rates['b-only'], 140);

  state = setBillingMemberRate(state, {
    projectKey,
    uid: 'b-only',
    rate: 200,
  });
  state = reconcileBillingMemberState({
    state,
    projectKey,
    members: [member],
    positions: [{ id: 'qa', hourlyRate: 160 }],
  });
  assert.equal(state.rates['b-only'], 200);
});

test('BillingTab hides and clears project-scoped invoice and rate state on switch', async () => {
  const billing = await read('../src/components/workspace/BillingTab.jsx');

  assert.match(
    billing,
    /const billingProjectKey = `\$\{activeOrgId \|\| ''\}:\$\{projectId \|\| ''\}`/,
  );
  assert.match(
    billing,
    /const savedInvoices = savedInvoiceState\.projectKey === billingProjectKey[\s\S]{0,100}: EMPTY_INVOICES/,
  );
  assert.match(
    billing,
    /const invoicePreview = invoicePreviewState\?\.projectKey === billingProjectKey[\s\S]{0,100}: null/,
  );
  assert.match(
    billing,
    /previous\.projectKey !== billingProjectKey[\s\S]{0,100}emptyBillingMemberState\(billingProjectKey\)/,
  );
  assert.match(
    billing,
    /if \(logsLoading\) return previous;[\s\S]{0,160}reconcileBillingMemberState/,
  );
  assert.match(
    billing,
    /previous\.projectKey === billingProjectKey[\s\S]{0,120}\{ projectKey: billingProjectKey, invoices: \[\] \}/,
  );
  assert.match(
    billing,
    /previous\?\.projectKey === billingProjectKey \? previous : null/,
  );
  assert.doesNotMatch(billing, /\bsetSavedInvoices\b|\bsetMemberRates\b|\bsetMemberPresets\b/);
});

test('changing the invoice currency converts the figures rather than relabelling them', () => {
  let state = emptyBillingMemberState('org:project');
  state = setBillingMemberRate(state, { projectKey: 'org:project', uid: 'u1', rate: 30 });
  state = setBillingMemberRate(state, { projectKey: 'org:project', uid: 'u2', rate: 0 });

  const converted = convertBillingMemberRates(state, {
    projectKey: 'org:project',
    factor: 41.5,
  });
  assert.equal(converted.rates.u1, 1245);
  // A rate nobody set stays unset rather than becoming a converted zero.
  assert.equal(converted.rates.u2, 0);
  assert.ok(converted.touchedRateIds.includes('u1'));

  // Rounded to the cent, so an invoice never shows a number it cannot print.
  const rounded = convertBillingMemberRates(
    setBillingMemberRate(emptyBillingMemberState('k'), { projectKey: 'k', uid: 'u', rate: 33.33 }),
    { projectKey: 'k', factor: 1.0777 },
  );
  assert.equal(rounded.rates.u, 35.92);

  // A meaningless factor is a no-op, not a wipe.
  for (const factor of [0, -2, Number.NaN, 1]) {
    assert.deepEqual(
      convertBillingMemberRates(state, { projectKey: 'org:project', factor }).rates,
      state.rates,
    );
  }
});

test('the invoice cannot be saved while its figures and its currency disagree', async () => {
  const billing = await read('../src/components/workspace/BillingTab.jsx');

  assert.match(billing, /const currencyChanged = currency !== amountsCurrency && hasEnteredAmounts/);
  assert.match(billing, /disabled=\{checkedCount === 0 \|\| currencyChanged\}/);
  // Both the preview and the save are gated, not just one of them.
  assert.equal(billing.match(/disabled=\{checkedCount === 0 \|\| currencyChanged\}/g).length, 2);
  // The busy state is the button's own, so the label cannot shift under a
  // spinner rendered beside it. The label is «Створити рахунок», not «Зберегти
  // чернетку»: pressing it takes an official number out of the organization's
  // sequence and locks the time logs it bills, which is not what saving a draft
  // means anywhere else.
  assert.match(billing, /loading=\{saving\}[\s\S]{0,260}Створити рахунок/);
  assert.doesNotMatch(billing, /<LoadingSpinner size="sm" className="mr-2 inline" \/>/);
  // The per-position bulk buttons are gone; the position picker on each row is
  // the one way to apply a position's rate.
  assert.doesNotMatch(billing, /Швидкі пресети/);
});
