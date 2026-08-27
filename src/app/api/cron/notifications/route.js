import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import { readSweepHealth, runScheduledNotificationSweep } from '@/lib/server/reminderJobs';
import { isQuotaExceededError } from '@/lib/utils/errors';
import { QUOTA_FAILURE_COPY } from '@/lib/utils/quotaState.mjs';

// The last secret here still compared with `!==`. Telegram's webhook secret and
// the API keys both use a constant-time comparison already; this one is the odd
// one out rather than a new risk, and matching them costs a function call.
function presentedSecretMatches(header, expected) {
  const a = Buffer.from(String(header || ''));
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

// `mode` splits the cheap half from the expensive one so an external scheduler
// can drive delivery on a tight interval without paying for a collection scan
// every minute:
//
//   ?mode=dispatch      — send what is due. One indexed query, no state read and
//                         no state write; safe every minute.
//   ?mode=maintenance   — empty «Нещодавно видалене» past its window and expire
//                         read records. Two bounded queries; hourly.
//   ?mode=materialise   — restock the outbox from the source data and post
//                         birthday greetings. Nightly; a safety net, because the
//                         rows are written when the deadline is set.
//   ?mode=health        — read the watermark and say whether anything has come
//                         to run the sweep lately. Sweeps nothing, writes
//                         nothing, costs one read; answers 503 when the sweep
//                         has been silent, so a caller outside its schedule can
//                         go red without parsing a body.
//   (default) full      — all three, with materialising self-throttled internally.
//
// See docs/ARCHITECTURE.md.
const MODES = new Set(['full', 'dispatch', 'maintenance', 'materialise', 'health']);

export async function GET(request) {
  const cronSecret = process.env.CRON_SECRET?.trim() || '';
  if (!cronSecret || !presentedSecretMatches(request.headers.get('authorization'), cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const requested = new URL(request.url).searchParams.get('mode') || 'full';
  if (!MODES.has(requested)) {
    return NextResponse.json({ error: 'Unknown mode' }, { status: 400 });
  }

  try {
    // Health is a question about the sweep, not a pass of it, so it answers
    // before anything is swept. A watchdog that had to run a sweep in order to
    // check on one would be the thing it is watching.
    if (requested === 'health') {
      const health = await readSweepHealth();
      return NextResponse.json(
        {
          ok: health.healthy,
          mode: 'health',
          ...health,
          ...(health.healthy ? {} : {
            error: health.silentForMs === null
              ? 'Розсилка сповіщень не запускалась жодного разу'
              : `Розсилка сповіщень мовчить ${Math.round(health.silentForMs / 3600000)} год`,
          }),
        },
        { status: health.healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const result = await runScheduledNotificationSweep({ mode: requested });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    // The daily read cap is not a broken sweep, and reporting it as one is how
    // a scheduler that runs every minute turns one exhausted quota into
    // fourteen hundred red runs. Nothing was lost: the sweep throws before it
    // advances its watermark, so the next pass after the counter resets covers
    // everything this one could not read.
    if (isQuotaExceededError(error)) {
      console.warn('[cron] Firestore daily quota is exhausted; nothing swept this pass');
      return NextResponse.json({
        ok: false,
        code: 'QUOTA_EXCEEDED',
        mode: requested,
        error: QUOTA_FAILURE_COPY.title,
      }, { status: 503 });
    }
    return routeErrorResponse(error, {
      context: 'scheduled notifications',
      fallbackMessage: 'Scheduled notification sweep failed',
    });
  }
}
