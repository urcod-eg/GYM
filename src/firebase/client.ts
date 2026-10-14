import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

/**
 * Firebase is optional at build time: with no VITE_FIREBASE_API_KEY the app runs in demo mode
 * (the preview with sample data) and never downloads the Firebase SDK. When configured, the SDK is
 * loaded on first use. The web config is not a secret; security comes from Firebase Auth and the
 * Firestore security rules (firestore.rules), which are the only guard on the free Spark plan.
 */
const env = import.meta.env;
export const firebaseConfigured = !!env.VITE_FIREBASE_API_KEY && env.VITE_PREVIEW_HOST !== '1';
export const demoMode = !firebaseConfigured;

export interface FB {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let ready: Promise<FB> | null = null;

export function firebase(): Promise<FB> {
  if (!firebaseConfigured) return Promise.reject(new Error('Firebase is not configured'));
  if (!ready) {
    ready = (async () => {
      const [{ initializeApp }, authMod, fsMod] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
      const app = initializeApp({
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: env.VITE_FIREBASE_APP_ID,
      });
      if (env.VITE_APPCHECK_RECAPTCHA_SITE_KEY) {
        const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('firebase/app-check');
        initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(env.VITE_APPCHECK_RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
      }
      const auth = authMod.getAuth(app);
      const db = fsMod.getFirestore(app);
      if (env.VITE_USE_EMULATORS === '1') {
        authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
        fsMod.connectFirestoreEmulator(db, '127.0.0.1', 8080);
      }
      return { app, auth, db };
    })();
  }
  return ready;
}

/**
 * A short-lived second Firebase app with its own in-memory sign-in. Staff use it to create someone
 * else's account without signing themselves out of the main app. Always call `close()` afterwards.
 */
export async function secondaryFirebase(): Promise<{ auth: Auth; db: Firestore; close: () => Promise<void> }> {
  const [{ app }, appMod, authMod, fsMod] = await Promise.all([firebase(), import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
  const app2 = appMod.initializeApp(app.options, `provision-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const auth = authMod.initializeAuth(app2, { persistence: authMod.inMemoryPersistence });
  const db = fsMod.getFirestore(app2);
  if (env.VITE_USE_EMULATORS === '1') {
    authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    fsMod.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  return {
    auth,
    db,
    close: async () => {
      await authMod.signOut(auth).catch(() => undefined);
      await appMod.deleteApp(app2).catch(() => undefined);
    },
  };
}
