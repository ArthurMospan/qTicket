import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firestoreDocumentData } from '../src/lib/utils/firestoreDocument.mjs';

const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  }));
  return nested.flat();
}

test('Firestore path identity wins over a stale denormalized id', () => {
  const record = firestoreDocumentData({
    id: 'canonical-path-id',
    data: () => ({ id: 'stale-cached-id', name: 'OneB' }),
  });

  assert.deepEqual(record, { id: 'canonical-path-id', name: 'OneB' });
});

test('source never spreads Firestore data over an already assigned id', async () => {
  const files = await sourceFiles(fileURLToPath(new URL('../src', import.meta.url)));
  const unsafe = [];
  const pattern = /\{\s*id:\s*[^,\r\n]+,\s*[^{}]*\.\.\.\s*[^,\r\n]+\.data\(/u;

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (pattern.test(source)) unsafe.push(file);
  }

  assert.deepEqual(unsafe, []);
});
