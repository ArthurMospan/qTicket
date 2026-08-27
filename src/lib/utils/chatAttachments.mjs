// Chat-specific attachment helpers. What a file *is* is not one of them: that
// answer is shared with the task surface and lives in `attachmentKinds.mjs`,
// because a spreadsheet posted in a channel and the same spreadsheet dropped on
// a task are the same spreadsheet.

import {
  attachmentKind,
  attachmentKindLabel,
  attachmentUrl,
  formatFileSize,
  isMediaKind,
} from './attachmentKinds.mjs';

export function chatAttachmentUrl(attachment) {
  return attachmentUrl(attachment);
}

export function chatAttachmentKind(attachment) {
  return attachmentKind(attachment);
}

export function isChatMediaAttachment(attachment) {
  return isMediaKind(attachmentKind(attachment));
}

export function formatChatFileSize(bytes) {
  return formatFileSize(bytes);
}

export function messageMatchesChatSearch(message, rawSearchTerm) {
  const searchTerm = String(rawSearchTerm || '').trim().toLocaleLowerCase('uk-UA');
  if (!searchTerm) return true;

  const searchable = [
    message?.text,
    message?.user,
    ...(message?.attachments || []).flatMap(attachment => [
      attachment?.name,
      attachment?.type,
      attachment?.resourceType,
    ]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('uk-UA');

  return searchable.includes(searchTerm);
}

/**
 * What the files on a message are called, for a list that shows the message
 * without them — the pinned tab is the one that matters.
 *
 * It used to print «Вкладення» there, which is the single thing every such
 * message has in common and therefore says nothing about any of them: three
 * pinned files were three identical lines and you had to open each one to find
 * out which was which. A file already carries the answer in its name.
 */
export function chatAttachmentNames(attachments) {
  return (attachments || [])
    .map(attachment => attachment?.name || attachmentKindLabel(attachmentKind(attachment)))
    .filter(Boolean)
    .join(', ');
}

export function collectChatAttachments(messages) {
  return (messages || []).flatMap(message =>
    (message.attachments || [])
      .filter(attachment => chatAttachmentUrl(attachment))
      .map((attachment, index) => ({
        ...attachment,
        messageId: message.id,
        senderId: message.senderId,
        senderName: message.user,
        messageCreatedAt: message.createdAt,
        chatAttachmentKey: `${message.id}-${index}-${attachment.name || 'attachment'}`,
      })),
  );
}
