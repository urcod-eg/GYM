/**
 * Phase 3 write sets: plans, gym settings, selling / renewing memberships (full payment or
 * deposit), paying the remainder, admin entry permission for a late balance, and cancellation
 * with refund. Like writes.ts these builders are pure; the security rules accept exactly these
 * shapes and re-check every amount, so a modified browser cannot change the figures.
 *
 * Money: integer piasters (1 EGP = 100). Dates: Firestore timestamps; a membership is
 * [startsAt, endsAt) in the gym timezone, a balance is late from `dueAt` (00:00 the day after the
 * due date), an entry permission lasts until `graceUntil` (00:00 the day after its last day).
 */
import { DateTime } from 'luxon';
import { computeEndExclusive, GYM_TZ, localStartOfDay, type PlanDuration } from './dates';
import { CUSTOM_DAYS_MAX, CUSTOM_DAYS_MIN, type Plan } from './plans';
import { audit, refuse, SERVER_TIME, type AnyOp, type DocData, type WriteOp } from './writes';

// ---------------------------------------------------------------- plans

export const PLAN_UNITS = ['session', 'day', 'week', 'month', 'year', 'custom'] as const;
export type PlanUnit = (typeof PLAN_UNITS)[number];
export const MAX_PRICE = 100_000_000; // 1,000,000 EGP in piasters

export interface PlanDoc {
  code: string;
  nameAr: string;
  nameEn: string;
  unit: PlanUnit;
  value: number;
  visitQuota: number | null;
  price: number;
  featured: boolean;
  active: boolean;
  sort: number;
}

export function planDocFromPlan(p: Plan, sort: number): PlanDoc {
  const unit: PlanUnit = p.duration ? p.duration.unit : 'custom';
  return {
    code: p.code,
    nameAr: p.nameAr,
    nameEn: p.nameEn,
    unit,
    value: p.duration && unit !== 'session' ? p.duration.value : 1,
    visitQuota: unit === 'session' ? 1 : p.visitQuota,
    price: unit === 'custom' ? 0 : p.price,
    featured: !!p.featured,
    active: p.active,
    sort,
  };
}

export function planFromDoc(id: string, d: PlanDoc): Plan & { sort: number } {
  return {
    id,
    code: d.code,
    nameAr: d.nameAr,
    nameEn: d.nameEn,
    duration: d.unit === 'custom' ? null : { unit: d.unit, value: d.unit === 'session' ? 1 : d.value },
    visitQuota: d.visitQuota,
    price: d.price,
    featured: d.featured,
    active: d.active,
    sort: d.sort,
  };
}

export function validPlanDoc(p: PlanDoc): boolean {
  const maxValue = p.unit === 'day' ? CUSTOM_DAYS_MAX : p.unit === 'week' ? 104 : p.unit === 'month' ? 24 : p.unit === 'year' ? 5 : 1;
  return (
    /^[A-Z0-9_-]{2,12}$/.test(p.code) &&
    p.nameAr.trim().length >= 1 &&
    p.nameAr.length <= 60 &&
    p.nameEn.trim().length >= 1 &&
    p.nameEn.length <= 60 &&
    (PLAN_UNITS as readonly string[]).includes(p.unit) &&
    Number.isInteger(p.value) &&
    p.value >= 1 &&
    p.value <= maxValue &&
    (p.visitQuota === null || (Number.isInteger(p.visitQuota) && p.visitQuota >= 1 && p.visitQuota <= 1000)) &&
    Number.isInteger(p.price) &&
    (p.unit === 'custom' ? p.price === 0 : p.price > 0 && p.price <= MAX_PRICE) &&
    Number.isInteger(p.sort) &&
    p.sort >= 0 &&
    p.sort <= 1000
  );
}

export function setPlan(i: { actorUid: string; auditId: string; planId: string; plan: PlanDoc }): WriteOp[] {
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(i.planId) || !validPlanDoc(i.plan)) refuse('invalid-plan');
  return [
    { type: 'set', path: `plans/${i.planId}`, data: { ...i.plan, updatedAt: SERVER_TIME, lastAuditId: i.auditId } },
    audit(i.auditId, i.actorUid, 'plan.set', 'plans', i.planId, { code: i.plan.code, price: i.plan.price, active: i.plan.active }),
  ];
}

// ---------------------------------------------------------------- gym settings

export interface GymSettingsDoc {
  depositEnabled: boolean;
  depositMinPercent: number; // 10..90
  depositGraceDays: number; // 1..60, default due date for the remainder
  depositMaxGraceDays: number; // graceDays..60, latest due date a cashier may pick
  cashierMaxDiscount: number; // 0..100, the most a cashier may discount (admins: any)
}

export const DEFAULT_GYM_SETTINGS: GymSettingsDoc = {
  depositEnabled: true,
  depositMinPercent: 50,
  depositGraceDays: 7,
  depositMaxGraceDays: 30,
  cashierMaxDiscount: 10,
};

export function validSettings(s: GymSettingsDoc): boolean {
  const int = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  return (
    typeof s.depositEnabled === 'boolean' &&
    int(s.depositMinPercent, 10, 90) &&
    int(s.depositGraceDays, 1, 60) &&
    int(s.depositMaxGraceDays, s.depositGraceDays, 60) &&
    int(s.cashierMaxDiscount, 0, 100)
  );
}

export function setGymSettings(i: { actorUid: string; auditId: string; settings: GymSettingsDoc }): WriteOp[] {
  if (!validSettings(i.settings)) refuse('invalid-settings');
  const s = i.settings;
  const data: DocData = {
    depositEnabled: s.depositEnabled,
    depositMinPercent: s.depositMinPercent,
    depositGraceDays: s.depositGraceDays,
    depositMaxGraceDays: s.depositMaxGraceDays,
    cashierMaxDiscount: s.cashierMaxDiscount,
  };
  return [
    { type: 'set', path: 'gymSettings/main', data: { ...data, updatedAt: SERVER_TIME, lastAuditId: i.auditId } },
    audit(i.auditId, i.actorUid, 'settings.set', 'gymSettings', 'main', data),
  ];
}

// ---------------------------------------------------------------- membership summary on the member file

export interface PeriodRef {
  planNameAr: string;
  planNameEn: string;
  startsAt: Date;
  endsAt: Date;
}

/** Kept on members/{id} so lists and the member app need no extra reads. */
export interface MembershipSummary extends PeriodRef {
  id: string;
  unit: PlanUnit;
  status: 'ACTIVE' | 'CANCELLED';
  /** Visits allowed on this membership (null = unlimited) and used so far (Phase 4 check-ins). */
  visitQuota: number | null;
  visitsUsed: number;
  /** The still-running period this one was appended to (early renewal), if any. */
  prev: PeriodRef | null;
}

export interface BalanceDoc {
  remaining: number;
  total: number; // the amount due on that sale (so paid = total − remaining)
  dueAt: Date; // late from this instant (00:00 the day after the due date)
  membershipId: string;
  graceUntil: Date | null; // admin permission to enter, until this instant
  graceReason: string;
}

/** The period that counts: the membership itself, or what it was appended to if it was cancelled. */
export function effectivePeriod(s: MembershipSummary | null | undefined): PeriodRef | null {
  if (!s) return null;
  return s.status === 'ACTIVE' ? s : s.prev;
}

export interface CurrentView {
  /** What the member is on right now (or next, when nothing is running yet). */
  period: PeriodRef | null;
  /** An already-paid renewal that starts after `period`. */
  next: PeriodRef | null;
  cancelled: boolean;
}

export function currentView(s: MembershipSummary | null | undefined, now: Date): CurrentView {
  if (!s) return { period: null, next: null, cancelled: false };
  if (s.status === 'CANCELLED') return { period: s.prev && s.prev.endsAt > now ? s.prev : null, next: null, cancelled: !(s.prev && s.prev.endsAt > now) };
  if (s.prev && s.prev.endsAt > now) return { period: s.prev, next: s, cancelled: false };
  return { period: s, next: null, cancelled: false };
}

// ---------------------------------------------------------------- dates

/** 'YYYY-MM-DD' (gym day) → 00:00 the next day, the instant the day is over. */
export function endOfGymDay(isoDate: string): Date {
  return localStartOfDay(isoDate).plus({ days: 1 }).toJSDate();
}

/** The gym day that ends at `instant` (inverse of endOfGymDay). */
export function gymDayEndingAt(instant: Date): string {
  return DateTime.fromJSDate(instant).setZone(GYM_TZ).minus({ days: 1 }).toISODate()!;
}

export function durationOf(p: PlanDoc, customDays: number | null): PlanDuration {
  if (p.unit === 'custom') return { unit: 'day', value: customDays ?? 0 };
  if (p.unit === 'session') return { unit: 'session', value: 1 };
  return { unit: p.unit, value: p.value };
}

// ---------------------------------------------------------------- receipts

/** R-YYMMDD-XXXXX: the gym day plus a random part (no counter, so no extra rule reads). */
export function newReceiptNo(now: Date, rand: () => number = Math.random): string {
  const day = DateTime.fromJSDate(now).setZone(GYM_TZ).toFormat('yyMMdd');
  const abc = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let tail = '';
  for (let k = 0; k < 5; k++) tail += abc[Math.floor(rand() * abc.length)];
  return `R-${day}-${tail}`;
}
export const isReceiptNo = (r: string) => /^R-[0-9]{6}-[0-9A-Z]{5}$/.test(r);

// ---------------------------------------------------------------- selling / renewing

export const PAY_METHODS = ['CASH', 'WALLET', 'INSTAPAY', 'BANK'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];
export type SaleMode = 'FULL' | 'DEPOSIT';

export interface SaleQuote {
  base: number;
  discount: number;
  carried: number;
  due: number;
  paidNow: number;
  remaining: number;
  minDeposit: number;
}

/** The amounts, exactly as the rules compute them (integer division truncates). */
export function saleQuote(i: { plan: PlanDoc; customPrice: number | null; discountPct: number; carried: number; mode: SaleMode; deposit: number; settings: GymSettingsDoc }): SaleQuote {
  const base = i.plan.unit === 'custom' ? i.customPrice ?? 0 : i.plan.price;
  const discount = Math.trunc((base * i.discountPct) / 100);
  const due = base - discount + i.carried;
  const minDeposit = Math.trunc((due * i.settings.depositMinPercent + 99) / 100);
  const paidNow = i.mode === 'FULL' ? due : i.deposit;
  return { base, discount, carried: i.carried, due, paidNow, remaining: due - paidNow, minDeposit };
}

export interface SaleInput {
  actorUid: string;
  actorIsAdmin: boolean;
  membershipId: string;
  paymentId: string;
  receiptNo: string;
  member: { id: string; membership: MembershipSummary | null; balance: BalanceDoc | null };
  planId: string;
  plan: PlanDoc;
  customDays: number | null;
  customPrice: number | null;
  startDate: string; // 'YYYY-MM-DD', gym day
  discountPct: number;
  mode: SaleMode;
  deposit: number;
  balanceDueDate: string | null; // 'YYYY-MM-DD' for a deposit
  method: PayMethod;
  reference: string | null;
  settings: GymSettingsDoc;
  now: Date;
}

export function sellMembership(i: SaleInput): { ops: AnyOp[]; quote: SaleQuote; startsAt: Date; endsAt: Date } {
  const p = i.plan;
  if (!p.active) refuse('plan-inactive');
  const custom = p.unit === 'custom';
  if (custom) {
    if (!Number.isInteger(i.customDays) || i.customDays! < CUSTOM_DAYS_MIN || i.customDays! > CUSTOM_DAYS_MAX) refuse('invalid-days');
    if (!Number.isInteger(i.customPrice) || i.customPrice! < 0 || i.customPrice! > MAX_PRICE) refuse('invalid-amount');
  }
  if (!Number.isInteger(i.discountPct) || i.discountPct < 0 || i.discountPct > 100) refuse('invalid-discount');
  if (!i.actorIsAdmin && i.discountPct > 0 && i.discountPct > i.settings.cashierMaxDiscount) refuse('discount-too-high');
  if (!(PAY_METHODS as readonly string[]).includes(i.method)) refuse('invalid-method');
  const reference = i.method === 'CASH' ? null : i.reference?.trim() ? i.reference.trim().slice(0, 40) : null;
  if (!isReceiptNo(i.receiptNo)) refuse('invalid-input');

  const carried = i.member.balance?.remaining ?? 0;
  const q = saleQuote({ plan: p, customPrice: custom ? i.customPrice : null, discountPct: i.discountPct, carried, mode: i.mode, deposit: i.deposit, settings: i.settings });

  let balanceDueAt: Date | null = null;
  if (i.mode === 'DEPOSIT') {
    if (!i.settings.depositEnabled) refuse('deposit-off');
    if (p.unit === 'session') refuse('deposit-day-pass');
    if (!Number.isInteger(i.deposit) || i.deposit < q.minDeposit || i.deposit >= q.due) refuse('invalid-deposit');
    if (!i.balanceDueDate) refuse('invalid-date');
    balanceDueAt = endOfGymDay(i.balanceDueDate!);
    const ms = balanceDueAt.getTime() - i.now.getTime();
    if (ms <= 86_400_000 || ms > (i.settings.depositMaxGraceDays + 2) * 86_400_000) refuse('invalid-date');
  }

  // Start: 00:00 of the chosen gym day; an early renewal starts when the running period ends.
  const running = effectivePeriod(i.member.membership);
  const chosen = localStartOfDay(i.startDate).toJSDate();
  const startsAt = running && running.endsAt > i.now && chosen < running.endsAt ? running.endsAt : chosen;
  if (startsAt.getTime() < i.now.getTime() - 86_400_000 || startsAt.getTime() > i.now.getTime() + 62 * 86_400_000) refuse('invalid-date');
  const endsAt = computeEndExclusive(DateTime.fromJSDate(startsAt).setZone(GYM_TZ), durationOf(p, i.customDays)).toJSDate();

  const planSnap: DocData = { code: p.code, nameAr: p.nameAr, nameEn: p.nameEn, unit: p.unit, value: p.value, price: p.price, visitQuota: p.visitQuota };
  const summary: DocData = {
    id: i.membershipId,
    planNameAr: p.nameAr,
    planNameEn: p.nameEn,
    unit: p.unit,
    startsAt,
    endsAt,
    status: 'ACTIVE',
    visitQuota: p.visitQuota,
    visitsUsed: 0,
    prev: running && running.endsAt > i.now ? { planNameAr: running.planNameAr, planNameEn: running.planNameEn, startsAt: running.startsAt, endsAt: running.endsAt } : null,
  };
  const balance: DocData | null =
    q.remaining > 0 ? { remaining: q.remaining, total: q.due, dueAt: balanceDueAt!, membershipId: i.membershipId, graceUntil: null, graceReason: '' } : null;

  const ops: AnyOp[] = [
    {
      type: 'set',
      path: `memberships/${i.membershipId}`,
      data: {
        memberId: i.member.id,
        planId: i.planId,
        plan: planSnap,
        customDays: custom ? i.customDays : null,
        startsAt,
        endsAt,
        base: q.base,
        discountPct: i.discountPct,
        discount: q.discount,
        carried: q.carried,
        due: q.due,
        paidNow: q.paidNow,
        mode: i.mode,
        balanceDueAt,
        method: i.method,
        reference,
        receiptNo: i.receiptNo,
        paymentId: i.paymentId,
        renewal: !!i.member.membership,
        status: 'ACTIVE',
        cancel: null,
        createdBy: i.actorUid,
        createdAt: SERVER_TIME,
        updatedAt: SERVER_TIME,
        // A sale is its own record (the membership and its receipt are never edited or deleted), so it
        // writes no separate audit entry: that keeps the write inside Firestore's rules budget.
        lastAuditId: null,
      },
    },
    payment({ id: i.paymentId, memberId: i.member.id, membershipId: i.membershipId, kind: 'SALE', amount: q.paidNow, method: i.method, reference, receiptNo: i.receiptNo, by: i.actorUid }),
    { type: 'update', path: `members/${i.member.id}`, data: { membership: summary, balance, lastPaymentId: i.paymentId, updatedAt: SERVER_TIME } },
  ];
  return { ops, quote: q, startsAt, endsAt };
}

function payment(i: { id: string; memberId: string; membershipId: string | null; kind: 'SALE' | 'BALANCE' | 'REFUND'; amount: number; method: PayMethod; reference: string | null; receiptNo: string; by: string }): WriteOp {
  return {
    type: 'set',
    path: `payments/${i.id}`,
    data: { memberId: i.memberId, membershipId: i.membershipId, kind: i.kind, amount: i.amount, method: i.method, reference: i.reference, receiptNo: i.receiptNo, by: i.by, at: SERVER_TIME },
  };
}

// ---------------------------------------------------------------- paying the remainder

export function payBalance(i: { actorUid: string; auditId: string; paymentId: string; receiptNo: string; memberId: string; balance: BalanceDoc | null; amount: number; method: PayMethod; reference: string | null }): AnyOp[] {
  const b = i.balance ?? refuse('no-balance');
  if (!Number.isInteger(i.amount) || i.amount <= 0 || i.amount > b.remaining) refuse('invalid-amount');
  if (!(PAY_METHODS as readonly string[]).includes(i.method)) refuse('invalid-method');
  if (!isReceiptNo(i.receiptNo)) refuse('invalid-input');
  const reference = i.method === 'CASH' ? null : i.reference?.trim() ? i.reference.trim().slice(0, 40) : null;
  const left = b.remaining - i.amount;
  return [
    payment({ id: i.paymentId, memberId: i.memberId, membershipId: b.membershipId, kind: 'BALANCE', amount: i.amount, method: i.method, reference, receiptNo: i.receiptNo, by: i.actorUid }),
    {
      type: 'update',
      path: `members/${i.memberId}`,
      data: {
        balance: left === 0 ? null : { remaining: left, total: b.total, dueAt: b.dueAt, membershipId: b.membershipId, graceUntil: b.graceUntil, graceReason: b.graceReason },
        lastPaymentId: i.paymentId,
        updatedAt: SERVER_TIME,
        lastAuditId: i.auditId,
      },
    },
    audit(i.auditId, i.actorUid, 'balance.pay', 'members', i.memberId, { amount: i.amount, left, receipt: i.receiptNo }),
  ];
}

// ---------------------------------------------------------------- admin entry permission for a late balance

export const GRACE_MAX_DAYS = 30;

export function grantEntry(i: { actorUid: string; auditId: string; memberId: string; balance: BalanceDoc | null; untilDate: string | null; reason: string; now: Date }): WriteOp[] {
  const b = i.balance ?? refuse('no-balance');
  const reason = i.reason.replace(/\s+/g, ' ').trim().slice(0, 200);
  let graceUntil: Date | null = null;
  if (i.untilDate) {
    if (!reason) refuse('reason-required');
    graceUntil = endOfGymDay(i.untilDate);
    const ms = graceUntil.getTime() - i.now.getTime();
    if (ms <= 0 || ms > (GRACE_MAX_DAYS + 2) * 86_400_000) refuse('invalid-date');
  }
  return [
    {
      type: 'update',
      path: `members/${i.memberId}`,
      data: { balance: { remaining: b.remaining, total: b.total, dueAt: b.dueAt, membershipId: b.membershipId, graceUntil, graceReason: graceUntil ? reason : '' }, updatedAt: SERVER_TIME, lastAuditId: i.auditId },
    },
    audit(i.auditId, i.actorUid, graceUntil ? 'balance.grant' : 'balance.revoke', 'members', i.memberId, { until: i.untilDate ?? '', reason: graceUntil ? reason : '' }),
  ];
}

// ---------------------------------------------------------------- cancellation and refund (admin)

export interface MembershipDoc {
  memberId: string;
  due: number;
  status: 'ACTIVE' | 'CANCELLED';
  startsAt: Date;
  endsAt: Date;
  plan: { price: number; nameAr: string; nameEn: string };
}

/** What has been paid on this membership so far (the remainder is still on the member file). */
export function paidOn(membershipId: string, m: { due: number }, balance: BalanceDoc | null): number {
  return m.due - (balance && balance.membershipId === membershipId ? balance.remaining : 0);
}

export function cancelMembership(i: {
  actorUid: string;
  auditId: string;
  membershipId: string;
  membership: MembershipDoc;
  member: { id: string; membership: MembershipSummary | null; balance: BalanceDoc | null };
  refund: number;
  overridden: boolean;
  reason: string;
  paymentId: string;
  receiptNo: string;
  method: PayMethod;
}): AnyOp[] {
  if (i.membership.status !== 'ACTIVE') refuse('already-cancelled');
  const s = i.member.membership;
  if (!s || s.id !== i.membershipId) refuse('not-latest');
  const paid = paidOn(i.membershipId, i.membership, i.member.balance);
  if (!Number.isInteger(i.refund) || i.refund < 0 || i.refund > paid) refuse('invalid-amount');
  const reason = i.reason.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!reason) refuse('reason-required');
  const withRefund = i.refund > 0;
  const keepBalance = i.member.balance && i.member.balance.membershipId !== i.membershipId ? i.member.balance : null;
  const ops: AnyOp[] = [
    {
      type: 'update',
      path: `memberships/${i.membershipId}`,
      data: {
        status: 'CANCELLED',
        cancel: { by: i.actorUid, at: SERVER_TIME, refund: i.refund, overridden: i.overridden, reason, paymentId: withRefund ? i.paymentId : null },
        updatedAt: SERVER_TIME,
        lastAuditId: i.auditId,
      },
    },
    {
      type: 'update',
      path: `members/${i.member.id}`,
      data: {
        membership: { ...summaryData(s!), status: 'CANCELLED' },
        balance: keepBalance ? balanceData(keepBalance) : null,
        updatedAt: SERVER_TIME,
        lastAuditId: i.auditId,
      },
    },
    audit(i.auditId, i.actorUid, 'membership.cancel', 'memberships', i.membershipId, { refund: i.refund, overridden: i.overridden, reason }),
  ];
  if (withRefund) {
    if (!isReceiptNo(i.receiptNo)) refuse('invalid-input');
    ops.push(payment({ id: i.paymentId, memberId: i.member.id, membershipId: i.membershipId, kind: 'REFUND', amount: i.refund, method: i.method, reference: null, receiptNo: i.receiptNo, by: i.actorUid }));
  }
  return ops;
}

function summaryData(s: MembershipSummary): DocData {
  return {
    id: s.id,
    planNameAr: s.planNameAr,
    planNameEn: s.planNameEn,
    unit: s.unit,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    status: s.status,
    visitQuota: s.visitQuota ?? null,
    visitsUsed: s.visitsUsed ?? 0,
    prev: s.prev ? { planNameAr: s.prev.planNameAr, planNameEn: s.prev.planNameEn, startsAt: s.prev.startsAt, endsAt: s.prev.endsAt } : null,
  };
}

function balanceData(b: BalanceDoc): DocData {
  return { remaining: b.remaining, total: b.total, dueAt: b.dueAt, membershipId: b.membershipId, graceUntil: b.graceUntil, graceReason: b.graceReason };
}
