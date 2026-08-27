import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exchangeGrantForToken } from '../src/lib/portal/exchangeGrantForToken.mjs';

const base = {
  qtPlusUrl: 'https://qt.test',
  clientId: 'quickteam-workspace',
  clientSecret: 's3cret',
  refreshToken: 'grant-abc',
};

function fetchReturning(status, jsonBody) {
  return async () => new Response(JSON.stringify(jsonBody), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('missing config -> not_configured, no fetch', async () => {
  let called = false;
  const res = await exchangeGrantForToken({
    ...base, qtPlusUrl: '', fetchImpl: async () => { called = true; return new Response('{}'); },
  });
  assert.deepEqual(res, { ok: false, code: 'not_configured' });
  assert.equal(called, false);
});

test('200 -> passes token through', async () => {
  const res = await exchangeGrantForToken({
    ...base,
    fetchImpl: fetchReturning(200, { customToken: 'ct-1', qtUserId: 'uid-7', email: 'q@plus.test' }),
  });
  assert.deepEqual(res, { ok: true, customToken: 'ct-1', qtUserId: 'uid-7', email: 'q@plus.test' });
});

test('400 invalid_grant -> grant_invalid', async () => {
  const res = await exchangeGrantForToken({
    ...base, fetchImpl: fetchReturning(400, { code: 'invalid_grant' }),
  });
  assert.deepEqual(res, { ok: false, code: 'grant_invalid' });
});

test('401 -> upstream', async () => {
  const res = await exchangeGrantForToken({ ...base, fetchImpl: fetchReturning(401, { error: 'x' }) });
  assert.deepEqual(res, { ok: false, code: 'upstream' });
});

test('network throw -> upstream', async () => {
  const res = await exchangeGrantForToken({
    ...base, fetchImpl: async () => { throw new Error('boom'); },
  });
  assert.deepEqual(res, { ok: false, code: 'upstream' });
});

test('400 without invalid_grant -> upstream', async () => {
  const res = await exchangeGrantForToken({
    ...base, fetchImpl: fetchReturning(400, {}),
  });
  assert.deepEqual(res, { ok: false, code: 'upstream' });
});

test('200 without customToken -> upstream', async () => {
  const res = await exchangeGrantForToken({
    ...base, fetchImpl: fetchReturning(200, { qtUserId: 'uid-7' }),
  });
  assert.deepEqual(res, { ok: false, code: 'upstream' });
});
