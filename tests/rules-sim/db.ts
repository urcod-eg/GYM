/**
 * In-memory Firestore that checks every read and every batched write with the rules simulator.
 * Writes are atomic: the whole batch is evaluated against the state before and after it, exactly
 * like Firestore's get() / getAfter(), and nothing is applied unless every operation is allowed.
 */
import { SERVER_TIME, type WriteOp } from '../../src/domain/writes';
import { decide, parseRules, resourceOf, RMap, RPath, RTime, toRV, type EvalContext, type RV } from './sim';

export interface AuthSpec {
  uid: string;
  email?: string;
  /** Signed in with a second factor (TOTP). */
  mfa?: boolean;
}

export type SimOp = WriteOp | { type: 'delete'; path: string };

export class Denied extends Error {
  constructor(public detail: string) {
    super(`PERMISSION_DENIED: ${detail}`);
  }
}

const MAX_LOOKUPS_PER_DOC = 10;
const MAX_LOOKUPS_PER_REQUEST = 20;

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
    const token: Record<string, RV> = { firebase: RMap.of(firebase) };
    if (auth.email) token.email = auth.email;
    return RMap.of({ uid: auth.uid, token: RMap.of(token) });
  }

  evaluate(method: string, path: string, auth: AuthSpec | null, now: Date, before: Map<string, Data>, after: Map<string, Data>, newData: Data | null, lookups: Set<string>) {
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
    };
    const d = decide(this.root, method, path, ctx);
    own.forEach((l) => lookups.add(l));
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
        after.set(op.path, { ...existing, ...(resolve(op.data, now) as Data) });
      }
    }
    const lookups = new Set<string>();
    ops.forEach((op, i) => {
      const d = this.db.evaluate(methods[i], op.path, this.auth, now, before, after, op.type === 'delete' ? null : after.get(op.path)!, lookups);
      if (!d.allowed) throw new Denied(`${methods[i]} ${op.path}${d.errors.length ? ' — ' + d.errors.join(' | ') : ''}`);
    });
    if (lookups.size > MAX_LOOKUPS_PER_REQUEST) throw new Error(`rules limit: ${lookups.size} document lookups in one batch (max ${MAX_LOOKUPS_PER_REQUEST})`);
    this.db.docs = after;
  }
}

export { toRV };
