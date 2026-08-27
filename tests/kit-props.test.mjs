import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractProps } from '../scripts/kit-props.mjs';
import { extractVariants } from '../scripts/kit-variants.mjs';

const committed = JSON.parse(
  readFileSync(new URL('../src/app/ui-kit/kit-props.generated.json', import.meta.url), 'utf8'),
);

test('the committed prop tables match the code', () => {
  assert.deepEqual(
    extractProps(),
    committed,
    'kit-props.generated.json is stale — run `npm run kit:props` and commit the result',
  );
});

// The two contract zeros. A kit component without a summary is one nobody can
// choose between; a prop without a description is one every call site has to
// guess at, which is how a codebase ends up with four ways to do one thing.
test('every kit component says what it is, and every prop says what it does', () => {
  assert.deepEqual(
    committed.componentsWithoutSummary,
    [],
    'A kit component must carry a JSDoc summary above its declaration',
  );
  assert.equal(committed.totals.componentsWithoutSummary, 0);

  const undocumented = [];
  for (const [name, entry] of Object.entries(committed.components)) {
    for (const prop of entry.props) {
      if (!prop.description) undocumented.push(`${name}.${prop.name}`);
    }
  }
  assert.deepEqual(
    undocumented,
    [],
    `Every prop needs a description — JSDoc @param, or the trailing // comment: ${undocumented.join(', ')}`,
  );
  assert.equal(committed.totals.undocumentedProps, 0);
});

// The table and «Матриця варіантів» must never disagree about what a prop
// accepts, which is why the values are read from the same manifest rather than
// typed into the JSDoc as prose.
test('declared values in the table come from the variant manifest', () => {
  const manifest = extractVariants();
  for (const [name, entry] of Object.entries(committed.components)) {
    for (const prop of entry.props) {
      const declared = manifest[name]?.[prop.name] || [];
      assert.deepEqual(
        prop.values,
        declared,
        `${name}.${prop.name}: the prop table lists values the variant manifest does not`,
      );
    }
  }
});

// Regression guards for two silent extraction failures, both of which reported
// a plausible-looking zero instead of an error.
test('the extractor reads the whole kit, not the half of it that parses easily', () => {
  const { components } = committed;

  // A doc comment sits above the *statement*: measuring the gap from the
  // function node finds `export default` in the way and every summary comes
  // back empty.
  assert.ok(components.Button.summary.length > 20, 'an exported function keeps its summary');
  assert.ok(components.KpiCard.summary.length > 20, 'a default-exported function keeps its summary');
  assert.ok(components.Input.summary.length > 20, 'a forwardRef component keeps its summary');

  // Half the kit is stored with CRLF, and `.` does not match `\r`, so an
  // end-anchored trailing-comment pattern found nothing in exactly those files.
  assert.ok(
    components.Button.props.find(prop => prop.name === 'style').description,
    'a trailing // comment is a description, in CRLF files too',
  );

  // A type containing braces — `{{label: string}[]}`, `{(e) => void}` — used to
  // end the match at the first inner brace and drop the prop entirely.
  assert.ok(
    components.Tabs.props.find(prop => prop.name === 'tabs').description,
    'a @param whose type contains braces is still read',
  );
  assert.ok(components.Button.props.find(prop => prop.name === 'onClick').description);

  // Defaults are the component's own source text, so the table reads the way
  // the signature reads.
  assert.equal(components.Button.props.find(prop => prop.name === 'size').default, "'lg'");
});

test('the catalogue shows the table, and the rules name the command', () => {
  const panel = readFileSync(new URL('../src/app/ui-kit/UsagePanel.jsx', import.meta.url), 'utf8');
  const preview = readFileSync(new URL('../src/app/ui-kit/preview.jsx', import.meta.url), 'utf8');
  const contract = readFileSync(new URL('../docs/UI_KIT_CONTRACT.md', import.meta.url), 'utf8');
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

  assert.equal(packageJson.scripts['kit:props'], 'node scripts/kit-props.mjs');
  assert.match(panel, /kit-props\.generated\.json/);
  assert.match(panel, /Пропси \(/);
  // A component the product reaches only through a host still has an API, so
  // its drawer has to be reachable from its preview.
  assert.match(preview, /usageEntry \|\| apiEntry/);
  assert.match(contract, /kit:props/);
});
