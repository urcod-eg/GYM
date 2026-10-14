import { useMemo, useState, type FormEvent } from 'react';
import { DateTime } from 'luxon';
import { Link, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp, useServerAction } from '../../app/AppContext';
import { Icon } from '../../components/Icon';
import { Shell, type NavItem } from '../../components/Shell';
import { Avatar, BalanceBadge, Modal, Notice, StatusBadge, VipBadge } from '../../components/ui';
import { useGym } from '../../app/GymContext';
import { AccountsPage } from './Accounts';
import { decideEntry, type DenyReason } from '../../domain/checkin';
import { GYM_TZ, computeEndExclusive, lastUsableDay, localStartOfDay, renewalStart, todayISO } from '../../domain/dates';
import { CUSTOM_DAYS_MAX, CUSTOM_DAYS_MIN, egp, formatEGP, quote } from '../../domain/plans';
import { usePlans } from '../../app/PlansContext';
import { useLedger } from '../../app/LedgerContext';
import { balanceDueDates, balanceStatus, planPayment, type PaymentError, type PayMode } from '../../domain/payments';
import { formatEgyptPhone, normalizeEgyptPhone } from '../../domain/text';
import { DEMO_MEMBERS, DEMO_PAYMENTS, planById } from '../../mock/demo';
import { memberRows, searchRows, type MemberRow } from './shared';

export function CashierArea() {
  const { t } = useApp();
  const pending = DEMO_PAYMENTS.filter((p) => p.status === 'PROOF_SUBMITTED').length;
  const nav: NavItem[] = [
    { to: '/cashier', label: t('app.search'), icon: 'search', end: true },
    { to: '/cashier/accounts', label: t('nav.accounts'), icon: 'users' },
    { to: '/cashier/new', label: t('cashier.newMember'), icon: 'plus' },
    { to: '/cashier/scan', label: t('cashier.scan'), icon: 'scan' },
    { to: '/cashier/pending', label: `${t('cashier.pending')} (${pending})`, icon: 'wallet' },
  ];
  return (
    <Shell nav={nav} defaultTheme="light" title={t('role.cashier')} livePaths={['/cashier/accounts']}>
      <Routes>
        <Route index element={<Reception />} />
        <Route path="accounts" element={<AccountsPage admin={false} />} />
        <Route path="new" element={<QuickRegisterRoute />} />
        <Route path="scan" element={<ScanPage />} />
        <Route path="pending" element={<PendingPayments />} />
        <Route path="*" element={<Navigate to="/cashier" replace />} />
      </Routes>
    </Shell>
  );
}

/* ---------- reception ---------- */
function Reception() {
  const { t, fmtTime } = useApp();
  const { isCancelled } = useLedger();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const rows = useMemo(memberRows, []);
  const results = useMemo(() => searchRows(rows, q).slice(0, 25), [rows, q]);
  const [selId, setSelId] = useState<string | null>('m1');
  const sel = rows.find((r) => r.m.id === selId) ?? null;
  const pending = DEMO_PAYMENTS.filter((p) => p.status === 'PROOF_SUBMITTED').length;

  return (
    <div className="stack">
      <div className="input-wrap">
        <Icon name="search" />
        <input className="input" style={{ minHeight: 56, fontSize: '1.0625rem' }} placeholder={t('cashier.searchPh')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('cashier.searchPh')} autoFocus />
      </div>
      <div className="grid-4">
        <button className="btn btn-primary btn-lg" onClick={() => navigate('/cashier/new')}>
          <Icon name="plus" />
          {t('cashier.newMember')}
        </button>
        <button className="btn btn-secondary btn-lg" onClick={() => sel && navigate(`/cashier/new?renew=${sel.m.id}`)} disabled={!sel}>
          <Icon name="refresh" />
          {t('cashier.renew')}
        </button>
        <button className="btn btn-secondary btn-lg" onClick={() => navigate('/cashier/scan')}>
          <Icon name="scan" />
          {t('cashier.scan')}
        </button>
        <button className="btn btn-secondary btn-lg" onClick={() => navigate('/cashier/pending')}>
          <Icon name="wallet" />
          {t('cashier.pending')} <span className="badge badge-warning no-dot">{pending}</span>
        </button>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="card" style={{ padding: 8 }} aria-label={t('app.search')}>
          {results.length === 0 && <p className="muted" style={{ padding: 16 }}>{t('app.noResults')}</p>}
          {results.map((r) => (
            <button key={r.m.id} className="list-item" aria-current={r.m.id === selId} onClick={() => setSelId(r.m.id)}>
              <Avatar name={r.m.name} />
              <div className="grow">
                <div className="row" style={{ gap: 6 }}>
                  <strong>{r.m.name}</strong>
                  <VipBadge tier={r.m.vip} label={false} />
                </div>
                <div className="muted xs ltr" style={{ textAlign: 'start' }}>
                  {r.m.code} · {formatEgyptPhone(r.m.phone)}
                </div>
              </div>
              <div className="stack-sm" style={{ gap: 4, alignItems: 'flex-end' }}>
                <StatusBadge phase={r.phase} blocked={r.m.blocked} cancelled={isCancelled(r.m.id)} />
                <BalanceBadge memberId={r.m.id} />
              </div>
            </button>
          ))}
        </section>
        {sel ? <MemberPanel r={sel} /> : <p className="muted">{t('cashier.selectHint')}</p>}
      </div>

      <div className="card card-flat row small">
        <Icon name="clock" width={20} height={20} />
        <span>{t('cashier.cashSession', { time: fmtTime(DateTime.now().setZone(GYM_TZ).set({ hour: 9, minute: 0 })) })}</span>
      </div>
    </div>
  );
}

function MemberPanel({ r }: { r: MemberRow }) {
  const { t, lang, fmtDate, fmtTime } = useApp();
  const navigate = useNavigate();
  const server = useServerAction();
  const { balanceOf, isCancelled } = useLedger();
  const vip = r.m.vip !== 'STANDARD';
  const bal = balanceOf(r.m.id);
  const bs = balanceStatus(DateTime.now(), bal);
  const [wa, setWa] = useState(false);
  return (
    <section className="card stack" style={vip ? { borderColor: 'var(--vip)' } : undefined}>
      <div className="row">
        <Avatar name={r.m.name} size="lg" />
        <div className="grow stack-sm" style={{ gap: 4 }}>
          <strong style={{ fontSize: '1.25rem' }}>{r.m.name}</strong>
          <div className="row wrap" style={{ gap: 6 }}>
            <StatusBadge phase={r.phase} blocked={r.m.blocked} cancelled={isCancelled(r.m.id)} />
            <VipBadge tier={r.m.vip} />
            <BalanceBadge memberId={r.m.id} />
          </div>
        </div>
      </div>
      {r.m.blocked && <Notice tone="danger" icon="shield">{t('cashier.blockedNote')}</Notice>}
      {bal && (
        <Notice tone={bs === 'ON_TIME' ? 'warning' : 'danger'} icon="wallet">
          <div className="stack-sm" style={{ gap: 2 }}>
            <strong>
              {t('pay.remaining')}: {formatEGP(bal.remaining, lang)}
            </strong>
            <span className="small">
              {bs === 'ON_TIME' && t('scan.dueSoon', { amount: formatEGP(bal.remaining, lang), date: fmtDate(bal.dueDate) })}
              {bs === 'OVERDUE_BLOCKED' && t('scan.reasonDues', { amount: formatEGP(bal.remaining, lang) })}
              {bs === 'OVERDUE_GRACE' && t('scan.graceWarn', { amount: formatEGP(bal.remaining, lang), date: fmtDate(bal.graceUntil!) })}
            </span>
          </div>
        </Notice>
      )}
      <dl className="grid-2" style={{ margin: 0 }}>
        <div>
          <dt className="muted small">{t('cashier.plan')}</dt>
          <dd style={{ margin: 0 }} className="bold">{lang === 'ar' ? r.planAr : r.planEn}</dd>
        </div>
        <div>
          <dt className="muted small">{r.phase === 'SCHEDULED' ? t('cashier.starts') : t('cashier.ends')}</dt>
          <dd style={{ margin: 0 }} className="bold">{fmtDate(r.phase === 'SCHEDULED' ? r.start : r.lastDay)}</dd>
        </div>
        <div>
          <dt className="muted small">{t('admin.colPhone')}</dt>
          <dd style={{ margin: 0 }} className="bold ltr" >{formatEgyptPhone(r.m.phone)}</dd>
        </div>
        <div>
          <dt className="muted small">{t('cashier.lastVisit')}</dt>
          <dd style={{ margin: 0 }} className="bold">{r.m.lastCheckIn ? `${fmtDate(r.m.lastCheckIn, 'short')} · ${fmtTime(r.m.lastCheckIn)}` : t('cashier.never')}</dd>
        </div>
      </dl>
      <div className="row wrap">
        <button className="btn btn-primary grow" onClick={() => navigate(`/cashier/new?renew=${r.m.id}`)}>
          <Icon name="refresh" />
          {t('cashier.renew')}
        </button>
        <button className={`btn grow ${bal ? 'btn-primary-soft' : 'btn-secondary'}`} onClick={server}>
          <Icon name="wallet" />
          {bal ? t('dues.collect') : t('cashier.collect')}
        </button>
      </div>
      <button className="btn btn-secondary" onClick={() => setWa(true)}>
        <Icon name="whatsapp" />
        {t('wa.send')}
      </button>
      {wa && <ActivationMessage r={r} onClose={() => setWa(false)} />}
    </section>
  );
}

/**
 * WhatsApp welcome message for the sample member panel (spec addendum 1.2 §B). Real activation links
 * are created from «حسابات المشتركين»; this screen runs on sample data until Phase 3.
 */
function ActivationMessage({ r, onClose }: { r: MemberRow; onClose: () => void }) {
  const { t, fmtDate, toast } = useApp();
  const gym = useGym();
  const url = 'https://pulse-gym.web.app/#/activate?c=…';
  const appUrl = url.split('/#')[0];
  const text = [
    `🏋️ أهلًا بك في *${gym.nameAr}*، كابتن *${r.m.name}*! 💪`,
    'تم تأكيد اشتراكك بنجاح.',
    `🏷️ رقم العضوية: *${r.m.code}*`,
    `🎫 الباقة: *${r.planAr}*`,
    `📅 بداية الاشتراك: *${fmtDate(r.start)}*`,
    `📅 نهاية الاشتراك (آخر يوم متاح): *${fmtDate(r.lastDay)}*`,
    `📱 تطبيق الجيم: ${appUrl}`,
    `🔐 رابط تفعيل حسابك (صالح 24 ساعة ولمرة واحدة): ${url}`,
    'نتمنى لك رحلة تدريب موفقة! 🔥',
  ].join('\n');
  const waHref = `https://wa.me/${r.m.phone.replace('+', '')}?text=${encodeURIComponent(text)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('wa.copied'), 'success');
    } catch {
      const el = document.getElementById('wa-text') as HTMLTextAreaElement | null;
      el?.select();
    }
  };

  return (
    <Modal open onClose={onClose} title={t('wa.title')}>
      <div className="stack">
        <textarea id="wa-text" className="input" readOnly value={text} rows={10} style={{ padding: 12, minHeight: 220, direction: 'rtl', lineHeight: 1.7 }} />
        <p className="small muted">{t('wa.demoLink')}</p>
        <div className="row wrap">
          <a className="btn btn-success grow" href={waHref} target="_blank" rel="noreferrer">
            <Icon name="whatsapp" />
            {t('wa.open')}
          </a>
          <button type="button" className="btn btn-secondary grow" onClick={copy}>
            <Icon name="copy" />
            {t('wa.copy')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- quick registration / renewal ---------- */
type Method = 'CASH' | 'WALLET' | 'INSTAPAY' | 'BANK';

/** Re-mount the form when switching between "new" and "renew X" so its state starts clean. */
function QuickRegisterRoute() {
  const [params] = useSearchParams();
  const renewId = params.get('renew');
  return <QuickRegister key={renewId ?? 'new'} renewId={renewId} />;
}

function QuickRegister({ renewId }: { renewId: string | null }) {
  const { t, lang, fmtDate } = useApp();
  const server = useServerAction();
  const navigate = useNavigate();
  const renewing = renewId ? memberRows().find((r) => r.m.id === renewId) : undefined;

  const [name, setName] = useState(renewing?.m.name ?? '');
  const [phone, setPhone] = useState(renewing ? '0' + renewing.m.phone.slice(3) : '');
  const { activePlans } = usePlans();
  const [planId, setPlanId] = useState(renewing?.m.planId ?? 'p_m1');
  const [customDays, setCustomDays] = useState(30);
  const [customPrice, setCustomPrice] = useState(1000);
  const defaultStart = renewing ? renewalStart(DateTime.now(), renewing.end).toISODate()! : todayISO();
  const [start, setStart] = useState(defaultStart);
  const [discount, setDiscount] = useState(0);
  const [method, setMethod] = useState<Method>('CASH');
  const [touched, setTouched] = useState(false);
  const { settings, balanceOf } = useLedger();
  const dueDates = balanceDueDates(DateTime.now(), settings);
  const [payMode, setPayMode] = useState<PayMode>('FULL');
  const [depositPounds, setDepositPounds] = useState<number | ''>('');
  const [balanceDue, setBalanceDue] = useState(dueDates.defaultDue);
  const [tenderedPounds, setTenderedPounds] = useState<number | ''>('');

  // A paused or deleted plan cannot be sold; fall back to the first plan on sale.
  const plan = activePlans.find((p) => p.id === planId) ?? activePlans[0] ?? planById('p_m1');
  const isCustom = plan.duration === null;
  const e164 = normalizeEgyptPhone(phone);
  const dupe = !renewing && e164 ? DEMO_MEMBERS.find((m) => m.phone === e164) : undefined;
  const customOk = Number.isInteger(customDays) && customDays >= CUSTOM_DAYS_MIN && customDays <= CUSTOM_DAYS_MAX;

  let endExclusive: DateTime | null = null;
  try {
    endExclusive = computeEndExclusive(localStartOfDay(start), plan.duration ?? { unit: 'day', value: customOk ? customDays : 1 });
  } catch {
    endExclusive = null;
  }
  const q = quote(isCustom ? egp(customPrice || 0) : plan.price, discount);
  // Renewing with an unpaid balance: the old balance is added to this order and paid with it.
  const oldBalance = renewing ? balanceOf(renewing.m.id) : null;
  const carried = oldBalance?.remaining ?? 0;
  const due = q.total + carried;
  const isDayPass = plan.duration?.unit === 'session';
  const depositAllowed = settings.enabled && !isDayPass;
  const mode: PayMode = depositAllowed ? payMode : 'FULL';
  const pay = planPayment(
    {
      due,
      mode,
      deposit: egp(Number(depositPounds) || 0),
      tendered: method === 'CASH' && tenderedPounds !== '' ? egp(Number(tenderedPounds)) : null,
      isDayPass,
    },
    settings,
  );
  const dueDateOk = mode === 'FULL' || (balanceDue >= dueDates.minDue && balanceDue <= dueDates.maxDue);
  const payErr = (e: PaymentError) => pay.errors.includes(e);

  const errors = {
    name: !name.trim() ? t('reg.required') : null,
    phone: !e164 ? t('login.invalidPhone') : null,
    days: isCustom && !customOk ? t('reg.daysRange') : null,
  };
  const valid = !errors.name && !errors.phone && !errors.days && !dupe && endExclusive && pay.errors.length === 0 && dueDateOk;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (valid) server();
  };

  return (
    <form className="grid-2" style={{ alignItems: 'start' }} onSubmit={submit} noValidate>
      <section className="card stack">
        <h1 className="page-title">{renewing ? `${t('cashier.renew')} — ${renewing.m.name}` : t('reg.title')}</h1>
        <div className="field">
          <label className="label" htmlFor="n">{t('reg.name')}</label>
          <input id="n" className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!!renewing} aria-invalid={touched && !!errors.name} autoComplete="off" />
          {touched && errors.name && <span className="error">{errors.name}</span>}
        </div>
        <div className="field">
          <label className="label" htmlFor="ph">{t('reg.phone')}</label>
          <input id="ph" className="input ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!!renewing} aria-invalid={(touched && !!errors.phone) || !!dupe} placeholder="010 1234 5678" style={{ textAlign: 'start' }} />
          {touched && errors.phone && <span className="error">{errors.phone}</span>}
          {dupe && (
            <Notice tone="warning" icon="alert">
              <div className="stack-sm">
                <span>{t('reg.phoneExists', { name: dupe.name, code: dupe.code })}</span>
                <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => navigate(`/cashier/new?renew=${dupe.id}`)}>
                  {t('reg.openExisting')}
                </button>
              </div>
            </Notice>
          )}
        </div>
        <div className="field">
          <span className="label" id="plan-l">{t('reg.plan')}</span>
          <div className="chips" role="group" aria-labelledby="plan-l">
            {activePlans.map((p) => (
              <button type="button" key={p.id} className="chip" aria-pressed={plan.id === p.id} onClick={() => setPlanId(p.id)}>
                {lang === 'ar' ? p.nameAr : p.nameEn}
              </button>
            ))}
          </div>
        </div>
        {isCustom && (
          <div className="grid-2">
            <div className="field">
              <label className="label" htmlFor="cd">{t('reg.customDays')}</label>
              <input id="cd" className="input num" type="number" min={CUSTOM_DAYS_MIN} max={CUSTOM_DAYS_MAX} value={customDays} onChange={(e) => setCustomDays(Number(e.target.value))} aria-invalid={!!errors.days} />
              {errors.days ? <span className="error">{errors.days}</span> : <span className="hint">{t('reg.daysRange')}</span>}
            </div>
            <div className="field">
              <label className="label" htmlFor="cp">{t('reg.customPrice')}</label>
              <input id="cp" className="input num" type="number" min={0} value={customPrice} onChange={(e) => setCustomPrice(Number(e.target.value))} />
            </div>
          </div>
        )}
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="st">{t('reg.start')}</label>
            <input id="st" className="input" type="date" value={start} min={renewing ? undefined : todayISO()} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="ds">{t('reg.discount')}</label>
            <input id="ds" className="input num" type="number" min={0} max={100} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
          </div>
        </div>
        <div className="field">
          <span className="label" id="m-l">{t('reg.method')}</span>
          <div className="chips" role="group" aria-labelledby="m-l">
            {(['CASH', 'WALLET', 'INSTAPAY', 'BANK'] as Method[]).map((m) => (
              <button type="button" key={m} className="chip" aria-pressed={method === m} onClick={() => setMethod(m)}>
                {t(`method.${m}`)}
              </button>
            ))}
          </div>
          <span className="hint">{method === 'CASH' ? t('reg.cashNote') : t('reg.transferNote')}</span>
        </div>

        {carried > 0 && oldBalance && (
          <Notice tone="warning" icon="alert">
            {t('pay.carriedNote', { amount: formatEGP(carried, lang) })}
          </Notice>
        )}

        <div className="field">
          <span className="label" id="pm-l">{t('pay.mode')}</span>
          <div className="chips" role="group" aria-labelledby="pm-l">
            <button type="button" className="chip" aria-pressed={mode === 'FULL'} onClick={() => setPayMode('FULL')}>
              {t('pay.full')}
            </button>
            <button type="button" className="chip" aria-pressed={mode === 'DEPOSIT'} disabled={!depositAllowed} onClick={() => setPayMode('DEPOSIT')}>
              {t('pay.deposit')}
            </button>
          </div>
          {!depositAllowed && <span className="hint">{isDayPass ? t('pay.noDepositDayPass') : t('pay.depositOff')}</span>}
        </div>

        {mode === 'DEPOSIT' && (
          <div className="grid-2">
            <div className="field">
              <label className="label" htmlFor="dep">{t('pay.depositAmount')}</label>
              <input id="dep" className="input num" type="number" min={0} inputMode="decimal" value={depositPounds} onChange={(e) => setDepositPounds(e.target.value === '' ? '' : Number(e.target.value))} aria-invalid={touched && (payErr('deposit.belowMin') || payErr('deposit.notLess'))} />
              {touched && payErr('deposit.belowMin') ? (
                <span className="error">{t('pay.err.belowMin', { min: formatEGP(pay.minDeposit, lang) })}</span>
              ) : touched && payErr('deposit.notLess') ? (
                <span className="error">{t('pay.err.notLess')}</span>
              ) : (
                <span className="hint">{t('pay.minHint', { min: formatEGP(pay.minDeposit, lang), pct: settings.minPercent })}</span>
              )}
            </div>
            <div className="field">
              <label className="label" htmlFor="bdue">{t('pay.balanceDue')}</label>
              <input id="bdue" className="input" type="date" value={balanceDue} min={dueDates.minDue} max={dueDates.maxDue} onChange={(e) => setBalanceDue(e.target.value)} aria-invalid={!dueDateOk} />
              {!dueDateOk ? <span className="error">{t('pay.err.dueRange', { n: settings.maxGraceDays })}</span> : <span className="hint">{t('pay.dueHint')}</span>}
            </div>
          </div>
        )}

        {method === 'CASH' && (
          <div className="field">
            <label className="label" htmlFor="tend">{t('pay.tendered')}</label>
            <input id="tend" className="input num" type="number" min={0} inputMode="decimal" value={tenderedPounds} onChange={(e) => setTenderedPounds(e.target.value === '' ? '' : Number(e.target.value))} aria-invalid={payErr('tendered.short')} />
            {payErr('tendered.short') ? <span className="error">{t('pay.err.short', { amount: formatEGP(pay.paidNow, lang) })}</span> : <span className="hint">{t('pay.tenderedHint')}</span>}
          </div>
        )}
      </section>

      <aside className="stack" style={{ position: 'sticky', top: 76 }}>
        <section className="summary stack-sm" aria-live="polite">
          <h2 className="card-title">{t('reg.summary')}</h2>
          <div className="row-between">
            <span>{lang === 'ar' ? plan.nameAr : plan.nameEn}</span>
            <span className="num">{formatEGP(q.base, lang)}</span>
          </div>
          {q.discount > 0 && (
            <div className="row-between" style={{ color: 'var(--success)' }}>
              <span>{t('reg.discount')} {discount}%</span>
              <span className="num">− {formatEGP(q.discount, lang)}</span>
            </div>
          )}
          {carried > 0 && (
            <div className="row-between" style={{ color: 'var(--warning)' }}>
              <span>{t('pay.carried')}</span>
              <span className="num">+ {formatEGP(carried, lang)}</span>
            </div>
          )}
          <div className="divider" />
          <div className="row-between">
            <span className="bold">{t('reg.due')}</span>
            <span className={`num ${mode === 'FULL' ? 'total' : 'bold'}`}>{formatEGP(due, lang)}</span>
          </div>
          {mode === 'DEPOSIT' && (
            <>
              <div className="row-between">
                <span className="bold">{t('pay.paidNow')}</span>
                <span className="total num">{formatEGP(pay.paidNow, lang)}</span>
              </div>
              <div className="pay-remaining">
                <div className="row-between">
                  <span className="bold">{t('pay.remaining')}</span>
                  <span className="num bold">{formatEGP(pay.remaining, lang)}</span>
                </div>
                <span className="xs">{t('pay.remainingNote', { date: fmtDate(balanceDue) })}</span>
              </div>
            </>
          )}
          {pay.change !== null && (
            <div className="row-between pay-change">
              <span className="bold">{t('pay.change')}</span>
              <span className="num bold">{formatEGP(pay.change, lang)}</span>
            </div>
          )}
          {endExclusive && (
            <>
              <div className="row small" style={{ marginTop: 8 }}>
                <Icon name="calendar" width={18} height={18} />
                <span>{t('reg.period', { from: fmtDate(localStartOfDay(start)), to: fmtDate(lastUsableDay(endExclusive)) })}</span>
              </div>
              <span className="muted xs">{t('reg.lastDayNote', { date: fmtDate(lastUsableDay(endExclusive)) })}</span>
            </>
          )}
        </section>
        <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={touched && !valid}>
          {t('reg.submit')}
        </button>
      </aside>
    </form>
  );
}

/* ---------- pending payments ---------- */
function PendingPayments() {
  const { t, lang, fmtTime, fmtDate } = useApp();
  const server = useServerAction();
  const rows = DEMO_PAYMENTS.filter((p) => p.status === 'PROOF_SUBMITTED');
  return (
    <div className="stack">
      <h1 className="page-title">{t('pending.title')}</h1>
      <Notice tone="warning" icon="alert">{t('pending.verifyNote')}</Notice>
      <div className="grid-2">
        {rows.map((p) => {
          const m = DEMO_MEMBERS.find((x) => x.id === p.memberId)!;
          return (
            <article key={p.id} className="card stack-sm">
              <div className="row-between">
                <span className="muted small ltr">
                  {t('pending.order')} #{p.orderNo}
                </span>
                <span className="badge badge-warning">{t('pay.PROOF_SUBMITTED')}</span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <strong>{m.name}</strong>
                <span className="muted xs ltr">{m.code}</span>
                <VipBadge tier={m.vip} label={false} />
              </div>
              <div className="row-between">
                <span>{t(`method.${p.method}`)}</span>
                <strong className="num" style={{ fontSize: '1.25rem' }}>{formatEGP(p.amount, lang)}</strong>
              </div>
              <div className="muted small">
                {t('pending.ref')}: <span className="ltr">{p.reference}</span> · {fmtDate(p.createdAt, 'short')} {fmtTime(p.createdAt)}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={server}>
                <Icon name="whatsapp" />
                {t('pending.notify')}
              </button>
              <div className="row wrap">
                <button className="btn btn-success grow" onClick={server}>
                  <Icon name="check" />
                  {t('pending.verify')}
                </button>
                <button className="btn btn-danger grow" onClick={server}>
                  {t('pending.reject')}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- check-in ---------- */
type Demo = 'ok' | 'expired' | 'blocked' | 'reused' | 'dues' | 'grace';
const DEMO_SCAN: Record<Demo, string> = { ok: 'm1', expired: 'm3', blocked: 'm11', reused: 'm8', dues: 'm5', grace: 'm12' };
const DEMO_LABEL = {
  ok: 'scan.demoActive',
  expired: 'scan.demoExpired',
  blocked: 'scan.demoBlocked',
  reused: 'scan.demoReused',
  dues: 'scan.demoDues',
  grace: 'scan.demoGrace',
} as const;

function ScanPage() {
  const { t, lang, fmtTime, fmtDate } = useApp();
  const { balanceOf, isCancelled } = useLedger();
  const [scan, setScan] = useState<{ id: string; reused: boolean } | null>(null);
  const [code, setCode] = useState('');
  const rows = memberRows();
  const r = scan ? rows.find((x) => x.m.id === scan.id) ?? null : null;
  const bal = r ? balanceOf(r.m.id) : null;
  const d = r
    ? decideEntry({
        now: DateTime.now(),
        phase: r.phase,
        cancelled: isCancelled(r.m.id),
        checkinBlocked: !!r.m.blocked,
        codeAlreadyUsed: scan!.reused,
        balance: bal,
      })
    : null;
  const money = (p: number) => formatEGP(p, lang);
  const reasonText = (why: DenyReason) =>
    ({
      CANCELLED: t('scan.reasonCancelled'),
      CODE_USED: t('scan.reasonUsed'),
      BLOCKED: t('scan.reasonBlocked'),
      SCHEDULED: t('scan.reasonScheduled'),
      EXPIRED: t('scan.reasonExpired'),
      DUES_OVERDUE: t('scan.reasonDues', { amount: money(bal?.remaining ?? 0) }),
    })[why];

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="stack">
        <h1 className="page-title">{t('scan.title')}</h1>
        <div className="scan-frame">
          <span className="small" style={{ position: 'absolute', bottom: 14 }}>{t('scan.camera')}</span>
        </div>
        <p className="muted small">{t('scan.cameraDemo')}</p>
        <div className="chips">
          {(Object.keys(DEMO_SCAN) as Demo[]).map((k) => (
            <button key={k} className="chip" aria-pressed={scan?.id === DEMO_SCAN[k] && scan.reused === (k === 'reused')} onClick={() => setScan({ id: DEMO_SCAN[k], reused: k === 'reused' })}>
              {t(DEMO_LABEL[k])}
            </button>
          ))}
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const hit = rows.find((x) => x.m.code.toLowerCase() === code.trim().toLowerCase());
            if (hit) setScan({ id: hit.m.id, reused: false });
          }}
        >
          <input className="input ltr grow" placeholder="GYM-10025" value={code} onChange={(e) => setCode(e.target.value)} aria-label={t('scan.manual')} />
          <button className="btn btn-secondary">{t('app.search')}</button>
        </form>
      </section>

      {r && d && (
        <section className={`result ${d.allowed ? 'ok' : 'no'} stack`} aria-live="assertive">
          <div className="row">
            <Avatar name={r.m.name} size="lg" />
            <div className="grow">
              <div className="row wrap" style={{ gap: 6 }}>
                <strong style={{ fontSize: '1.25rem' }}>{r.m.name}</strong>
                <VipBadge tier={r.m.vip} />
              </div>
              <span className="muted small ltr">{r.m.code}</span>
            </div>
          </div>
          <div className="row">
            <Icon name={d.allowed ? 'check' : 'x'} className="big-icon" style={{ color: d.allowed ? 'var(--success)' : 'var(--danger)' }} />
            <div>
              <div className="bold" style={{ fontSize: '1.375rem' }}>{d.allowed ? t('scan.allowed') : t('scan.denied')}</div>
              <div className="small">{d.allowed ? fmtTime(DateTime.now()) : reasonText(d.reason!)}</div>
            </div>
          </div>
          {d.note === 'GRACE' && bal && (
            <Notice tone="warning" icon="wallet">{t('scan.graceWarn', { amount: money(bal.remaining), date: fmtDate(bal.graceUntil!) })}</Notice>
          )}
          {d.note === 'BALANCE_DUE' && bal && (
            <Notice tone="warning" icon="wallet">{t('scan.dueSoon', { amount: money(bal.remaining), date: fmtDate(bal.dueDate) })}</Notice>
          )}
          <div className="row-between small wrap">
            <span>{lang === 'ar' ? r.planAr : r.planEn}</span>
            <span>
              {t('cashier.ends')}: {fmtDate(r.lastDay, 'short')}
            </span>
          </div>
          {d.reason === 'EXPIRED' && (
            <Link className="btn btn-primary" to={`/cashier/new?renew=${r.m.id}`}>
              <Icon name="refresh" />
              {t('scan.openRenew')}
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
