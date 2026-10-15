import { describe, expect, it } from 'vitest';
import { addFinanceEntry, closeCash, monthReport, voidFinanceEntry } from './finance';
import { WriteError } from './writes';

describe('finance entries', () => {
  it('category must match the kind; amount positive', () => {
    const base = { kind: 'EXPENSE' as const, category: 'rent' as const, amount: 100, method: 'CASH' as const, date: '2026-10-01', note: '' };
    expect(() => addFinanceEntry({ actorUid: 'a', auditId: 'x', entryId: 'e', entry: { ...base, category: 'products' } })).toThrow(WriteError);
    expect(() => addFinanceEntry({ actorUid: 'a', auditId: 'x', entryId: 'e', entry: { ...base, amount: 0 } })).toThrow(WriteError);
    expect(addFinanceEntry({ actorUid: 'a', auditId: 'x', entryId: 'e', entry: base })[0].data.status).toBe('ACTIVE');
  });
  it('voiding needs a reason', () => {
    expect(() => voidFinanceEntry({ actorUid: 'a', auditId: 'x', entryId: 'e', reason: '  ' })).toThrow(WriteError);
  });
  it('cash close: difference computed, one id per cashier per day', () => {
    const ops = closeCash({ actorUid: 'c1', auditId: 'x', date: '2026-10-15', expected: 5000, counted: 4900, note: '' });
    expect(ops[0].path).toBe('cashCloses/c1_2026-10-15');
    expect(ops[0].data.diff).toBe(-100);
  });
});

describe('monthly report', () => {
  it('collections minus refunds, plus other income, minus active expenses', () => {
    const r = monthReport({
      payments: [
        { kind: 'SALE', amount: 1000, method: 'CASH' },
        { kind: 'BALANCE', amount: 500, method: 'INSTAPAY' },
        { kind: 'REFUND', amount: 200, method: 'CASH' },
      ],
      entries: [
        { kind: 'EXPENSE', category: 'rent', amount: 300, status: 'ACTIVE' },
        { kind: 'EXPENSE', category: 'rent', amount: 999, status: 'VOID' },
        { kind: 'INCOME', category: 'products', amount: 100, status: 'ACTIVE' },
      ],
      memberships: [
        { renewal: false, plan: { code: 'M1', nameAr: 'شهر', nameEn: 'Month' }, status: 'ACTIVE', due: 1000 },
        { renewal: true, plan: { code: 'M1', nameAr: 'شهر', nameEn: 'Month' }, status: 'CANCELLED', due: 1000 },
      ],
    });
    expect(r).toMatchObject({ collected: 1500, refunds: 200, receipts: 1300, otherIncome: 100, expenses: 300, net: 1100, newMembers: 1, renewals: 1, cancelled: 1 });
    expect(r.byMethod.CASH).toBe(800);
    expect(r.topPlans[0]).toMatchObject({ code: 'M1', count: 2 });
  });
});
