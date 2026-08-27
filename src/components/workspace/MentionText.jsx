'use client';

import IssueMentionChip from '@/components/workspace/IssueMentionChip';
import HoverCard from '@/components/workspace/HoverCard';
import { filterMentionCandidates } from '@/lib/utils/mentions';
import { issueMentionTitles, tokenizeMessageLine } from '@/lib/utils/messageTokens.mjs';

// The task chat's messages, read back.
//
// It once carried its own copy of the rules — which names count, where a task
// key may start, how much of a URL a full stop belongs to — and the workspace
// chat carried a second copy that disagreed with it. Both read the same
// sentences written by the same people, so both now ask
// `tokenizeMessageLine`; the only difference left is that this surface has no
// `*bold*` marks to read, which it says outright.
export default function MentionText({
  text = '',
  members = [],
  dark = false,
  excludeMemberId = '',
  issueMentions,
}) {
  if (!text) return text;

  // What this comment wrote down about the tasks it names. A capsule with a
  // name in hand asks the server nothing.
  const storedTitles = issueMentionTitles(issueMentions);
  const memberNames = filterMentionCandidates(members, excludeMemberId).map(member => member.name);
  const tokens = tokenizeMessageLine(text, { memberNames, formatting: false });
  if (tokens.length === 0) return text;
  if (tokens.length === 1 && tokens[0].type === 'text') return tokens[0].value;

  return tokens.map((token, index) => {
    switch (token.type) {
      case 'mention':
        // The very same component the workspace chat uses, rather than a
        // lookalike span: a mention here opens the person's profile and shows
        // their card, which the retyped copy never could.
        return <HoverCard key={index} value={token.value} members={members} dark={dark} />;
      case 'issue': {
        const key = token.value.toLocaleUpperCase('uk-UA');
        return (
          <IssueMentionChip
            key={index}
            issueKey={key}
            title={storedTitles[key] || ''}
            dark={dark}
          />
        );
      }
      case 'link':
        return (
          <a
            key={index}
            href={token.value}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={`font-medium break-all underline decoration-1 underline-offset-2 transition-colors hover:decoration-2 ${
              dark ? 'text-white' : 'text-ink'
            }`}
          >
            {token.value}
          </a>
        );
      default:
        return token.value;
    }
  });
}
