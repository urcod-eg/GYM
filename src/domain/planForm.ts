import type { DurationUnit } from './dates';
import { CUSTOM_DAYS_MAX, egp, type Plan } from './plans';

/** Editable form shape for a plan. Money is typed in pounds and stored in piasters. */
export interface PlanDraft {
  id: string | null;
  code: string;
  nameAr: string;
  nameEn: string;
  unit: DurationUnit | 'custom';
  value: number;
  unlimitedVisits: boolean;
  visits: number;
  pricePounds: number;
  featured: boolean;
  active: boolean;
}

export type PlanErrors = Partial<Record<'code' | 'nameAr' | 'nameEn' | 'value' | 'visits' | 'pricePounds', string>>;

export const EMPTY_DRAFT: PlanDraft = {
  id: null,
  code: '',
  nameAr: '',
  nameEn: '',
  unit: 'month',
  value: 1,
  unlimitedVisits: true,
  visits: 12,
  pricePounds: 0,
  featured: false,
  active: true,
};

export function draftFromPlan(p: Plan): PlanDraft {
  return {
    id: p.id,
    code: p.code,
    nameAr: p.nameAr,
    nameEn: p.nameEn,
    unit: p.duration ? p.duration.unit : 'custom',
    value: p.duration ? p.duration.value : 30,
    unlimitedVisits: p.visitQuota === null,
    visits: p.visitQuota ?? 12,
    pricePounds: p.price / 100,
    featured: !!p.featured,
    active: p.active,
  };
}

/** Error messages are keys resolved by the UI so both languages stay in one place. */
export function validatePlan(d: PlanDraft, existing: Plan[]): PlanErrors {
  const e: PlanErrors = {};
  const code = d.code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,12}$/.test(code)) e.code = 'plan.err.code';
  else if (existing.some((p) => p.code === code && p.id !== d.id)) e.code = 'plan.err.codeTaken';
  if (!d.nameAr.trim()) e.nameAr = 'reg.required';
  if (!d.nameEn.trim()) e.nameEn = 'reg.required';
  const maxValue = d.unit === 'day' ? CUSTOM_DAYS_MAX : d.unit === 'week' ? 104 : d.unit === 'month' ? 24 : d.unit === 'year' ? 5 : 1;
  if (d.unit !== 'custom' && d.unit !== 'session' && (!Number.isInteger(d.value) || d.value < 1 || d.value > maxValue)) e.value = 'plan.err.value';
  if (!d.unlimitedVisits && (!Number.isInteger(d.visits) || d.visits < 1 || d.visits > 1000)) e.visits = 'plan.err.visits';
  if (d.unit !== 'custom' && (!Number.isFinite(d.pricePounds) || d.pricePounds <= 0 || d.pricePounds > 1_000_000)) e.pricePounds = 'plan.err.price';
  return e;
}

export function planFromDraft(d: PlanDraft, newId: () => string): Plan {
  return {
    id: d.id ?? newId(),
    code: d.code.trim().toUpperCase(),
    nameAr: d.nameAr.trim(),
    nameEn: d.nameEn.trim(),
    duration: d.unit === 'custom' ? null : { unit: d.unit, value: d.unit === 'session' ? 1 : d.value },
    visitQuota: d.unit === 'session' ? 1 : d.unlimitedVisits ? null : d.visits,
    price: d.unit === 'custom' ? 0 : egp(d.pricePounds),
    featured: d.featured,
    active: d.active,
  };
}
