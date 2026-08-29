// Every string in a source file that a person could read, with its line.
//
// Two terminology tests ask the same question of different halves of `src/`,
// and both of them have to ask it of *copy* rather than of source text: a
// comment about the data model may say `issue` or `projectId`, an import
// specifier is a path, and an identifier is not a sentence. Only string
// literals, template chunks and JSX text carry words somebody reads.
//
// This lived inside `product-terminology.test.mjs` while it had one caller.
// It has two now, and a parser copied into a second test is a parser that
// drifts from the first one silently.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { parse } from '@babel/parser';

export const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs']);

const PARSER_PLUGINS = [
  'jsx',
  'typescript',
  'decorators-legacy',
  'classProperties',
  'dynamicImport',
  'topLevelAwait',
  'importAttributes',
];

/** Every source file under `dir`, recursively. */
export function walkSources(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkSources(path, acc);
    else if (SOURCE_EXTENSIONS.has(extname(path))) acc.push(path);
  }
  return acc;
}

/**
 * The readable strings of one file.
 *
 * Import and export specifiers are skipped — a module path is not copy — and so
 * is everything Babel classifies as a comment, which is how the data-model
 * notes about `issues` and `projectId` stay legal.
 *
 * @param {string} file Absolute path to a `.js`, `.jsx` or `.mjs` file.
 * @returns {{value: string, line: number}[]}
 */
export function copyStrings(file) {
  const source = readFileSync(file, 'utf8');
  const ast = parse(source, { sourceType: 'unambiguous', plugins: PARSER_PLUGINS });

  const found = [];
  const skip = new Set();

  const visit = (node, parent) => {
    if (!node || typeof node.type !== 'string') return;

    if ((parent?.type === 'ImportDeclaration' || parent?.type === 'ExportNamedDeclaration'
      || parent?.type === 'ExportAllDeclaration') && parent.source === node) {
      skip.add(node);
    }

    if (node.type === 'StringLiteral' && !skip.has(node)) {
      found.push({ value: node.value, line: node.loc?.start.line || 0 });
    } else if (node.type === 'TemplateElement') {
      found.push({ value: node.value.cooked ?? node.value.raw, line: node.loc?.start.line || 0 });
    } else if (node.type === 'JSXText') {
      found.push({ value: node.value, line: node.loc?.start.line || 0 });
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
      const child = node[key];
      if (Array.isArray(child)) for (const item of child) visit(item, node);
      else if (child && typeof child.type === 'string') visit(child, node);
    }
  };

  visit(ast.program, null);
  return found;
}
