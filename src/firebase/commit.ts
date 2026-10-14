import type { DocumentData, Firestore, Transaction, WriteBatch } from 'firebase/firestore';
import { SERVER_TIME, type WriteOp } from '../domain/writes';

/**
 * Turns the plain write sets from src/domain/writes.ts into Firestore SDK calls. The rules tests use
 * this same code against the emulator, so what is tested is what ships.
 */
export type Op = WriteOp | { type: 'delete'; path: string };
type FS = typeof import('firebase/firestore');

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function toSdk(fs: FS, v: unknown): unknown {
  if (v === SERVER_TIME || (isPlainObject(v) && v.$serverTime === true)) return fs.serverTimestamp();
  if (Array.isArray(v)) return v.map((x) => toSdk(fs, x));
  if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toSdk(fs, x)]));
  return v; // primitives, Date, Timestamp read back from Firestore
}

export function applyOps(fs: FS, db: Firestore, sink: WriteBatch | Transaction, ops: Op[]) {
  const w = sink as WriteBatch; // Transaction has the same set/update/delete shape
  for (const op of ops) {
    const ref = fs.doc(db, op.path);
    if (op.type === 'delete') w.delete(ref);
    else if (op.type === 'set') w.set(ref, toSdk(fs, op.data) as DocumentData);
    else w.update(ref, toSdk(fs, op.data) as DocumentData);
  }
}

/** One atomic write: all operations succeed together or none does. */
export async function commitOps(db: Firestore, ops: Op[]): Promise<void> {
  const fs = await import('firebase/firestore');
  const batch = fs.writeBatch(db);
  applyOps(fs, db, batch, ops);
  await batch.commit();
}

/** Firestore Timestamps (and anything with toDate) become Dates, recursively. */
export function fromSdk<T = Record<string, unknown>>(v: unknown): T {
  if (v && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') return (v as { toDate(): Date }).toDate() as T;
  if (Array.isArray(v)) return v.map((x) => fromSdk(x)) as T;
  if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromSdk(x)])) as T;
  return v as T;
}
