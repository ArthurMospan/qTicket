// src/lib/firebase.js
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  getAuth,
  GithubAuthProvider,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
} from 'firebase/auth';
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

// Where a signed-in session is read from at boot, in the order it is tried.
//
// A tab does not have to be in front to be loading, and `getAuth()` behaves as
// if it does. It puts `indexedDBLocalPersistence` at the head of the list, and
// that store refuses to open while the document is hidden: it listens for
// `pagehide` and `visibilitychange`, raises an `isHiding` flag, and every
// `_openDb()` after that throws «Database is closing/hidden». A tab restored in
// the background, opened behind the current one, or loaded into a window that
// is not in front boots in exactly that state.
//
// The refusal then lands inside the SDK's own `initializeCurrentUser()`, which
// does not catch it, so the auth instance's initialization promise rejects and
// `_isInitialized` is never set. Every listener registered through
// `onAuthStateChanged` hangs off that promise by a `.then()` with no rejection
// handler — so no listener is ever called again for the life of the page, and
// `authStateReady()` never settles either. Nothing downstream can even discover
// that it failed: the workspace simply kept waiting, hit its twelve-second
// stall timer, and told the reader the product was unavailable. Reloading was
// the only cure, which is why the second attempt always worked.
//
// So the session is read from `localStorage` first. It is synchronous, it has
// no lifecycle of its own and it cannot be hidden. IndexedDB stays in the list
// behind it purely as a migration source: a session written there by an earlier
// build is still found on the first load and moved across. After that it is
// never on the boot path.
const AUTH_PERSISTENCE = [
  browserLocalPersistence,
  indexedDBLocalPersistence,
  browserSessionPersistence,
];

function createAuth() {
  // Server render: no browser stores to choose between, and `initializeAuth`
  // would be handed persistences that cannot exist there.
  if (typeof window === 'undefined') return getAuth(app);
  try {
    return initializeAuth(app, {
      persistence: AUTH_PERSISTENCE,
      // `getAuth()` supplies this one itself; `initializeAuth()` does not, and
      // without it `signInWithPopup(auth, provider)` has no resolver to open a
      // window with. Every social sign-in in the product goes through that call.
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    // Another bundle or a hot reload has already initialized auth for this app.
    return getAuth(app);
  }
}

export const auth = createAuth();
export const db = createFirestore();
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

export function createGitHubProvider() {
  const provider = new GithubAuthProvider();
  provider.addScope('read:user');
  provider.addScope('user:email');
  return provider;
}
