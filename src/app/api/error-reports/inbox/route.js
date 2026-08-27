// The inbox behind /errors — every report from every workspace, in one list.
//
// Reading these is not a workspace feature and never was one. A report carries
// somebody's screen, path and failure, and the only person it is addressed to
// is whoever can fix it. That used to be spelled «власник організації», which
// is the wrong person the moment a workspace belongs to a customer: their owner
// would read their team's failures, and the developer would have to walk every
// organization to find their own bug list.
//
// So the reader is not a role. It is a named person — and that is the whole
// difference from the shared password this replaced.
//
// A password had to be secret to work, and this repository is public: the one
// place the password was written down was also the one place anybody could read
// it. Rate limiting a guess is no defence against a value nobody has to guess.
// An account id is the opposite kind of value. It identifies without granting:
// knowing this id buys nothing, because reaching the inbox still means holding
// a valid Firebase session for it. So the list below is safe to read, safe to
// commit, and safe to leave here when the repository stays public.
//
// It also survives the move off Firebase. The seam is `authenticateRequest`,
// not this file: whatever issues tokens later, this stays a list of ids and the
// only edit is which ids are in it.
import { NextResponse } from 'next/server';
import { authenticateRequest, enforceRateLimit, getAdminDb } from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';

// Who may read the inbox. Add an id here to hand somebody the page; remove one
// to take it back. Unlike a password, taking it back from one person does not
// change it for everybody else.
const BUILT_IN_READERS = [
  '5wlnkYGpcxfVzNrzRy9TXHksDXh2', // arthur.mospan@gmail.com — product developer
];

// And an escape hatch that needs no deploy: ERROR_REPORT_READERS may name extra
// ids, comma-separated, for temporary access that ends when the variable does.
function readers() {
  const extra = (process.env.ERROR_REPORT_READERS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
  return new Set([...BUILT_IN_READERS, ...extra]);
}

const REPORT_LIMIT = 100;

export async function GET(request) {
  try {
    const authorization = await authenticateRequest(request);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    // Signed in is not the same as invited. Everybody with a workspace account
    // reaches this far; the list is what separates them.
    if (!readers().has(authorization.user.uid)) {
      return NextResponse.json({ error: 'Ця сторінка не для цього акаунта' }, { status: 403 });
    }

    // Still rate limited, now per account rather than per address — not against
    // guessing, which is no longer possible, but against a refresh held down.
    if (!(await enforceRateLimit('errorReportsInbox', authorization.user.uid, 60, 300))) {
      return NextResponse.json({ error: 'Забагато запитів. Спробуйте за кілька хвилин' }, { status: 429 });
    }

    const snapshot = await getAdminDb().collection('errorReports')
      .orderBy('createdAt', 'desc')
      .limit(REPORT_LIMIT)
      .get();

    return NextResponse.json({
      reports: snapshot.docs.map(document => {
        const data = document.data();
        return {
          id: document.id,
          message: data.message || '',
          note: data.note || '',
          detail: data.detail || '',
          context: data.context || '',
          path: data.path || '',
          userAgent: data.userAgent || '',
          organizationName: data.organizationName || '',
          reportedByName: data.reportedByName || '',
          createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
        };
      }),
    });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'error reports inbox',
      fallbackMessage: 'Не вдалося прочитати звіти',
    });
  }
}
