/**
 * Phase 6 — the gym's books beyond membership receipts.
 * Income/expense entries (admin or accountant) are append-only; a mistake is voided by an admin
 * with a reason, never edited or deleted. Each cashier closes their own cash drawer once a day:
 * counted cash vs. the cash they collected, and the difference is kept for the admin.
 */
import { audit, refuse, SERVER_TIME, type WriteOp } from './writes';
import { PAY_METHODS, type PayMethod } from './sales';

export const EXPENSE_CATEGORIES = ['rent', 'salaries', 'utilities', 'equipment', 'maintenance', 'supplies', 'marketing', 'other'] as const;
export const INCOME_CATEGORIES = ['products', 'personal_training', 'lockers', 'other'] as const;
export type FinanceKind = 'EXPENSE' | 'INCOME';
export type FinanceCategory = (typeof EXPENSE_CATEGORIES)[number] | (typeof INCOME_CATEGORIES)[number];

export interface FinanceEntryInput {
  kind: FinanceKind;
  category: FinanceCategory;
  amount: number; // piasters
  method: PayMethod;
  date: string; // gym day 'YYYY-MM-DD'
  note: string;
}

export function validCategory(kind: FinanceKind, c: string): boolean {
  return kind === 'EXPENSE' ? (EXPENSE_CATEGORIES as readonly string[]).includes(c) : (INCOME_CATEGORIES as readonly string[]).includes(c);
}

export function addFinanceEntry(i: { actorUid: string; auditId: string; entryId: string; entry: FinanceEntryInput }): WriteOp[] {
  const e = i.entry;
  const note = e.note.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (e.kind !== 'EXPENSE' && e.kind !== 'INCOME') refuse('invalid-input');
  if (!validCategory(e.kind, e.category)) refuse('invalid-input');
  if (!Number.isInteger(e.amount) || e.amount <= 0 || e.amount > 100_000_000) refuse('invalid-amount');
  if (!(PAY_METHODS as readonly string[]).includes(e.method)) refuse('invalid-method');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) refuse('invalid-date');
  return [
    {
      type: 'set',
      path: `financeEntries/${i.entryId}`,
      data: { kind: e.kind, category: e.category, amount: e.amount, method: e.method, date: e.date, note, status: 'ACTIVE', voidReason: '', voidedBy: null, voidedAt: null, by: i.actorUid, at: SERVER_TIME, lastAuditId: i.auditId },
    },
    audit(i.auditId, i.actorUid, 'finance.add', 'financeEntries', i.entryId, { kind: e.kind, category: e.category, amount: e.amount }),
  ];
}

export function voidFinanceEntry(i: { actorUid: string; auditId: string; entryId: string; reason: string }): WriteOp[] {
  const reason = i.reason.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!reason) refuse('reason-required');
  return [
    { type: 'update', path: `financeEntries/${i.entryId}`, data: { status: 'VOID', voidReason: reason, voidedBy: i.actorUid, voidedAt: SERVER_TIME, lastAuditId: i.auditId } },
    audit(i.auditId, i.actorUid, 'finance.void', 'financeEntries', i.entryId, { reason }),
  ];
}

/** A cashier's end-of-day cash count: one per cashier per day (the id makes a second one impossible). */
export function closeCash(i: { actorUid: string; auditId: string; date: string; expected: number; counted: number; note: string }): WriteOp[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) refuse('invalid-date');
  if (!Number.isInteger(i.counted) || i.counted < 0 || i.counted > 100_000_000 || !Number.isInteger(i.expected)) refuse('invalid-amount');
  const id = `${i.actorUid}_${i.date}`;
  return [
    {
      type: 'set',
      path: `cashCloses/${id}`,
      data: { date: i.date, by: i.actorUid, expected: i.expected, counted: i.counted, diff: i.counted - i.expected, note: i.note.replace(/\s+/g, ' ').trim().slice(0, 200), at: SERVER_TIME, lastAuditId: i.auditId },
    },
    audit(i.auditId, i.actorUid, 'cash.close', 'cashCloses', id, { expected: i.expected, counted: i.counted }),
  ];
}

// ---------------------------------------------------------------- monthly report (pure)

export interface ReportInput {
  payments: { kind: 'SALE' | 'BALANCE' | 'REFUND'; amount: number; method: PayMethod }[];
  entries: { kind: FinanceKind; category: string; amount: number; status: 'ACTIVE' | 'VOID' }[];
  memberships: { renewal?: boolean; plan: { code: string; nameAr: string; nameEn: string }; status: string; due: number }[];
}

export interface MonthReport {
  collected: number; // sales + remainders
  refunds: number;
  receipts: number; // collected − refunds
  byMethod: Record<PayMethod, number>;
  otherIncome: number;
  expenses: number;
  byExpense: Record<string, number>;
  net: number; // receipts + other income − expenses
  newMembers: number;
  renewals: number;
  cancelled: number;
  topPlans: { code: string; nameAr: string; nameEn: string; count: number }[];
}

export function monthReport(i: ReportInput): MonthReport {
  const byMethod: Record<PayMethod, number> = { CASH: 0, WALLET: 0, INSTAPAY: 0, BANK: 0 };
  let collected = 0;
  let refunds = 0;
  for (const p of i.payments) {
    if (p.kind === 'REFUND') {
      refunds += p.amount;
      byMethod[p.method] -= p.amount;
    } else {
      collected += p.amount;
      byMethod[p.method] += p.amount;
    }
  }
  const live = i.entries.filter((e) => e.status === 'ACTIVE');
  const otherIncome = live.filter((e) => e.kind === 'INCOME').reduce((s, e) => s + e.amount, 0);
  const byExpense: Record<string, number> = {};
  let expenses = 0;
  for (const e of live.filter((x) => x.kind === 'EXPENSE')) {
    expenses += e.amount;
    byExpense[e.category] = (byExpense[e.category] ?? 0) + e.amount;
  }
  const plans = new Map<string, { code: string; nameAr: string; nameEn: string; count: number }>();
  for (const m of i.memberships) {
    const k = m.plan.code;
    const cur = plans.get(k) ?? { code: k, nameAr: m.plan.nameAr, nameEn: m.plan.nameEn, count: 0 };
    cur.count += 1;
    plans.set(k, cur);
  }
  const receipts = collected - refunds;
  return {
    collected,
    refunds,
    receipts,
    byMethod,
    otherIncome,
    expenses,
    byExpense,
    net: receipts + otherIncome - expenses,
    newMembers: i.memberships.filter((m) => !m.renewal).length,
    renewals: i.memberships.filter((m) => m.renewal).length,
    cancelled: i.memberships.filter((m) => m.status === 'CANCELLED').length,
    topPlans: [...plans.values()].sort((a, b) => b.count - a.count).slice(0, 5),
  };
}
