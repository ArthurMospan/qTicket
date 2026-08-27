// What a file *is*, decided once.
//
// There were two answers to this question in the codebase and they disagreed:
// `issueAttachments.detectFileType` knew about five kinds, `chatAttachments`
// knew about the same five in a different order, and neither knew that a
// spreadsheet, a Word document, a text file and a zip are not all "файл". So a
// task could preview a picture and a chat could not preview the same picture
// consistently, and a PDF, an .xlsx and a .txt drew the identical grey page
// glyph on both.
//
// One resolver, one vocabulary, one place to add a kind. Pure and free of React
// so the kit component, the viewer and the chat tile all read the same rules
// instead of each keeping a copy.

/** Every kind the product can tell apart. `file` is the honest fallback. */
export const ATTACHMENT_KINDS = [
  'image', 'video', 'audio', 'pdf', 'sheet', 'doc', 'slides', 'text', 'code', 'archive', 'file',
];

// Extension → kind. Ordered by how often each family actually turns up in a
// workspace, not alphabetically, because this list is read by people.
const EXTENSIONS = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'ico'],
  video: ['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv', 'mpeg', 'mpg'],
  audio: ['mp3', 'wav', 'm4a', 'ogg', 'oga', 'aac', 'flac', 'opus', 'weba'],
  pdf: ['pdf'],
  sheet: ['xls', 'xlsx', 'xlsm', 'csv', 'tsv', 'ods', 'numbers'],
  doc: ['doc', 'docx', 'rtf', 'odt', 'pages'],
  slides: ['ppt', 'pptx', 'odp', 'key'],
  text: ['txt', 'md', 'markdown', 'log'],
  code: ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'json', 'xml', 'yml', 'yaml', 'html', 'css', 'scss', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'php', 'sh', 'sql', 'c', 'cpp', 'h'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'],
};

// Declared MIME subtypes that are not guessable from the extension list above.
// Office's are the reason this map exists at all: nothing about
// `vnd.openxmlformats-officedocument.spreadsheetml.sheet` says "таблиця".
const MIME_HINTS = [
  [/^application\/pdf$/, 'pdf'],
  [/spreadsheet|excel|\/csv$/, 'sheet'],
  [/presentation|powerpoint/, 'slides'],
  [/wordprocessing|msword|opendocument\.text/, 'doc'],
  [/zip|rar|7z|tar|gzip|compressed/, 'archive'],
  [/^text\/(?:html|css|xml|javascript)$|^application\/(?:json|xml|javascript|x-sh|sql)$/, 'code'],
  [/^text\//, 'text'],
];

const LABELS = {
  image: 'Зображення',
  video: 'Відео',
  audio: 'Аудіо',
  pdf: 'PDF',
  sheet: 'Таблиця',
  doc: 'Документ',
  slides: 'Презентація',
  text: 'Текст',
  code: 'Код',
  archive: 'Архів',
  file: 'Файл',
};

const EXTENSION_TO_KIND = new Map(
  Object.entries(EXTENSIONS).flatMap(([kind, list]) => list.map(extension => [extension, kind])),
);

/**
 * Where the bytes live. Five field names because five different writers have
 * stored an attachment over the life of the product.
 */
export function attachmentUrl(attachment) {
  return attachment?.previewUrl
    || attachment?.url
    || attachment?.downloadUrl
    || attachment?.downloadURL
    || attachment?.audioUrl
    || '';
}

// The last dot-suffix of a path, ignoring the query string and the hash that
// Cloudinary and Firebase both append.
function extensionOf(source) {
  const path = String(source || '').split(/[?#]/)[0];
  const match = /\.([a-z0-9]{1,10})$/i.exec(path);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Which of `ATTACHMENT_KINDS` this file is.
 *
 * The declared type wins when there is one — Cloudinary's `resourceType` and a
 * browser `File.type` are both authoritative — and the file name is the
 * fallback, because a raw upload arrives as `application/octet-stream` and only
 * its name says it is a spreadsheet.
 */
export function attachmentKind(attachment) {
  const declared = String(
    attachment?.mimeType || attachment?.resourceType || attachment?.type || '',
  ).toLowerCase();

  if (declared === 'image' || declared.startsWith('image/')) return 'image';
  if (declared === 'video' || declared.startsWith('video/')) return 'video';
  if (declared === 'audio' || declared.startsWith('audio/')) return 'audio';
  for (const [pattern, kind] of MIME_HINTS) {
    if (pattern.test(declared)) return kind;
  }

  const byName = EXTENSION_TO_KIND.get(extensionOf(attachment?.name || attachment?.title));
  if (byName) return byName;
  const byUrl = EXTENSION_TO_KIND.get(extensionOf(attachmentUrl(attachment)));
  if (byUrl) return byUrl;
  return 'file';
}

/** What to call that kind in the interface. */
export function attachmentKindLabel(kind) {
  return LABELS[kind] || LABELS.file;
}

/** Kinds the browser can put on screen or through the speakers as they are. */
export function isPlayableKind(kind) {
  return kind === 'video' || kind === 'audio';
}

/** Kinds that carry their own picture, so a thumbnail beats any glyph. */
export function isVisualKind(kind) {
  return kind === 'image' || kind === 'video';
}

/** Image, video or audio — what the chat's «Медіа» filter means. */
export function isMediaKind(kind) {
  return kind === 'image' || isPlayableKind(kind);
}

/** Kinds the attachment viewer can render inline rather than offer to download. */
export function isViewableKind(kind) {
  return kind === 'image' || kind === 'pdf' || kind === 'text' || kind === 'code' || isPlayableKind(kind);
}

export function formatFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  // `4,2 МБ`, not `4.2 МБ`. The rest of the interface is Ukrainian and the
  // decimal point was the one place a number said otherwise.
  const digits = unitIndex > 0 && size < 10 ? 1 : 0;
  return `${size.toLocaleString('uk-UA', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[unitIndex]}`;
}

/** `3:07`, and `—` while the browser has not read the metadata yet. */
export function formatMediaTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/**
 * The line under a file's name: what it is, and how big it is. Either half may
 * be missing — a pending upload has no size yet, and every kind has a name.
 */
export function attachmentMetaLabel(attachment, kind = attachmentKind(attachment)) {
  return [attachmentKindLabel(kind), formatFileSize(attachment?.size)].filter(Boolean).join(' · ');
}
