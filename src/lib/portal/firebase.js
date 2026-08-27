'use client';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// PUBLIC config for the QuickTeam+ project (quickteam-portal-prod). These are
// NOT secrets — the exact same values ship in the qt app's own browser bundle
// (see qt/src/lib/firebase.js). Committed as defaults so the integration works
// with zero per-deploy env setup; the NEXT_PUBLIC_QTPLUS_FB_* env vars still
// override them if they are ever set.
const config = {
  apiKey: process.env.NEXT_PUBLIC_QTPLUS_FB_API_KEY || 'AIzaSyAG21Rabxh6H6qM3j0hT5NoqtFpgzldUHA',
  authDomain: process.env.NEXT_PUBLIC_QTPLUS_FB_AUTH_DOMAIN || 'quickteam-portal-prod.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_QTPLUS_FB_PROJECT_ID || 'quickteam-portal-prod',
  appId: process.env.NEXT_PUBLIC_QTPLUS_FB_APP_ID || '1:238360279495:web:194cc0e2b387455b1941e2',
};

const PORTAL_APP = 'qtplus-portal';

function portalApp() {
  if (!config.projectId) return null; // integration not configured -> inert
  const existing = getApps().find((a) => a.name === PORTAL_APP);
  return existing || initializeApp(config, PORTAL_APP);
}

export function getPortalAuth() {
  const app = portalApp();
  return app ? getAuth(app) : null;
}

export function getPortalDb() {
  const app = portalApp();
  return app ? getFirestore(app) : null;
}
