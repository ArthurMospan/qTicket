import React from 'react';
import HoverCard from './HoverCard';
import IssueMentionChip from './IssueMentionChip';
import { ChatAttachmentList } from '@/components/ui/Chat/ChatAttachmentList';
import { issueMentionTitles, tokenizeMessageLine } from '@/lib/utils/messageTokens.mjs';

// Before attachments were a field of their own, a file was written into the
// message text — `![attachment](url)` for a picture, `📎 name` for anything
// else. Those messages are still in the channels, and each of the two used to
// draw itself: a bare 300px `<img>` with a border, and a grey 40px box with a
// paperclip in the middle of the name. Neither looked like the tile the same
// file gets today, which is most of why files in chat "все по-різному".
//
// They are read out as attachments now and handed to the one tile.
function legacyAttachment(line) {
  if (line.startsWith('![attachment](') && line.endsWith(')')) {
    const url = line.slice(14, -1);
    return url ? { name: url.split(/[?#]/)[0].split('/').pop() || 'Зображення', url } : null;
  }
  if (line.startsWith('📎 ')) {
    const name = line.slice(2).trim();
    return name ? { name } : null;
  }
  return null;
}

export default function MessageContent({ text, members, searchTerm, issueMentions }) {
  if (!text) return null;
  // What the message wrote down about the tasks it names, so drawing it costs
  // no request. Messages written before this field existed have none, and fall
  // back to the batched lookup inside the capsule.
  const storedTitles = issueMentionTitles(issueMentions);
  const memberNames = (members || [])
    .map(member => member.name || member.displayName || member.email)
    .filter(Boolean);

  const highlightText = (content) => {
    if (!searchTerm) return content;
    const escapedSearchTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedSearchTerm})`, 'gi');
    const parts = content.split(regex);
    const normalizedSearchTerm = searchTerm.toLocaleLowerCase('uk-UA');
    return (
      <>
        {parts.map((p, i) =>
          p.toLocaleLowerCase('uk-UA') === normalizedSearchTerm ? (
            <mark key={i} className="bg-warning-solid/40 text-ink px-0.5 rounded font-medium">
              {p}
            </mark>
          ) : (
            p
          )
        )}
      </>
    );
  };

  // We split by lines first
  const allLines = text.split('\n');
  const legacyAttachments = allLines.map(legacyAttachment).filter(Boolean);
  const lines = allLines.filter(line => !legacyAttachment(line));

  return (
    <>
      {lines.map((line, idx) => (
        <div key={idx} className="mb-1 last:mb-0">
          {/* Only what actually matched is a mention, a task or a link. The
              text between the matches is text, even when it starts with `@`. */}
          {tokenizeMessageLine(line, { memberNames }).map((token, tokenIndex) => {
            switch (token.type) {
              case 'bold':
                return <strong key={tokenIndex}>{highlightText(token.value)}</strong>;
              case 'italic':
                return <em key={tokenIndex}>{highlightText(token.value)}</em>;
              case 'strike':
                return <del key={tokenIndex}>{highlightText(token.value)}</del>;
              case 'code':
                return (
                  <code key={tokenIndex} className="bg-canvas text-danger px-1 py-0.5 rounded text-[13px] font-mono">
                    {token.value}
                  </code>
                );
              case 'mention':
                return <HoverCard key={tokenIndex} type="user" value={token.value} members={members} />;
              case 'issue': {
                const key = token.value.toLocaleUpperCase('uk-UA');
                return <IssueMentionChip key={tokenIndex} issueKey={key} title={storedTitles[key] || ''} />;
              }
              case 'link':
                return (
                  <a
                    key={tokenIndex}
                    href={token.value}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink hover:underline break-all inline-flex items-center gap-1"
                  >
                    {token.value}
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="inline">
                      <path d="M2 10L10 2M10 2H6M10 2V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </a>
                );
              default:
                return <span key={tokenIndex}>{highlightText(token.value)}</span>;
            }
          })}
        </div>
      ))}
      <ChatAttachmentList attachments={legacyAttachments} />
    </>
  );
}
