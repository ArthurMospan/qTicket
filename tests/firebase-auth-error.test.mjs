import test from 'node:test';
import assert from 'node:assert/strict';
import { isRejectedIdTokenError } from '../src/lib/utils/firebaseAuthError.mjs';

test('an invalid or expired caller token is an authentication rejection', () => {
  assert.equal(isRejectedIdTokenError({ code: 'auth/id-token-expired' }), true);
  assert.equal(isRejectedIdTokenError({
    code: 'auth/argument-error',
    message: 'Decoding Firebase ID token failed. Make sure you passed the entire string JWT.',
  }), true);
});

test('an Admin SDK or network failure is not misreported as a signed-out user', () => {
  assert.equal(isRejectedIdTokenError({
    code: 'auth/argument-error',
    message: 'Credential implementation failed',
    cause: { code: 'EACCES' },
  }), false);
  assert.equal(isRejectedIdTokenError({ code: 'auth/argument-error', message: 'Invalid credential configuration' }), false);
  assert.equal(isRejectedIdTokenError({ code: 'auth/internal-error', cause: { code: 'ENETUNREACH' } }), false);
});
