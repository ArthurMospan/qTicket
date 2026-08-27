// What a chat message is made of.
//
// The renderer used to ask this question with `String.prototype.split` and then
// decide what each piece was by looking at its first character. `split` with a
// capturing group hands back the text *between* the matches as well as the
// matches themselves, so «@ у чаті завдання» — a sentence that merely begins
// with an at sign, matching nothing — arrived as one unmatched piece whose
// first character was `@`, and was drawn as a mention of a person named
// « у чаті завдання». Every line starting with `@` or `#` became a capsule.
//
// A token is now something that matched, and nothing else can become one.

const LINK = 'https?:\\/\\/[^\\s]+';
const CODE = '`[^`\\n]+`';
const BOLD = '\\*\\*[^\\n]+?\\*\\*';
const ITALIC = '\\*[^*\\n]+?\\*|_[^_\\n]+?_';
const STRIKE = '~[^~\\n]+?~';

// A mention is a boundary, an `@`, and the name of somebody who is actually in
// this organization. Anything else after an `@` is a sentence.
//
// The boundary is consumed rather than looked behind: a lookbehind is still the
// newest thing in this expression's grammar, and the character it would inspect
// is handed straight back as text below, so nothing is lost by taking it.
const BOUNDARY = '(?:^|[\\s([{«"\'])';
// `#QT-12`, under the same rule.
const ISSUE = `${BOUNDARY}#[\\p{L}\\p{N}-]+`;
// What may follow a name for it to have been a mention and not a prefix of a
// longer word: whitespace, punctuation, a closing bracket, or the end.
const MENTION_TAIL = '(?=[\\s.,!?;:)\\]}»"\']|$)';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Everything up to the first whitespace is greedy, so a pasted address that
 * ends a sentence swallows the punctuation. Hand that tail back as plain text —
 * `.../a.` is a sentence about `/a`, not a link to `/a.`.
 */
export function splitUrlTail(url) {
  let end = url.length;
  while (end > 0) {
    const char = url[end - 1];
    if ('.,;:!?«»"\''.includes(char)) {
      end -= 1;
      continue;
    }
    // A closing paren belongs to the URL unless it is unbalanced, so links that
    // legitimately carry one (Wikipedia, Figma node ids) stay intact.
    if (char === ')') {
      const head = url.slice(0, end);
      const opened = (head.match(/\(/g) || []).length;
      const closed = (head.match(/\)/g) || []).length;
      if (closed > opened) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return [url.slice(0, end), url.slice(end)];
}

/**
 * One line of a message, as the pieces a renderer draws.
 *
 * @param {string} line The text.
 * @param {object} options
 * @param {string[]} options.memberNames Everyone who can be named here. A name
 *   that is not in this list is not a mention — there is no fallback that turns
 *   an arbitrary `@word` into somebody, because there is no such somebody.
 * @param {boolean} options.formatting Whether `*bold*`-style marks are read.
 * @returns {{type: 'text'|'mention'|'issue'|'link'|'bold'|'italic'|'strike'|'code', value: string}[]}
 *   `value` is what the token means: a name without the `@`, a key without the
 *   `#`, the href, the emphasised words without their marks.
 */
export function tokenizeMessageLine(line, { memberNames = [], formatting = true } = {}) {
  const text = String(line ?? '');
  if (!text) return [];

  const names = [...new Set(memberNames.filter(Boolean).map(String))]
    // Longest first: «Анна Коваль» must win over a colleague called «Анна».
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  const mention = names.length
    ? `${BOUNDARY}@(?:${names.join('|')})${MENTION_TAIL}`
    : null;

  const parts = [
    LINK,
    formatting ? CODE : null,
    formatting ? BOLD : null,
    formatting ? ITALIC : null,
    formatting ? STRIKE : null,
    mention,
    ISSUE,
  ].filter(Boolean);
  const pattern = new RegExp(`(${parts.join('|')})`, 'gu');

  const tokens = [];
  let cursor = 0;
  const pushText = value => {
    if (!value) return;
    const last = tokens[tokens.length - 1];
    if (last?.type === 'text') last.value += value;
    else tokens.push({ type: 'text', value });
  };

  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    pushText(text.slice(cursor, match.index));
    cursor = match.index + token.length;

    if (token.startsWith('http')) {
      const [href, tail] = splitUrlTail(token);
      tokens.push({ type: 'link', value: href });
      pushText(tail);
      continue;
    }
    if (formatting && token.startsWith('**') && token.endsWith('**')) {
      tokens.push({ type: 'bold', value: token.slice(2, -2) });
      continue;
    }
    if (formatting && (
      (token.startsWith('*') && token.endsWith('*'))
      || (token.startsWith('_') && token.endsWith('_'))
    )) {
      tokens.push({ type: 'italic', value: token.slice(1, -1) });
      continue;
    }
    if (formatting && token.startsWith('~') && token.endsWith('~')) {
      tokens.push({ type: 'strike', value: token.slice(1, -1) });
      continue;
    }
    if (formatting && token.startsWith('`') && token.endsWith('`')) {
      tokens.push({ type: 'code', value: token.slice(1, -1) });
      continue;
    }

    // What is left is a mention or a task key, and it carries the boundary
    // character it was matched after. That character is text, not part of
    // either — the marker is the first `@` or `#`, because a boundary is
    // whitespace or a bracket and can never be one of them.
    const marker = token.search(/[@#]/);
    pushText(token.slice(0, marker));
    const body = token.slice(marker + 1);
    tokens.push(token[marker] === '@'
      ? { type: 'mention', value: body }
      : { type: 'issue', value: body });
  }

  pushText(text.slice(cursor));
  return tokens;
}

/**
 * The task mentions a message carries with it.
 *
 * A `#QT-12` in a message used to be a *question*: every capsule asked the
 * server what that task was called, on every render, for the life of the
 * message. That is the wrong shape for the problem — the composer that wrote
 * the mention already had the answer on screen when the author picked it from
 * the list. It writes it down instead, and the capsule reads it back for free
 * for as long as the message exists. Slack, Linear and GitHub all store the
 * resolved reference in the message for the same reason.
 *
 * Kept honest against the text: a name the author typed and then deleted must
 * not be carried, and the text is the truth about what was said.
 *
 * @param {string} text The message as written.
 * @param {Map|object} remembered Keys the composer resolved, `KEY -> {id, title}`.
 * @returns {{key: string, id?: string, title: string}[]} Only the ones still said.
 */
export function collectIssueMentions(text, remembered) {
  const source = remembered instanceof Map ? remembered : new Map(Object.entries(remembered || {}));
  if (source.size === 0) return [];
  const said = new Set(
    String(text || '')
      .split('\n')
      .flatMap(line => tokenizeMessageLine(line, { memberNames: [], formatting: false }))
      .filter(token => token.type === 'issue')
      .map(token => token.value.toLocaleUpperCase('uk-UA')),
  );
  return [...source.entries()]
    .filter(([key]) => said.has(String(key).toLocaleUpperCase('uk-UA')))
    .map(([key, issue]) => ({
      key: String(key).toLocaleUpperCase('uk-UA'),
      ...(issue?.id ? { id: issue.id } : {}),
      title: String(issue?.title || ''),
    }))
    .filter(entry => entry.title);
}

/** The stored mentions of one message, as a `KEY -> title` lookup. */
export function issueMentionTitles(mentions) {
  const titles = {};
  for (const entry of Array.isArray(mentions) ? mentions : []) {
    const key = String(entry?.key || '').toLocaleUpperCase('uk-UA');
    if (key && entry?.title) titles[key] = String(entry.title);
  }
  return titles;
}
