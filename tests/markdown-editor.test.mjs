import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  continueMarkdownList,
  formatHeading,
  formatInline,
  formatList,
  indentLines,
  insertBlock,
  insertCodeBlock,
  insertLink,
  setTaskChecked,
} from '../src/lib/utils/markdownEditor.mjs';

test('inline styles wrap, select, and toggle without losing content', () => {
  const bold = formatInline('alpha', 0, 5, '**', '**', 'жирний текст');
  assert.deepEqual(bold, { value: '**alpha**', selectionStart: 2, selectionEnd: 7 });
  assert.deepEqual(formatInline(bold.value, 2, 7, '**', '**'), { value: 'alpha', selectionStart: 0, selectionEnd: 5 });
  assert.equal(formatInline('', 0, 0, '*', '*', 'курсив').value, '*курсив*');
});

test('headings toggle and preserve a collapsed cursor', () => {
  const heading = formatHeading('alpha', 2, 2, 2);
  assert.deepEqual(heading, { value: '## alpha', selectionStart: 5, selectionEnd: 5 });
  assert.deepEqual(formatHeading(heading.value, 5, 5, 2), { value: 'alpha', selectionStart: 2, selectionEnd: 2 });
});

test('all list styles apply and toggle predictably', () => {
  for (const [kind, expected] of [['bullet', '- alpha'], ['ordered', '1. alpha'], ['task', '- [ ] alpha'], ['quote', '> alpha']]) {
    const formatted = formatList('alpha', 2, 2, kind);
    assert.equal(formatted.value, expected);
    assert.equal(formatted.selectionStart, 2 + expected.length - 5);
    assert.equal(formatList(formatted.value, formatted.selectionStart, formatted.selectionEnd, kind).value, 'alpha');
  }
  assert.equal(formatList('alpha\nbeta', 0, 10, 'ordered').value, '1. alpha\n2. beta');
});

test('list conversion removes the previous prefix instead of nesting accidental markers', () => {
  assert.equal(formatList('- [ ] alpha', 6, 6, 'bullet').value, '- alpha');
  assert.equal(formatList('1. alpha', 4, 4, 'task').value, '- [ ] alpha');
});

test('indent and outdent preserve cursor position', () => {
  const indented = indentLines('- alpha', 4, 4);
  assert.deepEqual(indented, { value: '  - alpha', selectionStart: 6, selectionEnd: 6 });
  assert.deepEqual(indentLines(indented.value, 6, 6, true), { value: '- alpha', selectionStart: 4, selectionEnd: 4 });
});

test('links, blocks, and code blocks return useful selections', () => {
  assert.deepEqual(insertLink('alpha', 0, 5), {
    value: '[alpha](https://)', selectionStart: 8, selectionEnd: 16,
  });
  assert.equal(insertBlock('before after', 6, 6, '---').value, 'before\n\n---\n\n after');
  assert.deepEqual(insertCodeBlock('alpha', 0, 5), {
    value: '```\nalpha\n```', selectionStart: 4, selectionEnd: 9,
  });
});

test('Enter continues bullets, ordered lists, and unchecked tasks', () => {
  assert.equal(continueMarkdownList('- alpha', 7, 7).value, '- alpha\n- ');
  assert.equal(continueMarkdownList('3. alpha', 8, 8).value, '3. alpha\n4. ');
  assert.equal(continueMarkdownList('- [x] alpha', 11, 11).value, '- [x] alpha\n- [ ] ');
  assert.deepEqual(continueMarkdownList('- ', 2, 2), { value: '', selectionStart: 0, selectionEnd: 0 });
});

test('task checkbox changes only the AST source line requested', () => {
  const content = 'intro\n- [ ] first\ntext\n- [x] second';
  assert.equal(setTaskChecked(content, 2, true), 'intro\n- [x] first\ntext\n- [x] second');
  assert.equal(setTaskChecked(content, 4, false), 'intro\n- [ ] first\ntext\n- [ ] second');
});

test('GFM task list items expose stable source lines for interactive toggles', () => {
  const sourceLines = [];
  renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm],
    components: {
      li: ({ node, ...props }) => {
        sourceLines.push(node.position.start.line);
        return React.createElement('li', props);
      },
    },
  }, 'intro\n\n- [ ] first\n\ntext\n\n- [x] second'));
  assert.deepEqual(sourceLines, [3, 7]);
});
