import { DateTime } from 'luxon';
import { GYM_TZ, lastUsableDay, phaseAt, type MembershipPhase } from '../../domain/dates';
import { matchesQuery } from '../../domain/text';
import { activeBlocks } from '../../domain/writes';
import { currentView } from '../../domain/sales';
import type { MemberDoc } from '../../firebase/data';
import { DEMO_COACHES, DEMO_MEMBERS, memberDates, planById, type VipTier } from '../../mock/demo';

/** The member fields the staff screens show; the same shape for the preview and for live data. */
export interface RowMember {
  id: string;
  name: string;
  code: string;
  phone: string; // E.164
  vip: VipTier;
  coachId: string | null;
  lastCheckIn: string | null;
  blocked: boolean;
  planId: string;
  gender?: 'M' | 'F' | null;
}

export type RowPhase = MembershipPhase | 'NONE';

export interface MemberRow {
  m: RowMember;
  /** NONE: registered but nothing sold yet (or the only membership was cancelled). */
  phase: RowPhase;
  start: DateTime | null;
  end: DateTime | null;
  lastDay: DateTime | null;
  planAr: string;
  planEn: string;
  coach: string | null;
  /** A paid renewal that starts after the current period. */
  next: { planAr: string; planEn: string; start: DateTime } | null;
  cancelled: boolean;
  /** The live member file (null in the preview). */
  doc: MemberDoc | null;
}

/** Sample ladies in the preview (by first name). */
const DEMO_LADIES = /^(سارة|منة|هبة|آية|نورهان|مريم|ندى|سلمى|ياسمين|فاطمة|نور)/;

/** Preview rows (sample data). */
export function demoRows(): MemberRow[] {
  const now = DateTime.now().setZone(GYM_TZ);
  return DEMO_MEMBERS.map((m) => {
    const { start, end } = memberDates(m);
    const plan = planById(m.planId);
    return {
      m: { id: m.id, name: m.name, code: m.code, phone: m.phone, vip: m.vip, coachId: m.coachId, lastCheckIn: m.lastCheckIn, blocked: !!m.blocked, planId: m.planId, gender: DEMO_LADIES.test(m.name) ? 'F' : 'M' },
      start,
      end,
      phase: phaseAt(now, start, end),
      lastDay: lastUsableDay(end),
      planAr: plan.nameAr,
      planEn: plan.nameEn,
      coach: DEMO_COACHES.find((c) => c.id === m.coachId)?.name ?? null,
      next: null,
      cancelled: false,
      doc: null,
    };
  });
}

/** A live member file as a row: the period running now (or next), any renewal after it, blocks. */
export function liveRow(d: MemberDoc, now: Date = new Date()): MemberRow {
  const v = currentView(d.membership, now);
  const p = v.period;
  const start = p ? DateTime.fromJSDate(p.startsAt).setZone(GYM_TZ) : null;
  const end = p ? DateTime.fromJSDate(p.endsAt).setZone(GYM_TZ) : null;
  const blocked = activeBlocks(d.blocks, now).some((s) => s === 'CHECKIN_BLOCK' || s === 'TEMPORARY_SUSPENSION' || s === 'LOGIN_BLOCK');
  return {
    m: { id: d.id, name: d.fullName, code: d.memberCode, phone: d.phoneE164, vip: d.vipTierId ?? 'STANDARD', coachId: d.assignedCoachId, lastCheckIn: d.lastCheckInAt ? d.lastCheckInAt.toISOString() : null, blocked, planId: '', gender: d.gender ?? null },
    phase: start && end ? phaseAt(DateTime.fromJSDate(now), start, end) : 'NONE',
    start,
    end,
    lastDay: end ? lastUsableDay(end) : null,
    planAr: p?.planNameAr ?? '',
    planEn: p?.planNameEn ?? '',
    coach: d.assignedCoachName ?? null,
    next: v.next ? { planAr: v.next.planNameAr, planEn: v.next.planNameEn, start: DateTime.fromJSDate(v.next.startsAt).setZone(GYM_TZ) } : null,
    cancelled: v.cancelled,
    doc: d,
  };
}

/** The end date a renewal is appended to: the last period already paid for. */
export function paidUntil(r: MemberRow): DateTime | null {
  if (r.doc?.membership && r.doc.membership.status === 'ACTIVE') return DateTime.fromJSDate(r.doc.membership.endsAt).setZone(GYM_TZ);
  return r.end;
}

export function searchRows(rows: MemberRow[], q: string) {
  return rows.filter((r) => matchesQuery([r.m.name, r.m.phone, '0' + r.m.phone.slice(3), r.m.code], q));
}

/** Kept for screens that still show sample data only (coach area, check-in until Phase 4). */
export const memberRows = demoRows;
