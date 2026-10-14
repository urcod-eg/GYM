import { DateTime } from 'luxon';

/**
 * Membership date rules (Phase 0 §5.1). In production these run ONLY on the server
 * (Cloud Functions); the client copy exists for previews such as the registration summary.
 *
 * - Gym timezone: Africa/Cairo. Stored values are UTC instants.
 * - A membership starts at 00:00 local time on its start date.
 * - The end is EXCLUSIVE: the first instant the membership is no longer valid.
 * - Month/year plans keep the day-of-month; if that day does not exist in the target
 *   month, the membership ends on the 1st of the following month.
 * - Day/week plans add CALENDAR days (never N × 24h), so DST changes do not shift them.
 */
export const GYM_TZ = 'Africa/Cairo';

export type DurationUnit = 'session' | 'day' | 'week' | 'month' | 'year';

export interface PlanDuration {
  unit: DurationUnit;
  value: number;
}

export type MembershipPhase = 'SCHEDULED' | 'ACTIVE' | 'EXPIRED';

/** 'YYYY-MM-DD' interpreted as 00:00 in the gym timezone. */
export function localStartOfDay(isoDate: string, tz: string = GYM_TZ): DateTime {
  const dt = DateTime.fromISO(isoDate, { zone: tz });
  if (!dt.isValid) throw new Error(`Invalid date: ${isoDate}`);
  return dt.startOf('day');
}

function addMonthsRollover(start: DateTime, months: number): DateTime {
  const target = start.plus({ months });
  // Luxon clamps 31 Jan + 1 month to 28/29 Feb; our rule rolls to the 1st of the next month instead.
  if (target.day !== start.day) return target.plus({ days: 1 }).startOf('day');
  return target;
}

export function computeEndExclusive(start: DateTime, d: PlanDuration): DateTime {
  if (!Number.isInteger(d.value) || d.value < 1) throw new Error('Duration value must be a positive integer');
  const s = start.startOf('day');
  switch (d.unit) {
    case 'session':
      return s.plus({ days: 1 });
    case 'day':
      return s.plus({ days: d.value });
    case 'week':
      return s.plus({ days: 7 * d.value });
    case 'month':
      return addMonthsRollover(s, d.value);
    case 'year':
      return addMonthsRollover(s, 12 * d.value);
  }
}

/** The last date a member can attend, for display only. */
export function lastUsableDay(endExclusive: DateTime): DateTime {
  return endExclusive.minus({ days: 1 }).startOf('day');
}

export function phaseAt(now: DateTime, startsAt: DateTime, endsAtExclusive: DateTime): MembershipPhase {
  if (now < startsAt) return 'SCHEDULED';
  if (now < endsAtExclusive) return 'ACTIVE';
  return 'EXPIRED';
}

/** Whole calendar days left, counting today, while ACTIVE. */
export function daysRemaining(now: DateTime, endsAtExclusive: DateTime, tz: string = GYM_TZ): number {
  const today = now.setZone(tz).startOf('day');
  const diff = endsAtExclusive.setZone(tz).startOf('day').diff(today, 'days').days;
  return Math.max(0, Math.round(diff));
}

/**
 * Early-renewal default policy `append_to_existing_end`:
 * if the current membership has not ended, the new one starts exactly at its end;
 * otherwise it starts today (no retroactive days).
 */
export function renewalStart(now: DateTime, currentEndExclusive: DateTime | null, tz: string = GYM_TZ): DateTime {
  const today = now.setZone(tz).startOf('day');
  if (currentEndExclusive && currentEndExclusive > now) return currentEndExclusive.setZone(tz);
  return today;
}

export function todayISO(tz: string = GYM_TZ): string {
  return DateTime.now().setZone(tz).toISODate()!;
}
