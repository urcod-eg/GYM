import { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp, useServerAction } from '../../app/AppContext';
import { BarChart, LineChart } from '../../components/Charts';
import { Icon } from '../../components/Icon';
import { Shell, type NavItem } from '../../components/Shell';
import { BalanceBadge, Modal, Notice, PlaceholderPage, Stat, StatusBadge, VipBadge } from '../../components/ui';
import { useLedger } from '../../app/LedgerContext';
import { GYM_TZ, daysRemaining, type MembershipPhase } from '../../domain/dates';
import { formatEGP, type Plan } from '../../domain/plans';
import { EMPTY_DRAFT, draftFromPlan, planFromDraft, validatePlan, type PlanDraft, type PlanErrors } from '../../domain/planForm';
import { usePlans } from '../../app/PlansContext';
import { formatEgyptPhone } from '../../domain/text';
import { DEMO_MEMBERS, DEMO_PAYMENTS, DEMO_PEAK_HOURS, DEMO_REVENUE_30D, type VipTier } from '../../mock/demo';
import type { StringKey } from '../../i18n/strings';
import { memberRows, searchRows } from './shared';
import { DuesPage, SettingsPage, useDuesSummary } from './AdminDues';
import { Link } from 'react-router-dom';
import { AccountsPage } from './Accounts';
import { StaffManager } from './StaffManager';
import { AuditPage } from './AuditPage';

export function AdminArea() {
  const { t } = useApp();
  const nav: NavItem[] = [
    { to: '/admin', label: t('admin.dashboard'), icon: 'home', end: true },
    { to: '/admin/accounts', label: t('nav.accounts'), icon: 'users' },
    { to: '/admin/members', label: t('admin.members'), icon: 'card' },
    { to: '/admin/plans', label: t('admin.plans'), icon: 'tag' },
    { to: '/admin/payments', label: t('admin.payments'), icon: 'wallet' },
    { to: '/admin/dues', label: t('dues.title'), icon: 'alert' },
    { to: '/admin/finance', label: t('admin.finance'), icon: 'receipt' },
    { to: '/admin/attendance', label: t('admin.attendance'), icon: 'clock' },
    { to: '/admin/coaches', label: t('admin.coaches'), icon: 'dumbbell' },
    { to: '/admin/vip', label: t('admin.vip'), icon: 'crown' },
    { to: '/admin/banners', label: t('admin.banners'), icon: 'image' },
    { to: '/admin/staff', label: t('admin.staff'), icon: 'user' },
    { to: '/admin/security', label: t('admin.security'), icon: 'shield' },
    { to: '/admin/reports', label: t('admin.reports'), icon: 'chart' },
    { to: '/admin/audit', label: t('admin.audit'), icon: 'file' },
    { to: '/admin/settings', label: t('admin.settings'), icon: 'settings' },
  ];
  const later: [string, StringKey, number][] = [
    ['payments', 'admin.payments', 3],
    ['finance', 'admin.finance', 6],
    ['attendance', 'admin.attendance', 4],
    ['coaches', 'admin.coaches', 5],
    ['vip', 'admin.vip', 4],
    ['banners', 'admin.banners', 3],
    ['reports', 'admin.reports', 6],
  ];
  return (
    <Shell nav={nav} defaultTheme="light" showCloud title={t('role.admin')} livePaths={['/admin/accounts', '/admin/staff', '/admin/security', '/admin/audit']}>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="accounts" element={<AccountsPage admin />} />
        <Route path="staff" element={<StaffManager />} />
        <Route path="security" element={<AccountsPage admin initialFilter="blocked" />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="members" element={<Members />} />
        <Route path="plans" element={<Plans />} />
        <Route path="dues" element={<DuesPage />} />
        <Route path="settings" element={<SettingsPage />} />
        {later.map(([path, key, phase]) => (
          <Route key={path} path={path} element={<PlaceholderPage title={t(key)} phase={phase} />} />
        ))}
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </Shell>
  );
}

function Dashboard() {
  const { t, lang, fmtNum, fmtDate } = useApp();
  const server = useServerAction();
  const rows = useMemo(memberRows, []);
  const now = DateTime.now().setZone(GYM_TZ);
  const active = rows.filter((r) => r.phase === 'ACTIVE');
  const vip = active.filter((r) => r.m.vip !== 'STANDARD').length;
  const expiring = active.filter((r) => daysRemaining(now, r.end) <= 7).sort((a, b) => a.end.toMillis() - b.end.toMillis());
  const today = DEMO_REVENUE_30D.at(-1)!.amount;
  const yesterday = DEMO_REVENUE_30D.at(-2)!.amount;
  const change = Math.round(((today - yesterday) / yesterday) * 100);
  const pending = DEMO_PAYMENTS.filter((p) => p.status === 'PROOF_SUBMITTED').length;
  const dues = useDuesSummary();

  return (
    <div className="stack">
      <div className="row-between wrap">
        <h1 className="page-title">{t('admin.dashboard')}</h1>
        <span className="badge badge-info">{t('admin.licenseOk')}</span>
      </div>
      <div className="grid-kpi">
        <Stat label={t('admin.todayCollected')} value={formatEGP(today, lang)} icon="wallet" delta={{ text: `${change > 0 ? '+' : ''}${change}%`, up: change >= 0 }} />
        <Stat label={t('admin.newSubs')} value={fmtNum(23)} icon="users" />
        <Stat label={t('admin.todayVisits')} value={fmtNum(87)} icon="clock" />
        <Stat label={t('admin.activeVip')} value={lang === 'ar' ? `${fmtNum(vip)} من ${fmtNum(active.length)}` : `${fmtNum(vip)} of ${fmtNum(active.length)}`} icon="crown" />
        <Link to="/admin/dues" className="stat-link">
          <Stat label={t('dues.total')} value={formatEGP(dues.total, lang)} icon="alert" delta={{ text: t('dues.lateCount', { n: dues.late }), up: false }} />
        </Link>
      </div>
      <section className="stack-sm">
        <h2 className="section-title">{t('admin.alerts')}</h2>
        <Notice tone="danger" icon="alert">{t('admin.alertCash')}</Notice>
        <Notice tone="warning" icon="clock">{t('admin.alertPending', { n: pending })}</Notice>
      </section>
      <div className="grid-2" style={{ gridTemplateColumns: undefined }}>
        <section className="card stack-sm">
          <h2 className="card-title">{t('admin.revenue30')}</h2>
          <LineChart
            ariaLabel={t('admin.revenue30')}
            points={DEMO_REVENUE_30D.map((d) => ({ label: fmtDate(d.date, 'short'), value: d.amount / 100 }))}
            formatValue={(n) => (n >= 1000 ? `${n / 1000}k` : String(n))}
          />
        </section>
        <section className="card stack-sm">
          <div className="row-between">
            <h2 className="card-title">{t('admin.expiring')}</h2>
            <span className="badge badge-warning no-dot">{expiring.length}</span>
          </div>
          <div className="list">
            {expiring.map((r) => (
              <div key={r.m.id} className="list-item">
                <div className="grow">
                  <div className="row" style={{ gap: 6 }}>
                    <strong>{r.m.name}</strong>
                    <VipBadge tier={r.m.vip} label={false} />
                  </div>
                  <div className="muted xs">
                    {lang === 'ar' ? r.planAr : r.planEn} · {t('cashier.ends')} {fmtDate(r.lastDay, 'short')}
                  </div>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={server}>
                  <Icon name="whatsapp" />
                  {t('admin.remind')}
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="card stack-sm">
        <h2 className="card-title">{t('admin.peak')}</h2>
        <BarChart ariaLabel={t('admin.peak')} bars={DEMO_PEAK_HOURS.map((h) => ({ label: `${h.hour}:00`, value: h.visits }))} />
      </section>
    </div>
  );
}

const PAGE = 8;

function Members() {
  const { t, lang, fmtDate } = useApp();
  const { isCancelled } = useLedger();
  const { plans } = usePlans();
  const server = useServerAction();
  const all = useMemo(memberRows, []);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<MembershipPhase | 'ALL'>('ALL');
  const [vip, setVip] = useState<VipTier | 'ALL'>('ALL');
  const [plan, setPlan] = useState<string>('ALL');
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(
    () =>
      searchRows(all, q)
        .filter((r) => status === 'ALL' || r.phase === status)
        .filter((r) => vip === 'ALL' || r.m.vip === vip)
        .filter((r) => plan === 'ALL' || r.m.planId === plan)
        .sort((a, b) => a.m.name.localeCompare(b.m.name, 'ar')),
    [all, q, status, vip, plan],
  );
  const shown = filtered.slice(0, limit);
  const dirty = q || status !== 'ALL' || vip !== 'ALL' || plan !== 'ALL';

  return (
    <div className="stack">
      <div className="row-between wrap">
        <h1 className="page-title">{t('admin.members')}</h1>
        <div className="row no-print">
          <button className="btn btn-secondary btn-sm" onClick={server}>
            <Icon name="download" />
            {t('admin.export')}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => window.print()}>
            <Icon name="print" />
            {t('admin.print')}
          </button>
        </div>
      </div>
      <div className="card stack-sm no-print">
        <div className="input-wrap">
          <Icon name="search" />
          <input className="input" placeholder={t('cashier.searchPh')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('cashier.searchPh')} />
        </div>
        <div className="grid-3">
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as MembershipPhase | 'ALL')} aria-label={t('admin.filterStatus')}>
            <option value="ALL">{t('admin.filterStatus')}: {t('app.all')}</option>
            {(['ACTIVE', 'SCHEDULED', 'EXPIRED'] as const).map((s) => (
              <option key={s} value={s}>{t(`status.${s}`)}</option>
            ))}
          </select>
          <select className="select" value={plan} onChange={(e) => setPlan(e.target.value)} aria-label={t('admin.filterPlan')}>
            <option value="ALL">{t('admin.filterPlan')}: {t('app.all')}</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>{lang === 'ar' ? p.nameAr : p.nameEn}</option>
            ))}
          </select>
          <select className="select" value={vip} onChange={(e) => setVip(e.target.value as VipTier | 'ALL')} aria-label={t('admin.filterVip')}>
            <option value="ALL">{t('admin.filterVip')}: {t('app.all')}</option>
            {(['STANDARD', 'PLUS', 'ELITE'] as const).map((v) => (
              <option key={v} value={v}>{t(`vip.${v}`)}</option>
            ))}
          </select>
        </div>
        {dirty && (
          <button
            className="linkish"
            style={{ alignSelf: 'flex-start', minHeight: 32 }}
            onClick={() => {
              setQ('');
              setStatus('ALL');
              setVip('ALL');
              setPlan('ALL');
            }}
          >
            {t('app.clear')}
          </button>
        )}
      </div>
      <section className="card">
        {shown.length === 0 ? (
          <p className="muted">{t('app.noResults')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>{t('admin.colName')}</th>
                  <th>{t('admin.colCode')}</th>
                  <th>{t('admin.colPhone')}</th>
                  <th>{t('admin.colPlan')}</th>
                  <th>{t('admin.colEnds')}</th>
                  <th>{t('admin.colCoach')}</th>
                  <th>{t('admin.colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.m.id}>
                    <td className="primary-cell">
                      <div className="row" style={{ gap: 6 }}>
                        <strong>{r.m.name}</strong>
                        <VipBadge tier={r.m.vip} label={false} />
                      </div>
                    </td>
                    <td data-label={t('admin.colCode')} className="ltr" style={{ textAlign: 'start' }}>{r.m.code}</td>
                    <td data-label={t('admin.colPhone')} className="ltr num" style={{ textAlign: 'start' }}>{formatEgyptPhone(r.m.phone)}</td>
                    <td data-label={t('admin.colPlan')}>{lang === 'ar' ? r.planAr : r.planEn}</td>
                    <td data-label={t('admin.colEnds')} className="num">{fmtDate(r.lastDay, 'short')}</td>
                    <td data-label={t('admin.colCoach')}>{r.coach ?? '—'}</td>
                    <td>
                      <div className="row wrap" style={{ gap: 4 }}>
                        <StatusBadge phase={r.phase} blocked={r.m.blocked} cancelled={isCancelled(r.m.id)} />
                        <BalanceBadge memberId={r.m.id} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="row-between" style={{ marginTop: 12 }}>
          <span className="muted small">{t('app.showing', { n: shown.length, total: filtered.length })}</span>
          {limit < filtered.length && (
            <button className="btn btn-secondary btn-sm" onClick={() => setLimit((l) => l + PAGE)}>
              {t('app.loadMore')}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function Plans() {
  const { t, lang, toast } = useApp();
  const { plans, upsert, remove } = usePlans();
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [confirm, setConfirm] = useState<Plan | null>(null);
  const usage = (id: string) => DEMO_MEMBERS.filter((m) => m.planId === id).length;
  const dur = (p: Plan) => {
    if (!p.duration) return t('dur.custom');
    if (p.duration.unit === 'session') return t('dur.session');
    return t(`dur.${p.duration.unit}` as StringKey, { n: p.duration.value });
  };

  return (
    <div className="stack">
      <div className="row-between wrap">
        <h1 className="page-title">{t('admin.plans')}</h1>
        <button className="btn btn-primary" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
          <Icon name="plus" />
          {t('admin.addPlan')}
        </button>
      </div>
      <Notice icon="info">{t('plan.previewNote')}</Notice>
      <div className="grid-4">
        {plans.map((p) => (
          <article key={p.id} className="card stack-sm plan-card" data-featured={p.featured || undefined} data-inactive={!p.active || undefined}>
            <div className="row-between wrap" style={{ gap: 6 }}>
              <strong style={{ fontSize: '1.125rem' }}>{lang === 'ar' ? p.nameAr : p.nameEn}</strong>
              <span className="badge badge-neutral no-dot ltr">{p.code}</span>
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {p.featured && <span className="badge badge-danger no-dot">{t('plan.featuredBadge')}</span>}
              <span className={`badge ${p.active ? 'badge-success' : 'badge-neutral'}`}>{p.active ? t('plan.active') : t('plan.inactive')}</span>
            </div>
            <div className="stat">
              <span className="value" style={{ fontSize: '1.5rem' }}>{p.duration ? formatEGP(p.price, lang) : '—'}</span>
            </div>
            <div className="muted small">
              {t('admin.planDuration')}: {dur(p)}
            </div>
            <div className="muted small">
              {t('admin.planVisits')}: {p.visitQuota ?? t('member.unlimited')}
            </div>
            <div className="row" style={{ marginTop: 'auto', paddingTop: 8 }}>
              <button className="btn btn-secondary btn-sm grow" onClick={() => setDraft(draftFromPlan(p))}>
                <Icon name="edit" />
                {t('plan.edit')}
              </button>
              <button className="btn btn-danger btn-sm grow" onClick={() => setConfirm(p)}>
                <Icon name="trash" />
                {t('plan.delete')}
              </button>
            </div>
          </article>
        ))}
      </div>

      {draft && (
        <PlanEditor
          draft={draft}
          plans={plans}
          onClose={() => setDraft(null)}
          onSave={(d) => {
            upsert(planFromDraft(d, () => `p_${Date.now().toString(36)}`));
            setDraft(null);
            toast(t('plan.saved'), 'success');
          }}
        />
      )}

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm ? t('plan.confirmTitle', { name: lang === 'ar' ? confirm.nameAr : confirm.nameEn }) : ''}
      >
        {confirm && (
          <div className="stack">
            {usage(confirm.id) > 0 ? (
              <>
                <Notice tone="warning" icon="alert">
                  {t('plan.inUseBody', { n: usage(confirm.id) })}
                </Notice>
                <div className="row wrap">
                  <button
                    className="btn btn-primary grow"
                    onClick={() => {
                      upsert({ ...confirm, active: false });
                      setConfirm(null);
                      toast(t('plan.deactivated'), 'success');
                    }}
                  >
                    {t('plan.deactivate')}
                  </button>
                  <button className="btn btn-secondary grow" onClick={() => setConfirm(null)}>
                    {t('app.cancel')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>{t('plan.confirmBody')}</p>
                <div className="row wrap">
                  <button
                    className="btn btn-danger-solid grow"
                    onClick={() => {
                      remove(confirm.id);
                      setConfirm(null);
                      toast(t('plan.deleted'), 'success');
                    }}
                  >
                    <Icon name="trash" />
                    {t('plan.confirmDelete')}
                  </button>
                  <button className="btn btn-secondary grow" onClick={() => setConfirm(null)}>
                    {t('app.cancel')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

const UNITS: PlanDraft['unit'][] = ['session', 'day', 'week', 'month', 'year', 'custom'];

function PlanEditor({ draft, plans, onClose, onSave }: { draft: PlanDraft; plans: Plan[]; onClose: () => void; onSave: (d: PlanDraft) => void }) {
  const { t } = useApp();
  const [d, setD] = useState<PlanDraft>(draft);
  const [touched, setTouched] = useState(false);
  const errors = validatePlan(d, plans);
  const err = (k: keyof PlanErrors) => (touched && errors[k] ? t(errors[k] as StringKey) : null);
  const set = <K extends keyof PlanDraft>(k: K, v: PlanDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const hasValue = d.unit !== 'session' && d.unit !== 'custom';

  return (
    <Modal open onClose={onClose} title={draft.id ? t('plan.editTitle') : t('plan.newTitle')}>
      <form
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (Object.keys(errors).length === 0) onSave(d);
        }}
      >
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="pl-ar">{t('plan.nameAr')}</label>
            <input id="pl-ar" className="input" value={d.nameAr} onChange={(e) => set('nameAr', e.target.value)} aria-invalid={!!err('nameAr')} />
            {err('nameAr') && <span className="error">{err('nameAr')}</span>}
          </div>
          <div className="field">
            <label className="label" htmlFor="pl-en">{t('plan.nameEn')}</label>
            <input id="pl-en" className="input" dir="ltr" value={d.nameEn} onChange={(e) => set('nameEn', e.target.value)} aria-invalid={!!err('nameEn')} />
            {err('nameEn') && <span className="error">{err('nameEn')}</span>}
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="pl-code">{t('plan.code')}</label>
          <input id="pl-code" className="input ltr" value={d.code} onChange={(e) => set('code', e.target.value.toUpperCase())} aria-invalid={!!err('code')} style={{ textAlign: 'start' }} />
          {err('code') ? <span className="error">{err('code')}</span> : <span className="hint">{t('plan.codeHint')}</span>}
        </div>
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="pl-unit">{t('plan.unit')}</label>
            <select id="pl-unit" className="select" value={d.unit} onChange={(e) => set('unit', e.target.value as PlanDraft['unit'])}>
              {UNITS.map((u) => (
                <option key={u} value={u}>{t(`plan.unit.${u}` as StringKey)}</option>
              ))}
            </select>
          </div>
          {hasValue && (
            <div className="field">
              <label className="label" htmlFor="pl-val">{t('plan.value')}</label>
              <input id="pl-val" className="input num" type="number" min={1} value={d.value} onChange={(e) => set('value', Number(e.target.value))} aria-invalid={!!err('value')} />
              {err('value') && <span className="error">{err('value')}</span>}
            </div>
          )}
        </div>
        {d.unit === 'custom' ? (
          <Notice icon="info">{t('plan.customPriceNote')}</Notice>
        ) : (
          <div className="field">
            <label className="label" htmlFor="pl-price">{t('plan.price')}</label>
            <input id="pl-price" className="input num" type="number" min={0} step="0.5" value={d.pricePounds} onChange={(e) => set('pricePounds', Number(e.target.value))} aria-invalid={!!err('pricePounds')} />
            {err('pricePounds') && <span className="error">{err('pricePounds')}</span>}
          </div>
        )}
        {d.unit !== 'session' && (
          <div className="stack-sm">
            <label className="check-row" htmlFor="pl-unl">
              <input id="pl-unl" type="checkbox" checked={d.unlimitedVisits} onChange={(e) => set('unlimitedVisits', e.target.checked)} />
              {t('plan.unlimited')}
            </label>
            {!d.unlimitedVisits && (
              <div className="field">
                <label className="label" htmlFor="pl-vis">{t('plan.visits')}</label>
                <input id="pl-vis" className="input num" type="number" min={1} value={d.visits} onChange={(e) => set('visits', Number(e.target.value))} aria-invalid={!!err('visits')} />
                {err('visits') && <span className="error">{err('visits')}</span>}
              </div>
            )}
          </div>
        )}
        <label className="check-row" htmlFor="pl-feat">
          <input id="pl-feat" type="checkbox" checked={d.featured} onChange={(e) => set('featured', e.target.checked)} />
          {t('plan.featured')}
        </label>
        <label className="check-row" htmlFor="pl-act">
          <input id="pl-act" type="checkbox" checked={d.active} onChange={(e) => set('active', e.target.checked)} />
          {t('plan.active')}
        </label>
        <div className="row wrap">
          <button type="submit" className="btn btn-primary grow">{t('app.save')}</button>
          <button type="button" className="btn btn-secondary grow" onClick={onClose}>{t('app.cancel')}</button>
        </div>
      </form>
    </Modal>
  );
}
