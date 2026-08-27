'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAppContext } from '@/lib/context/AppContext';
import { reportLoadError } from '@/lib/utils/errors';
import { presenceMillis } from '@/lib/utils/presence.mjs';

export function useOrganizationPresence() {
  const { activeOrgId } = useAppContext();
  const [presenceByUserId, setPresenceByUserId] = useState({});

  useEffect(() => {
    if (!activeOrgId) {
      queueMicrotask(() => setPresenceByUserId({}));
      return undefined;
    }
    return onSnapshot(
      collection(db, 'organizations', activeOrgId, 'presence'),
      snapshot => {
        const next = {};
        snapshot.forEach(document => {
          next[document.id] = presenceMillis(document.data().lastSeen);
        });
        setPresenceByUserId(next);
      },
      error => reportLoadError('[useOrganizationPresence]', error),
    );
  }, [activeOrgId]);

  return presenceByUserId;
}
