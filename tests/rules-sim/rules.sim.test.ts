import { readFileSync } from 'node:fs';
import { Denied, SimFirestore } from './db';
import { defineScenarios, type Harness } from '../rules/scenarios';

const db = new SimFirestore(readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'));

const harness: Harness = {
  async reset() {
    db.clear();
  },
  async seed(docs) {
    for (const [p, d] of Object.entries(docs)) db.seed(p, d);
  },
  async peek(path) {
    return db.peek(path);
  },
  as(auth) {
    const c = db.client(auth);
    return {
      get: (p) => c.get(p),
      list: (col, field, value) => c.list(col, field ? (d) => d[field] === value : undefined),
      commit: (ops) => c.commit(ops as never),
    };
  },
  isDenied: (e) => e instanceof Denied,
};

defineScenarios('simulator', harness);
