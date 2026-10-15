/**
 * Phase 5 — coaches and programmes.
 * One document per member for each of: workout plan, nutrition plan, workout log, weight log
 * (cheap to read on the free plan). A coach writes only for members assigned to them; the admin
 * assigns coaches and can edit any plan; the member writes only their own logs.
 */
import { audit, refuse, SERVER_TIME, type WriteOp } from './writes';

export interface Exercise {
  name: string;
  sets: number;
  reps: string;
  rest: number; // seconds
  target: string; // e.g. "60 kg"
}
export interface PlanDay {
  day: number; // 0 = Saturday … 6 = Friday (gym week)
  focus: string;
  exercises: Exercise[];
}
export interface WorkoutPlan {
  title: string;
  days: PlanDay[];
  notes: string;
}
export interface Meal {
  name: string;
  items: string;
}
export interface NutritionPlan {
  title: string;
  meals: Meal[];
  notes: string;
}

export const MAX_DAYS = 7;
export const MAX_EXERCISES = 12;
export const MAX_MEALS = 8;
const cut = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);
const int = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));

/** Saturday-first index of a date in the gym week (luxon weekday: Mon = 1 … Sun = 7). */
export const gymDayIndex = (luxonWeekday: number) => (luxonWeekday + 1) % 7;

export function cleanWorkout(p: WorkoutPlan): WorkoutPlan {
  const seen = new Set<number>();
  const days = p.days
    .filter((d) => d.day >= 0 && d.day <= 6 && !seen.has(d.day) && seen.add(d.day))
    .slice(0, MAX_DAYS)
    .map((d) => ({
      day: d.day,
      focus: cut(d.focus, 40),
      exercises: d.exercises
        .filter((e) => e.name.trim())
        .slice(0, MAX_EXERCISES)
        .map((e) => ({ name: cut(e.name, 60), sets: int(e.sets, 1, 20), reps: cut(e.reps, 12) || '10', rest: int(e.rest, 0, 600), target: cut(e.target, 20) })),
    }))
    .sort((a, b) => a.day - b.day);
  return { title: cut(p.title, 60), days, notes: p.notes.trim().slice(0, 500) };
}

export function cleanNutrition(p: NutritionPlan): NutritionPlan {
  return {
    title: cut(p.title, 60),
    meals: p.meals.filter((m) => m.name.trim() || m.items.trim()).slice(0, MAX_MEALS).map((m) => ({ name: cut(m.name, 40), items: m.items.trim().slice(0, 300) })),
    notes: p.notes.trim().slice(0, 800),
  };
}

const plain = <T>(v: T) => JSON.parse(JSON.stringify(v));

export function setWorkoutPlan(i: { actorUid: string; memberId: string; coachId: string; plan: WorkoutPlan }): WriteOp[] {
  const p = cleanWorkout(i.plan);
  if (!p.title) refuse('invalid-input');
  return [{ type: 'set', path: `workoutPlans/${i.memberId}`, data: { memberId: i.memberId, coachId: i.coachId, title: p.title, days: plain(p.days), notes: p.notes, updatedAt: SERVER_TIME, by: i.actorUid } }];
}

export function setNutritionPlan(i: { actorUid: string; memberId: string; coachId: string; plan: NutritionPlan }): WriteOp[] {
  const p = cleanNutrition(i.plan);
  if (!p.title) refuse('invalid-input');
  return [{ type: 'set', path: `nutritionPlans/${i.memberId}`, data: { memberId: i.memberId, coachId: i.coachId, title: p.title, meals: plain(p.meals), notes: p.notes, updatedAt: SERVER_TIME, by: i.actorUid } }];
}

/** Admin assigns (or removes) a member's coach; the coach's name is kept on the member file for the member app. */
export function assignCoach(i: { actorUid: string; auditId: string; memberId: string; coach: { uid: string; name: string } | null }): WriteOp[] {
  return [
    { type: 'update', path: `members/${i.memberId}`, data: { assignedCoachId: i.coach?.uid ?? null, assignedCoachName: i.coach?.name ?? null, updatedAt: SERVER_TIME, lastAuditId: i.auditId } },
    audit(i.auditId, i.actorUid, 'member.coach', 'members', i.memberId, { coach: i.coach?.name ?? '' }),
  ];
}

// ---------------------------------------------------------------- member logs

export const MAX_LOG_DAYS = 120;
export const MAX_WEIGHTS = 200;

/** Workout log: date → indexes of the exercises done that day (older days dropped past 120). */
export function setWorkoutDay(i: { memberId: string; days: Record<string, number[]>; date: string; done: number[] }): WriteOp[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) refuse('invalid-date');
  const days = { ...i.days, [i.date]: [...new Set(i.done.filter((n) => Number.isInteger(n) && n >= 0 && n < 50))].sort((a, b) => a - b) };
  const keep = Object.keys(days).sort().slice(-MAX_LOG_DAYS);
  return [{ type: 'set', path: `workoutLogs/${i.memberId}`, data: { memberId: i.memberId, days: Object.fromEntries(keep.map((k) => [k, days[k]])), updatedAt: SERVER_TIME } }];
}

export interface WeightEntry {
  date: string;
  kg: number;
}

export function addWeight(i: { memberId: string; entries: WeightEntry[]; date: string; kg: number }): WriteOp[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) refuse('invalid-date');
  const kg = Math.round(i.kg * 10) / 10;
  if (!(kg >= 20 && kg <= 400)) refuse('invalid-weight');
  const all = [...i.entries.filter((e) => e.date !== i.date), { date: i.date, kg }].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_WEIGHTS);
  return [{ type: 'set', path: `bodyLogs/${i.memberId}`, data: { memberId: i.memberId, entries: plain(all), updatedAt: SERVER_TIME } }];
}

// ---------------------------------------------------------------- exercise library

export const MUSCLES = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core', 'cardio', 'full'] as const;
export type Muscle = (typeof MUSCLES)[number];

export interface LibraryExercise {
  nameAr: string;
  nameEn: string;
  muscle: Muscle;
  tips: string;
}

export function setLibraryExercise(i: { actorUid: string; id: string; doc: LibraryExercise }): WriteOp[] {
  const d = { nameAr: cut(i.doc.nameAr, 60), nameEn: cut(i.doc.nameEn, 60), muscle: i.doc.muscle, tips: i.doc.tips.trim().slice(0, 300) };
  if (!d.nameAr || !(MUSCLES as readonly string[]).includes(d.muscle) || !/^[A-Za-z0-9_-]{2,40}$/.test(i.id)) refuse('invalid-input');
  return [{ type: 'set', path: `exercises/${i.id}`, data: { ...d, updatedAt: SERVER_TIME, by: i.actorUid } }];
}

/** Share of planned days with at least one exercise done, over the last `days` days. */
export function adherence(plan: WorkoutPlan | null, log: Record<string, number[]>, isoDays: { iso: string; gymDay: number }[]): number | null {
  if (!plan || plan.days.length === 0) return null;
  const planned = isoDays.filter((d) => plan.days.some((p) => p.day === d.gymDay && p.exercises.length > 0));
  if (!planned.length) return null;
  const done = planned.filter((d) => (log[d.iso] ?? []).length > 0).length;
  return Math.round((done / planned.length) * 100);
}
