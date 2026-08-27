import 'server-only';

import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getAdminAuth, getAdminDb } from '@/lib/server/firebaseAdmin';

export async function readWorkspaceProjectAccess(projectId) {
  const cleanProjectId = typeof projectId === 'string' ? projectId.trim() : '';
  if (!cleanProjectId) notFound();

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('qt_session')?.value;
  if (!sessionCookie) return null;

  let user;
  try {
    user = await getAdminAuth().verifySessionCookie(sessionCookie, true);
  } catch {
    // Firebase client auth is authoritative for the workspace shell. A cookie
    // can briefly lag behind a valid client session, so let the client guard
    // finish auth instead of turning that race into a false 404.
    return null;
  }

  // Authentication comes before the resource read. Apart from saving a
  // billable Firestore read for anonymous requests, this prevents the server
  // component from becoming a project-id existence oracle.
  const db = getAdminDb();
  const projectSnapshot = await db.collection('projects').doc(cleanProjectId).get();
  if (!projectSnapshot.exists) notFound();

  const project = projectSnapshot.data();
  const organizationId = typeof project.organizationId === 'string'
    ? project.organizationId.trim()
    : '';
  if (!organizationId) notFound();

  const membershipSnapshot = await db.collection('orgMemberships')
    .doc(`${organizationId}_${user.uid}`)
    .get();
  if (!membershipSnapshot.exists) notFound();

  const membership = membershipSnapshot.data();
  const privileged = membership.role === 'owner' || membership.role === 'admin';
  const onProjectTeam = Array.isArray(project.team) && project.team.includes(user.uid);
  if (!privileged && !onProjectTeam) notFound();

  return {
    id: cleanProjectId,
    organizationId,
  };
}
