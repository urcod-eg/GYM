import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useApp, useServerAction } from '../../app/AppContext';
import { LineChart } from '../../components/Charts';
import { Icon } from '../../components/Icon';
import { Shell, type NavItem } from '../../components/Shell';
import { IllustrativeCode, Modal, Notice, PromoCard, VipBadge } from '../../components/ui';
import { GYM_TZ, daysRemaining, lastUsableDay, phaseAt, type MembershipPhase } from '../../domain/dates';
import { DEMO_BALANCES, DEMO_COACHES, DEMO_MEMBERS, DEMO_WEEK, DEMO_WEIGHT, DEMO_WORKOUT, memberDates, planById, type VipTier } from '../../mock/demo';
import { demoMode } from '../../firebase/client';
import { useSession } from '../../app/SessionContext';
import { useGym } from '../../app/GymContext';
import { liveRow } from '../staff/shared';
import { bannerFigure, useBanners } from '../staff/AdminContent';
import { visibleBanners } from '../../domain/content';
import { balanceStatus, type Balance } from '../../domain/payments';
import { gymDayEndingAt } from '../../domain/sales';
import { qrText } from '../../domain/attendance';
import { writeMyCheckinCode } from '../../firebase/data';
import { useErrorText } from '../../app/useErrorText';
import { DAY_KEYS, DEMO_NUTRITION, DEMO_PLAN, useMemberDoc } from '../staff/Coaching';
import { gymDayIndex, type NutritionPlan, type WeightEntry, type WorkoutPlan } from '../../domain/coaching';
import { readMyCheckins, readMyPayments, saveWeight, saveWorkoutDay, watchVipTiers, type PaymentRow } from '../../firebase/data';
import type { VipTierDoc } from '../../domain/content';
import type { StringKey } from '../../i18n/strings';
import { formatEGP } from '../../domain/plans';

/* ---------- preview state: which demo member the member screens show ---------- */
const PRESETS = [
  { id: 'm1', key: 'status.ACTIVE' as const, vip: true },
  { id: 'm4', key: 'status.SCHEDULED' as const, vip: false },
  { id: 'm3', key: 'status.EXPIRED' as const, vip: false },
];

interface ViewMember {
  id: string;
  name: string;
  code: string;
  vip: VipTier;
  coachName: string | null;
  planAr: string;
  planEn: string;
}
interface MemberView {
  m: ViewMember;
  /** NONE: no paid membership yet (or the only one was cancelled). */
  phase: MembershipPhase | 'NONE';
  start: DateTime;
  end: DateTime;
  balance: Balance | null;
  next: { planAr: string; planEn: string; start: DateTime } | null;
  /** A limited plan's visits (null = unlimited). */
  visits: { quota: number; used: number } | null;
  setId: (id: string) => void;
}
const MemberCtx = createContext<MemberView | null>(null);
const useMember = () => useContext(MemberCtx)!;

function MemberProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState('m1');
  const session = useSession();
  const live = session.member;
  const value = useMemo<MemberView>(() => {
    if (!demoMode) {
      const now = DateTime.now().setZone(GYM_TZ);
      if (!live) return { m: { id: '', name: session.profile?.displayName ?? '', code: '', vip: 'STANDARD', coachName: null, planAr: '', planEn: '' }, phase: 'NONE', start: now, end: now, balance: null, next: null, visits: null, setId };
      const r = liveRow(live);
      const b = live.balance;
      return {
        m: { id: live.id, name: live.fullName, code: live.memberCode, vip: r.m.vip, coachName: live.assignedCoachName ?? null, planAr: r.planAr, planEn: r.planEn },
        phase: r.phase,
        start: r.start ?? now,
        end: r.end ?? now,
        balance: b && b.remaining > 0 ? { remaining: b.remaining, dueDate: gymDayEndingAt(b.dueAt), graceUntil: b.graceUntil ? gymDayEndingAt(b.graceUntil) : null } : null,
        next: r.next,
        visits: live.membership && live.membership.visitQuota != null && !r.next && r.planAr === live.membership.planNameAr ? { quota: live.membership.visitQuota, used: live.membership.visitsUsed ?? 0 } : null,
        setId,
      };
    }
    const m = DEMO_MEMBERS.find((x) => x.id === id)!;
    const { start, end } = memberDates(m);
    const plan = planById(m.planId);
    const b = DEMO_BALANCES.find((x) => x.memberId === m.id) ?? null;
    return {
      m: { id: m.id, name: m.name, code: m.code, vip: m.vip, coachName: DEMO_COACHES.find((c) => c.id === m.coachId)?.name ?? null, planAr: plan.nameAr, planEn: plan.nameEn },
      start,
      end,
      phase: phaseAt(DateTime.now().setZone(GYM_TZ), start, end),
      balance: b,
      next: null,
      visits: plan.visitQuota != null ? { quota: plan.visitQuota, used: 0 } : null,
      setId,
    };
  }, [id, live, session.profile?.displayName]);
  return <MemberCtx.Provider value={value}>{children}</MemberCtx.Provider>;
}

function PreviewSwitch() {
  const { t } = useApp();
  const { m, setId } = useMember();
  return (
    <div className="chips" role="group" aria-label={t('app.previewAs')} style={{ marginBottom: 4 }}>
      <span className="muted xs" style={{ alignSelf: 'center' }}>{t('app.previewAs')}:</span>
      {PRESETS.map((p) => (
        <button key={p.id} className="chip" style={{ minHeight: 32, fontSize: 12 }} aria-pressed={m.id === p.id} onClick={() => setId(p.id)}>
          {t(p.key)}
          {p.vip ? ' · VIP' : ''}
        </button>
      ))}
    </div>
  );
}

/* ---------- shell ---------- */
export function MemberArea() {
  const { t } = useApp();
  const nav: NavItem[] = [
    { to: '/member', label: t('member.nav.home'), icon: 'home', end: true },
    { to: '/member/workout', label: t('member.nav.workout'), icon: 'dumbbell' },
    { to: '/member/card', label: t('member.nav.card'), icon: 'qr' },
    { to: '/member/progress', label: t('member.nav.progress'), icon: 'chart' },
    { to: '/member/more', label: t('member.nav.more'), icon: 'menu' },
  ];
  return (
    <MemberProvider>
      <Shell bottomNav={nav} defaultTheme="dark" width="narrow" sampleNote="app.sampleScreenMember" livePaths={['/member']}>
        {demoMode && <PreviewSwitch />}
        <Routes>
          <Route index element={<MemberHome />} />
          <Route path="workout" element={<Gate><Workout /></Gate>} />
          <Route path="card" element={<CardPage />} />
          <Route path="progress" element={<Progress />} />
          <Route path="more" element={<More />} />
          <Route path="*" element={<Navigate to="/member" replace />} />
        </Routes>
      </Shell>
    </MemberProvider>
  );
}

/** Paid services are locked when not ACTIVE. In production the SERVER refuses them too. */
function Gate({ children }: { children: ReactNode }) {
  const { phase } = useMember();
  if (phase === 'ACTIVE') return <>{children}</>;
  if (phase === 'NONE') return <NoMembershipView />;
  return phase === 'EXPIRED' ? <ExpiredView /> : <ScheduledView />;
}

function NoMembershipView() {
  const { t } = useApp();
  const gym = useGym();
  return (
    <div className="stack">
      <section className="card stack">
        <div className="row">
          <Icon name="card" width={28} height={28} style={{ color: 'var(--primary-text)' }} />
          <h1 className="section-title">{t('status.NONE')}</h1>
        </div>
        <p>{t('member.noMembership')}</p>
        {gym.supportPhone && (
          <a className="btn btn-secondary btn-block" href={`https://wa.me/${gym.supportPhone.replace('+', '')}`} target="_blank" rel="noreferrer">
            <Icon name="whatsapp" />
            {t('member.contactAdmin')}
          </a>
        )}
      </section>
      <Banners />
    </div>
  );
}

/** The unpaid remainder, on the member's home (entry stops when it is late). */
function BalanceNotice() {
  const { t, lang, fmtDate } = useApp();
  const { balance } = useMember();
  if (!balance) return null;
  const st = balanceStatus(DateTime.now(), balance);
  if (st === 'NONE') return null;
  const amount = formatEGP(balance.remaining, lang);
  return st === 'OVERDUE_BLOCKED' ? (
    <Notice tone="danger" icon="wallet">{t('member.balanceLate', { amount, date: fmtDate(balance.dueDate) })}</Notice>
  ) : (
    <Notice tone="warning" icon="wallet">{t('member.balanceDue', { amount, date: fmtDate(balance.dueDate) })}</Notice>
  );
}

/* ---------- home ---------- */
function MemberHome() {
  const { phase } = useMember();
  if (phase === 'NONE') return <NoMembershipView />;
  if (phase === 'EXPIRED') return <ExpiredView />;
  if (phase === 'SCHEDULED') return <ScheduledView />;
  return <ActiveHome />;
}

function MembershipCard() {
  const { t, lang, fmtDate } = useApp();
  const { m, start, end } = useMember();
  const now = DateTime.now().setZone(GYM_TZ);
  const total = Math.max(1, end.diff(start, 'days').days);
  const left = daysRemaining(now, end);
  const pct = Math.min(100, Math.max(0, (left / total) * 100));
  const vip = m.vip !== 'STANDARD';
  return (
    <section className={`member-card ${vip ? 'vip' : ''}`} aria-label={t('member.myCard')}>
      <div className="stripe" />
      <div className="stack-sm">
        <div className="row-between">
          <span className="muted small">{t('member.myCard')}</span>
          {vip && <VipBadge tier={m.vip} />}
        </div>
        <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
          <strong style={{ fontSize: '1.5rem' }}>{lang === 'ar' ? m.planAr : m.planEn}</strong>
          <span className="muted small ltr">{m.code}</span>
        </div>
        <div className="row-between" style={{ marginTop: 8 }}>
          <strong className="num">{t('member.daysLeft', { n: left })}</strong>
          <span className="muted small">{t('member.lastDay', { date: fmtDate(lastUsableDay(end), 'short') })}</span>
        </div>
        <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="muted small" style={{ marginTop: 6 }}>
          {t('member.coach')}: {m.coachName ?? t('member.noCoach')}
        </div>
      </div>
    </section>
  );
}

function Banners() {
  const { lang } = useApp();
  const { m } = useMember();
  const live = useBanners(false);
  if (!demoMode) {
    const shown = visibleBanners(live ?? [], m.vip !== 'STANDARD', new Date());
    if (!shown.length) return null;
    return (
      <div className="banner-rail" role="region" aria-label={lang === 'ar' ? 'العروض والإعلانات' : 'Offers and announcements'}>
        {shown.map((b) => (
          <PromoCard key={b.id} variant={0} figure={bannerFigure(b)} tag={b.tag} tagTone={b.tone} title={b.title} body={b.body} />
        ))}
      </div>
    );
  }
  const items = [
    { v: 1, k: lang === 'ar' ? 'عرض' : 'Offer', title: lang === 'ar' ? 'جدّد 3 شهور ووفّر 10%' : 'Renew 3 months, save 10%', body: lang === 'ar' ? 'حتى نهاية الشهر' : 'Until the end of the month' },
    { v: 2, k: lang === 'ar' ? 'مواعيد' : 'Hours', title: lang === 'ar' ? 'الجيم مفتوح 24 ساعة يوم الخميس' : 'Open 24 hours on Thursday', body: lang === 'ar' ? 'للأسبوع ده بس' : 'This week only' },
    ...(m.vip !== 'STANDARD' ? [{ v: 3, k: 'VIP', title: lang === 'ar' ? 'جلسة قياسات مجانية لأعضاء VIP' : 'Free body assessment for VIP members', body: lang === 'ar' ? 'احجز من الاستقبال' : 'Book at reception' }] : []),
  ];
  return (
    <div className="banner-rail" role="region" aria-label={lang === 'ar' ? 'العروض والإعلانات' : 'Offers and announcements'}>
      {items.map((b) => (
        <PromoCard key={b.title} variant={b.v} tag={b.k} tagTone={b.v === 3 ? 'vip' : 'primary'} title={b.title} body={b.body} />
      ))}
    </div>
  );
}

function ActiveHome() {
  const { t, lang, fmtDate } = useApp();
  const { m, end, next } = useMember();
  const left = daysRemaining(DateTime.now(), end);
  const first = m.name.split(' ')[0];
  const w = useTodayWorkout();
  const done = w.done.length;
  const total = w.exercises.length;
  return (
    <div className="stack">
      <h1 className="page-title">{t('member.hello', { name: first })}</h1>
      <BalanceNotice />
      {next ? (
        <Notice icon="calendar">{t('member.nextPeriod', { plan: lang === 'ar' ? next.planAr : next.planEn, date: fmtDate(next.start) })}</Notice>
      ) : (
        left <= 7 && (
          <Notice tone="warning" icon="clock">
            {t('member.expiryReminder', { n: left })}
          </Notice>
        )
      )}
      <Banners />
      <MembershipCard />
      <Link to="/member/card" className="btn btn-primary btn-lg btn-block">
        <Icon name="qr" />
        {t('member.showQr')}
      </Link>
      <section className="card stack-sm">
        <div className="row-between">
          <h2 className="card-title">{t('member.todayWorkout')}</h2>
          <span className="muted small num">
            {done}/{total}
          </span>
        </div>
        <p className="bold" style={{ fontSize: '1.125rem' }}>{w.focus || w.title || (w.plan === null ? t('member.noPlan') : t('member.restDay'))}</p>
        <div className="progress light">
          <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
        <Link to="/member/workout" className="btn btn-secondary">
          <Icon name="dumbbell" />
          {t('member.startWorkout')}
        </Link>
      </section>
      <section className="card stack-sm">
        <h2 className="card-title">{t('member.weekCommit')}</h2>
        <WeekStrip />
      </section>
    </div>
  );
}

function WeekStrip() {
  const { lang } = useApp();
  // Saturday-first week (Egypt); luxon weekday: Mon=1 … Sun=7
  const todayIdx = (DateTime.now().setZone(GYM_TZ).weekday + 1) % 7;
  return (
    <ul className="week">
      {DEMO_WEEK.map((d, i) => {
        const state = i < todayIdx ? 'done' : i === todayIdx ? 'today' : 'next';
        const label = lang === 'ar' ? { done: 'تم', today: 'اليوم', next: 'قادم' }[state] : { done: 'Done', today: 'Today', next: 'Upcoming' }[state];
        return (
          <li key={d.dayEn} className={`week-day ${state}`}>
            <span className="week-name">{lang === 'ar' ? d.dayAr : d.dayEnFull}</span>
            <span className="week-state">
              {state === 'done' && <Icon name="check" width={14} height={14} />}
              {label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ScheduledView() {
  const { t, fmtDate } = useApp();
  const { start } = useMember();
  return (
    <div className="stack">
      <PromoCard variant={2} tag={t('status.SCHEDULED')} tagTone="info" title={t('member.scheduledTitle')} body={t('member.scheduledBody', { date: fmtDate(start) })} as="h1" large />
      <Banners />
      <section className="card row">
        <Icon name="calendar" width={28} height={28} style={{ color: 'var(--info)' }} />
        <div className="grow">
          <div className="muted small">{t('cashier.starts')}</div>
          <strong>{fmtDate(start)}</strong>
        </div>
      </section>
    </div>
  );
}

function ExpiredView() {
  const { t, lang, fmtDate } = useApp();
  const { end } = useMember();
  const server = useServerAction();
  const gym = useGym();
  const support = gym.supportPhone ? `https://wa.me/${gym.supportPhone.replace('+', '')}` : 'https://wa.me/201000000000';
  return (
    <div className="stack">
      <section className="card stack" style={{ borderColor: 'var(--danger)' }}>
        <div className="row">
          <Icon name="alert" width={28} height={28} style={{ color: 'var(--danger)' }} />
          <h1 className="section-title">{t('member.expiredTitle')}</h1>
        </div>
        <p>{t('member.expiredBody', { date: fmtDate(lastUsableDay(end)) })}</p>
        {demoMode ? (
          <button className="btn btn-primary btn-lg btn-block" onClick={server}>
            <Icon name="refresh" />
            {t('member.renewRequest')}
          </button>
        ) : (
          <a className="btn btn-primary btn-lg btn-block" href={`${support}?text=${encodeURIComponent(t('member.renewText'))}`} target="_blank" rel="noreferrer">
            <Icon name="refresh" />
            {t('member.renewRequest')}
          </a>
        )}
        <a className="btn btn-secondary btn-block" href={support} target="_blank" rel="noreferrer">
          <Icon name="whatsapp" />
          {t('member.contactAdmin')}
        </a>
      </section>
      <h2 className="section-title">{t('member.offers')}</h2>
      <PromoCard
        variant={0}
        tag={lang === 'ar' ? 'عرض العودة' : 'Welcome back'}
        title={lang === 'ar' ? '3 شهور بخصم 15%' : '3 months at 15% off'}
        body={lang === 'ar' ? 'عرض العودة لفترة محدودة' : 'Welcome-back offer for a limited time'}
      />
      <button className="list-item card" onClick={server}>
        <Icon name="receipt" width={22} height={22} />
        <span className="grow">{t('member.invoices')}</span>
        <Icon name="chevron" width={20} height={20} className="flip-rtl" />
      </button>
    </div>
  );
}

/* ---------- workout ---------- */
interface TodayWorkout {
  title: string;
  focus: string;
  exercises: { name: string; sets: number; reps: string; rest: number; target: string }[];
  done: number[];
  toggle: (i: number) => void;
  plan: WorkoutPlan | null | undefined;
  food: NutritionPlan | null | undefined;
}

/** Today's exercises from the coach's plan (sample plan in the preview) and what is ticked off. */
function useTodayWorkout(): TodayWorkout {
  const { lang } = useApp();
  const { m } = useMember();
  const errText = useErrorText();
  const { toast } = useApp();
  const plan = useMemberDoc<WorkoutPlan>('workoutPlans', m.id || null, null);
  const food = useMemberDoc<NutritionPlan>('nutritionPlans', m.id || null, DEMO_NUTRITION);
  const log = useMemberDoc<{ days: Record<string, number[]> }>('workoutLogs', m.id || null, null);
  const [demoDone, setDemoDone] = useState(() => DEMO_WORKOUT.exercises.map((e, i) => (e.done ? i : -1)).filter((i) => i >= 0));
  const today = DateTime.now().setZone(GYM_TZ);
  const iso = today.toISODate()!;
  if (demoMode) {
    return {
      title: lang === 'ar' ? DEMO_WORKOUT.titleAr : DEMO_WORKOUT.titleEn,
      focus: '',
      exercises: DEMO_WORKOUT.exercises.map((e) => ({ name: lang === 'ar' ? e.nameAr : e.nameEn, sets: e.sets, reps: e.reps, rest: e.rest, target: e.target })),
      done: demoDone,
      toggle: (i) => setDemoDone((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i])),
      plan: DEMO_PLAN,
      food,
    };
  }
  const day = plan?.days.find((d) => d.day === gymDayIndex(today.weekday));
  const done = log?.days?.[iso] ?? [];
  return {
    title: plan?.title ?? '',
    focus: day?.focus ?? '',
    exercises: day?.exercises ?? [],
    done,
    toggle: (i) => {
      const next = done.includes(i) ? done.filter((x) => x !== i) : [...done, i];
      saveWorkoutDay(m.id, log?.days ?? {}, iso, next).catch((e) => toast(errText(e), 'danger'));
    },
    plan,
    food,
  };
}

function Workout() {
  const { t, lang } = useApp();
  const w = useTodayWorkout();
  return (
    <div className="stack">
      <h1 className="page-title">{w.focus || w.title || t('member.todayWorkout')}</h1>
      {w.plan === null && !demoMode ? (
        <Notice icon="info">{t('member.noPlan')}</Notice>
      ) : w.exercises.length === 0 ? (
        <Notice icon="info">{t('member.restDay')}</Notice>
      ) : (
        <section className="card">
          {w.exercises.map((e, i) => (
            <div className="exercise" key={i}>
              <button className="check" role="checkbox" aria-checked={w.done.includes(i)} aria-label={e.name} onClick={() => w.toggle(i)}>
                <Icon name="check" />
              </button>
              <div>
                <div className="bold">{e.name}</div>
                <div className="muted small num">
                  {e.sets} {t('member.sets')} × {e.reps} {t('member.reps')} · {t('member.rest')} {e.rest}s
                </div>
              </div>
              {e.target && <span className="badge badge-neutral no-dot ltr">{e.target}</span>}
            </div>
          ))}
        </section>
      )}
      {w.plan && w.plan.days.length > 0 && (
        <section className="card stack-sm">
          <h2 className="card-title">{t('member.weekPlan')}</h2>
          <div className="list">
            {w.plan.days.map((d) => (
              <div key={d.day} className="list-item" style={{ minHeight: 44 }}>
                <strong style={{ minWidth: 104 }}>{t(DAY_KEYS[d.day])}</strong>
                <span className="muted">{d.focus}</span>
              </div>
            ))}
          </div>
          {w.plan.notes && <p className="small muted">{w.plan.notes}</p>}
        </section>
      )}
      <section className="card stack-sm">
        <h2 className="card-title">{t('member.nutrition')}{w.food ? `: ${w.food.title}` : ''}</h2>
        {w.food ? (
          <>
            {w.food.meals.map((m, i) => (
              <div key={i} className="stack-sm" style={{ gap: 2 }}>
                <strong>{m.name}</strong>
                <span className="small" style={{ whiteSpace: 'pre-line' }}>{m.items}</span>
              </div>
            ))}
            {w.food.notes && <p className="small muted">{w.food.notes}</p>}
          </>
        ) : (
          <p className="muted small">{lang === 'ar' ? t('member.nutritionBody') : t('member.nutritionBody')}</p>
        )}
      </section>
    </div>
  );
}

/* ---------- entry code ---------- */
function CardPage() {
  const { t, lang } = useApp();
  const { m, phase, visits } = useMember();
  const errText = useErrorText();
  const [seed, setSeed] = useState(1);
  const [left, setLeft] = useState(45);
  const [svg, setSvg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Live: a fresh single-use code every 45 s (the server accepts it for 90 s).
  useEffect(() => {
    if (phase !== 'ACTIVE') return;
    let alive = true;
    const refresh = async () => {
      try {
        const QR = (await import('qrcode')).default;
        const text = demoMode ? qrText(m.id || 'demo', 'DEMO2345') : qrText(m.id, await writeMyCheckinCode(m.id));
        const s = await QR.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
        if (alive) {
          setSvg(s);
          setErr(null);
        }
      } catch (e) {
        if (alive) setErr(errText(e));
      }
    };
    refresh();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, seed, m.id]);

  useEffect(() => {
    if (phase !== 'ACTIVE') return;
    const id = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          setSeed((x) => x + 1);
          return 45;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  if (phase !== 'ACTIVE') return <Gate>{null}</Gate>;
  return (
    <div className="stack" style={{ textAlign: 'center' }}>
      <h1 className="page-title">{t('member.qrTitle')}</h1>
      <div className="row" style={{ justifyContent: 'center' }}>
        <strong>{m.name}</strong>
        <VipBadge tier={m.vip} label={false} />
      </div>
      {svg ? (
        <div className="qr-live" aria-live="polite" role="img" aria-label={t('member.qrTitle')} dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="qr-box" aria-busy="true">
          <IllustrativeCode seed={seed} />
        </div>
      )}
      <div className="row" style={{ justifyContent: 'center' }}>
        <div className="ring" style={{ ['--p' as string]: (left / 45) * 100 }}>
          <span className="num">{left}</span>
        </div>
        <span className="muted small">{t('member.qrRefresh', { s: left })}</span>
      </div>
      <p className="muted small">{t('member.qrHint')}</p>
      {err && <Notice tone="danger" icon="alert">{err}</Notice>}
      {demoMode && <Notice tone="warning" icon="info">{t('member.qrDemoLive')}</Notice>}
      <div className="card row-between" style={{ textAlign: 'start' }}>
        <span>{lang === 'ar' ? m.planAr : m.planEn}</span>
        <span className="muted small">
          {t('member.visitsLeft')}: {visits ? Math.max(0, visits.quota - visits.used) : t('member.unlimited')}
        </span>
      </div>
    </div>
  );
}

/* ---------- progress ---------- */
function Progress() {
  const { t, fmtDate, fmtNum, toast } = useApp();
  const { m } = useMember();
  const errText = useErrorText();
  const body = useMemberDoc<{ entries: WeightEntry[] }>('bodyLogs', m.id || null, { entries: DEMO_WEIGHT.map((w) => ({ date: w.date, kg: w.kg })) });
  const [visits, setVisits] = useState<number | null>(demoMode ? 14 : null);
  const [kg, setKg] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (demoMode || !m.id) return;
    const start = DateTime.now().setZone(GYM_TZ).startOf('month').toJSDate();
    readMyCheckins(m.id)
      .then((ds) => setVisits(ds.filter((d) => d >= start).length))
      .catch(() => setVisits(null));
  }, [m.id]);
  const entries = body?.entries ?? [];
  const first = entries[0]?.kg;
  const last = entries.at(-1)?.kg;
  const add = async () => {
    const v = Number(kg);
    if (!(v >= 20 && v <= 400)) return toast(t('member.weightErr'), 'danger');
    if (demoMode) return toast(t('app.demoNoSave'));
    setBusy(true);
    try {
      await saveWeight(m.id, entries, DateTime.now().setZone(GYM_TZ).toISODate()!, v);
      setKg('');
      toast(t('coach.saved'), 'success');
    } catch (e) {
      toast(errText(e), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <h1 className="page-title">{t('member.progress')}</h1>
      <div className="grid-2">
        <div className="card stat">
          <span className="label">{t('member.weight')}</span>
          <span className="value">{last ? `${fmtNum(last)} kg` : '—'}</span>
          {first && last && entries.length > 1 && <span className="delta up">{fmtNum(Math.round((last - first) * 10) / 10)} kg</span>}
        </div>
        <div className="card stat">
          <span className="label">{t('member.attendance')}</span>
          <span className="value">{visits === null ? '—' : fmtNum(visits)}</span>
          <span className="muted small">{t('member.visitsMonth')}</span>
        </div>
      </div>
      <section className="card stack-sm">
        <h2 className="card-title">{t('member.addWeight')}</h2>
        <div className="row">
          <input className="input num grow" type="number" inputMode="decimal" min={20} max={400} step="0.1" placeholder="kg" value={kg} onChange={(e) => setKg(e.target.value === '' ? '' : Number(e.target.value))} aria-label={t('member.weight')} />
          <button className="btn btn-primary" disabled={busy || kg === ''} aria-busy={busy} onClick={add}>{t('app.save')}</button>
        </div>
      </section>
      {entries.length > 1 && (
        <section className="card stack-sm">
          <h2 className="card-title">{t('member.weight')} (kg)</h2>
          <LineChart
            ariaLabel={`${t('member.weight')}: ${first} → ${last} kg`}
            points={entries.slice(-30).map((w) => ({ label: fmtDate(w.date, 'short'), value: w.kg }))}
            formatValue={(n) => n.toFixed(0)}
            height={180}
          />
        </section>
      )}
    </div>
  );
}

/* ---------- more ---------- */
function More() {
  const { t } = useApp();
  const session = useSession();
  const navigate = useNavigate();
  const server = useServerAction();
  const gym = useGym();
  const { m } = useMember();
  const [open, setOpen] = useState<'invoices' | 'vip' | null>(null);
  const support = gym.supportPhone ? `https://wa.me/${gym.supportPhone.replace('+', '')}` : null;
  const items: { icon: Parameters<typeof Icon>[0]['name']; label: string; href?: string; ext?: string; on?: () => void }[] = [
    ...(demoMode ? [{ icon: 'bell' as const, label: t('member.notifications'), on: server }] : []),
    ...(m.vip !== 'STANDARD' ? [{ icon: 'crown' as const, label: t('member.vipPerks'), on: () => setOpen('vip') }] : []),
    { icon: 'receipt', label: t('member.invoices'), on: () => setOpen('invoices') },
    ...(support ? [{ icon: 'whatsapp' as const, label: t('member.help'), ext: support }] : demoMode ? [{ icon: 'whatsapp' as const, label: t('member.help'), on: server }] : []),
    { icon: 'info', label: t('login.about'), href: '/about' },
  ];
  return (
    <div className="stack">
      <h1 className="page-title">{t('member.nav.more')}</h1>
      <section className="card" style={{ padding: 8 }}>
        {items.map((it) =>
          it.href ? (
            <Link key={it.label} className="list-item" to={it.href} style={{ textDecoration: 'none', color: 'inherit', padding: '0 8px' }}>
              <Icon name={it.icon} width={22} height={22} />
              <span className="grow">{it.label}</span>
            </Link>
          ) : it.ext ? (
            <a key={it.label} className="list-item" href={it.ext} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: 'inherit', padding: '0 8px' }}>
              <Icon name={it.icon} width={22} height={22} />
              <span className="grow">{it.label}</span>
            </a>
          ) : (
            <button key={it.label} className="list-item" onClick={it.on}>
              <Icon name={it.icon} width={22} height={22} />
              <span className="grow">{it.label}</span>
            </button>
          ),
        )}
      </section>
      <p className="muted xs">{t('support.body')}</p>
      <button className="btn btn-ghost" onClick={() => session.signOut().then(() => navigate('/', { replace: true }))}>
        <Icon name="logout" />
        {t('app.logout')}
      </button>
      {open === 'invoices' && <MyInvoices onClose={() => setOpen(null)} />}
      {open === 'vip' && <MyVip onClose={() => setOpen(null)} />}
    </div>
  );
}

function MyInvoices({ onClose }: { onClose: () => void }) {
  const { t, lang, fmtDate } = useApp();
  const { m } = useMember();
  const [rows, setRows] = useState<PaymentRow[] | null>(demoMode ? [] : null);
  useEffect(() => {
    if (demoMode || !m.id) return;
    readMyPayments(m.id).then(setRows).catch(() => setRows([]));
  }, [m.id]);
  return (
    <Modal open onClose={onClose} title={t('member.invoices')}>
      {rows === null ? (
        <p className="muted" aria-busy="true">…</p>
      ) : rows.length === 0 ? (
        <p className="muted">{demoMode ? t('app.demoNoSave') : t('member.noInvoices')}</p>
      ) : (
        <div className="list">
          {rows.map((p) => (
            <div key={p.id} className="list-item">
              <div className="grow">
                <strong>{t(`sale.kind.${p.kind}` as StringKey)}</strong>
                <div className="xs muted ltr">{p.receiptNo}</div>
              </div>
              <div style={{ textAlign: 'end' }}>
                <strong className="num">{formatEGP(p.kind === 'REFUND' ? -p.amount : p.amount, lang)}</strong>
                <div className="xs muted">{p.at ? fmtDate(p.at, 'short') : ''}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function MyVip({ onClose }: { onClose: () => void }) {
  const { t, lang } = useApp();
  const { m } = useMember();
  const [tier, setTier] = useState<VipTierDoc | null | undefined>(undefined);
  useEffect(() => {
    if (demoMode) return setTier({ nameAr: 'إيليت', nameEn: 'Elite', perksAr: 'جلسة قياسات شهرية مجانية\nخصم 10% على التجديد\nمنشفة ولوكر', perksEn: 'Free monthly body assessment\n10% off renewals\nTowel and locker' });
    let stop: (() => void) | undefined;
    let cancelled = false;
    watchVipTiers((all) => setTier(all[m.vip as 'PLUS' | 'ELITE'] ?? null), () => setTier(null)).then((u) => (cancelled ? u() : (stop = u)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [m.vip]);
  return (
    <Modal open onClose={onClose} title={t('member.vipPerks')}>
      <div className="stack">
        <VipBadge tier={m.vip} />
        {tier === undefined ? (
          <p className="muted" aria-busy="true">…</p>
        ) : !tier ? (
          <p className="muted">—</p>
        ) : (
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {(lang === 'ar' ? tier.perksAr : tier.perksEn).split('\n').filter(Boolean).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
