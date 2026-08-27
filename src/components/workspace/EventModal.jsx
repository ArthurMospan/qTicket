'use client';

// The event's twin of `IssueModal`: the same panel, over whatever screen you
// were on. A calendar, a profile and an analytics list all name events, and
// clicking one used to mean leaving the screen you were reading.

import CalendarEventPage from '@/components/workspace/calendar/CalendarEventPage';
import { useModalFocus } from '@/lib/hooks/useModalFocus';

export default function EventModal({ event, onClose }) {
  const dialogRef = useModalFocus({ isOpen: Boolean(event), onClose });
  if (!event) return null;
  return (
    <div data-ui-overlay="issue-detail" className="fixed inset-0 z-[100] flex items-end justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={event.title || 'Подія'}
        data-ui-surface="local"
        className="relative flex h-[94dvh] w-full flex-col overflow-hidden rounded-t-[24px] bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:h-full sm:max-h-none sm:w-[min(1040px,88vw)] sm:rounded-none sm:pb-0"
        onClick={clickEvent => clickEvent.stopPropagation()}
      >
        <CalendarEventPage
          eventId={event.sourceEventId || event.id}
          occurrenceStartAt={event.occurrenceStartAt || ''}
          isModal
          onClose={onClose}
        />
      </div>
    </div>
  );
}
