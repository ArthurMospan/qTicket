import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSameOriginUrl } from '../src/lib/utils/browserNavigation.mjs';

test('auth hand-offs resolve relative paths against the current origin', () => {
  assert.equal(
    resolveSameOriginUrl('/api/auth/oneb/start?r=%2Fsettings', 'https://team.example'),
    'https://team.example/api/auth/oneb/start?r=%2Fsettings',
  );
});

test('auth hand-offs reject absolute and protocol-relative external URLs', () => {
  for (const target of ['https://evil.example/steal', '//evil.example/steal', 'javascript:alert(1)']) {
    assert.throws(
      () => resolveSameOriginUrl(target, 'https://team.example'),
      /Cross-origin browser navigation is not allowed/,
    );
  }
});
