import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useApp } from '../../app/AppContext';
import { useLedger } from '../../app/LedgerContext';
import { useActor } from '../../app/SessionContext';
import { useErrorText } from '../../app/useErrorText';
import { BarChart } from '../../components/Charts';
import { Icon } from '../../components/Icon';
import { Modal, Notice, Stat } from '../../components/ui';
import { GYM_TZ } from '../../domain/dates';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, monthReport, type FinanceCategory, type FinanceKind, type MonthReport } from '../../domain/finance';
import { egp, formatEGP } from '../../domain/plans';
import { PAY_METHODS, type PayMethod } from '../../domain/sales';
import { demoMode } from '../../firebase/client';
import * as data from '../../firebase/data';
import type { StringKey } from '../../i18n/strings';
import { downloadCsv } from './csv';
import { useStaff } from './StaffManager';

/* ---------------------------------------------------------------- month picker */

function useMonth() {
  const [offset, setOffset] = useState(0);
  const m = DateTime.now().setZone(GYM_TZ).startOf('month').minus({ months: offset });
  return {
    offset,
    setOffset,
    start: m,
    end: m.plus({ months: 1 }),
    fromIso: m.toISODate()!,
    toIso: m.endOf('month').toISODate()!,
  };
}

function MonthPicker({ month }: { month: ReturnType<typeof useMonth> }) {
  const { lang, dir } = useApp();
  // The chevron points right: in Arabic "previous" is to the right, in English to the left.
  const back = dir === 'rtl' ? undefined : 'scaleX(-1)';
  const fwd = dir === 'rtl' ? 'scaleX(-1)' : undefined;
  return (
    <div className="row" style={{ gap: 8 }}>
      <button className="btn btn-secondary btn-sm" onClick={() => month.setOffset(month.offset + 1)} aria-label="previous">
        <Icon name="chevron" style={{ transform: back }} />
      </button>
      <strong style={{ minWidth: 120, textAlign: 'center' }}>{month.start.setLocale(lang === 'ar' ? 'ar-EG' : 'en-GB').toFormat('LLLL yyyy')}</strong>
      <button className="btn btn-secondary btn-sm" onClick={() => month.setOffset(Math.max(0, month.offset - 1))} disabled={month.offset === 0} aria-label="next">
        <Icon name="chevron" style={{ transform: fwd }} />
      </button>
    </div>
  );
}

const catKey = (kind: FinanceKind, c: string) => `fin.cat.${kind === 'EXPENSE' ? 'e' : 'i'}.${c}` as StringKey;

/* ================================================================ income & expenses */

const DEMO_ENTRIES: data.FinanceRow[] = [
  { id: 'e1', kind: 'EXPENSE', category: 'rent', amount: egp(15000), method: 'BANK', date: DateTime.now().toFormat('yyyy-MM-01'), note: 'إيجار الشهر', status: 'ACTIVE', voidReason: '', by: 'admin', at: new Date() },
  { id: 'e2', kind: 'EXPENSE', category: 'salaries', amount: egp(22000), method: 'CASH', date: DateTime.now().toFormat('yyyy-MM-05'), note: 'مرتبات', status: 'ACTIVE', voidReason: '', by: 'admin', at: new Date() },
  { id: 'e3', kind: 'EXPENSE', category: 'utilities', amount: egp(3400), method: 'CASH', date: DateTime.now().toFormat('yyyy-MM-07'), note: 'كهربا ومية', status: 'ACTIVE', voidReason: '', by: 'acc', at: new Date() },
  { id: 'e4', kind: 'INCOME', category: 'products', amount: egp(4200), method: 'CASH', date: DateTime.now().toFormat('yyyy-MM-08'), note: 'مكملات', status: 'ACTIVE', voidReason: '', by: 'acc', at: new Date() },
  { id: 'e5', kind: 'EXPENSE', category: 'maintenance', amount: egp(1200), method: 'CASH', date: DateTime.now().toFormat('yyyy-MM-09'), note: 'صيانة تريدميل', status: 'VOID', voidReason: 'اتسجل مرتين', by: 'acc', at: new Date() },
];

export function FinancePage() {
  const { t, lang, fmtDate, toast } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const month = useMonth();
  const { rows: staff } = useStaff();
  const isAdmin = actor.roles.includes('admin') || actor.roles.includes('developer');
  const [rows, setRows] = useState<data.FinanceRow[] | null>(demoMode ? DEMO_ENTRIES : null);
  const [closes, setCloses] = useState<data.CashCloseRow[] | null>(demoMode ? [] : null);
  const [adding, setAdding] = useState<FinanceKind | null>(null);
  const [voiding, setVoiding] = useState<data.FinanceRow | null>(null);

  useEffect(() => {
    if (demoMode) return;
    setRows(null);
    setCloses(null);
    let s1: (() => void) | undefined;
    let s2: (() => void) | undefined;
    let cancelled = false;
    data.watchEntries(month.fromIso, month.toIso, setRows, () => setRows([])).then((u) => (cancelled ? u() : (s1 = u)));
    data.watchCashCloses(month.fromIso, month.toIso, setCloses, () => setCloses([])).then((u) => (cancelled ? u() : (s2 = u)));
    return () => {
      cancelled = true;
      s1?.();
      s2?.();
    };
  }, [month.fromIso, month.toIso]);

  const live = (rows ?? []).filter((r) => r.status === 'ACTIVE');
  const expenses = live.filter((r) => r.kind === 'EXPENSE').reduce((s, r) => s + r.amount, 0);
  const income = live.filter((r) => r.kind === 'INCOME').reduce((s, r) => s + r.amount, 0);
  const name = (uid: string) => staff?.find((s) => s.uid === uid)?.displayName ?? (demoMode ? t(uid === 'acc' ? 'role.accountant' : 'role.admin') : uid.slice(0, 6));

  return (
    <div className="stack">
      <div className="row-between wrap">
        <h1 className="page-title">{t('admin.finance')}</h1>
        <MonthPicker month={month} />
      </div>
      <div className="row wrap">
        <button className="btn btn-primary" onClick={() => setAdding('EXPENSE')}>
          <Icon name="plus" />
          {t('fin.addExpense')}
        </button>
        <button className="btn btn-secondary" onClick={() => setAdding('INCOME')}>
          <Icon name="plus" />
          {t('fin.addIncome')}
        </button>
      </div>
      <div className="grid-3">
        <Stat label={t('fin.expenses')} value={formatEGP(expenses, lang)} icon="receipt" />
        <Stat label={t('fin.otherIncome')} value={formatEGP(income, lang)} icon="wallet" />
        <Stat label={t('fin.count')} value={String(live.length)} icon="file" />
      </div>
      <section className="card" style={{ padding: 0 }}>
        {rows === null ? (
          <p className="muted" style={{ padding: 16 }} aria-busy="true">…</p>
        ) : rows.length === 0 ? (
          <p className="muted" style={{ padding: 16 }}>{t('fin.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>{t('pay.col.date')}</th>
                  <th>{t('fin.category')}</th>
                  <th>{t('pay.col.amount')}</th>
                  <th>{t('pay.col.method')}</th>
                  <th>{t('pay.col.by')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={r.status === 'VOID' ? { opacity: 0.55 } : undefined}>
                    <td className="small">{fmtDate(r.date, 'short')}</td>
                    <td className="primary-cell">
                      <span className={`badge ${r.kind === 'EXPENSE' ? 'badge-danger' : 'badge-success'}`}>{t(catKey(r.kind, r.category))}</span>
                      {r.note && <div className="xs muted">{r.note}</div>}
                      {r.status === 'VOID' && <div className="xs" style={{ color: 'var(--danger)' }}>{t('fin.voided', { reason: r.voidReason })}</div>}
                    </td>
                    <td data-label={t('pay.col.amount')} className="num bold money" style={{ textDecoration: r.status === 'VOID' ? 'line-through' : undefined }}>
                      {r.kind === 'EXPENSE' ? '− ' : '+ '}
                      {formatEGP(r.amount, lang)}
                    </td>
                    <td data-label={t('pay.col.method')}>{t(`method.${r.method}` as StringKey)}</td>
                    <td data-label={t('pay.col.by')} className="small">{name(r.by)}</td>
                    <td>
                      {isAdmin && r.status === 'ACTIVE' && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setVoiding(r)}>
                          {t('fin.void')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card stack-sm">
        <h2 className="card-title">{t('fin.closesTitle')}</h2>
        {closes === null ? (
          <p className="muted" aria-busy="true">…</p>
        ) : closes.length === 0 ? (
          <p className="muted small">{t('fin.closesEmpty')}</p>
        ) : (
          closes.map((c) => (
            <div key={c.id} className="list-item">
              <div className="grow">
                <strong>{name(c.by)}</strong>
                <div className="xs muted">
                  {fmtDate(c.date, 'short')} · {t('fin.expected')} {formatEGP(c.expected, lang)} · {t('fin.counted')} {formatEGP(c.counted, lang)}
                  {c.note ? ` · ${c.note}` : ''}
                </div>
              </div>
              <span className={`badge ${c.diff === 0 ? 'badge-success' : c.diff < 0 ? 'badge-danger' : 'badge-warning'}`}>
                {c.diff === 0 ? t('fin.balanced') : `${c.diff > 0 ? '+' : '−'} ${formatEGP(Math.abs(c.diff), lang)}`}
              </span>
            </div>
          ))
        )}
      </section>
      <Notice icon="shield">{t('fin.lockedNote')}</Notice>

      {adding && <EntryForm kind={adding} onClose={() => setAdding(null)} />}
      {voiding && (
        <VoidForm
          row={voiding}
          onClose={() => setVoiding(null)}
          onVoid={async (reason) => {
            if (demoMode) return toast(t('app.demoNoSave'));
            try {
              await data.voidEntry(actor, voiding.id, reason);
              toast(t('staff.saved'), 'success');
              setVoiding(null);
            } catch (e) {
              toast(errText(e), 'danger');
            }
          }}
        />
      )}
    </div>
  );
}

function EntryForm({ kind, onClose }: { kind: FinanceKind; onClose: () => void }) {
  const { t, toast } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const cats = kind === 'EXPENSE' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const [category, setCategory] = useState<FinanceCategory>(cats[0]);
  const [pounds, setPounds] = useState<number | ''>('');
  const [method, setMethod] = useState<PayMethod>('CASH');
  const [date, setDate] = useState(DateTime.now().setZone(GYM_TZ).toISODate()!);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const amount = egp(Number(pounds) || 0);
  const save = async () => {
    if (amount <= 0) return setErr(t('fin.err.amount'));
    if (demoMode) {
      toast(t('app.demoNoSave'));
      return onClose();
    }
    setBusy(true);
    setErr(null);
    try {
      await data.addEntry(actor, { kind, category, amount, method, date, note });
      toast(t('staff.saved'), 'success');
      onClose();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={kind === 'EXPENSE' ? t('fin.addExpense') : t('fin.addIncome')}>
      <div className="stack">
        <div className="field">
          <span className="label">{t('fin.category')}</span>
          <div className="chips">
            {cats.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
                {t(catKey(kind, c))}
              </button>
            ))}
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="fe-a">{t('pay.col.amount')}</label>
            <input id="fe-a" className="input num" type="number" min={1} inputMode="decimal" value={pounds} onChange={(e) => setPounds(e.target.value === '' ? '' : Number(e.target.value))} />
          </div>
          <div className="field">
            <label className="label" htmlFor="fe-d">{t('pay.col.date')}</label>
            <input id="fe-d" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="chips">
          {PAY_METHODS.map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={method === m} onClick={() => setMethod(m)}>
              {t(`method.${m}`)}
            </button>
          ))}
        </div>
        <div className="field">
          <label className="label" htmlFor="fe-n">{t('fin.note')}</label>
          <input id="fe-n" className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {err && <span className="error" role="alert">{err}</span>}
        <button className="btn btn-primary" disabled={busy} aria-busy={busy} onClick={save}>{t('app.save')}</button>
        <span className="hint">{t('fin.lockedNote')}</span>
      </div>
    </Modal>
  );
}

function VoidForm({ row, onClose, onVoid }: { row: data.FinanceRow; onClose: () => void; onVoid: (reason: string) => void }) {
  const { t, lang } = useApp();
  const [reason, setReason] = useState('');
  return (
    <Modal open onClose={onClose} title={t('fin.void')}>
      <div className="stack">
        <p>
          {t(catKey(row.kind, row.category))} · <strong>{formatEGP(row.amount, lang)}</strong>
        </p>
        <div className="field">
          <label className="label" htmlFor="fv-r">{t('dues.grantReason')}</label>
          <input id="fv-r" className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <button className="btn btn-danger" disabled={!reason.trim()} onClick={() => onVoid(reason)}>{t('fin.void')}</button>
      </div>
    </Modal>
  );
}

/* ================================================================ cashier: close the drawer */

export function CashCloseCard({ mineCash }: { mineCash: number }) {
  const { t, lang, fmtTime, toast } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const today = DateTime.now().setZone(GYM_TZ).toISODate()!;
  const [closed, setClosed] = useState<data.CashCloseRow | null | undefined>(demoMode ? null : undefined);
  const [open, setOpen] = useState(false);
  const [pounds, setPounds] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (demoMode) return;
    data.readMyClose(actor.uid, today).then(setClosed).catch(() => setClosed(null));
  }, [actor.uid, today]);

  const counted = egp(Number(pounds) || 0);
  const diff = counted - mineCash;
  const save = async () => {
    if (demoMode) {
      toast(t('app.demoNoSave'));
      return setOpen(false);
    }
    setBusy(true);
    try {
      await data.closeMyCash(actor, today, mineCash, counted, note);
      setClosed(await data.readMyClose(actor.uid, today));
      toast(t('fin.closed'), 'success');
      setOpen(false);
    } catch (e) {
      toast(errText(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {closed ? (
        <Notice tone={closed.diff === 0 ? 'info' : 'warning'} icon="lock">
          {t('fin.closedAt', { time: closed.at ? fmtTime(closed.at) : '' })} · {t('fin.counted')} {formatEGP(closed.counted, lang)} · {closed.diff === 0 ? t('fin.balanced') : `${closed.diff > 0 ? '+' : '−'} ${formatEGP(Math.abs(closed.diff), lang)}`}
        </Notice>
      ) : (
        <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)} disabled={closed === undefined}>
          <Icon name="lock" />
          {t('fin.closeDrawer')}
        </button>
      )}
      {open && (
        <Modal open onClose={() => setOpen(false)} title={t('fin.closeDrawer')}>
          <div className="stack">
            <div className="summary stack-sm">
              <div className="row-between">
                <span>{t('fin.expectedLong')}</span>
                <strong className="num">{formatEGP(mineCash, lang)}</strong>
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="cc-c">{t('fin.countedLong')}</label>
              <input id="cc-c" className="input num" type="number" min={0} inputMode="decimal" value={pounds} onChange={(e) => setPounds(e.target.value === '' ? '' : Number(e.target.value))} autoFocus />
            </div>
            {pounds !== '' && (
              <Notice tone={diff === 0 ? 'info' : 'warning'} icon={diff === 0 ? 'check' : 'alert'}>
                {diff === 0 ? t('fin.balanced') : diff > 0 ? t('fin.over', { amount: formatEGP(diff, lang) }) : t('fin.short', { amount: formatEGP(-diff, lang) })}
              </Notice>
            )}
            <div className="field">
              <label className="label" htmlFor="cc-n">{t('fin.note')}</label>
              <input id="cc-n" className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <button className="btn btn-primary" disabled={busy || pounds === ''} aria-busy={busy} onClick={save}>{t('fin.closeConfirm')}</button>
            <span className="hint">{t('fin.closeOnce')}</span>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ================================================================ monthly report */

const DEMO_REPORT: MonthReport = monthReport({
  payments: [
    ...Array.from({ length: 34 }, (_, i) => ({ kind: 'SALE' as const, amount: [100000, 270000, 40000][i % 3], method: (['CASH', 'INSTAPAY', 'WALLET', 'CASH'] as PayMethod[])[i % 4] })),
    { kind: 'BALANCE', amount: 50000, method: 'CASH' },
    { kind: 'REFUND', amount: 30000, method: 'CASH' },
  ],
  entries: DEMO_ENTRIES,
  memberships: Array.from({ length: 34 }, (_, i) => ({ renewal: i % 3 !== 0, plan: [{ code: 'M1', nameAr: 'شهر', nameEn: '1 month' }, { code: 'M3', nameAr: '3 شهور', nameEn: '3 months' }, { code: 'WEEK', nameAr: 'أسبوع', nameEn: '1 week' }][i % 3], status: i === 5 ? 'CANCELLED' : 'ACTIVE', due: 100000 })),
});

export function ReportsPage() {
  const { t, lang, fmtNum, fmtDate } = useApp();
  const month = useMonth();
  const { balances, rows } = useLedger();
  const [state, setState] = useState<{ report: MonthReport; raw: Awaited<ReturnType<typeof data.readMonth>> | null; visits: number | null } | null>(
    demoMode ? { report: DEMO_REPORT, raw: null, visits: 1240 } : null,
  );
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (demoMode) return;
    setState(null);
    setErr(false);
    let alive = true;
    data
      .readMonth(month.start.toJSDate(), month.end.toJSDate(), month.fromIso, month.toIso)
      .then((raw) => {
        if (!alive) return;
        const report = monthReport({ payments: raw.payments, entries: raw.entries ?? [], memberships: raw.memberships });
        setState({ report, raw, visits: raw.visits });
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [month.fromIso, month.toIso, month.start, month.end]);

  const r = state?.report;
  const dues = balances.reduce((s, b) => s + b.remaining, 0);
  const money = (p: number) => formatEGP(p, lang);
  const name = (id: string) => rows?.find((x) => x.m.id === id)?.m.name ?? id;
  const stamp = month.start.toFormat('yyyy-MM');

  const exports = useMemo(
    () => [
      {
        key: 'payments',
        label: t('report.xPayments'),
        run: () =>
          downloadCsv(`payments-${stamp}.csv`, [
            [t('pay.col.receipt'), t('pay.col.date'), t('pay.col.member'), t('pay.col.kind'), t('pay.col.method'), t('pay.col.amount')],
            ...(state?.raw?.payments ?? []).map((p) => [p.receiptNo, p.at ? DateTime.fromJSDate(p.at).setZone(GYM_TZ).toFormat('yyyy-MM-dd HH:mm') : '', name(p.memberId), t(`sale.kind.${p.kind}` as StringKey), t(`method.${p.method}` as StringKey), ((p.kind === 'REFUND' ? -p.amount : p.amount) / 100).toFixed(2)]),
          ]),
      },
      {
        key: 'memberships',
        label: t('report.xMemberships'),
        run: () =>
          downloadCsv(`memberships-${stamp}.csv`, [
            [t('pay.col.date'), t('pay.col.member'), t('cashier.plan'), t('report.type'), t('reg.due'), t('pay.paidNow'), t('admin.colStatus')],
            ...(state?.raw?.memberships ?? []).map((m) => [m.createdAt ? DateTime.fromJSDate(m.createdAt).setZone(GYM_TZ).toISODate()! : '', name(m.memberId), m.plan.nameAr, m.renewal ? t('report.renewal') : t('report.new'), (m.due / 100).toFixed(2), (m.paidNow / 100).toFixed(2), m.status]),
          ]),
      },
      {
        key: 'entries',
        label: t('report.xEntries'),
        run: () =>
          downloadCsv(`income-expenses-${stamp}.csv`, [
            [t('pay.col.date'), t('fin.kind'), t('fin.category'), t('pay.col.amount'), t('pay.col.method'), t('fin.note'), t('admin.colStatus')],
            ...(state?.raw?.entries ?? []).map((e) => [e.date, e.kind === 'EXPENSE' ? t('fin.expense') : t('fin.income'), t(catKey(e.kind, e.category)), (e.amount / 100).toFixed(2), t(`method.${e.method}` as StringKey), e.note, e.status === 'VOID' ? `VOID: ${e.voidReason}` : '']),
          ]),
      },
      {
        key: 'members',
        label: t('report.xMembers'),
        run: () =>
          downloadCsv(`members-${DateTime.now().toISODate()}.csv`, [
            [t('admin.colCode'), t('admin.colName'), t('admin.colPhone'), t('admin.colPlan'), t('admin.colEnds'), t('admin.colStatus'), t('pay.remaining'), 'VIP', t('member.coach')],
            ...(rows ?? []).map((x) => [x.m.code, x.m.name, '0' + x.m.phone.slice(3), x.planAr, x.lastDay ? x.lastDay.toISODate()! : '', t(`status.${x.phase}` as StringKey), ((balances.find((b) => b.memberId === x.m.id)?.remaining ?? 0) / 100).toFixed(2), x.m.vip, x.coach ?? '']),
          ]),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, rows, balances, lang, stamp],
  );

  return (
    <div className="stack">
      <div className="row-between wrap">
        <h1 className="page-title">{t('admin.reports')}</h1>
        <MonthPicker month={month} />
      </div>
      {err && <Notice tone="danger" icon="alert">{t('acc.loadError')}</Notice>}
      {!r ? (
        !err && <p className="muted" aria-busy="true">…</p>
      ) : (
        <>
          <div className="grid-kpi">
            <Stat label={t('report.receipts')} value={money(r.receipts)} icon="wallet" delta={r.refunds ? { text: `${t('sale.kind.REFUND')} ${money(r.refunds)}`, up: false } : undefined} />
            <Stat label={t('fin.otherIncome')} value={money(r.otherIncome)} icon="tag" />
            <Stat label={t('fin.expenses')} value={money(r.expenses)} icon="receipt" />
            <Stat label={t('report.net')} value={money(r.net)} icon="chart" delta={{ text: r.net >= 0 ? t('report.profit') : t('report.loss'), up: r.net >= 0 }} />
          </div>
          <div className="grid-kpi">
            <Stat label={t('report.new')} value={fmtNum(r.newMembers)} icon="plus" />
            <Stat label={t('report.renewals')} value={fmtNum(r.renewals)} icon="refresh" />
            <Stat label={t('status.CANCELLED')} value={fmtNum(r.cancelled)} icon="x" />
            <Stat label={t('checkin.visits')} value={state?.visits == null ? '—' : fmtNum(state.visits)} icon="clock" />
          </div>
          <div className="grid-2" style={{ gridTemplateColumns: undefined }}>
            <section className="card stack-sm">
              <h2 className="card-title">{t('report.byMethod')}</h2>
              <BarChart ariaLabel={t('report.byMethod')} bars={PAY_METHODS.map((m) => ({ label: t(`method.${m}`), value: Math.round(r.byMethod[m] / 100) }))} />
            </section>
            <section className="card stack-sm">
              <h2 className="card-title">{t('report.byExpense')}</h2>
              {Object.keys(r.byExpense).length === 0 ? (
                <p className="muted small">—</p>
              ) : (
                <BarChart ariaLabel={t('report.byExpense')} bars={Object.entries(r.byExpense).map(([c, v]) => ({ label: t(catKey('EXPENSE', c)), value: Math.round(v / 100) }))} />
              )}
            </section>
          </div>
          <div className="grid-2">
            <section className="card stack-sm">
              <h2 className="card-title">{t('report.topPlans')}</h2>
              {r.topPlans.length === 0 ? (
                <p className="muted small">—</p>
              ) : (
                r.topPlans.map((p) => (
                  <div key={p.code} className="row-between">
                    <span>{lang === 'ar' ? p.nameAr : p.nameEn}</span>
                    <strong className="num">{fmtNum(p.count)}</strong>
                  </div>
                ))
              )}
            </section>
            <section className="card stack-sm">
              <h2 className="card-title">{t('dues.total')}</h2>
              <strong style={{ fontSize: '1.5rem' }} className="num">{money(dues)}</strong>
              <span className="xs muted">{t('report.duesNow', { date: fmtDate(DateTime.now()) })}</span>
            </section>
          </div>
          <section className="card stack-sm">
            <h2 className="card-title">{t('report.exportCsv')}</h2>
            <div className="row wrap">
              {exports.map((x) => (
                <button key={x.key} className="btn btn-secondary btn-sm" onClick={x.run} disabled={demoMode && x.key !== 'members'}>
                  <Icon name="download" />
                  {x.label}
                </button>
              ))}
            </div>
            <span className="hint">{t('report.exportHint')}</span>
          </section>
        </>
      )}
    </div>
  );
}
