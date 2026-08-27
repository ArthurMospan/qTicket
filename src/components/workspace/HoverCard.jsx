'use client';

// The `@name` in a message: a chip that opens the person's profile, and a card
// that says who they are while you point at it.
//
// It used to serve tasks too, through a second branch with its own Firestore
// lookup and its own preview. A task mention shows its title outright now
// (`IssueMentionChip`), so there is nothing left to hover for and nothing left
// here that is not about a person.

import React, { useState, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import { formatLastSeenUk, isPresenceOnline } from '@/lib/utils/presence.mjs';
import { useAppContext } from '@/lib/context/AppContext';
import useFittedLabel from '@/lib/hooks/useFittedLabel';
import { ORGANIZATION_ROLE_LABELS } from '@/lib/utils/orgMembership.mjs';

/**
 * The one shape a mention has, whoever it names. `IssueMentionChip` and the
 * task chat's `MentionText` wear the same one, so a mentioned task and a
 * mentioned person read alike in a sentence.
 *
 * It is an **inline-block, not a flex box**, and that is the whole trick. An
 * inline-block's baseline is the baseline of the text inside it, so the name in
 * the chip sits on exactly the line the sentence sits on — by construction,
 * with no tuned offset and nothing to drift. A flex chip has no text baseline
 * to offer (its first item is a face, not a word), so the browser synthesises
 * one from whatever that face happens to be; every previous attempt here was
 * really an attempt to guess that synthesis, and every one of them left the
 * words in the chip a pixel or two off the words around them.
 *
 * Three rules keep it that way, and breaking any of them puts the step back:
 *
 *   • No `overflow: hidden` on the chip. An inline-block that clips takes its
 *     bottom margin edge as its baseline instead of its text — which is why the
 *     label is shortened as a *string* rather than truncated as a box, by
 *     `useFittedLabel`, against the width the chip really has.
 *   • The avatar is positioned, not laid out. Out of flow it cannot touch the
 *     line box, and `top-1/2 -translate-y-1/2` centres it in the chip exactly,
 *     whatever the font's metrics are.
 *   • `leading-[20px]` against the body's 14px/22.75px line. The chip's whole
 *     box then fits inside the line the sentence already occupies, so a
 *     paragraph does not grow by so much as a pixel where somebody is named.
 *
 * @param {boolean} options.dark On a dark bubble — the task chat's own messages.
 * @param {boolean} options.interactive Whether it answers to a pointer; a chip
 *   that only names somebody must not offer a hover state it cannot honour.
 */
export function mentionChipClass({ dark = false, interactive = true } = {}) {
  return [
    'relative inline-block whitespace-nowrap rounded-full pl-[25px] pr-2',
    'align-baseline text-[13px] font-medium leading-[20px]',
    dark ? 'bg-white/15 text-white' : 'bg-black/[0.06] text-ink',
    interactive
      ? `cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 ${
        dark
          ? 'hover:bg-white/25 focus-visible:ring-white/40'
          : 'hover:bg-black/[0.11] focus-visible:ring-ink/20'
      }`
      : '',
  ].filter(Boolean).join(' ');
}

/** The 16px badge at the chip's left, centred in it and out of the line's way. */
export const MENTION_CHIP_BADGE = 'absolute left-[3px] top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full';

export const MENTION_CHIP = mentionChipClass();

// Imported rather than repeated: see `orgMembership.mjs` for why the same
// three words used to be written out in four files with three spellings.

function findMember(members, value) {
  const normalizedValue = decodeURIComponent(String(value || ''))
    .replace(/^@/, '')
    .replace(/_/g, ' ')
    .trim()
    .toLocaleLowerCase('uk-UA');

  return (members || []).find(member => {
    const candidates = [
      member.id,
      member.uid,
      member.name,
      member.displayName,
      member.email,
    ].filter(Boolean);
    return candidates.some(candidate =>
      String(candidate).replace(/_/g, ' ').trim().toLocaleLowerCase('uk-UA') === normalizedValue
    );
  });
}

/**
 * A mentioned person, as a chip with a card behind it.
 *
 * The chip's own contents used to arrive as `children`, which meant every chat
 * that wanted a mention had to retype the face and the name — and the task chat,
 * which did retype them, ended up with a mention that could not be clicked. The
 * chip is built here now; a caller says who is named, not how it looks.
 *
 * @param {'user'} props.type Kept so a call site says what it is naming; a task is `IssueMentionChip`.
 * @param {string} props.value The name written after the `@`.
 * @param {object[]} props.members Everyone in the organization, which is where the name resolves from.
 * @param {boolean} props.dark On a dark bubble — a task chat message of your own.
 */
export default function HoverCard({ type = 'user', value, members, dark = false }) {
  const { currentUser } = useAppContext();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [show, setShow] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // No lookup: the organization's members are already on the page, which is why
  // this half never needed a request and the task half did.
  const member = findMember(members, value);
  // Names are as long as people's names are. The capsule shortens the one it
  // shows to the room it has; the whole name stays in the tooltip.
  const fullName = member?.name || String(value || '').trim();
  const [chipRef, label] = useFittedLabel(fullName);

  const openUser = () => {
    const userId = member?.id || member?.uid;
    if (!userId) {
      setShow(true);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set('member', userId);
    setShow(false);
    router.push(`${pathname}?${params.toString()}`);
  };

  const currentUserId = currentUser?.id || currentUser?.uid;
  const memberId = member?.id || member?.uid;
  const isOnline = Boolean(member && (
    memberId === currentUserId
    || member.online === true
    || isPresenceOnline(member.lastActive, now)
  ));
  const subtitle = member?.positionName
    || member?.title
    || ORGANIZATION_ROLE_LABELS[member?.role]
    || 'Учасник';

  return (
    <span
      // Baseline-aligned, like the chip it wraps: an inline-block takes the
      // baseline of its last line box, and that line box is the chip, so the
      // wrapper passes the chip's own baseline straight through to the sentence.
      className="relative inline-block align-baseline"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <button
        ref={chipRef}
        type="button"
        onClick={openUser}
        title={`Відкрити профіль ${fullName}`}
        className={mentionChipClass({ dark })}
        data-mention={type}
      >
        <span className={MENTION_CHIP_BADGE}>
          <UserAvatar user={member || { name: value }} size="xs" />
        </span>
        {label}
      </button>

      {show && (
        <span data-ui-surface="local" className="absolute bottom-full left-1/2 z-50 mb-2 block w-64 -translate-x-1/2 rounded-[12px] border border-line bg-white p-3 text-left shadow-xl">
          {member ? (
            <span className="flex flex-col gap-2">
              <span className="flex items-center gap-3">
                <UserAvatar user={member} size="lg" />
                <span className="block">
                  <span className="block text-[14px] font-bold leading-tight text-ink">{member.name || member.email}</span>
                  <span className="block text-[11px] text-muted">{subtitle}</span>
                </span>
              </span>
              <span className="mt-1 flex items-center gap-1 text-[11px] text-muted">
                <span className={`h-2 w-2 rounded-full ${isOnline ? 'bg-success-solid' : 'bg-faint'}`} />
                {formatLastSeenUk(member.lastActive, { now, online: isOnline })}
              </span>
            </span>
          ) : (
            <span className="block text-[12px] text-muted">Користувача не знайдено</span>
          )}
        </span>
      )}
    </span>
  );
}
