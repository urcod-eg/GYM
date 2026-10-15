/**
 * Men / ladies setup of a gym (chosen by the admin in Settings):
 *   MIXED        one gym for everyone — nothing changes.
 *   SPLIT_HOURS  ladies' hours: at those hours only ladies may check in, at all other hours only men.
 *   SEPARATE     a separate ladies' section (own coaches): a member's coach must be of the same section.
 * The security rules check the same things (check-in: ladies' hours; coach assignment: same section).
 */
import { DateTime } from 'luxon';
import { GYM_TZ } from './dates';

export const GENDER_MODES = ['MIXED', 'SPLIT_HOURS', 'SEPARATE'] as const;
export type GenderMode = (typeof GENDER_MODES)[number];
export type Gender = 'M' | 'F';
export const GENDERS: Gender[] = ['M', 'F'];

/** Ladies' hours per weekday: '0' = Sunday … '6' = Saturday → the starting hours (0–23) that belong to ladies. */
export type LadiesHours = Record<string, number[]>;

export const DAY_KEYS = ['6', '0', '1', '2', '3', '4', '5'] as const; // shown from Saturday (Egyptian week)

export function validLadiesHours(h: unknown): h is LadiesHours {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return false;
  return Object.entries(h as Record<string, unknown>).every(
    ([k, v]) => /^[0-6]$/.test(k) && Array.isArray(v) && v.length <= 24 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 23) && new Set(v).size === v.length,
  );
}

/** Whose hour it is at `now` (gym time). null = everyone (no ladies' hours in this mode). */
export function sectionAt(mode: GenderMode, hours: LadiesHours, now: Date): Gender | null {
  if (mode !== 'SPLIT_HOURS') return null;
  const t = DateTime.fromJSDate(now).setZone(GYM_TZ);
  return (hours[String(t.weekday % 7)] ?? []).includes(t.hour) ? 'F' : 'M';
}

export type SectionRefusal = 'NO_GENDER' | 'WRONG_HOURS';

/** May this member check in now? (null = yes) */
export function sectionRefusal(mode: GenderMode, hours: LadiesHours, gender: Gender | null | undefined, now: Date): SectionRefusal | null {
  const s = sectionAt(mode, hours, now);
  if (!s) return null;
  if (gender !== 'M' && gender !== 'F') return 'NO_GENDER';
  return gender === s ? null : 'WRONG_HOURS';
}

/** Hours from `from` up to (not including) `to`, e.g. 10 → 14 = [10, 11, 12, 13]. */
export function hoursBetween(from: number, to: number): number[] {
  const out: number[] = [];
  for (let h = from; h < to && h <= 23; h++) out.push(h);
  return out;
}

/** [10,11,12,13,18,19] → [[10,14],[18,20]] (end exclusive). */
export function hourRanges(hours: number[]): [number, number][] {
  const s = [...hours].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const h of s) {
    const last = out[out.length - 1];
    if (last && last[1] === h) last[1] = h + 1;
    else out.push([h, h + 1]);
  }
  return out;
}

/** A coach may take a member: any coach in a mixed gym; the same section when the ladies' section is separate. */
export function coachAllowed(mode: GenderMode, member: Gender | null | undefined, coach: Gender | null | undefined): boolean {
  if (mode !== 'SEPARATE') return true;
  return !!member && member === coach;
}
