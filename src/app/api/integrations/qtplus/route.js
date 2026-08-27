import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import { readLink, deleteLink, QTPLUS_CLIENT_ID } from '@/lib/server/qtplusLink';

export async function GET(request) {
  try {
    const authorization = await authenticateRequest(request);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const link = await readLink(authorization.user.uid);
    return NextResponse.json(link ? { connected: true, ...link } : { connected: false });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'QuickTeam+ status',
      fallbackMessage: 'Internal Server Error',
    });
  }
}

export async function DELETE(request) {
  try {
    const authorization = await authenticateRequest(request);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const removed = await deleteLink(authorization.user.uid);
    if (!removed) return NextResponse.json({ success: true });

    // The local link is already gone. Revoking in QT+ is best effort: if it
    // fails, the user is still disconnected here, and reporting failure would
    // invite them to retry something that cannot succeed.
    const qtPlusUrl = process.env.NEXT_PUBLIC_QTPLUS_URL;
    const clientSecret = process.env.QTPLUS_CLIENT_SECRET;
    if (removed.refreshToken && qtPlusUrl && clientSecret) {
      try {
        const revokeRes = await fetch(new URL('/api/oauth/revoke', qtPlusUrl), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: QTPLUS_CLIENT_ID,
            clientSecret,
            refreshToken: removed.refreshToken,
          }),
        });
        if (!revokeRes.ok) {
          console.error('[qtplus] revoke failed:', revokeRes.status, await revokeRes.text());
        }
      } catch (error) {
        console.error('[qtplus] revoke request failed:', error.message);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'QuickTeam+ disconnect',
      fallbackMessage: 'Internal Server Error',
    });
  }
}
