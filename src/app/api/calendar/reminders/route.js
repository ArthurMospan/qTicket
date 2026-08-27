import { NextResponse } from 'next/server';
import { authorizeOrgRequest } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  runBirthdaySweep,
  runCalendarReminderSweep,
} from '@/lib/server/reminderJobs';

// Authenticated manual fallback for development and diagnostics. Production
// reminders are driven by /api/cron/notifications and never depend on a browser
// tab being open.
export async function POST(request) {
  try {
    const body = await readJsonBody(request);
    const organizationId = typeof body.organizationId === 'string' ? body.organizationId.trim() : '';
    const authorization = await authorizeOrgRequest(request, organizationId);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const [calendar, birthdays] = await Promise.all([
      runCalendarReminderSweep({
        organizationId,
        recipientId: authorization.user.uid,
      }),
      runBirthdaySweep({ organizationId }),
    ]);
    return NextResponse.json({
      created: calendar.claimed,
      telegram: calendar.telegram,
      birthdayGreetings: birthdays.created,
    });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'calendar-reminders POST',
      fallbackMessage: 'Не вдалося перевірити нагадування',
    });
  }
}
