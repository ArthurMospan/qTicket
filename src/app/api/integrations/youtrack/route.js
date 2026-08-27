import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/server/apiErrors';
import { authorizeOrgRequest, enforceRateLimit, getAdminDb } from '@/lib/server/firebaseAdmin';
import { youTrackRouteErrorResponse } from '@/lib/server/youtrackRouteErrors';
import { refuseWithoutCapability } from '@/lib/server/planLimits';
import {
  connectYouTrack,
  disconnectYouTrack,
  readYouTrackConnection,
} from '@/lib/server/youtrackIntegration';

function organizationIdFrom(request) {
  return new URL(request.url).searchParams.get('organizationId')?.trim() || '';
}

export async function GET(request) {
  try {
    const organizationId = organizationIdFrom(request);
    const authorization = await authorizeOrgRequest(request, organizationId, ['owner', 'admin']);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    return NextResponse.json(await readYouTrackConnection(organizationId), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return youTrackRouteErrorResponse(error, {
      context: 'YouTrack status',
      fallbackMessage: 'Не вдалося перевірити підключення YouTrack',
    });
  }
}

export async function POST(request) {
  try {
    const { organizationId, baseUrl, token } = await readJsonBody(request);
    const authorization = await authorizeOrgRequest(request, organizationId, ['owner', 'admin']);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    if (!(await enforceRateLimit('youtrack-connect', authorization.user.uid, 10, 60))) {
      return NextResponse.json({ error: 'Забагато спроб підключення' }, { status: 429 });
    }
    // Connecting a tracker is «Перенесення даних». Disconnecting (DELETE) is
    // not: a stored credential must always be removable.
    const refusal = await refuseWithoutCapability(getAdminDb(), organizationId, 'data-import');
    if (refusal) return refusal;
    const connection = await connectYouTrack({
      organizationId,
      baseUrl,
      token,
      userId: authorization.user.uid,
    });
    return NextResponse.json(connection);
  } catch (error) {
    return youTrackRouteErrorResponse(error, {
      context: 'YouTrack connect',
      fallbackMessage: 'Не вдалося підключити YouTrack',
    });
  }
}

export async function DELETE(request) {
  try {
    const organizationId = organizationIdFrom(request);
    const authorization = await authorizeOrgRequest(request, organizationId, ['owner', 'admin']);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    await disconnectYouTrack(organizationId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return youTrackRouteErrorResponse(error, {
      context: 'YouTrack disconnect',
      fallbackMessage: 'Не вдалося відключити YouTrack',
    });
  }
}
