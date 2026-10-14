import type { PlanDuration } from './dates';

/** Amounts are integer piasters (1 EGP = 100). No floats in money. */
export type Piasters = number;

export interface Plan {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  duration: PlanDuration | null; // null = custom days typed by the admin
  visitQuota: number | null; // null = unlimited visits
  price: Piasters;
  featured?: boolean;
  active: boolean;
}

export const egp = (pounds: number): Piasters => Math.round(pounds * 100);

/** Default catalogue agreed in Phase 0. Prices are demo values for the preview only. */
export const DEFAULT_PLANS: Plan[] = [
  { id: 'p_day', code: 'DAY', nameAr: 'حصة يوم', nameEn: 'Day pass', duration: { unit: 'session', value: 1 }, visitQuota: 1, price: egp(100), active: true },
  { id: 'p_week', code: 'WEEK', nameAr: 'أسبوع', nameEn: '1 week', duration: { unit: 'week', value: 1 }, visitQuota: null, price: egp(400), active: true },
  { id: 'p_half', code: 'HALF', nameAr: 'نصف شهر', nameEn: 'Half month', duration: { unit: 'day', value: 15 }, visitQuota: null, price: egp(650), active: true },
  { id: 'p_m1', code: 'M1', nameAr: 'شهر', nameEn: '1 month', duration: { unit: 'month', value: 1 }, visitQuota: null, price: egp(1000), active: true },
  { id: 'p_m3', code: 'M3', nameAr: '3 شهور', nameEn: '3 months', duration: { unit: 'month', value: 3 }, visitQuota: null, price: egp(2700), featured: true, active: true },
  { id: 'p_m6', code: 'M6', nameAr: '6 شهور', nameEn: '6 months', duration: { unit: 'month', value: 6 }, visitQuota: null, price: egp(5000), active: true },
  { id: 'p_y1', code: 'Y1', nameAr: 'سنة', nameEn: '1 year', duration: { unit: 'year', value: 1 }, visitQuota: null, price: egp(9000), active: true },
  { id: 'p_custom', code: 'CUSTOM', nameAr: 'مدة مخصصة', nameEn: 'Custom', duration: null, visitQuota: null, price: 0, active: true },
];

export const CUSTOM_DAYS_MIN = 1;
export const CUSTOM_DAYS_MAX = 730;

export interface PriceQuote {
  base: Piasters;
  discount: Piasters;
  total: Piasters;
}

/** Client-side PREVIEW of a quote. The server recomputes and is the only source of truth. */
export function quote(base: Piasters, discountPercent = 0): PriceQuote {
  const pct = Math.min(100, Math.max(0, Math.round(discountPercent)));
  const discount = Math.floor((base * pct) / 100);
  return { base, discount, total: Math.max(0, base - discount) };
}

export function formatEGP(p: Piasters, lang: 'ar' | 'en'): string {
  const pounds = p / 100;
  const n = new Intl.NumberFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG', {
    maximumFractionDigits: pounds % 1 === 0 ? 0 : 2,
  }).format(pounds);
  return lang === 'ar' ? `${n} ج.م` : `EGP ${n}`;
}
