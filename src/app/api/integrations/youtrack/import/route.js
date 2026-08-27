import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/server/apiErrors';
import { authorizeOrgRequest, enforceRateLimit, getAdminDb } from '@/lib/server/firebaseAdmin';
import { refuseWithoutCapability } from '@/lib/server/planLimits';
import { youTrackRouteErrorResponse } from '@/lib/server/youtrackRouteErrors';
import {
  cancelYouTrackImport,
  getYouTrackImport,
  prepareYouTrackImport,
  runYouTrackImportStep,
} from '@/lib/server/youtrackImporter';

export const maxDuration = 60;

function organizationIdFrom(request) {
  return new URL(request.url).searchParams.get('organizationId')?.trim() || '';
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const organizationId = organizationIdFrom(request);
    const authorization = await authorizeOrgRequest(request, organizationId, ['owner', 'admin']);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    const jobId = url.searchParams.get('jobId')?.trim() || '';
    const result = await getYouTrackImport({ organizationId, jobId });
    return NextResponse.json(jobId ? { job: result } : { jobs: result }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return youTrackRouteErrorResponse(error, {
      context: 'YouTrack import status',
      fallbackMessage: 'Не вдалося прочитати стан імпорту',
    });
  }
}

export async function POST(request) {
  try {
    const body = await readJsonBody(request);
    const organizationId = String(body.organizationId || '').trim();
    const authorization = await authorizeOrgRequest(request, organizationId, ['owner', 'admin']);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    const rateLimit = body.action === 'run' ? 1_000 : 20;
    if (!(await enforceRateLimit(`youtrack-import-${body.action || 'unknown'}`, authorization.user.uid, rateLimit, 60))) {
      return NextResponse.json({ error: 'Імпорт виконується надто швидко, повторіть за хвилину' }, { status: 429 });
    }
    // The importer already asks the registry about the project ceiling; it had
    // never been asked whether the plan has importing at all. A job prepared on
    // Lite and continued after a downgrade went on writing.
    const refusal = await refuseWithoutCapability(getAdminDb(), organizationId, 'data-import');
    if (refusal) return refusal;

    if (body.action === 'prepare') {
      const job = await prepareYouTrackImport({
        organizationId,
        userId: authorization.user.uid,
        selectedProjectIds: body.selectedProjectIds,
        projectMappings: body.projectMappings,
        userMappings: body.userMappings,
        statusFilters: body.statusFilters,
        statusMappings: body.statusMappings,
      });
      return NextResponse.json({ job }, { status: 201 });
    }
    if (body.action === 'run') {
      const job = await runYouTrackImportStep({
        organizationId,
        jobId: String(body.jobId || ''),
        userId: authorization.user.uid,
      });
      return NextResponse.json({ job });
    }
    if (body.action === 'cancel') {
      const job = await cancelYouTrackImport({
        organizationId,
        jobId: String(body.jobId || ''),
        userId: authorization.user.uid,
        // Being admin of the organization is not being the author of somebody
        // else's migration. Only the owner is given the stop button for one.
        isOrganizationOwner: authorization.membership?.role === 'owner',
      });
      return NextResponse.json({ job });
    }
    return NextResponse.json({ error: 'Невідома дія імпорту' }, { status: 400 });
  } catch (error) {
    return youTrackRouteErrorResponse(error, {
      context: 'YouTrack import',
      fallbackMessage: 'Імпорт YouTrack завершився помилкою',
    });
  }
}
