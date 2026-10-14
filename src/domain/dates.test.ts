import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { GYM_TZ, computeEndExclusive, daysRemaining, lastUsableDay, localStartOfDay, phaseAt, renewalStart } from './dates';

const d = (iso: string) => localStartOfDay(iso);
const ymd = (dt: DateTime) => dt.setZone(GYM_TZ).toISODate();

describe('computeEndExclusive', () => {
  it('monthly plan: 15 Oct → ends at the start of 15 Nov, last day 14 Nov', () => {
    const end = computeEndExclusive(d('2026-10-15'), { unit: 'month', value: 1 });
    expect(ymd(end)).toBe('2026-11-15');
    expect(end.setZone(GYM_TZ).hour).toBe(0);
    expect(ymd(lastUsableDay(end))).toBe('2026-11-14');
  });

  it('31 Jan + 1 month rolls to 1 Mar (Feb has no 31st)', () => {
    expect(ymd(computeEndExclusive(d('2026-01-31'), { unit: 'month', value: 1 }))).toBe('2026-03-01');
  });

  it('30 Jan + 1 month in a leap year → 1 Mar; last usable day 29 Feb', () => {
    const end = computeEndExclusive(d('2028-01-30'), { unit: 'month', value: 1 });
    expect(ymd(end)).toBe('2028-03-01');
    expect(ymd(lastUsableDay(end))).toBe('2028-02-29');
  });

  it('29 Feb + 1 year → 1 Mar of the next year', () => {
    expect(ymd(computeEndExclusive(d('2028-02-29'), { unit: 'year', value: 1 }))).toBe('2029-03-01');
  });

  it('31 Aug + 3 months → 1 Dec (Nov has 30 days)', () => {
    expect(ymd(computeEndExclusive(d('2026-08-31'), { unit: 'month', value: 3 }))).toBe('2026-12-01');
  });

  it('single session ends at the next midnight', () => {
    expect(ymd(computeEndExclusive(d('2026-10-14'), { unit: 'session', value: 1 }))).toBe('2026-10-15');
  });

  it('half month = 15 calendar days', () => {
    expect(ymd(computeEndExclusive(d('2026-10-14'), { unit: 'day', value: 15 }))).toBe('2026-10-29');
  });

  it('a week across the end of Egyptian summer time stays at local midnight', () => {
    const end = computeEndExclusive(d('2026-10-26'), { unit: 'week', value: 1 });
    const local = end.setZone(GYM_TZ);
    expect(local.toISODate()).toBe('2026-11-02');
    expect(local.hour).toBe(0);
  });

  it('a month across the start of summer time stays at local midnight', () => {
    const local = computeEndExclusive(d('2026-04-10'), { unit: 'month', value: 1 }).setZone(GYM_TZ);
    expect(local.toISODate()).toBe('2026-05-10');
    expect(local.hour).toBe(0);
  });

  it('rejects zero or fractional durations', () => {
    expect(() => computeEndExclusive(d('2026-10-14'), { unit: 'day', value: 0 })).toThrow();
    expect(() => computeEndExclusive(d('2026-10-14'), { unit: 'day', value: 1.5 })).toThrow();
  });
});

describe('phaseAt', () => {
  const start = d('2026-11-01');
  const end = computeEndExclusive(start, { unit: 'month', value: 1 });

  it('paid on 14 Oct, starting 1 Nov → SCHEDULED until 1 Nov 00:00 Cairo', () => {
    expect(phaseAt(DateTime.fromISO('2026-10-31T23:59:59', { zone: GYM_TZ }), start, end)).toBe('SCHEDULED');
    expect(phaseAt(DateTime.fromISO('2026-11-01T00:00:00', { zone: GYM_TZ }), start, end)).toBe('ACTIVE');
  });

  it('expires exactly at the exclusive end', () => {
    expect(phaseAt(DateTime.fromISO('2026-11-30T23:59:59', { zone: GYM_TZ }), start, end)).toBe('ACTIVE');
    expect(phaseAt(DateTime.fromISO('2026-12-01T00:00:00', { zone: GYM_TZ }), start, end)).toBe('EXPIRED');
  });

  it('uses the instant, not the client wall clock zone', () => {
    // 21:30 UTC on 30 Nov is already 1 Dec 00:30 in Cairo (UTC+2 in winter)
    expect(phaseAt(DateTime.fromISO('2026-11-30T22:30:00Z'), start, end)).toBe('EXPIRED');
  });
});

describe('renewalStart (append_to_existing_end)', () => {
  it('renewing 5 days early keeps every remaining day', () => {
    const end = d('2026-10-20');
    const now = DateTime.fromISO('2026-10-15T18:00', { zone: GYM_TZ });
    expect(ymd(renewalStart(now, end))).toBe('2026-10-20');
  });

  it('renewing after expiry starts today, never retroactively', () => {
    const end = d('2026-10-01');
    const now = DateTime.fromISO('2026-10-14T10:00', { zone: GYM_TZ });
    expect(ymd(renewalStart(now, end))).toBe('2026-10-14');
  });
});

describe('daysRemaining', () => {
  it('counts calendar days to the exclusive end', () => {
    const now = DateTime.fromISO('2026-10-14T23:00', { zone: GYM_TZ });
    expect(daysRemaining(now, d('2026-11-15'))).toBe(32);
  });
});
