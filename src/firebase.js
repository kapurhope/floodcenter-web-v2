import { getAnalytics } from 'firebase/analytics';
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

/**
 * Flood Center web v2 — point at floodcenter-backend-v2 via .env.local.
 * Never hard-code production (floodcenter-backend) credentials here.
 */
const PRODUCTION_PROJECT_ID = 'floodcenter-backend';

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID,
};

const configError = (() => {
  if (!firebaseConfig.projectId || !firebaseConfig.apiKey) {
    return 'Missing REACT_APP_FIREBASE_* settings. Copy .env.example to .env.local, '
      + 'fill in the web config for floodcenter-backend-v2, and restart the dev server.';
  }
  if (firebaseConfig.projectId === PRODUCTION_PROJECT_ID) {
    return `REACT_APP_FIREBASE_PROJECT_ID is ${PRODUCTION_PROJECT_ID} (production). `
      + 'Flood Center v2 must use floodcenter-backend-v2.';
  }
  return null;
})();

if (configError) console.error(`[firebase] ${configError}`);

const app = configError ? null : initializeApp(firebaseConfig);
const db = app ? getFirestore(app) : null;

let analytics = null;
try {
  if (app && typeof window !== 'undefined' && firebaseConfig.measurementId) {
    analytics = getAnalytics(app);
  }
} catch (err) {
  console.warn('[firebase] Analytics unavailable:', err.message);
}

let auth = null;
const getAppAuth = () => {
  if (!app) return null;
  if (!auth) auth = getAuth(app);
  return auth;
};

export { app, analytics, db, configError as firebaseConfigError, getAppAuth };
