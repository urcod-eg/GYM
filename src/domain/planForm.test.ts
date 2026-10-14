import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS } from './plans';
import { EMPTY_DRAFT, draftFromPlan, planFromDraft, validatePlan } from './planForm';

const ok = { ...EMPTY_DRAFT, code: 'm2', nameAr: 'شهرين', nameEn: '2 months', unit: 'month' as const, value: 2, pricePounds: 1900 };

describe('plan form', () => {
  it('accepts a valid new plan and stores price in piasters', () => {
    expect(validatePlan(ok, DEFAULT_PLANS)).toEqual({});
    const p = planFromDraft(ok, () => 'p_new');
    expect(p).toMatchObject({ id: 'p_new', code: 'M2', price: 190000, duration: { unit: 'month', value: 2 }, visitQuota: null });
  });

  it('rejects a duplicate code but not the plan’s own code when editing', () => {
    expect(validatePlan({ ...ok, code: 'm1' }, DEFAULT_PLANS).code).toBe('plan.err.codeTaken');
    const edit = draftFromPlan(DEFAULT_PLANS.find((p) => p.code === 'M1')!);
    expect(validatePlan(edit, DEFAULT_PLANS)).toEqual({});
  });

  it('rejects empty names, zero price and out-of-range durations', () => {
    const e = validatePlan({ ...ok, nameAr: ' ', pricePounds: 0, value: 30 }, DEFAULT_PLANS);
    expect(e.nameAr).toBeDefined();
    expect(e.pricePounds).toBeDefined();
    expect(e.value).toBeDefined();
  });

  it('a day pass always has one visit and one day', () => {
    const p = planFromDraft({ ...ok, code: 'D2', unit: 'session', value: 9, unlimitedVisits: true }, () => 'x');
    expect(p.duration).toEqual({ unit: 'session', value: 1 });
    expect(p.visitQuota).toBe(1);
  });

  it('round-trips every default plan without validation errors', () => {
    for (const plan of DEFAULT_PLANS) expect(validatePlan(draftFromPlan(plan), DEFAULT_PLANS)).toEqual({});
  });
});
