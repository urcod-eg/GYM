import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { coachAllowed, hourRanges, hoursBetween, sectionAt, sectionRefusal, validLadiesHours } from './gender';
import { checkEntry } from './attendance';
import { DEFAULT_GYM_SETTINGS, setGymSettings } from './sales';
import { WriteError } from './writes';

const at = (iso: string) => DateTime.fromISO(iso, { zone: 'Africa/Cairo' }).toJSDate();

describe('men / ladies', () => {
  // 2026-10-15 is a Thursday ('4'); Cairo is UTC+3 that day.
  const hours = { '4': hoursBetween(10, 14) };
  it("ladies' hours use the gym's local day and hour", () => {
    expect(sectionAt('SPLIT_HOURS', hours, at('2026-10-15T10:00'))).toBe('F');
    expect(sectionAt('SPLIT_HOURS', hours, at('2026-10-15T13:59'))).toBe('F');
    expect(sectionAt('SPLIT_HOURS', hours, at('2026-10-15T14:00'))).toBe('M');
    expect(sectionAt('SPLIT_HOURS', hours, at('2026-10-16T11:00'))).toBe('M');
    expect(sectionAt('MIXED', hours, at('2026-10-15T11:00'))).toBeNull();
  });
  it('refusals: no gender set, or the other section\'s hours', () => {
    expect(sectionRefusal('SPLIT_HOURS', hours, null, at('2026-10-15T11:00'))).toBe('NO_GENDER');
    expect(sectionRefusal('SPLIT_HOURS', hours, 'M', at('2026-10-15T11:00'))).toBe('WRONG_HOURS');
    expect(sectionRefusal('SPLIT_HOURS', hours, 'F', at('2026-10-15T11:00'))).toBeNull();
    expect(sectionRefusal('SEPARATE', hours, null, at('2026-10-15T11:00'))).toBeNull();
  });
  it('the door check uses it', () => {
    const now = at('2026-10-15T11:00');
    const m = { id: 'm', membership: { id: 'ms', planNameAr: 'شهر', planNameEn: 'Month', unit: 'month' as const, startsAt: new Date(now.getTime() - 86_400_000), endsAt: new Date(now.getTime() + 86_400_000 * 20), status: 'ACTIVE' as const, visitQuota: null, visitsUsed: 0, prev: null }, balance: null, blocks: {}, lastCheckInAt: null };
    expect(checkEntry({ ...m, gender: 'M' }, now, null, { genderMode: 'SPLIT_HOURS', ladiesHours: hours }).reason).toBe('WRONG_HOURS');
    expect(checkEntry({ ...m, gender: 'F' }, now, null, { genderMode: 'SPLIT_HOURS', ladiesHours: hours }).allowed).toBe(true);
    expect(checkEntry({ ...m, gender: 'M' }, now, null, { genderMode: 'MIXED', ladiesHours: hours }).allowed).toBe(true);
  });
  it('hour ranges and validation', () => {
    expect(hourRanges([10, 11, 12, 18, 19])).toEqual([[10, 13], [18, 20]]);
    expect(hoursBetween(22, 24)).toEqual([22, 23]);
    expect(validLadiesHours({ '0': [9, 10] })).toBe(true);
    expect(validLadiesHours({ '7': [9] })).toBe(false);
    expect(validLadiesHours({ '1': [24] })).toBe(false);
    expect(() => setGymSettings({ actorUid: 'a', auditId: 'x', settings: { ...DEFAULT_GYM_SETTINGS, genderMode: 'OTHER' as never } })).toThrow(WriteError);
  });
  it('coach of the same section only when the ladies\' section is separate', () => {
    expect(coachAllowed('MIXED', 'F', 'M')).toBe(true);
    expect(coachAllowed('SEPARATE', 'F', 'M')).toBe(false);
    expect(coachAllowed('SEPARATE', 'F', 'F')).toBe(true);
    expect(coachAllowed('SEPARATE', null, 'F')).toBe(false);
  });
});
