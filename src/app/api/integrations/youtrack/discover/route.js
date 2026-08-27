import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/server/apiErrors';
import { authorizeOrgRequest, enforceRateLimit } from '@/lib/server/firebaseAdmin';
import { youTrackRouteErrorResponse } from '@/lib/server/youtrackRouteErrors';
import { discoverYouTrack } from '@/lib/server/youtrackIntegration';

export const maxDuration = 60;

export async function POST(request) {
  try {
    const { organizationId } = await readJsonBody(request);
    const authorization = await authorizeOrgRequest(request, organizationId, ['owner', 'admin']);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    if (!(await enforceRateLimit('youtrack-discover', authorization.user.uid, 10, 60))) {
      return NextResponse.json({ error: 'Забагато запитів до YouTrack' }, { status: 429 });
    }
    return NextResponse.json(await discoverYouTrack(organizationId), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return youTrackRouteErrorResponse(error, {
      context: 'YouTrack discover',
      fallbackMessage: 'Не вдалося прочитати проєкти YouTrack',
    });
  }
}
