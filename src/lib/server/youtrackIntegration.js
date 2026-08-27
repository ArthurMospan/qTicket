import { FieldValue } from 'firebase-admin/firestore';
import 'server-only';

import { createHash } from 'node:crypto';
import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { open, seal, SealedBoxUnreadableError } from '@/lib/server/secretBox.mjs';
import { YouTrackClient } from '@/lib/server/youtrackClient';
import {
  isYouTrackStateField,
  mergeYouTrackStatuses,
  normalizeYouTrackBaseUrl,
} from '@/lib/utils/youtrackImport.mjs';
import {
  DEFAULT_STATUS_IDS,
  statusLabel,
} from '@/lib/utils/workflowDefaults.mjs';
import { statusCategoryMap } from '@/lib/utils/statusCategories.mjs';

function connectionRef(organizationId) {
  return getAdminDb().collection('organizations').doc(organizationId)
    .collection('private').doc('youtrack');
}

function connectionIdFor(baseUrl) {
  return createHash('sha256').update(baseUrl).digest('hex').slice(0, 32);
}

function publicConnection(snapshot) {
  if (!snapshot.exists) return { connected: false };
  const data = snapshot.data();
  return {
    connected: Boolean(data.tokenBox && data.baseUrl),
    baseUrl: data.baseUrl || '',
    connectionId: data.connectionId || '',
    account: data.account || null,
    connectedAt: data.connectedAt?.toDate?.().toISOString() || null,
    updatedAt: data.updatedAt?.toDate?.().toISOString() || null,
  };
}

export async function readYouTrackConnection(organizationId) {
  return publicConnection(await connectionRef(organizationId).get());
}

export async function connectYouTrack({ organizationId, baseUrl, token, userId }) {
  const normalizedUrl = normalizeYouTrackBaseUrl(baseUrl);
  const cleanToken = String(token || '').trim();
  if (cleanToken.length < 10 || cleanToken.length > 2_000) {
    throw new Error('Некоректний постійний токен YouTrack');
  }

  const client = new YouTrackClient({ baseUrl: normalizedUrl, token: cleanToken });
  const account = await client.me();
  const payload = {
    provider: 'youtrack',
    baseUrl: normalizedUrl,
    connectionId: connectionIdFor(normalizedUrl),
    tokenBox: seal(cleanToken),
    account: {
      id: String(account?.id || ''),
      login: String(account?.login || ''),
      name: String(account?.name || account?.fullName || account?.login || ''),
      email: String(account?.email || ''),
    },
    connectedBy: userId,
    connectedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await connectionRef(organizationId).set(payload);
  return { ...publicConnection({ exists: true, data: () => payload }), connectedAt: new Date().toISOString() };
}

export async function disconnectYouTrack(organizationId) {
  await connectionRef(organizationId).delete();
}

export async function youTrackClientFor(organizationId) {
  const snapshot = await connectionRef(organizationId).get();
  if (!snapshot.exists) throw new Error('YouTrack не підключено');
  const data = snapshot.data();
  if (!data.tokenBox || !data.baseUrl) throw new Error('Підключення YouTrack пошкоджене');

  let token;
  try {
    token = open(data.tokenBox);
  } catch (error) {
    // A stored token that no longer decrypts — the encryption key was rotated,
    // or the document was written by a deployment holding a different one. Only
    // this layer knows what the box held, so only this layer can say what to do
    // about it; unhandled, the reader got Node's own English sentence about a
    // GCM tag, printed under a progress bar in the migration screen.
    if (error instanceof SealedBoxUnreadableError) {
      throw new Error(
        'Підключення YouTrack пошкоджене: збережений токен більше не вдається прочитати. '
        + 'Відключіть YouTrack і підключіть його знову — перенесені задачі залишаться на місці.',
      );
    }
    throw error;
  }

  return {
    connection: data,
    client: new YouTrackClient({ baseUrl: data.baseUrl, token }),
  };
}

export async function discoverYouTrack(organizationId) {
  const { client, connection } = await youTrackClientFor(organizationId);
  const [projects, users, workflowSnapshot] = await Promise.all([
    client.projects(),
    client.users(),
    getAdminDb().collection('organizations').doc(organizationId)
      .collection('settings').doc('workflow').get(),
  ]);
  const savedStatuses = workflowSnapshot.data()?.statuses;
  const workflowStatuses = Array.isArray(savedStatuses) && savedStatuses.length
    ? savedStatuses.filter(status => status?.id)
    : DEFAULT_STATUS_IDS.map(id => ({ id, label: statusLabel(id) }));
  const targetStatusCategories = statusCategoryMap(workflowStatuses);
  const stateBundleIds = [...new Set(projects.flatMap(project => (
    (project.customFields || [])
      .filter(isYouTrackStateField)
      .map(field => String(field?.bundle?.id || ''))
      .filter(Boolean)
  )))];
  const stateBundles = new Map();
  for (let index = 0; index < stateBundleIds.length; index += 8) {
    const batch = stateBundleIds.slice(index, index + 8);
    const values = await Promise.all(batch.map(bundleId => client.stateBundle(bundleId)));
    batch.forEach((bundleId, bundleIndex) => {
      if (values[bundleIndex]) stateBundles.set(bundleId, values[bundleIndex]);
    });
  }
  const bundleStatusesByProject = new Map(projects.map(project => [
    String(project.id),
    (project.customFields || [])
      .filter(isYouTrackStateField)
      .flatMap(field => stateBundles.get(String(field?.bundle?.id || ''))?.values || []),
  ]));
  const observedIssuesByProject = new Map();
  const projectsNeedingFallback = projects.filter(project => (
    project?.id
    && !project.archived
    && (bundleStatusesByProject.get(String(project.id)) || []).length === 0
  ));
  // Tokens that can read/import issues do not necessarily have permission to
  // read admin bundles. Fall back to the state values on the issues themselves
  // in small batches so the picker never disappears merely because of 403/404.
  for (let index = 0; index < projectsNeedingFallback.length; index += 4) {
    const batch = projectsNeedingFallback.slice(index, index + 4);
    const issueLists = await Promise.all(batch.map(project => client.issueStubs(project.shortName)));
    batch.forEach((project, projectIndex) => {
      observedIssuesByProject.set(String(project.id), issueLists[projectIndex] || []);
    });
  }
  return {
    connectionId: connection.connectionId,
    targetStatuses: workflowStatuses.map(status => ({
      id: String(status.id),
      label: String(status.label || status.id),
      category: targetStatusCategories.get(status.id) || '',
    })),
    projects: projects
      .filter(project => project?.id && !project.archived)
      .map(project => ({
        id: String(project.id),
        name: String(project.name || project.shortName || 'Без назви'),
        shortName: String(project.shortName || project.id),
        description: String(project.description || ''),
        archived: project.archived === true,
        statuses: mergeYouTrackStatuses(
          bundleStatusesByProject.get(String(project.id)),
          observedIssuesByProject.get(String(project.id)),
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'uk')),
    users: users
      .filter(user => user?.id || user?.login)
      .map(user => ({
        id: String(user.id || user.login),
        login: String(user.login || ''),
        name: String(user.name || user.fullName || user.login || user.email || 'Користувач YouTrack'),
        email: String(user.email || ''),
        avatarUrl: String(user.avatarUrl || ''),
        banned: user.banned === true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'uk')),
  };
}
