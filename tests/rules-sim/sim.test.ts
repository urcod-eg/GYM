import { describe, expect, it } from 'vitest';
import { SimFirestore } from './db';

/** The simulator's own semantics, checked against what the Rules language reference specifies. */
const rules = (cond: string) => `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function f(x) { let bad = x.missing; return x.size() > 0; }
    match /t/{id} { allow get: if ${cond}; }
  }
}`;

async function allowed(cond: string, data: Record<string, unknown> = { a: 1, s: 'abc', m: { k: 'v' }, l: ['x', 'y'] }) {
  const db = new SimFirestore(rules(cond));
  db.seed('t/1', data);
  try {
    await db.client({ uid: 'u' }).get('t/1');
    return true;
  } catch {
    return false;
  }
}

describe('rules simulator semantics', () => {
  it('errors are absorbed by || and && only when the other side decides', async () => {
    expect(await allowed('resource.data.nope == 1 || true')).toBe(true);
    expect(await allowed('true || resource.data.nope == 1')).toBe(true);
    expect(await allowed('resource.data.nope == 1 && false')).toBe(false);
    expect(await allowed('resource.data.nope == 1 || false')).toBe(false);
    expect(await allowed('!(resource.data.nope == 1)')).toBe(false);
  });
  it('unused failing let bindings do not matter', async () => {
    expect(await allowed("f('abc')")).toBe(true);
  });
  it('matches() must match the whole string', async () => {
    expect(await allowed("resource.data.s.matches('b')")).toBe(false);
    expect(await allowed("resource.data.s.matches('a.c')")).toBe(true);
  });
  it('maps, lists, sets and diffs', async () => {
    expect(await allowed("resource.data.m.get('z', 7) == 7 && 'k' in resource.data.m && resource.data.l.hasOnly(['x','y','z'])")).toBe(true);
    expect(await allowed("resource.data.l == ['y','x']")).toBe(false);
    expect(await allowed("resource.data.diff({'a': 2, 's': 'abc', 'm': {'k': 'v'}, 'l': ['x','y']}).affectedKeys().hasOnly(['a'])")).toBe(true);
    expect(await allowed("resource.data.keys().hasAll(['a','s']) && resource.data.size() == 4")).toBe(true);
  });
  it('time arithmetic and types', async () => {
    expect(await allowed("request.time + duration.value(1, 'h') > request.time && request.time is timestamp && resource.data.a is int")).toBe(true);
    expect(await allowed("resource.data.s + 1 == 'abc1'")).toBe(false);
    expect(await allowed("resource.data.s + string(1) == 'abc1'")).toBe(true);
  });
  it('stops past 1000 evaluated expressions, like Firestore', async () => {
    const chain = (n: number) => Array.from({ length: n }, () => 'resource.data.a == 1').join(' && ');
    expect(await allowed(chain(50))).toBe(true);
    const db = new SimFirestore(rules(chain(300)));
    db.seed('t/1', { a: 1 });
    await expect(db.client({ uid: 'u' }).get('t/1')).rejects.toThrow(/rules limit: \d+ expressions/);
  });
  it('signed-out callers have a null auth', async () => {
    const db = new SimFirestore(rules('request.auth == null'));
    db.seed('t/1', {});
    await expect(db.client(null).get('t/1')).resolves.toEqual({});
  });
});
