'use client';
import { doc, updateDoc, deleteField, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

/**
 * Persist the QuickTeam+ link on a workspace project. Owner/admin only — the
 * workspace projects update rule authorizes it (status & organizationId
 * unchanged); the UI gate is defensive. Writes only qtplusLink + updatedAt.
 */
export async function linkQtPlusProject(projectId, portalProject, linkedByUid) {
  await updateDoc(doc(db, 'projects', projectId), {
    qtplusLink: {
      projectId: portalProject.id,
      projectName: portalProject.name || '',
      linkedBy: linkedByUid || null,
      linkedAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
}

/** Remove the QuickTeam+ link from a workspace project. */
export async function unlinkQtPlusProject(projectId) {
  await updateDoc(doc(db, 'projects', projectId), {
    qtplusLink: deleteField(),
    updatedAt: serverTimestamp(),
  });
}
