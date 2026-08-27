import test from 'node:test';
import assert from 'node:assert/strict';

import {
  billedTimeLogDetails,
  isBilledTimeLog,
} from '../src/lib/utils/issueDeletion.mjs';

test('invoice id or billed timestamp makes a time log immutable billing evidence', () => {
  assert.equal(isBilledTimeLog({ invoiceId: 'invoice-a' }), true);
  assert.equal(isBilledTimeLog({ billedAt: { seconds: 1 } }), true);
  assert.equal(isBilledTimeLog({ invoiceId: '  ' }), false);
  assert.deepEqual(billedTimeLogDetails([
    { id: 'log-a', invoiceId: 'invoice-b' },
    { id: 'log-b', invoiceId: 'invoice-a' },
    { id: 'log-c', invoiceId: 'invoice-b', billedAt: true },
    { id: 'open' },
  ]), {
    billedTimeLogIds: ['log-a', 'log-b', 'log-c'],
    invoiceIds: ['invoice-a', 'invoice-b'],
  });
});
