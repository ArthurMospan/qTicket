import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { seal, open } from '../src/lib/server/secretBox.mjs';

const KEY = randomBytes(32).toString('base64');

test('round-trips a secret', () => {
  process.env.QTPLUS_TOKEN_KEY = KEY;
  const box = seal('refresh-token-value');
  assert.equal(open(box), 'refresh-token-value');
});

test('the sealed box never contains the plaintext', () => {
  process.env.QTPLUS_TOKEN_KEY = KEY;
  const box = seal('refresh-token-value');
  assert.equal(JSON.stringify(box).includes('refresh-token-value'), false);
});

test('the same plaintext seals differently every time', () => {
  process.env.QTPLUS_TOKEN_KEY = KEY;
  // A reused IV in GCM is catastrophic, so this is not a style preference.
  assert.notEqual(seal('x').data, seal('x').data);
  assert.notEqual(seal('x').iv, seal('x').iv);
});

test('refuses to open a tampered ciphertext', () => {
  process.env.QTPLUS_TOKEN_KEY = KEY;
  const box = seal('refresh-token-value');
  const flipped = Buffer.from(box.data, 'base64');
  flipped[0] ^= 0xff;
  // GCM must make this an error, never a silently different plaintext.
  assert.throws(() => open({ ...box, data: flipped.toString('base64') }));
});

test('refuses to open with a tampered auth tag', () => {
  process.env.QTPLUS_TOKEN_KEY = KEY;
  const box = seal('refresh-token-value');
  const tag = Buffer.from(box.tag, 'base64');
  tag[0] ^= 0xff;
  assert.throws(() => open({ ...box, tag: tag.toString('base64') }));
});

test('refuses to open with the wrong key', () => {
  process.env.QTPLUS_TOKEN_KEY = KEY;
  const box = seal('refresh-token-value');
  process.env.QTPLUS_TOKEN_KEY = randomBytes(32).toString('base64');
  assert.throws(() => open(box));
});

test('refuses an unsupported box version', () => {
  process.env.QTPLUS_TOKEN_KEY = KEY;
  const box = seal('x');
  assert.throws(() => open({ ...box, v: 2 }));
  assert.throws(() => open(null));
});

test('fails closed when the key is missing or the wrong size', () => {
  delete process.env.QTPLUS_TOKEN_KEY;
  assert.throws(() => seal('x'), /QTPLUS_TOKEN_KEY/);

  process.env.QTPLUS_TOKEN_KEY = randomBytes(16).toString('base64');
  assert.throws(() => seal('x'), /32/);

  process.env.QTPLUS_TOKEN_KEY = KEY;
});
