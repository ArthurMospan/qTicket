// src/lib/firebase.js
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, GithubAuthProvider, GoogleAuthProvider } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// QuickTeam+ uses a named secondary Firebase app. `getApps()[0]` is therefore
// not a safe substitute for the main app: module evaluation order can put the
// portal app first and make every workspace ID token target the wrong Firebase
// project. Resolve the SDK's explicit [DEFAULT] app or create that exact app.
const app = getApps().some(candidate => candidate.name === '[DEFAULT]')
  ? getApp()
  : initializeApp(firebaseConfig);

if (
  process.env.NODE_ENV === 'development'
  && app.options.projectId !== firebaseConfig.projectId
) {
  console.error('[firebase] Default app project mismatch', {
    actualProjectId: app.options.projectId || '',
    expectedProjectId: firebaseConfig.projectId || '',
  });
}

function createFirestore() {
  if (typeof window === 'undefined') return getFirestore(app);
  try {
    return initializeFirestore(app, {
      // Next dev repeatedly replaces modules while the browser may have several
      // localhost tabs open. Sharing an IndexedDB primary lease across those
      // short-lived clients produced "future update time" and lease failures
      // that made local listeners look disconnected. Memory cache is Firebase's
      // normal web default and keeps development deterministic; production
      // retains the intentional offline, multi-tab cache.
      localCache: process.env.NODE_ENV === 'development'
        ? memoryLocalCache()
        : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // Hot reloads or another bundle may have initialized Firestore already.
    return getFirestore(app);
  }
}

export const auth = getAuth(app);
export const db = createFirestore();
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

export function createGitHubProvider() {
  const provider = new GithubAuthProvider();
  provider.addScope('read:user');
  provider.addScope('user:email');
  return provider;
}
