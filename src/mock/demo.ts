/**
 * DEMO DATA — Phase 1 preview only. Nothing here is real, nothing is saved, and no screen
 * that uses it talks to a server. Phase 2 replaces this module with Firestore reads.
 */
import { DateTime } from 'luxon';
import { GYM_TZ, computeEndExclusive, localStartOfDay } from '../domain/dates';
import { DEFAULT_PLANS, egp, type Piasters } from '../domain/plans';
import type { Balance } from '../domain/payments';

export type VipTier = 'STANDARD' | 'PLUS' | 'ELITE';

export interface DemoMember {
  id: string;
  code: string;
  name: string;
  phone: string; // E.164
  planId: string;
  startsAt: string; // ISO date, gym tz
  vip: VipTier;
  coachId: string | null;
  lastCheckIn: string | null; // ISO datetime
  blocked?: boolean;
}

export interface DemoCoach {
  id: string;
  name: string;
  specialty: string;
}

export interface DemoPayment {
  id: string;
  orderNo: string;
  memberId: string;
  amount: Piasters;
  method: 'CASH' | 'WALLET' | 'INSTAPAY' | 'BANK';
  reference: string | null;
  status: 'PROOF_SUBMITTED' | 'VERIFIED' | 'REJECTED';
  createdAt: string;
}

const now = DateTime.now().setZone(GYM_TZ);
const daysAgo = (n: number) => now.minus({ days: n }).toISODate()!;
const daysAhead = (n: number) => now.plus({ days: n }).toISODate()!;

export const DEMO_GYM = {
  nameAr: 'بلس جيم',
  nameEn: 'PULSE GYM',
  taglineAr: 'كل يوم أقوى من اللي قبله',
  taglineEn: 'Stronger every day',
  supportPhone: '+201000000000',
};

export const DEMO_COACHES: DemoCoach[] = [
  { id: 'c1', name: 'كابتن محمد سامي', specialty: 'تضخيم وقوة' },
  { id: 'c2', name: 'كابتن ندى فاروق', specialty: 'لياقة وتخسيس' },
  { id: 'c3', name: 'كابتن عمر حسن', specialty: 'تأهيل وحركة' },
];

export const DEMO_MEMBERS: DemoMember[] = [
  { id: 'm1', code: 'GYM-10025', name: 'أحمد علي', phone: '+201012345678', planId: 'p_m3', startsAt: daysAgo(67), vip: 'ELITE', coachId: 'c1', lastCheckIn: now.minus({ hours: 26 }).toISO() },
  { id: 'm2', code: 'GYM-10026', name: 'سارة محمود', phone: '+201112223344', planId: 'p_m1', startsAt: daysAgo(10), vip: 'STANDARD', coachId: 'c2', lastCheckIn: now.minus({ hours: 2 }).toISO() },
  { id: 'm3', code: 'GYM-10027', name: 'أحمد سمير', phone: '+201223334455', planId: 'p_m1', startsAt: daysAgo(40), vip: 'STANDARD', coachId: 'c1', lastCheckIn: now.minus({ days: 12 }).toISO() },
  { id: 'm4', code: 'GYM-10028', name: 'أحمد كمال', phone: '+201554445566', planId: 'p_m6', startsAt: daysAhead(6), vip: 'PLUS', coachId: 'c3', lastCheckIn: null },
  { id: 'm5', code: 'GYM-10029', name: 'منة الله إبراهيم', phone: '+201098887766', planId: 'p_y1', startsAt: daysAgo(120), vip: 'PLUS', coachId: 'c2', lastCheckIn: now.minus({ hours: 20 }).toISO() },
  { id: 'm6', code: 'GYM-10030', name: 'يوسف عادل', phone: '+201277766655', planId: 'p_week', startsAt: daysAgo(3), vip: 'STANDARD', coachId: null, lastCheckIn: now.minus({ hours: 5 }).toISO() },
  { id: 'm7', code: 'GYM-10031', name: 'مصطفى رضا', phone: '+201566655544', planId: 'p_half', startsAt: daysAgo(13), vip: 'STANDARD', coachId: 'c1', lastCheckIn: now.minus({ days: 1 }).toISO() },
  { id: 'm8', code: 'GYM-10032', name: 'هبة عبد الرحمن', phone: '+201033322211', planId: 'p_m3', startsAt: daysAgo(85), vip: 'ELITE', coachId: 'c2', lastCheckIn: now.minus({ days: 2 }).toISO() },
  { id: 'm9', code: 'GYM-10033', name: 'كريم نبيل', phone: '+201144455566', planId: 'p_m1', startsAt: daysAgo(29), vip: 'STANDARD', coachId: 'c3', lastCheckIn: now.minus({ days: 4 }).toISO() },
  { id: 'm10', code: 'GYM-10034', name: 'آية حسين', phone: '+201299988877', planId: 'p_day', startsAt: daysAgo(0), vip: 'STANDARD', coachId: null, lastCheckIn: null },
  { id: 'm11', code: 'GYM-10035', name: 'عمرو شريف', phone: '+201511122233', planId: 'p_m1', startsAt: daysAgo(18), vip: 'STANDARD', coachId: 'c1', lastCheckIn: now.minus({ days: 1 }).toISO(), blocked: true },
  { id: 'm12', code: 'GYM-10036', name: 'نورهان طارق', phone: '+201066677788', planId: 'p_m6', startsAt: daysAgo(170), vip: 'PLUS', coachId: 'c2', lastCheckIn: now.minus({ days: 3 }).toISO() },
];

/** Members who paid a deposit: one on time, one late and blocked, one late with admin permission. */
export interface DemoBalance extends Balance {
  memberId: string;
  paid: Piasters; // total paid so far (deposit)
  graceReason: string | null;
}

export const DEMO_BALANCES: DemoBalance[] = [
  { memberId: 'm2', paid: egp(500), remaining: egp(500), dueDate: daysAhead(2), graceUntil: null, graceReason: null },
  { memberId: 'm5', paid: egp(4500), remaining: egp(4500), dueDate: daysAgo(9), graceUntil: null, graceReason: null },
  { memberId: 'm12', paid: egp(3000), remaining: egp(2000), dueDate: daysAgo(6), graceUntil: daysAhead(2), graceReason: 'وعد بالسداد يوم الخميس' },
];

export const DEMO_PAYMENTS: DemoPayment[] = [
  { id: 'pay1', orderNo: 'O-2291', memberId: 'm4', amount: egp(5000), method: 'INSTAPAY', reference: '884210', status: 'PROOF_SUBMITTED', createdAt: now.minus({ minutes: 40 }).toISO()! },
  { id: 'pay2', orderNo: 'O-2292', memberId: 'm3', amount: egp(1000), method: 'WALLET', reference: '55-1932', status: 'PROOF_SUBMITTED', createdAt: now.minus({ hours: 3 }).toISO()! },
  { id: 'pay3', orderNo: 'O-2289', memberId: 'm2', amount: egp(1000), method: 'CASH', reference: null, status: 'VERIFIED', createdAt: now.minus({ days: 10 }).toISO()! },
  { id: 'pay4', orderNo: 'O-2293', memberId: 'm9', amount: egp(2700), method: 'BANK', reference: 'FT2610140091', status: 'PROOF_SUBMITTED', createdAt: now.minus({ hours: 6 }).toISO()! },
];

/** Demo revenue for the last 30 days, integer piasters. */
export const DEMO_REVENUE_30D: { date: string; amount: Piasters }[] = Array.from({ length: 30 }, (_, i) => {
  const date = now.minus({ days: 29 - i }).toISODate()!;
  const wave = 5200 + Math.round(2200 * Math.sin(i / 3.1) + 1400 * Math.cos(i / 1.7));
  const weekend = now.minus({ days: 29 - i }).weekday === 5 ? -2600 : 0; // Friday is quieter
  return { date, amount: egp(Math.max(1200, wave + weekend)) };
});

export const DEMO_PEAK_HOURS: { hour: number; visits: number }[] = [
  { hour: 7, visits: 18 }, { hour: 9, visits: 11 }, { hour: 11, visits: 7 }, { hour: 13, visits: 6 },
  { hour: 15, visits: 9 }, { hour: 17, visits: 24 }, { hour: 19, visits: 41 }, { hour: 21, visits: 33 }, { hour: 23, visits: 12 },
];

export function planById(id: string) {
  return DEFAULT_PLANS.find((p) => p.id === id)!;
}

export function memberDates(m: DemoMember) {
  const plan = planById(m.planId);
  const start = localStartOfDay(m.startsAt);
  const end = computeEndExclusive(start, plan.duration ?? { unit: 'day', value: 30 });
  return { start, end };
}

export const DEMO_WORKOUT = {
  titleAr: 'صدر وترايسبس',
  titleEn: 'Chest & triceps',
  exercises: [
    { nameAr: 'بنش برس بالبار', nameEn: 'Barbell bench press', sets: 4, reps: '8–10', rest: 90, target: '60 kg', done: true },
    { nameAr: 'دمبل مائل', nameEn: 'Incline dumbbell press', sets: 3, reps: '10–12', rest: 75, target: '22 kg', done: true },
    { nameAr: 'تفتيح كابل', nameEn: 'Cable fly', sets: 3, reps: '12–15', rest: 60, target: '15 kg', done: false },
    { nameAr: 'ديبس', nameEn: 'Dips', sets: 3, reps: 'Max', rest: 75, target: 'BW', done: false },
    { nameAr: 'ترايسبس حبل', nameEn: 'Rope pushdown', sets: 3, reps: '12', rest: 60, target: '25 kg', done: false },
  ],
};

export const DEMO_WEEK = [
  { dayAr: 'السبت', dayEn: 'Sat', dayEnFull: 'Saturday', focusAr: 'صدر وترايسبس', focusEn: 'Chest & triceps' },
  { dayAr: 'الأحد', dayEn: 'Sun', dayEnFull: 'Sunday', focusAr: 'ظهر وبايسبس', focusEn: 'Back & biceps' },
  { dayAr: 'الإثنين', dayEn: 'Mon', dayEnFull: 'Monday', focusAr: 'راحة نشطة', focusEn: 'Active rest' },
  { dayAr: 'الثلاثاء', dayEn: 'Tue', dayEnFull: 'Tuesday', focusAr: 'أرجل', focusEn: 'Legs' },
  { dayAr: 'الأربعاء', dayEn: 'Wed', dayEnFull: 'Wednesday', focusAr: 'أكتاف وبطن', focusEn: 'Shoulders & core' },
  { dayAr: 'الخميس', dayEn: 'Thu', dayEnFull: 'Thursday', focusAr: 'كارديو', focusEn: 'Cardio' },
  { dayAr: 'الجمعة', dayEn: 'Fri', dayEnFull: 'Friday', focusAr: 'راحة', focusEn: 'Rest' },
];

export const DEMO_WEIGHT: { date: string; kg: number }[] = [
  { date: daysAgo(63), kg: 88.4 }, { date: daysAgo(56), kg: 87.9 }, { date: daysAgo(49), kg: 87.1 },
  { date: daysAgo(42), kg: 86.8 }, { date: daysAgo(35), kg: 86.0 }, { date: daysAgo(28), kg: 85.6 },
  { date: daysAgo(21), kg: 85.1 }, { date: daysAgo(14), kg: 84.7 }, { date: daysAgo(7), kg: 84.2 }, { date: daysAgo(0), kg: 83.9 },
];
