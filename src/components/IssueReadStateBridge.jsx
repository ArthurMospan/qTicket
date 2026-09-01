'use client';

import { useEffect } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useAppContext } from '@/lib/context/AppContext';
import { db } from '@/lib/firebase';
import { timestampMillis } from '@/lib/utils/issueReadState.mjs';
import { reportLoadError } from '@/lib/utils/errors';
import useWorkspaceStore from '@/store/useWorkspaceStore';

// One organization-wide cursor stream feeds every issue card. Keeping this at
// the workspace boundary avoids one Firestore listener per card or per board.
export default function IssueReadStateBridge() {
  // `subscribableOrgId`, а не `activeOrgId`: цей міст змонтований у layout
  // сусідом до `WorkspaceOrganizationRouteGuard`, тобто ВИЩЕ за нього. Гвард
  // тримає екрани, поки довідник організацій не підтверджено, а міст під той
  // гвард не потрапляє — і підписувався саме у вікні, яке гвард існує щоб
  // закрити. Звідси `[IssueReadStateBridge] Missing or insufficient permissions`
  // у консолі кожного холодного входу.
  const { subscribableOrgId: activeOrgId, currentUser } = useAppContext();
  const userId = currentUser?.uid || currentUser?.id || null;
  const setIssueReadState = useWorkspaceStore(state => state.setIssueReadState);
  const resetIssueReadState = useWorkspaceStore(state => state.resetIssueReadState);

  useEffect(() => {
    if (!activeOrgId || !userId) {
      queueMicrotask(() => resetIssueReadState());
      return undefined;
    }

    // Cleared, and *marked* uncleared: until the first snapshot lands, an empty
    // map must not be read as «nothing here has ever been seen».
    queueMicrotask(() => resetIssueReadState());

    const readStateQuery = query(
      collection(db, 'organizations', activeOrgId, 'issueReadState'),
      where('userId', '==', userId),
    );
    const unsubscribe = onSnapshot(readStateQuery, snapshot => {
      const state = {};
      snapshot.forEach(cursorDocument => {
        const cursor = cursorDocument.data();
        if (cursor.issueId) state[cursor.issueId] = timestampMillis(cursor.lastSeenAt);
      });
      setIssueReadState(state);
    }, error => {
      reportLoadError('[IssueReadStateBridge]', error);
    });

    return () => unsubscribe();
  }, [activeOrgId, resetIssueReadState, setIssueReadState, userId]);

  useEffect(() => () => resetIssueReadState(), [resetIssueReadState]);

  return null;
}
