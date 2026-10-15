import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { currentView, DEFAULT_GYM_SETTINGS, endOfGymDay, gymDayEndingAt, isReceiptNo, newReceiptNo, payBalance, saleQuote, sellMembership, type MembershipSummary, type PlanDoc, type SaleInput } from './sales';
import { WriteError } from './writes';

const M1: PlanDoc = { code: 'M1', nameAr: 'شهر', nameEn: '1 month', unit: 'month', value: 1, visitQuota: null, price: 100000, featured: false, active: true, sort: 1 };
const today = () => DateTime.now().setZone('Africa/Cairo').toISODate()!;
const base = (over: Partial<SaleInput> = {}): SaleInput => ({
  actorUid: 'c', actorIsAdmin: false, auditId: 'a', membershipId: 'ms', paymentId: 'p', receiptNo: 'R-261015-ABCDE',
  member: { id: 'm', membership: null, balance: null }, planId: 'p_m1', plan: M1, customDays: null, customPrice: null,
  startDate: today(), discountPct: 0, mode: 'FULL', deposit: 0, balanceDueDate: null, method: 'CASH', reference: null,
  settings: DEFAULT_GYM_SETTINGS, now: new Date(), ...over,
});
const reason = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e instanceof WriteError ? e.reason : String(e);
  }
  return null;
};

describe('sale amounts', () => {
  it('discount rounds down, the minimum deposit rounds up', () => {
    const q = saleQuote({ plan: { ...M1, price: 99999 }, customPrice: null, discountPct: 7, carried: 0, mode: 'FULL', deposit: 0, settings: DEFAULT_GYM_SETTINGS });
    expect(q.discount).toBe(6999);
    expect(q.due).toBe(93000);
    expect(q.minDeposit).toBe(46500);
    const odd = saleQuote({ plan: { ...M1, price: 101 }, customPrice: null, discountPct: 0, carried: 0, mode: 'FULL', deposit: 0, settings: DEFAULT_GYM_SETTINGS });
    expect(odd.minDeposit).toBe(51);
  });
  it('cashiers are held to the discount limit; admins are not', () => {
    expect(reason(() => sellMembership(base({ discountPct: 20 })))).toBe('discount-too-high');
    expect(reason(() => sellMembership(base({ discountPct: 20, actorIsAdmin: true })))).toBeNull();
  });
  it('deposits: minimum, not the whole amount, never on a day pass', () => {
    expect(reason(() => sellMembership(base({ mode: 'DEPOSIT', deposit: 40000, balanceDueDate: DateTime.now().setZone('Africa/Cairo').plus({ days: 7 }).toISODate()! })))).toBe('invalid-deposit');
    expect(reason(() => sellMembership(base({ mode: 'DEPOSIT', deposit: 100000, balanceDueDate: DateTime.now().setZone('Africa/Cairo').plus({ days: 7 }).toISODate()! })))).toBe('invalid-deposit');
    const r = sellMembership(base({ mode: 'DEPOSIT', deposit: 50000, balanceDueDate: DateTime.now().setZone('Africa/Cairo').plus({ days: 7 }).toISODate()! }));
    expect(r.quote.remaining).toBe(50000);
    expect(reason(() => sellMembership(base({ plan: { ...M1, unit: 'session', value: 1 }, mode: 'DEPOSIT', deposit: 60000, balanceDueDate: today() })))).toBe('deposit-day-pass');
  });
  it('an early renewal is appended to the running period', () => {
    const end = new Date(Date.now() + 5 * 86_400_000);
    const running: MembershipSummary = { id: 'x', planNameAr: 'ش', planNameEn: 'M', unit: 'month', startsAt: new Date(Date.now() - 25 * 86_400_000), endsAt: end, status: 'ACTIVE', visitQuota: null, visitsUsed: 0, prev: null };
    const r = sellMembership(base({ member: { id: 'm', membership: running, balance: null } }));
    expect(r.startsAt.getTime()).toBe(end.getTime());
  });
  it('the remainder can be paid in parts but never overpaid', () => {
    const balance = { remaining: 500, total: 1000, dueAt: new Date(), membershipId: 'ms', graceUntil: null, graceReason: '' };
    expect(reason(() => payBalance({ actorUid: 'c', auditId: 'a', paymentId: 'p', receiptNo: 'R-261015-ABCDE', memberId: 'm', balance, amount: 600, method: 'CASH', reference: null }))).toBe('invalid-amount');
    const ops = payBalance({ actorUid: 'c', auditId: 'a', paymentId: 'p', receiptNo: 'R-261015-ABCDE', memberId: 'm', balance, amount: 500, method: 'CASH', reference: null });
    expect(ops[1].type === 'update' && ops[1].data.balance).toBeNull();
  });
});

describe('dates and receipts', () => {
  it('a due date ends at midnight of the next gym day, and back', () => {
    const end = endOfGymDay('2026-10-20');
    expect(gymDayEndingAt(end)).toBe('2026-10-20');
  });
  it('receipt numbers look right', () => {
    expect(isReceiptNo(newReceiptNo(new Date()))).toBe(true);
  });
  it('a cancelled renewal falls back to the period it was appended to', () => {
    const now = new Date();
    const prev = { planNameAr: 'أ', planNameEn: 'A', startsAt: new Date(now.getTime() - 86_400_000), endsAt: new Date(now.getTime() + 86_400_000) };
    const s: MembershipSummary = { id: 'x', planNameAr: 'ب', planNameEn: 'B', unit: 'month', startsAt: prev.endsAt, endsAt: new Date(now.getTime() + 40 * 86_400_000), status: 'CANCELLED', visitQuota: null, visitsUsed: 0, prev };
    expect(currentView(s, now).period?.planNameEn).toBe('A');
    expect(currentView({ ...s, status: 'ACTIVE' }, now).next?.planNameEn).toBe('B');
  });
});
