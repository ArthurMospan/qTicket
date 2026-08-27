// Attachment presentation helpers for a task.
//
// These used to be three self-contained functions with their own idea of what a
// file is. That idea is now `attachmentKinds.mjs`, shared with the chat, and
// these three are the names the task surface calls it by — kept because the
// task's own vocabulary ("mat", short for material) predates the chat's and
// renaming it here would touch code that has nothing to do with file types.

import {
  attachmentKind,
  attachmentUrl,
  formatFileSize,
} from './attachmentKinds.mjs';

export function getMatFileUrl(mat) {
  return attachmentUrl(mat);
}

/** @deprecated in spirit — call `attachmentKind` in new code. */
export function detectFileType(mat) {
  return attachmentKind(mat);
}

export function fmtBytes(bytes) {
  return formatFileSize(bytes);
}
