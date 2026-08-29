import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

async function routeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);
    return entry.isDirectory() ? routeFiles(path) : entry.name === 'route.js' ? [path] : [];
  }));
  return nested.flat();
}

test('every API route delegates malformed JSON handling to the shared reader', async () => {
  const files = await routeFiles(new URL('../src/app/api/', import.meta.url));
  const sources = await Promise.all(files.map(async file => ({
    file: file.pathname,
    source: await readFile(file, 'utf8'),
  })));
  const directReaders = sources
    .filter(({ source }) => /\b(?:request|req)\.json\(/.test(source))
    .map(({ file }) => file);

  assert.deepEqual(directReaders, []);

  const helper = await readFile(
    new URL('../src/lib/server/apiErrors.js', import.meta.url),
    'utf8',
  );
  assert.match(helper, /class InvalidJsonBodyError/);
  assert.match(helper, /code = 'INVALID_JSON'/);
  assert.match(helper, /error instanceof InvalidJsonBodyError[\s\S]*status: 400/);
});
