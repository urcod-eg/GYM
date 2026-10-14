import { DateTime } from 'luxon';
import { GYM_TZ } from './dates';
import type { Piasters } from './plans';

/**
 * Deposits, balances and refunds (agreed 14 Oct 2026). Integer piasters only.
 * In production every rule here is enforced by Cloud Functions; the client copy powers previews.
 */

export interface DepositSettings {
  enabled: boolean;
  minPercent: number; // minimum deposit as % of the amount due
  graceDays: number; // default days to pay the remainder
  maxGraceDays: number; // longest due date a cashier may choose
}

export const DEFAULT_DEPOSIT_SETTINGS: DepositSettings = {
  enabled: true,
  minPercent: 50,
  graceDays: 7,
  maxGraceDays: 30,
};

export type PayMode = 'FULL' | 'DEPOSIT';

export interface PaymentInput {
  due: Piasters; // amount due after discount
  mode: PayMode;
  deposit: Piasters; // only used for DEPOSIT
  tendered: Piasters | null; // cash handed over, to compute change; null = not entered
  isDayPass: boolean;
}

export type PaymentError = 'deposit.disabled' | 'deposit.dayPass' | 'deposit.belowMin' | 'deposit.notLess' | 'tendered.short';

export interface PaymentPlan {
  paidNow: Piasters; // what the receipt records today
  remaining: Piasters; // balance owed after today
  change: Piasters | null; // cash to hand back; never recorded as revenue
  minDeposit: Piasters;
  errors: PaymentError[];
}

export function minDepositFor(due: Piasters, s: DepositSettings): Piasters {
  return Math.ceil((due * s.minPercent) / 100);
}

export function planPayment(p: PaymentInput, s: DepositSettings): PaymentPlan {
  const errors: PaymentError[] = [];
  const minDeposit = minDepositFor(p.due, s);
  let paidNow = p.due;
  if (p.mode === 'DEPOSIT') {
    if (!s.enabled) errors.push('deposit.disabled');
    if (p.isDayPass) errors.push('deposit.dayPass');
    if (p.deposit < minDeposit) errors.push('deposit.belowMin');
    if (p.deposit >= p.due) errors.push('deposit.notLess');
    paidNow = Math.max(0, Math.min(p.deposit, p.due));
  }
  let change: Piasters | null = null;
  if (p.tendered !== null) {
    if (p.tendered < paidNow) errors.push('tendered.short');
    else change = p.tendered - paidNow;
  }
  return { paidNow, remaining: p.due - paidNow, change, minDeposit, errors };
}

/** Default and latest allowed due date for the remainder, as gym-local ISO dates. */
export function balanceDueDates(now: DateTime, s: DepositSettings) {
  const today = now.setZone(GYM_TZ).startOf('day');
  return {
    defaultDue: today.plus({ days: s.graceDays }).toISODate()!,
    maxDue: today.plus({ days: s.maxGraceDays }).toISODate()!,
    minDue: today.plus({ days: 1 }).toISODate()!,
  };
}

export type BalanceStatus = 'NONE' | 'ON_TIME' | 'OVERDUE_BLOCKED' | 'OVERDUE_GRACE';

export interface Balance {
  remaining: Piasters;
  dueDate: string; // ISO date; the remainder must be paid before the END of this day
  graceUntil: string | null; // admin permission to enter, inclusive last day
}

/**
 * The remainder is late from 00:00 the day AFTER the due date (gym timezone).
 * A late balance blocks entry unless an admin granted access until a date that has not passed.
 */
export function balanceStatus(now: DateTime, b: Balance | null): BalanceStatus {
  if (!b || b.remaining <= 0) return 'NONE';
  const local = now.setZone(GYM_TZ);
  const lateFrom = DateTime.fromISO(b.dueDate, { zone: GYM_TZ }).startOf('day').plus({ days: 1 });
  if (local < lateFrom) return 'ON_TIME';
  if (b.graceUntil) {
    const graceEnd = DateTime.fromISO(b.graceUntil, { zone: GYM_TZ }).startOf('day').plus({ days: 1 });
    if (local < graceEnd) return 'OVERDUE_GRACE';
  }
  return 'OVERDUE_BLOCKED';
}

export function daysLate(now: DateTime, b: Balance): number {
  const today = now.setZone(GYM_TZ).startOf('day');
  const due = DateTime.fromISO(b.dueDate, { zone: GYM_TZ }).startOf('day');
  return Math.max(0, Math.round(today.diff(due, 'days').days));
}

export function entryAllowedByBalance(status: BalanceStatus): boolean {
  return status !== 'OVERDUE_BLOCKED';
}

/**
 * Refund on cancellation (policy: deposit is refundable).
 * - Before the membership starts: everything paid comes back.
 * - After it starts: paid minus the value of the days already used, valued at the FULL plan price
 *   per calendar day (today counts as used). Never below zero; a cancelled member owes nothing.
 * An admin may override the amount with a written reason (recorded in the audit log).
 */
export interface RefundQuote {
  paid: Piasters;
  usedDays: number;
  totalDays: number;
  usedValue: Piasters;
  refund: Piasters;
}

export function quoteRefund(now: DateTime, paid: Piasters, planPrice: Piasters, startsAt: DateTime, endsAtExclusive: DateTime): RefundQuote {
  const today = now.setZone(GYM_TZ).startOf('day');
  const start = startsAt.setZone(GYM_TZ).startOf('day');
  const end = endsAtExclusive.setZone(GYM_TZ).startOf('day');
  const totalDays = Math.max(1, Math.round(end.diff(start, 'days').days));
  let usedDays = 0;
  if (today >= start) usedDays = Math.min(totalDays, Math.round(today.diff(start, 'days').days) + 1);
  const usedValue = Math.round((planPrice * usedDays) / totalDays);
  return { paid, usedDays, totalDays, usedValue, refund: Math.max(0, paid - usedValue) };
}
