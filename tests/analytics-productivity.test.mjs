import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('productivity shows observable flow and oldest work, not a scope-free burndown', async () => {
  const source = await readFile(
    new URL('../src/components/workspace/VelocityTab.jsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /useBurndown|Скільки роботи лишилось|Рівний темп/);
  assert.doesNotMatch(source, /Зміна беклогу/);
  assert.match(source, /Відкрито зараз/);
  assert.match(source, /Найстаріші відкриті завдання/);
  assert.match(source, /const dayCount = period/);
  assert.match(source, /Від створення до завершення/);
});
