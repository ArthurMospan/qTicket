import { NextResponse } from 'next/server';
import { authorizeOrgRequest, enforceRateLimit } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { runBirthdaySweep } from '@/lib/server/reminderJobs';

// Announces the caller's birthday now, if it is today.
//
// The scheduled sweep claims each organization once per calendar day, which
// keeps it to two reads per member per day but also means it has already run by
// the time most people get to Settings. Saving a birthday dated today therefore
// produced nothing at all until the following year. This is the same sweep,
// scoped to one person and allowed to bypass that claim; the greeting and the
// notifications are keyed by day and member, so running both is harmless.
export async function POST(request) {
  try {
    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      return NextResponse.json({
        error: 'Некоректний JSON',
        code: 'INVALID_JSON',
      }, { status: 400 });
    }
    const organizationId = typeof body?.organizationId === 'string' ? body.organizationId.trim() : '';
    const authorization = await authorizeOrgRequest(request, organizationId);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    if (!(await enforceRateLimit('calendar-birthday-announce', authorization.user.uid, 5, 60))) {
      return NextResponse.json({ error: 'Забагато запитів' }, { status: 429 });
    }

    const result = await runBirthdaySweep({
      organizationId,
      userId: authorization.user.uid,
      force: true,
    });
    return NextResponse.json({ greetings: result.created });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'calendar-birthday POST',
      fallbackMessage: 'Не вдалося оголосити день народження',
    });
  }
}
