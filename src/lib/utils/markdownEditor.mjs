function normalizedSelection(text, start, end) {
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, text.length));
  return { start: safeStart, end: safeEnd };
}

export function formatInline(text, start, end, before, after = before, fallback = 'текст') {
  const selection = normalizedSelection(text, start, end);
  const selected = text.slice(selection.start, selection.end);
  const alreadyWrapped = selection.start >= before.length
    && text.slice(selection.start - before.length, selection.start) === before
    && text.slice(selection.end, selection.end + after.length) === after;

  if (alreadyWrapped) {
    return {
      value: text.slice(0, selection.start - before.length) + selected + text.slice(selection.end + after.length),
      selectionStart: selection.start - before.length,
      selectionEnd: selection.end - before.length,
    };
  }

  const content = selected || fallback;
  return {
    value: text.slice(0, selection.start) + before + content + after + text.slice(selection.end),
    selectionStart: selection.start + before.length,
    selectionEnd: selection.start + before.length + content.length,
  };
}

export function transformLineBlock(text, start, end, transform) {
  const selection = normalizedSelection(text, start, end);
  const blockStart = text.lastIndexOf('\n', Math.max(0, selection.start - 1)) + 1;
  const nextBreak = text.indexOf('\n', selection.end);
  const blockEnd = nextBreak === -1 ? text.length : nextBreak;
  const originalLines = text.slice(blockStart, blockEnd).split('\n');
  const transformedLines = transform(originalLines);
  const transformed = transformedLines.join('\n');

  const mapOffset = absoluteOffset => {
    const relativeOffset = Math.max(0, absoluteOffset - blockStart);
    let consumed = 0;
    let mapped = 0;
    for (let index = 0; index < originalLines.length; index += 1) {
      const originalLine = originalLines[index];
      const transformedLine = transformedLines[index] ?? '';
      const lineEnd = consumed + originalLine.length;
      if (relativeOffset <= lineEnd || index === originalLines.length - 1) {
        const column = Math.min(relativeOffset - consumed, originalLine.length);
        const prefixDelta = transformedLine.length - originalLine.length;
        return mapped + Math.max(0, Math.min(transformedLine.length, column + prefixDelta));
      }
      consumed = lineEnd + 1;
      mapped += transformedLine.length + 1;
    }
    return transformed.length;
  };

  return {
    value: text.slice(0, blockStart) + transformed + text.slice(blockEnd),
    selectionStart: blockStart + mapOffset(selection.start),
    selectionEnd: blockStart + mapOffset(selection.end),
  };
}

export function formatHeading(text, start, end, level) {
  const marker = `${'#'.repeat(level)} `;
  return transformLineBlock(text, start, end, lines => {
    const contentLines = lines.filter(line => line.trim());
    const removeHeading = contentLines.length > 0 && contentLines.every(line => line.startsWith(marker));
    return lines.map(line => {
      if (!line.trim()) return line;
      const content = line.replace(/^#{1,6}\s+/, '');
      return removeHeading ? content : `${marker}${content}`;
    });
  });
}

const LIST_PATTERNS = {
  bullet: /^\s*[-*+]\s+(?!\[[ xX]\]\s+)/,
  ordered: /^\s*\d+\.\s+/,
  task: /^\s*-\s+\[[ xX]\]\s+/,
  quote: /^\s*>\s?/,
};

function removeLinePrefix(line) {
  return line.replace(/^(\s*)(?:(?:-\s+\[[ xX]\]\s+)|(?:[-*+]\s+)|(?:\d+\.\s+)|(?:>\s?))/, '$1');
}

export function formatList(text, start, end, kind) {
  if (!LIST_PATTERNS[kind]) throw new Error(`Unknown list kind: ${kind}`);
  return transformLineBlock(text, start, end, lines => {
    const contentLines = lines.filter(line => line.trim());
    const removePrefix = contentLines.length > 0 && contentLines.every(line => LIST_PATTERNS[kind].test(line));
    if (removePrefix) return lines.map(removeLinePrefix);

    let orderedIndex = 1;
    return lines.map(line => {
      if (!line.trim()) return line;
      const indent = line.match(/^\s*/)?.[0] || '';
      const content = removeLinePrefix(line).trimStart();
      const prefix = kind === 'ordered' ? `${orderedIndex++}. `
        : kind === 'task' ? '- [ ] '
          : kind === 'quote' ? '> '
            : '- ';
      return `${indent}${prefix}${content}`;
    });
  });
}

export function indentLines(text, start, end, outdent = false) {
  return transformLineBlock(text, start, end, lines => (
    lines.map(line => outdent ? line.replace(/^ {1,2}/, '') : `  ${line}`)
  ));
}

export function insertLink(text, start, end) {
  const selection = normalizedSelection(text, start, end);
  const label = text.slice(selection.start, selection.end) || 'назва посилання';
  const url = 'https://';
  const markdown = `[${label}](${url})`;
  return {
    value: text.slice(0, selection.start) + markdown + text.slice(selection.end),
    selectionStart: selection.start + label.length + 3,
    selectionEnd: selection.start + label.length + 3 + url.length,
  };
}

export function insertBlock(text, start, end, markdown, selectionOffset = markdown.length) {
  const selection = normalizedSelection(text, start, end);
  const prefix = selection.start > 0 && text[selection.start - 1] !== '\n' ? '\n\n' : '';
  const suffix = selection.end < text.length && text[selection.end] !== '\n' ? '\n\n' : '';
  const cursor = selection.start + prefix.length + selectionOffset;
  return {
    value: text.slice(0, selection.start) + prefix + markdown + suffix + text.slice(selection.end),
    selectionStart: cursor,
    selectionEnd: cursor,
  };
}

export function insertCodeBlock(text, start, end) {
  const selection = normalizedSelection(text, start, end);
  const selected = text.slice(selection.start, selection.end) || 'код';
  const block = `\`\`\`\n${selected}\n\`\`\``;
  return {
    value: text.slice(0, selection.start) + block + text.slice(selection.end),
    selectionStart: selection.start + 4,
    selectionEnd: selection.start + 4 + selected.length,
  };
}

export function continueMarkdownList(text, start, end) {
  const selection = normalizedSelection(text, start, end);
  if (selection.start !== selection.end) return null;
  const lineStart = text.lastIndexOf('\n', Math.max(0, selection.start - 1)) + 1;
  const lineBeforeCursor = text.slice(lineStart, selection.start);
  const match = lineBeforeCursor.match(/^(\s*)(?:(-\s+\[[ xX]\])|([-*+])|(\d+)\.)\s+(.*)$/);
  if (!match) return null;

  const [, indent, taskMarker, bulletMarker, number, content] = match;
  if (!content.trim()) {
    const cursor = lineStart + indent.length;
    return {
      value: text.slice(0, lineStart) + indent + text.slice(selection.start),
      selectionStart: cursor,
      selectionEnd: cursor,
    };
  }

  const marker = taskMarker ? '- [ ]' : bulletMarker || `${Number(number) + 1}.`;
  const insertion = `\n${indent}${marker} `;
  const cursor = selection.start + insertion.length;
  return {
    value: text.slice(0, selection.start) + insertion + text.slice(selection.start),
    selectionStart: cursor,
    selectionEnd: cursor,
  };
}

export function setTaskChecked(content, targetLine, checked) {
  return content.split('\n').map((line, index) => {
    if (index + 1 !== targetLine) return line;
    return line.replace(/^(\s*[-*+]\s+\[)[ xX](\]\s+)/, `$1${checked ? 'x' : ' '}$2`);
  }).join('\n');
}
