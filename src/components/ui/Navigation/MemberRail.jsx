'use client';

import React from 'react';
import { User } from 'lucide-react';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import PresenceDot from '@/components/ui/DataDisplay/PresenceDot';
import Pill from '@/components/ui/DataDisplay/Pill';
import LoadingSpinner from '@/components/ui/Feedback/LoadingSpinner';
import EmptyState from '@/components/ui/Feedback/EmptyState';

// The team rail: a titled, counted list of people.
//
// Same story as ChannelRail — /ui-kit used to hand-copy this and the copy was
// wrong in five ways at once (8px radius drawn as 10px, the `#ebebeb` selected
// row drawn as white-with-a-shadow, a 32px avatar drawn at 24px, the muted
// `#4a4a4a` name drawn as bold ink, and no presence dot at all). The page and
// the catalogue render this file now, so there is nothing left to drift.
/**
 * The team rail: a titled, counted list of people, with presence.
 *
 * @param {string} props.title Heading above the list.
 * @param {object[]} props.members The people to list.
 * @param {string} props.activeId Id of the selected person.
 * @param {(id: string) => void} props.onSelect Selects one.
 * @param {React.ReactNode} props.action Control beside the heading — search, or invite.
 * @param {boolean} props.loading The list is still arriving; a spinner takes its place.
 * @param {string} props.emptyTitle Headline when nobody matches.
 * @param {string} props.emptyDescription Sentence under it.
 */
export default function MemberRail({
  title = 'Команда',
  members = [],
  activeId,
  onSelect = () => {},
  action,
  loading = false,
  emptyTitle = 'Нікого не знайдено',
  emptyDescription = 'Спробуйте змінити пошуковий запит.',
}) {
  return (
    <>
      {/* QUI-107. 16px, not the 32px the other two rails open with.
          Those 32px were copied here to stop the team rail's content starting
          higher than chat's and settings' — but the three rails do not open
          with the same thing. Chat and settings open with a 10px uppercase
          caption; this one opens with a 16px heading and a counter beside it,
          so the same 32px above a block twice as tall reads as a hole. The
          heading itself now does the separating work the padding was doing. */}
      <div className="px-4 pt-[16px] pb-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="ui-type-dialog-title text-ink">{title}</h2>
          {/* QUI-108. The same count the board columns show, drawn the same
              way. This was an outline `Pill`; the first attempt at the fix
              reached for `Counter`, which is what two of the board's own
              headers use — but not the one anybody sees, so it still did not
              match. `tone="count"` is now the single answer, here and in all
              four of the board's headers. */}
          <Pill tone="count" size="md">{members.length}</Pill>
        </div>
        {action}
      </div>

      <div className="qt-nav-scroll flex-1 overflow-y-auto custom-scrollbar px-2 pb-4 flex flex-col gap-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner size="sm" />
          </div>
        ) : members.length === 0 ? (
          <EmptyState icon={User} title={emptyTitle} description={emptyDescription} density="compact" />
        ) : (
          members.map(member => {
            const uid = member.id || member.uid;
            const isSelected = uid === activeId;
            return (
              <button
                key={uid}
                type="button"
                onClick={() => onSelect(member)}
                className={`w-full text-left px-3 py-2 rounded-[8px] transition-colors flex items-center gap-3 ${
                  isSelected ? 'bg-line' : 'hover:bg-line/50'
                }`}
              >
                <div className="relative shrink-0">
                  <UserAvatar user={member} size="md" />
                  {member.online && <PresenceDot size="md" collar="canvas" />}
                </div>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className={`text-[13px] font-medium truncate transition-colors flex items-center gap-1 ${
                    isSelected ? 'text-ink' : 'text-ink group-hover:text-ink'
                  }`}
                  >
                    {member.name || member.email}
                    {member.statusEmoji && <span>{member.statusEmoji}</span>}
                  </span>
                  <span className="text-[11px] font-normal text-muted truncate">
                    {member.positionName}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}
