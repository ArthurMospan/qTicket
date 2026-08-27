export function telegramCommandPayload(text, command) {
  const escaped = String(command || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(text || '').match(new RegExp(`^/${escaped}(?:@\\w+)?(?:\\s+(.+))?$`, 'i'));
  return match ? (match[1] || '').trim() : null;
}

export function telegramTaskContent(text, botUsername) {
  const value = String(text || '').trim();
  const slashTask = value.match(/^\/task(?:@\w+)?(?:\s+|\n)([\s\S]+)$/i);
  if (slashTask) return slashTask[1].trim();
  if (!botUsername) return '';
  const escapedUsername = String(botUsername).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mention = new RegExp(`^@${escapedUsername}\\b[\\s,:-]*`, 'i');
  if (!mention.test(value)) return '';
  return value.replace(mention, '').replace(/^(задача|завдання|task)(?=\s|[,:-]|$)[\s,:-]*/i, '').trim();
}

export function splitTelegramTask(content) {
  const value = String(content || '').trim();
  const pipeIndex = value.indexOf('|');
  if (pipeIndex >= 0) {
    return {
      title: value.slice(0, pipeIndex).trim(),
      description: value.slice(pipeIndex + 1).trim(),
    };
  }
  const lines = value.split(/\r?\n/);
  return { title: lines.shift()?.trim() || '', description: lines.join('\n').trim() };
}
