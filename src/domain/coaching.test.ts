import { describe, expect, it } from 'vitest';
import { addWeight, adherence, cleanNutrition, cleanWorkout, gymDayIndex, setWorkoutDay, type WorkoutPlan } from './coaching';
import { WriteError } from './writes';

describe('workout plan cleaning', () => {
  it('keeps one entry per day, at most 12 exercises, bounded numbers', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `ex${i}`, sets: 99, reps: '10', rest: 9999, target: '' }));
    const p = cleanWorkout({ title: '  Plan  ', notes: '', days: [{ day: 2, focus: 'a', exercises: many }, { day: 2, focus: 'dup', exercises: [] }, { day: 9, focus: 'bad', exercises: [] }] });
    expect(p.title).toBe('Plan');
    expect(p.days).toHaveLength(1);
    expect(p.days[0].exercises).toHaveLength(12);
    expect(p.days[0].exercises[0]).toMatchObject({ sets: 20, rest: 600 });
  });
  it('drops empty meals', () => {
    expect(cleanNutrition({ title: 'x', notes: '', meals: [{ name: '', items: '' }, { name: 'غدا', items: 'فراخ' }] }).meals).toHaveLength(1);
  });
});

describe('member logs', () => {
  it('weight: one entry per day, sensible range', () => {
    const ops = addWeight({ memberId: 'm', entries: [{ date: '2026-10-14', kg: 85 }, { date: '2026-10-15', kg: 84 }], date: '2026-10-15', kg: 83.96 });
    expect(ops[0].data.entries).toEqual([{ date: '2026-10-14', kg: 85 }, { date: '2026-10-15', kg: 84 }]);
    expect(() => addWeight({ memberId: 'm', entries: [], date: '2026-10-15', kg: 5 })).toThrow(WriteError);
  });
  it('workout log keeps the latest 120 days', () => {
    const days = Object.fromEntries(Array.from({ length: 130 }, (_, i) => [`2026-01-${String((i % 28) + 1).padStart(2, '0')}-${i}`, [0]]));
    const ops = setWorkoutDay({ memberId: 'm', days, date: '2026-10-15', done: [2, 0, 2] });
    const kept = ops[0].data.days as Record<string, number[]>;
    expect(Object.keys(kept).length).toBeLessThanOrEqual(120);
    expect(kept['2026-10-15']).toEqual([0, 2]);
  });
});

describe('adherence', () => {
  it('share of planned days with something done', () => {
    const plan: WorkoutPlan = { title: 'p', notes: '', days: [{ day: 0, focus: '', exercises: [{ name: 'a', sets: 1, reps: '1', rest: 0, target: '' }] }] };
    const days = [
      { iso: 'd1', gymDay: 0 },
      { iso: 'd2', gymDay: 1 },
      { iso: 'd3', gymDay: 0 },
    ];
    expect(adherence(plan, { d1: [0] }, days)).toBe(50);
    expect(adherence(null, {}, days)).toBeNull();
  });
  it('Saturday is the first gym day', () => {
    expect(gymDayIndex(6)).toBe(0); // luxon Saturday
    expect(gymDayIndex(5)).toBe(6); // Friday
  });
});
