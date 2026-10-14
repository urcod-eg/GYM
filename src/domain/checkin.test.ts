import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { GYM_TZ } from './dates';
import { egp } from './plans';
import { decideEntry, type EntryInput } from './checkin';

const now = DateTime.fromISO('2026-10-25T18:00', { zone: GYM_TZ });
const base: EntryInput = { now, phase: 'ACTIVE', cancelled: false, checkinBlocked: false, codeAlreadyUsed: false, balance: null };
const late = { remaining: egp(1200), dueDate: '2026-10-21', graceUntil: null };

describe('decideEntry', () => {
  it('active, nothing owed → allowed', () => {
    expect(decideEntry(base)).toMatchObject({ allowed: true, note: null });
  });
  it('overdue balance → denied', () => {
    expect(decideEntry({ ...base, balance: late })).toMatchObject({ allowed: false, reason: 'DUES_OVERDUE' });
  });
  it('overdue but admin allowed entry until a future date → allowed with a note', () => {
    expect(decideEntry({ ...base, balance: { ...late, graceUntil: '2026-10-27' } })).toMatchObject({ allowed: true, note: 'GRACE' });
  });
  it('balance not yet due → allowed with a reminder', () => {
    expect(decideEntry({ ...base, balance: { ...late, dueDate: '2026-10-28' } })).toMatchObject({ allowed: true, note: 'BALANCE_DUE' });
  });
  it('admin permission never revives an expired, scheduled, cancelled or blocked membership', () => {
    const grace = { ...late, graceUntil: '2026-10-30' };
    expect(decideEntry({ ...base, phase: 'EXPIRED', balance: grace }).reason).toBe('EXPIRED');
    expect(decideEntry({ ...base, phase: 'SCHEDULED', balance: grace }).reason).toBe('SCHEDULED');
    expect(decideEntry({ ...base, cancelled: true, balance: grace }).reason).toBe('CANCELLED');
    expect(decideEntry({ ...base, checkinBlocked: true, balance: grace }).reason).toBe('BLOCKED');
  });
  it('a code used once is refused even for a member in good standing', () => {
    expect(decideEntry({ ...base, codeAlreadyUsed: true }).reason).toBe('CODE_USED');
  });
});
