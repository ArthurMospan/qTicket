'use client';

import { useEffect, useState } from 'react';

// Whether the browser believes it can reach the network.
//
// The workspace mixes Firestore writes with authenticated server requests, so
// it cannot promise offline persistence. `navigator.onLine` is a coarse signal
// — it reports the link, not whether anything answers on it — but it catches the
// case that matters, which is a phone that left coverage.
//
// Initialised to true rather than to navigator.onLine so the server render and
// the first client render agree; the real value arrives in the effect.
export function useOnlineStatus() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(window.navigator.onLine !== false);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}

export default useOnlineStatus;
