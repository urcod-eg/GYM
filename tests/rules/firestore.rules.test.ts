/**
 * The security scenarios against the official Firestore emulator.
 * Needs Java 21:  npm run test:rules   (also runs in GitHub Actions: .github/workflows/rules.yml)
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'firebase/firestore';
import { commitOps, toSdk } from '../../src/firebase/commit';
import { defineScenarios, type AuthSpec, type Harness } from './scenarios';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-gym',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => env?.cleanup());

function dbFor(auth: AuthSpec | null) {
  if (!auth) return env.unauthenticatedContext().firestore();
  const firebase: Record<string, string> = { sign_in_provider: 'password' };
  if (auth.mfa) firebase.sign_in_second_factor = 'totp';
  return env.authenticatedContext(auth.uid, { email: auth.email, firebase, auth_time: auth.authTime ?? 1_700_000_000 } as never).firestore();
}

const harness: Harness = {
  reset: () => env.clearFirestore(),
  async seed(docs) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      for (const [p, d] of Object.entries(docs)) await fs.setDoc(fs.doc(db, p), toSdk(fs, d) as fs.DocumentData);
    });
  },
  async peek(path) {
    let out: Record<string, unknown> | undefined;
    await env.withSecurityRulesDisabled(async (ctx) => {
      const s = await fs.getDoc(fs.doc(ctx.firestore(), path));
      out = s.exists() ? s.data() : undefined;
    });
    return out;
  },
  as(auth) {
    const db = dbFor(auth);
    return {
      async get(p) {
        const s = await fs.getDoc(fs.doc(db, p));
        return s.exists() ? s.data() : null;
      },
      async list(col, field, value) {
        const q = field ? fs.query(fs.collection(db, col), fs.where(field, '==', value)) : fs.collection(db, col);
        return (await fs.getDocs(q)).docs.map((d) => d.data());
      },
      commit: (ops) => commitOps(db as unknown as fs.Firestore, ops as never),
    };
  },
  isDenied: (e) => (e as { code?: string })?.code === 'permission-denied',
};

defineScenarios('emulator', harness);
