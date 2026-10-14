import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { GYM_TZ, computeEndExclusive, localStartOfDay } from './dates';
import { egp } from './plans';
import { DEFAULT_DEPOSIT_SETTINGS as S, balanceDueDates, balanceStatus, daysLate, entryAllowedByBalance, planPayment, quoteRefund } from './payments';

const at = (iso: string) => DateTime.fromISO(iso, { zone: GYM_TZ });

describe('planPayment', () => {
  const due = egp(2700);

  it('full payment: paid = due, nothing remaining, change from cash handed over', () => {
    const p = planPayment({ due, mode: 'FULL', deposit: 0, tendered: egp(3000), isDayPass: false }, S);
    expect(p).toMatchObject({ paidNow: due, remaining: 0, change: egp(300), errors: [] });
  });

  it('deposit: records only the deposit; change is computed on the deposit', () => {
    const p = planPayment({ due, mode: 'DEPOSIT', deposit: egp(1500), tendered: egp(1600), isDayPass: false }, S);
    expect(p).toMatchObject({ paidNow: egp(1500), remaining: egp(1200), change: egp(100), errors: [] });
  });

  it('deposit must be at least 50% of the amount due', () => {
    const p = planPayment({ due, mode: 'DEPOSIT', deposit: egp(1349), tendered: null, isDayPass: false }, S);
    expect(p.minDeposit).toBe(egp(1350));
    expect(p.errors).toContain('deposit.belowMin');
  });

  it('a "deposit" equal to the full amount is not a deposit', () => {
    expect(planPayment({ due, mode: 'DEPOSIT', deposit: due, tendered: null, isDayPass: false }, S).errors).toContain('deposit.notLess');
  });

  it('day passes cannot be paid with a deposit', () => {
    expect(planPayment({ due: egp(100), mode: 'DEPOSIT', deposit: egp(60), tendered: null, isDayPass: true }, S).errors).toContain('deposit.dayPass');
  });

  it('deposits can be switched off by the admin', () => {
    expect(planPayment({ due, mode: 'DEPOSIT', deposit: egp(2000), tendered: null, isDayPass: false }, { ...S, enabled: false }).errors).toContain('deposit.disabled');
  });

  it('cash handed over below the amount is rejected', () => {
    expect(planPayment({ due, mode: 'FULL', deposit: 0, tendered: egp(2000), isDayPass: false }, S).errors).toContain('tendered.short');
  });
});

describe('balanceStatus', () => {
  const b = { remaining: egp(1200), dueDate: '2026-10-21', graceUntil: null };

  it('on time through the end of the due date', () => {
    expect(balanceStatus(at('2026-10-21T23:59'), b)).toBe('ON_TIME');
  });

  it('late from midnight after the due date → entry blocked', () => {
    const s = balanceStatus(at('2026-10-22T00:00'), b);
    expect(s).toBe('OVERDUE_BLOCKED');
    expect(entryAllowedByBalance(s)).toBe(false);
    expect(daysLate(at('2026-10-25T10:00'), b)).toBe(4);
  });

  it('admin grace allows entry through its last day, then blocks again', () => {
    const g = { ...b, graceUntil: '2026-10-24' };
    expect(balanceStatus(at('2026-10-24T22:00'), g)).toBe('OVERDUE_GRACE');
    expect(entryAllowedByBalance('OVERDUE_GRACE')).toBe(true);
    expect(balanceStatus(at('2026-10-25T00:00'), g)).toBe('OVERDUE_BLOCKED');
  });

  it('paid off → no balance', () => {
    expect(balanceStatus(at('2026-11-30T10:00'), { ...b, remaining: 0 })).toBe('NONE');
  });

  it('due date choices follow the settings', () => {
    expect(balanceDueDates(at('2026-10-14T20:00'), S)).toEqual({ defaultDue: '2026-10-21', maxDue: '2026-11-13', minDue: '2026-10-15' });
  });
});

describe('quoteRefund', () => {
  const start = localStartOfDay('2026-10-20');
  const end = computeEndExclusive(start, { unit: 'month', value: 3 }); // 20 Jan 2027, 92 days

  it('cancelled before the start → full refund', () => {
    expect(quoteRefund(at('2026-10-18T12:00'), egp(1500), egp(2700), start, end)).toMatchObject({ usedDays: 0, refund: egp(1500) });
  });

  it('cancelled on day 10 → deposit minus 10 days at the full plan price', () => {
    const q = quoteRefund(at('2026-10-29T12:00'), egp(1500), egp(2700), start, end);
    expect(q.totalDays).toBe(92);
    expect(q.usedDays).toBe(10);
    expect(q.usedValue).toBe(Math.round((egp(2700) * 10) / 92)); // ≈ 293.48 EGP
    expect(q.refund).toBe(egp(1500) - q.usedValue);
  });

  it('never negative: used value above the deposit refunds nothing and leaves no debt', () => {
    expect(quoteRefund(at('2027-01-10T12:00'), egp(1500), egp(2700), start, end).refund).toBe(0);
  });
});
