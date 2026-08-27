'use client';

import { use } from 'react';
import CalendarEventPage from '@/components/workspace/calendar/CalendarEventPage';

export default function CalendarEventRoute({ params, searchParams }) {
  const { eventId } = use(params);
  const resolvedSearchParams = use(searchParams);
  return (
    <CalendarEventPage
      eventId={eventId}
      occurrenceStartAt={resolvedSearchParams?.occurrence || ''}
    />
  );
}
