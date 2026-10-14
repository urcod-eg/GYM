import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { useApp, useServerAction } from '../../app/AppContext';
import { LineChart } from '../../components/Charts';
import { Icon } from '../../components/Icon';
import { Shell, type NavItem } from '../../components/Shell';
import { IllustrativeCode, Notice, PromoCard, VipBadge } from '../../components/ui';
import { GYM_TZ, daysRemaining, lastUsableDay, phaseAt, type MembershipPhase } from '../../domain/dates';
import { DEMO_COACHES, DEMO_MEMBERS, DEMO_WEEK, DEMO_WEIGHT, DEMO_WORKOUT, memberDates, planById, type DemoMember } from '../../mock/demo';

/* ---------- preview state: which demo member the member screens show ---------- */
const PRESETS = [
  { id: 'm1', key: 'status.ACTIVE' as const, vip: true },
  { id: 'm4', key: 'status.SCHEDULED' as const, vip: false },
  { id: 'm3', key: 'status.EXPIRED' as const, vip: false },
];

interface MemberView {
  m: DemoMember;
  phase: MembershipPhase;
  start: DateTime;
  end: DateTime;
  setId: (id: string) => void;
}
const MemberCtx = createContext<MemberView | null>(null);
const useMember = () => useContext(MemberCtx)!;

function MemberProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState('m1');
  const value = useMemo(() => {
    const m = DEMO_MEMBERS.find((x) => x.id === id)!;
    const { start, end } = memberDates(m);
    return { m, start, end, phase: phaseAt(DateTime.now().setZone(GYM_TZ), start, end), setId };
  }, [id]);
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
      <Shell bottomNav={nav} defaultTheme="dark" width="narrow" sampleNote="app.sampleScreenMember">
        <PreviewSwitch />
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
  return phase === 'EXPIRED' ? <ExpiredView /> : <ScheduledView />;
}

/* ---------- home ---------- */
function MemberHome() {
  const { phase } = useMember();
  if (phase === 'EXPIRED') return <ExpiredView />;
  if (phase === 'SCHEDULED') return <ScheduledView />;
  return <ActiveHome />;
}

function MembershipCard() {
  const { t, lang, fmtDate } = useApp();
  const { m, start, end } = useMember();
  const plan = planById(m.planId);
  const now = DateTime.now().setZone(GYM_TZ);
  const total = Math.max(1, end.diff(start, 'days').days);
  const left = daysRemaining(now, end);
  const pct = Math.min(100, Math.max(0, (left / total) * 100));
  const coach = DEMO_COACHES.find((c) => c.id === m.coachId);
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
          <strong style={{ fontSize: '1.5rem' }}>{lang === 'ar' ? plan.nameAr : plan.nameEn}</strong>
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
          {t('member.coach')}: {coach ? coach.name : t('member.noCoach')}
        </div>
      </div>
    </section>
  );
}

function Banners() {
  const { lang } = useApp();
  const { m } = useMember();
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
  const { t, lang } = useApp();
  const { m, end } = useMember();
  const left = daysRemaining(DateTime.now(), end);
  const first = m.name.split(' ')[0];
  const done = DEMO_WORKOUT.exercises.filter((e) => e.done).length;
  return (
    <div className="stack">
      <h1 className="page-title">{t('member.hello', { name: first })}</h1>
      {left <= 7 && (
        <Notice tone="warning" icon="clock">
          {t('member.expiryReminder', { n: left })}
        </Notice>
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
            {done}/{DEMO_WORKOUT.exercises.length}
          </span>
        </div>
        <p className="bold" style={{ fontSize: '1.125rem' }}>{lang === 'ar' ? DEMO_WORKOUT.titleAr : DEMO_WORKOUT.titleEn}</p>
        <div className="progress light">
          <span style={{ width: `${(done / DEMO_WORKOUT.exercises.length) * 100}%` }} />
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
  return (
    <div className="stack">
      <section className="card stack" style={{ borderColor: 'var(--danger)' }}>
        <div className="row">
          <Icon name="alert" width={28} height={28} style={{ color: 'var(--danger)' }} />
          <h1 className="section-title">{t('member.expiredTitle')}</h1>
        </div>
        <p>{t('member.expiredBody', { date: fmtDate(lastUsableDay(end)) })}</p>
        <button className="btn btn-primary btn-lg btn-block" onClick={server}>
          <Icon name="refresh" />
          {t('member.renewRequest')}
        </button>
        <a className="btn btn-secondary btn-block" href="https://wa.me/201000000000" target="_blank" rel="noreferrer">
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
function Workout() {
  const { t, lang } = useApp();
  const [done, setDone] = useState(() => DEMO_WORKOUT.exercises.map((e) => e.done));
  return (
    <div className="stack">
      <h1 className="page-title">{lang === 'ar' ? DEMO_WORKOUT.titleAr : DEMO_WORKOUT.titleEn}</h1>
      <section className="card">
        {DEMO_WORKOUT.exercises.map((e, i) => (
          <div className="exercise" key={e.nameEn}>
            <button
              className="check"
              role="checkbox"
              aria-checked={done[i]}
              aria-label={lang === 'ar' ? e.nameAr : e.nameEn}
              onClick={() => setDone((d) => d.map((v, j) => (j === i ? !v : v)))}
            >
              <Icon name="check" />
            </button>
            <div>
              <div className="bold">{lang === 'ar' ? e.nameAr : e.nameEn}</div>
              <div className="muted small num">
                {e.sets} {t('member.sets')} × {e.reps} {t('member.reps')} · {t('member.rest')} {e.rest}s
              </div>
            </div>
            <span className="badge badge-neutral no-dot ltr">{e.target}</span>
          </div>
        ))}
      </section>
      <section className="card stack-sm">
        <h2 className="card-title">{t('member.weekPlan')}</h2>
        <div className="list">
          {DEMO_WEEK.map((d) => (
            <div key={d.dayEn} className="list-item" style={{ minHeight: 44 }}>
              <strong style={{ minWidth: 104 }}>{lang === 'ar' ? d.dayAr : d.dayEnFull}</strong>
              <span className="muted">{lang === 'ar' ? d.focusAr : d.focusEn}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="card stack-sm">
        <h2 className="card-title">{t('member.nutrition')}</h2>
        <p className="muted small">{t('member.nutritionBody')}</p>
      </section>
    </div>
  );
}

/* ---------- entry code ---------- */
function CardPage() {
  const { t, lang } = useApp();
  const { m, phase } = useMember();
  const [seed, setSeed] = useState(1);
  const [left, setLeft] = useState(45);
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
  const plan = planById(m.planId);
  return (
    <div className="stack" style={{ textAlign: 'center' }}>
      <h1 className="page-title">{t('member.qrTitle')}</h1>
      <div className="row" style={{ justifyContent: 'center' }}>
        <strong>{m.name}</strong>
        <VipBadge tier={m.vip} label={false} />
      </div>
      <div className="qr-box" aria-live="polite">
        <IllustrativeCode seed={seed} />
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <div className="ring" style={{ ['--p' as string]: (left / 45) * 100 }}>
          <span className="num">{left}</span>
        </div>
        <span className="muted small">{t('member.qrRefresh', { s: left })}</span>
      </div>
      <p className="muted small">{t('member.qrHint')}</p>
      <Notice tone="warning" icon="info">{t('member.qrDemo')}</Notice>
      <div className="card row-between" style={{ textAlign: 'start' }}>
        <span>{lang === 'ar' ? plan.nameAr : plan.nameEn}</span>
        <span className="muted small">
          {t('member.visitsLeft')}: {plan.visitQuota ?? t('member.unlimited')}
        </span>
      </div>
    </div>
  );
}

/* ---------- progress ---------- */
function Progress() {
  const { t, fmtDate, fmtNum } = useApp();
  const first = DEMO_WEIGHT[0].kg;
  const last = DEMO_WEIGHT.at(-1)!.kg;
  return (
    <div className="stack">
      <h1 className="page-title">{t('member.progress')}</h1>
      <div className="grid-2">
        <div className="card stat">
          <span className="label">{t('member.weight')}</span>
          <span className="value">{fmtNum(last)} kg</span>
          <span className="delta up">{fmtNum(Math.round((last - first) * 10) / 10)} kg</span>
        </div>
        <div className="card stat">
          <span className="label">{t('member.attendance')}</span>
          <span className="value">{fmtNum(14)}</span>
          <span className="muted small">{t('member.visitsMonth')}</span>
        </div>
      </div>
      <section className="card stack-sm">
        <h2 className="card-title">{t('member.weight')} (kg)</h2>
        <LineChart
          ariaLabel={`${t('member.weight')}: ${first} → ${last} kg`}
          points={DEMO_WEIGHT.map((w) => ({ label: fmtDate(w.date, 'short'), value: w.kg }))}
          formatValue={(n) => n.toFixed(0)}
          height={180}
        />
      </section>
    </div>
  );
}

/* ---------- more ---------- */
function More() {
  const { t } = useApp();
  const server = useServerAction();
  const { m } = useMember();
  const items: { icon: Parameters<typeof Icon>[0]['name']; label: string; href?: string }[] = [
    { icon: 'bell', label: t('member.notifications') },
    ...(m.vip !== 'STANDARD' ? [{ icon: 'crown' as const, label: t('member.vipPerks') }] : []),
    { icon: 'receipt', label: t('member.invoices') },
    { icon: 'whatsapp', label: t('member.help') },
    { icon: 'settings', label: t('member.settings') },
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
          ) : (
            <button key={it.label} className="list-item" onClick={server}>
              <Icon name={it.icon} width={22} height={22} />
              <span className="grow">{it.label}</span>
            </button>
          ),
        )}
      </section>
      <p className="muted xs">{t('support.body')}</p>
      <Link className="btn btn-ghost" to="/">
        <Icon name="logout" />
        {t('app.logout')}
      </Link>
    </div>
  );
}
