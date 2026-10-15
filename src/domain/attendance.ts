/**
 * Phase 4 — check-in at the door, on the free plan.
 *
 * The member app writes a fresh random code (checkinTokens/{memberId}) every ~45 seconds and shows it
 * as a QR code. The cashier scans it; the check-in is ONE atomic write (check-in record + member file
 * + code marked used) and the security rules decide, on the server, whether entry is allowed:
 * a membership covering now, visits left, no entry block, no late balance (unless an admin allowed
 * it), a code that is fresh (90 s, by server time) and unused, and not the same member twice in 2 min.
 * A screenshot of the code is useless after it is scanned once or after 90 seconds.
 */
import { sectionRefusal, type GenderMode, type LadiesHours } from './gender';
import { SERVER_TIME, type AnyOp, type WriteOp } from './writes';
import type { BalanceDoc, MembershipSummary } from './sales';

export const TOKEN_TTL_MS = 90_000;
export const TOKEN_REFRESH_MS = 45_000;
export const CHECKIN_GAP_MS = 2 * 60_000;
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newCheckinCode(rand: () => number = Math.random): string {
  let c = '';
  for (let k = 0; k < 8; k++) c += ABC[Math.floor(rand() * ABC.length)];
  return c;
}
export const isCheckinCode = (c: string) => /^[A-Z2-9]{8}$/.test(c);

export const qrText = (memberId: string, code: string) => `GYMQR1:${memberId}:${code}`;
export function parseQr(text: string): { memberId: string; code: string } | null {
  const m = /^GYMQR1:([A-Za-z0-9_-]{1,64}):([A-Z2-9]{8})$/.exec(text.trim());
  return m ? { memberId: m[1], code: m[2] } : null;
}

/** The member app's fresh code (server time decides when it expires). */
export function writeToken(memberId: string, code: string): WriteOp[] {
  return [{ type: 'set', path: `checkinTokens/${memberId}`, data: { code, at: SERVER_TIME, usedAt: null } }];
}

export interface TokenDoc {
  code: string;
  at: Date | null;
  usedAt: Date | null;
}

export interface EntryMember {
  id: string;
  membership: MembershipSummary | null | undefined;
  balance: BalanceDoc | null | undefined;
  blocks: Record<string, { until?: Date | null } | undefined>;
  lastCheckInAt: Date | null | undefined;
  gender?: 'M' | 'F' | null;
}

export type EntryReason =
  | 'NO_MEMBERSHIP'
  | 'CANCELLED'
  | 'SCHEDULED'
  | 'EXPIRED'
  | 'QUOTA_USED'
  | 'BLOCKED'
  | 'DUES_OVERDUE'
  | 'CODE_INVALID'
  | 'CODE_USED'
  | 'CODE_EXPIRED'
  | 'TOO_SOON'
  | 'NO_GENDER'
  | 'WRONG_HOURS';

export interface EntryCheck {
  allowed: boolean;
  reason: EntryReason | null;
  /** The visit counts against a limited plan (e.g. a day pass or 12 sessions). */
  counts: boolean;
  visitsLeft: number | null;
  /** Allowed with a balance due soon or with an admin's late-entry permission. */
  note: 'BALANCE_DUE' | 'GRACE' | null;
}

const blockedNow = (b: { until?: Date | null } | undefined, now: Date) => !!b && (b.until == null || b.until > now);

/** Exactly what the rules check (same order of importance for the message shown). */
export function checkEntry(m: EntryMember, now: Date, token: { code: string; doc: TokenDoc | null } | null, gym?: { genderMode: GenderMode; ladiesHours: LadiesHours }): EntryCheck {
  const deny = (reason: EntryReason): EntryCheck => ({ allowed: false, reason, counts: false, visitsLeft: null, note: null });
  const c = m.membership;
  if (!c) return deny('NO_MEMBERSHIP');
  const mainCovers = c.status === 'ACTIVE' && c.startsAt <= now && now < c.endsAt;
  const prevCovers = !!c.prev && c.prev.startsAt <= now && now < c.prev.endsAt;
  if (!mainCovers && !prevCovers) {
    if (c.status === 'CANCELLED') return deny('CANCELLED');
    if (c.startsAt > now) return deny('SCHEDULED');
    return deny('EXPIRED');
  }
  const counts = mainCovers && c.visitQuota != null;
  if (counts && (c.visitsUsed ?? 0) >= (c.visitQuota ?? 0)) return deny('QUOTA_USED');
  if (blockedNow(m.blocks?.CHECKIN_BLOCK, now) || blockedNow(m.blocks?.TEMPORARY_SUSPENSION, now)) return deny('BLOCKED');
  // Ladies' hours: only ladies then, only men otherwise.
  const section = gym ? sectionRefusal(gym.genderMode, gym.ladiesHours, m.gender, now) : null;
  if (section) return deny(section);
  const b = m.balance;
  let note: EntryCheck['note'] = null;
  if (b && b.remaining > 0) {
    if (now >= b.dueAt) {
      if (b.graceUntil && now < b.graceUntil) note = 'GRACE';
      else return deny('DUES_OVERDUE');
    } else note = 'BALANCE_DUE';
  }
  if (m.lastCheckInAt && now.getTime() - m.lastCheckInAt.getTime() <= CHECKIN_GAP_MS) return deny('TOO_SOON');
  if (token) {
    const t = token.doc;
    if (!t || t.code !== token.code) return deny('CODE_INVALID');
    if (t.usedAt) return deny('CODE_USED');
    if (!t.at || now.getTime() - t.at.getTime() >= TOKEN_TTL_MS) return deny('CODE_EXPIRED');
  }
  return { allowed: true, reason: null, counts, visitsLeft: counts ? (c.visitQuota ?? 0) - (c.visitsUsed ?? 0) - 1 : null, note };
}

/** The check-in write: record + member file (+ code used). The rules accept it only if checkEntry would. */
export function checkIn(i: { actorUid: string; checkinId: string; member: EntryMember; method: 'QR' | 'MANUAL'; code: string | null; counts: boolean }): AnyOp[] {
  const c = i.member.membership!;
  const ops: AnyOp[] = [
    { type: 'set', path: `checkins/${i.checkinId}`, data: { memberId: i.member.id, method: i.method, code: i.method === 'QR' ? i.code : null, membershipId: c.id, by: i.actorUid, at: SERVER_TIME } },
    {
      type: 'update',
      path: `members/${i.member.id}`,
      data: {
        lastCheckInAt: SERVER_TIME,
        lastCheckinId: i.checkinId,
        // Only a limited plan's counter moves; otherwise the membership is left untouched.
        ...(i.counts ? { 'membership.visitsUsed': (c.visitsUsed ?? 0) + 1 } : {}),
      },
    },
  ];
  if (i.method === 'QR') ops.push({ type: 'update', path: `checkinTokens/${i.member.id}`, data: { usedAt: SERVER_TIME } });
  return ops;
}

/** Visits per hour of day (gym time) for the peak-hours chart. */
export function peakHours(times: Date[], tzOffsetHours: (d: Date) => number): number[] {
  const h = Array.from({ length: 24 }, () => 0);
  for (const t of times) h[(t.getUTCHours() + tzOffsetHours(t) + 24) % 24] += 1;
  return h;
}
