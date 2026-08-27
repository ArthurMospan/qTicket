import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  classifyGeminiFailure,
  geminiFailureMessage,
  parseGeminiApiKeys,
  rotateKeys,
} from '../src/lib/ai/geminiKeys.mjs';

const key = suffix => `AIzaSyEXAMPLEKEY000000${suffix}`;

test('one key, several keys and both variables all parse into one ordered list', () => {
  assert.deepEqual(parseGeminiApiKeys({ GEMINI_API_KEY: key('a') }), [key('a')]);
  assert.deepEqual(
    parseGeminiApiKeys({ GEMINI_API_KEY: `${key('a')},${key('b')} , ${key('c')}` }),
    [key('a'), key('b'), key('c')],
  );
  assert.deepEqual(
    parseGeminiApiKeys({ GEMINI_API_KEY: key('a'), GEMINI_API_KEYS: `${key('b')}\n${key('c')}` }),
    [key('a'), key('b'), key('c')],
  );
});

test('a repeated key is capacity nobody has, so it is counted once', () => {
  assert.deepEqual(
    parseGeminiApiKeys({ GEMINI_API_KEY: `${key('a')},${key('a')},${key('b')}` }),
    [key('a'), key('b')],
  );
});

test('empty, missing and too-short values yield no keys at all', () => {
  assert.deepEqual(parseGeminiApiKeys({}), []);
  assert.deepEqual(parseGeminiApiKeys({ GEMINI_API_KEY: '  ,, ' }), []);
  assert.deepEqual(parseGeminiApiKeys({ GEMINI_API_KEY: 'your-key-here' }), []);
});

test('rotation returns every key exactly once and starts somewhere new each call', () => {
  const keys = [key('a'), key('b'), key('c')];
  const first = rotateKeys(keys);
  const second = rotateKeys(keys);
  assert.deepEqual([...first].sort(), [...keys].sort());
  assert.deepEqual([...second].sort(), [...keys].sort());
  assert.notEqual(first[0], second[0]);
  assert.deepEqual(rotateKeys([key('a')]), [key('a')]);
  assert.deepEqual(rotateKeys([]), []);
});

test('a spent or rejected key moves on, an overloaded model retries, a bad request stops', () => {
  assert.equal(classifyGeminiFailure(429), 'next-key');
  assert.equal(classifyGeminiFailure(403), 'next-key');
  assert.equal(classifyGeminiFailure(401), 'next-key');
  assert.equal(classifyGeminiFailure(404), 'next-key');
  assert.equal(classifyGeminiFailure(503), 'retry');
  assert.equal(classifyGeminiFailure(500), 'retry');
  assert.equal(classifyGeminiFailure(400), 'fail');
});

test('the exhausted-quota message says how to get more capacity', () => {
  assert.match(geminiFailureMessage(429, 1), /GEMINI_API_KEY/);
  assert.match(geminiFailureMessage(429, 3), /3 ключах/);
  assert.match(geminiFailureMessage(503, 2), /перевантажений/);
  assert.match(geminiFailureMessage(0, 2), /таймаут/);
});

test('the route walks the key list instead of reading one key, and never logs a key', async () => {
  const route = await readFile(
    new URL('../src/app/api/ai/call-to-tasks/route.js', import.meta.url),
    'utf8',
  );

  assert.match(route, /parseGeminiApiKeys\(process\.env\)/);
  assert.match(route, /for \(const apiKey of rotateKeys\(apiKeys\)\)/);
  assert.match(route, /classifyGeminiFailure/);
  assert.match(route, /keyIndex: apiKeys\.indexOf\(apiKey\)/);
  // Every remaining mention is the list, never `process.env.GEMINI_API_KEY`.
  assert.doesNotMatch(route, /process\.env\.GEMINI_API_KEY/);
  // Quota exhaustion is a 429 the client can explain, not a blanket 502.
  assert.match(route, /status: result\.status \|\| 502/);
  // Both outbound fetches are bounded; an unbounded one becomes the platform's
  // own timeout and reaches the user as «Internal Server Error».
  assert.match(route, /GEMINI_TIMEOUT_MS/);
  assert.match(route, /AbortSignal\.timeout\(/);
});
