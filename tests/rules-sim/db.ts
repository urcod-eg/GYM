/**
 * In-memory Firestore that checks every read and every batched write with the rules simulator.
 * Writes are atomic: the whole batch is evaluated against the state before and after it, exactly
 * like Firestore's get() / getAfter(), and nothing is applied unless every operation is allowed.
 */
import { appendFileSync } from 'node:fs';
import { SERVER_TIME, type WriteOp } from '../../src/domain/writes';
import { decide, parseRules, resourceOf, RMap, RPath, RTime, toRV, type EvalContext, type RV } from './sim';

export interface AuthSpec {
  uid: string;
  email?: string;
  /** Signed in with a second factor (TOTP). */
  mfa?: boolean;
  /** Seconds since epoch of the sign-in (the ID token's auth_time claim). */
  authTime?: number;
}

export type SimOp = WriteOp | { type: 'delete'; path: string };

export class Denied extends Error {
  constructor(public detail: string) {
    super(`PERMISSION_DENIED: ${detail}`);
  }
}

const MAX_LOOKUPS_PER_DOC = 10;
const MAX_LOOKUPS_PER_REQUEST = 20;
// Firestore evaluates at most 1000 expressions per request. We count them as davideast/pyric does
// (see sim.ts) and, to be safe, add up every document of a batch against one budget.
const MAX_EXPRESSIONS = Number(process.env.MAX_EXPRESSIONS ?? 1000);

type Data = Record<string, unknown>;

function resolve(v: unknown, now: Date): unknown {
  if (v === SERVER_TIME || (v && typeof v === 'object' && (v as { $serverTime?: boolean }).$serverTime)) return now;
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map((x) => resolve(x, now));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, now)]));
  return v;
}

function clone(d: Data): Data {
  return structuredClone(d);
}

export class SimFirestore {
  private root;
  docs = new Map<string, Data>();
  /** Fixed clock for tests; defaults to the real time. */
  clock: () => Date = () => new Date();

  constructor(rulesSource: string) {
    this.root = parseRules(rulesSource);
  }

  seed(path: string, data: Data) {
    this.docs.set(path, resolve(data, this.clock()) as Data);
  }

  clear() {
    this.docs.clear();
  }

  peek(path: string): Data | undefined {
    const d = this.docs.get(path);
    return d ? clone(d) : undefined;
  }

  client(auth: AuthSpec | null) {
    return new SimClient(this, auth);
  }

  authRV(auth: AuthSpec | null): RV {
    if (!auth) return null;
    const firebase: Record<string, RV> = { sign_in_provider: 'password' };
    if (auth.mfa) firebase.sign_in_second_factor = 'totp';
    const token: Record<string, RV> = { firebase: RMap.of(firebase), auth_time: auth.authTime ?? 1_700_000_000 };
    if (auth.email) token.email = auth.email;
    return RMap.of({ uid: auth.uid, token: RMap.of(token) });
  }

  evaluate(method: string, path: string, auth: AuthSpec | null, now: Date, before: Map<string, Data>, after: Map<string, Data>, newData: Data | null, lookups: Set<string>, exprs?: { n: number; ops: string[] }) {
    const req: Record<string, RV> = {
      auth: this.authRV(auth),
      time: new RTime(now.getTime()),
      method,
      path: new RPath(`/databases/(default)/documents/${path}`),
    };
    if (newData) req.resource = resourceOf(path, newData);
    const own = new Set<string>();
    const ctx: EvalContext = {
      request: RMap.of(req),
      resource: resourceOf(path, before.get(path)),
      before: { get: (p) => before.get(p) },
      after: { get: (p) => after.get(p) },
      now: now.getTime(),
      lookups: own,
      exprs: { n: 0 },
    };
    const d = decide(this.root, method, path, ctx);
    own.forEach((l) => lookups.add(l));
    const n = ctx.exprs!.n;
    if (exprs) exprs.n += n;
    else if (n > MAX_EXPRESSIONS) throw new Error(`rules limit: ${n} expressions for ${method} ${path} (max ${MAX_EXPRESSIONS})`);
    if (exprs) exprs.ops.push(`${method} ${path.split('/')[0]}:${n}`);
    if (own.size > MAX_LOOKUPS_PER_DOC) throw new Error(`rules limit: ${own.size} document lookups for ${method} ${path} (max ${MAX_LOOKUPS_PER_DOC})`);
    return d;
  }
}

export class SimClient {
  constructor(private db: SimFirestore, private auth: AuthSpec | null) {}

  async get(path: string): Promise<Data | null> {
    const now = this.db.clock();
    const d = this.db.evaluate('get', path, this.auth, now, this.db.docs, this.db.docs, null, new Set());
    if (!d.allowed) throw new Denied(`get ${path} ${d.errors.join(' | ')}`);
    const doc = this.db.docs.get(path);
    return doc ? clone(doc) : null;
  }

  /** Every document of the collection that passes `where` must be readable (see sim.ts on `list`). */
  async list(collection: string, where: (d: Data) => boolean = () => true): Promise<{ id: string; data: Data }[]> {
    const now = this.db.clock();
    const out: { id: string; data: Data }[] = [];
    for (const [p, data] of this.db.docs) {
      const parts = p.split('/');
      if (parts.length !== 2 || parts[0] !== collection || !where(data)) continue;
      const d = this.db.evaluate('list', p, this.auth, now, this.db.docs, this.db.docs, null, new Set());
      if (!d.allowed) throw new Denied(`list ${p} ${d.errors.join(' | ')}`);
      out.push({ id: parts[1], data: clone(data) });
    }
    if (out.length === 0) {
      // An empty result still needs permission: check against a phantom document.
      const probe = `${collection}/__probe__`;
      const d = this.db.evaluate('list', probe, this.auth, now, this.db.docs, this.db.docs, null, new Set());
      if (!d.allowed) throw new Denied(`list ${collection}`);
    }
    return out;
  }

  /** Atomic batch: every operation is checked against the state before and after the whole batch. */
  async commit(ops: SimOp[]): Promise<void> {
    const now = this.db.clock();
    const before = this.db.docs;
    const after = new Map(before);
    const methods: string[] = [];
    for (const op of ops) {
      const existing = after.get(op.path);
      if (op.type === 'delete') {
        methods.push('delete');
        after.delete(op.path);
      } else if (op.type === 'set') {
        methods.push(before.has(op.path) ? 'update' : 'create');
        after.set(op.path, resolve(op.data, now) as Data);
      } else {
        if (!existing) throw new Error(`NOT_FOUND: update ${op.path}`);
        methods.push('update');
        after.set(op.path, mergeUpdate(existing, resolve(op.data, now) as Data));
      }
    }
    const lookups = new Set<string>();
    const exprs = { n: 0, ops: [] as string[] };
    ops.forEach((op, i) => {
      const d = this.db.evaluate(methods[i], op.path, this.auth, now, before, after, op.type === 'delete' ? null : after.get(op.path)!, lookups, exprs);
      if (!d.allowed) throw new Denied(`${methods[i]} ${op.path}${d.errors.length ? ' — ' + d.errors.join(' | ') : ''}`);
    });
    if (process.env.EXPR_LOG) appendFileSync(process.env.EXPR_LOG, `${exprs.n} ${exprs.ops.join(' ')}\n`);
    // Firestore counts expressions across the whole request (every document of a batch together).
    if (exprs.n > MAX_EXPRESSIONS) throw new Error(`rules limit: ${exprs.n} expressions in one request (max ${MAX_EXPRESSIONS}): ${exprs.ops.join(', ')}`);
    if (lookups.size > MAX_LOOKUPS_PER_REQUEST) throw new Error(`rules limit: ${lookups.size} document lookups in one batch (max ${MAX_LOOKUPS_PER_REQUEST})`);
    this.db.docs = after;
  }
}

export { toRV };

/** Firestore update semantics: top-level keys replace; "a.b" paths set a nested field. */
function mergeUpdate(existing: Data, patch: Data): Data {
  const out: Data = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (!k.includes('.')) {
      out[k] = v;
      continue;
    }
    const parts = k.split('.');
    let cur = out as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = cur[parts[i]];
      const copy = next && typeof next === 'object' && !(next instanceof Date) ? { ...(next as Record<string, unknown>) } : {};
      cur[parts[i]] = copy;
      cur = copy;
    }
    cur[parts[parts.length - 1]] = v;
  }
  return out;
}
