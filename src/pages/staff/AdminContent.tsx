import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useApp } from '../../app/AppContext';
import { useLedger } from '../../app/LedgerContext';
import { useActor } from '../../app/SessionContext';
import { useErrorText } from '../../app/useErrorText';
import { Icon } from '../../components/Icon';
import { mediaUrl } from '../../components/Media';
import { Modal, Notice, PromoCard, Stat } from '../../components/ui';
import { BANNER_FIGURES, type BannerDoc, type BannerFigure, type BannerTone } from '../../domain/content';
import { GYM_TZ } from '../../domain/dates';
import { formatEGP } from '../../domain/plans';
import { PAY_METHODS, type PayMethod } from '../../domain/sales';
import { demoMode } from '../../firebase/client';
import * as data from '../../firebase/data';
import type { StringKey } from '../../i18n/strings';
import { downloadCsv } from './csv';
import { useStaff } from './StaffManager';

/* ================================================================ payments log */

type Range = 'today' | '7' | '30' | 'month';

const DEMO_ROWS = (): data.PaymentRow[] => {
  const now = Date.now();
  const k: data.PaymentRow['kind'][] = ['SALE', 'SALE', 'BALANCE', 'SALE', 'REFUND', 'SALE'];
  const m: PayMethod[] = ['CASH', 'INSTAPAY', 'CASH', 'WALLET', 'CASH', 'BANK'];
  return Array.from({ length: 18 }, (_, i) => ({
    id: `d${i}`,
    memberId: `m${(i % 12) + 1}`,
    membershipId: null,
    kind: k[i % k.length],
    amount: [100000, 270000, 50000, 40000, 30000, 900000][i % 6],
    method: m[i % m.length],
    reference: m[i % m.length] === 'CASH' ? null : `TX${4400 + i}`,
    receiptNo: `R-261015-D${String(i).padStart(4, '0')}`,
    by: i % 2 ? 'cash1' : 'admin',
    at: new Date(now - i * 5 * 3600_000),
  }));
};

export function PaymentsPage() {
  const { t, lang, fmtDate, fmtTime, fmtNum } = useApp();
  const { rowOf } = useLedger();
  const { rows: staff } = useStaff();
  const [range, setRange] = useState<Range>('today');
  const [method, setMethod] = useState<PayMethod | 'ALL'>('ALL');
  const [kind, setKind] = useState<data.PaymentRow['kind'] | 'ALL'>('ALL');
  const [by, setBy] = useState<string>('ALL');
  const [rows, setRows] = useState<data.PaymentRow[] | null>(demoMode ? DEMO_ROWS() : null);

  const since = useMemo(() => {
    const today = DateTime.now().setZone(GYM_TZ).startOf('day');
    return range === 'today' ? today : range === 'month' ? today.startOf('month') : today.minus({ days: Number(range) - 1 });
  }, [range]);

  useEffect(() => {
    if (demoMode) return;
    setRows(null);
    let stop: (() => void) | undefined;
    let cancelled = false;
    data.watchPaymentsSince(since.toJSDate(), setRows, () => setRows([]), 2000).then((u) => (cancelled ? u() : (stop = u)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [since]);

  const staffName = (uid: string) => staff?.find((s) => s.uid === uid)?.displayName ?? (demoMode ? t(uid === 'admin' ? 'role.admin' : 'role.cashier') : uid.slice(0, 6));
  const inRange = (rows ?? []).filter((p) => !demoMode || (p.at && p.at >= since.toJSDate()));
  const shown = inRange.filter((p) => (method === 'ALL' || p.method === method) && (kind === 'ALL' || p.kind === kind) && (by === 'ALL' || p.by === by));
  const signed = (p: data.PaymentRow) => (p.kind === 'REFUND' ? -p.amount : p.amount);
  const total = shown.reduce((s, p) => s + signed(p), 0);
  const refunds = shown.filter((p) => p.kind === 'REFUND').reduce((s, p) => s + p.amount, 0);
  const cash = shown.filter((p) => p.method === 'CASH').reduce((s, p) => s + signed(p), 0);
  const cashiers = [...new Set((rows ?? []).map((p) => p.by))];

  const exportCsv = () =>
    downloadCsv(`payments-${since.toISODate()}.csv`, [
      [t('pay.col.receipt'), t('pay.col.date'), t('pay.col.member'), t('pay.col.kind'), t('pay.col.method'), t('pay.col.ref'), t('pay.col.amount'), t('pay.col.by')],
      ...shown.map((p) => [
        p.receiptNo,
        p.at ? DateTime.fromJSDate(p.at).setZone(GYM_TZ).toFormat('yyyy-MM-dd HH:mm') : '',
        rowOf(p.memberId)?.m.name ?? p.memberId,
        t(`sale.kind.${p.kind}` as StringKey),
        t(`method.${p.method}` as StringKey),
        p.reference ?? '',
        (signed(p) / 100).toFixed(2),
        staffName(p.by),
      ]),
    ]);

  return (
    <div className="stack">
      <div className="row-between wrap">
        <h1 className="page-title">{t('admin.payments')}</h1>
        <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!shown.length}>
          <Icon name="download" />
          {t('report.exportCsv')}
        </button>
      </div>
      <div className="card stack-sm">
        <div className="chips" role="group" aria-label={t('pay.range')}>
          {(['today', '7', '30', 'month'] as Range[]).map((r) => (
            <button key={r} type="button" className="chip" aria-pressed={range === r} onClick={() => setRange(r)}>
              {t(`pay.range.${r}` as StringKey)}
            </button>
          ))}
        </div>
        <div className="grid-3">
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label={t('pay.col.kind')}>
            <option value="ALL">{t('pay.col.kind')}: {t('app.all')}</option>
            {(['SALE', 'BALANCE', 'REFUND'] as const).map((k) => (
              <option key={k} value={k}>{t(`sale.kind.${k}`)}</option>
            ))}
          </select>
          <select className="select" value={method} onChange={(e) => setMethod(e.target.value as typeof method)} aria-label={t('pay.col.method')}>
            <option value="ALL">{t('pay.col.method')}: {t('app.all')}</option>
            {PAY_METHODS.map((m) => (
              <option key={m} value={m}>{t(`method.${m}`)}</option>
            ))}
          </select>
          <select className="select" value={by} onChange={(e) => setBy(e.target.value)} aria-label={t('pay.col.by')}>
            <option value="ALL">{t('pay.col.by')}: {t('app.all')}</option>
            {cashiers.map((u) => (
              <option key={u} value={u}>{staffName(u)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid-3">
        <Stat label={t('pay.net')} value={formatEGP(total, lang)} icon="wallet" delta={{ text: t('sale.todayCount', { n: fmtNum(shown.length) }), up: true }} />
        <Stat label={t('method.CASH')} value={formatEGP(cash, lang)} icon="wallet" />
        <Stat label={t('sale.kind.REFUND')} value={formatEGP(refunds, lang)} icon="refresh" />
      </div>
      <section className="card" style={{ padding: 0 }}>
        {rows === null ? (
          <p className="muted" style={{ padding: 16 }} aria-busy="true">…</p>
        ) : shown.length === 0 ? (
          <p className="muted" style={{ padding: 16 }}>{t('app.noResults')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>{t('pay.col.date')}</th>
                  <th>{t('pay.col.member')}</th>
                  <th>{t('pay.col.kind')}</th>
                  <th>{t('pay.col.method')}</th>
                  <th>{t('pay.col.amount')}</th>
                  <th>{t('pay.col.by')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td className="small">
                      {p.at ? `${fmtDate(p.at, 'short')} · ${fmtTime(p.at)}` : '—'}
                      <div className="xs muted ltr">{p.receiptNo}</div>
                    </td>
                    <td className="primary-cell">
                      <strong>{rowOf(p.memberId)?.m.name ?? '—'}</strong>
                      <div className="xs muted ltr">{rowOf(p.memberId)?.m.code}</div>
                    </td>
                    <td data-label={t('pay.col.kind')}>
                      <span className={`badge ${p.kind === 'REFUND' ? 'badge-danger' : p.kind === 'BALANCE' ? 'badge-warning' : 'badge-success'}`}>{t(`sale.kind.${p.kind}`)}</span>
                    </td>
                    <td data-label={t('pay.col.method')}>
                      {t(`method.${p.method}`)}
                      {p.reference && <div className="xs muted ltr">{p.reference}</div>}
                    </td>
                    <td data-label={t('pay.col.amount')} className="num bold money" style={{ color: p.kind === 'REFUND' ? 'var(--danger)' : undefined }}>
                      {formatEGP(signed(p), lang)}
                    </td>
                    <td data-label={t('pay.col.by')} className="small">{staffName(p.by)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <Notice icon="shield">{t('pay.lockedNote')}</Notice>
    </div>
  );
}

/* ================================================================ banners */

const toneFor: Record<BannerTone, 'red' | 'gold' | 'blue'> = { primary: 'red', vip: 'gold', info: 'blue' };
export const bannerFigure = (b: Pick<BannerDoc, 'figure' | 'tone'>) => ({ figure: b.figure, tone: toneFor[b.tone] });

const DEMO_BANNERS: data.BannerRow[] = [
  { id: 'b1', title: 'جدّد 3 شهور ووفّر 10%', body: 'حتى نهاية الشهر', tag: 'عرض', tone: 'primary', figure: 'curl', status: 'PUBLISHED', vipOnly: false, sort: 0, endsAt: null },
  { id: 'b2', title: 'الجيم مفتوح 24 ساعة يوم الخميس', body: 'للأسبوع ده بس', tag: 'مواعيد', tone: 'info', figure: 'squat', status: 'PUBLISHED', vipOnly: false, sort: 1, endsAt: null },
  { id: 'b3', title: 'جلسة قياسات مجانية لأعضاء VIP', body: 'احجز من الاستقبال', tag: 'VIP', tone: 'vip', figure: 'abs', status: 'DRAFT', vipOnly: true, sort: 2, endsAt: null },
];

export function useBanners(all: boolean) {
  const [rows, setRows] = useState<data.BannerRow[] | null>(demoMode ? DEMO_BANNERS : null);
  useEffect(() => {
    if (demoMode) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    data.watchBanners(all, setRows, () => setRows([])).then((u) => (cancelled ? u() : (stop = u)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [all]);
  return rows;
}

const EMPTY_BANNER: BannerDoc = { title: '', body: '', tag: 'عرض', tone: 'primary', figure: 'flex', status: 'PUBLISHED', vipOnly: false, sort: 0, endsAt: null };

export function BannersPage() {
  const { t } = useApp();
  const rows = useBanners(true);
  const [edit, setEdit] = useState<{ id: string | null; doc: BannerDoc } | null>(null);
  const active = (rows ?? []).filter((b) => b.status !== 'ARCHIVED');
  const archived = (rows ?? []).filter((b) => b.status === 'ARCHIVED');
  return (
    <div className="stack">
      <div className="row-between wrap">
        <div className="stack-sm" style={{ gap: 4 }}>
          <h1 className="page-title">{t('admin.banners')}</h1>
          <p className="muted small">{t('banner.body')}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEdit({ id: null, doc: { ...EMPTY_BANNER, sort: active.length } })}>
          <Icon name="plus" />
          {t('banner.new')}
        </button>
      </div>
      {rows === null ? (
        <p className="muted" aria-busy="true">…</p>
      ) : active.length === 0 ? (
        <p className="muted">{t('banner.empty')}</p>
      ) : (
        <div className="grid-2">
          {active.map((b) => (
            <div key={b.id} className="stack-sm">
              <PromoCard variant={0} figure={bannerFigure(b)} tag={b.tag} tagTone={b.tone} title={b.title} body={b.body} />
              <div className="row wrap" style={{ gap: 6 }}>
                <span className={`badge ${b.status === 'PUBLISHED' ? 'badge-success' : 'badge-neutral'}`}>{t(`banner.status.${b.status}` as StringKey)}</span>
                {b.vipOnly && <span className="badge badge-vip">VIP</span>}
                {b.endsAt && <span className="badge badge-info">{t('banner.until', { date: DateTime.fromJSDate(b.endsAt).setZone(GYM_TZ).minus({ days: 1 }).toISODate()! })}</span>}
                <button className="btn btn-secondary btn-sm" onClick={() => setEdit({ id: b.id, doc: b })}>
                  <Icon name="edit" />
                  {t('plan.edit')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {archived.length > 0 && <p className="muted small">{t('banner.archivedCount', { n: archived.length })}</p>}
      {edit && <BannerEditor id={edit.id} initial={edit.doc} onClose={() => setEdit(null)} />}
    </div>
  );
}

function BannerEditor({ id, initial, onClose }: { id: string | null; initial: BannerDoc; onClose: () => void }) {
  const { t, toast } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const [d, setD] = useState<BannerDoc>(initial);
  const [until, setUntil] = useState(initial.endsAt ? DateTime.fromJSDate(initial.endsAt).setZone(GYM_TZ).minus({ days: 1 }).toISODate()! : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof BannerDoc>(k: K, v: BannerDoc[K]) => setD((x) => ({ ...x, [k]: v }));
  const ok = d.title.trim().length >= 2 && d.tag.trim().length >= 1;

  const save = async (status?: BannerDoc['status']) => {
    if (!ok) return setErr(t('banner.err'));
    const doc: BannerDoc = { ...d, status: status ?? d.status, endsAt: until ? DateTime.fromISO(until, { zone: GYM_TZ }).startOf('day').plus({ days: 1 }).toJSDate() : null };
    if (demoMode) {
      toast(t('app.demoNoSave'));
      return onClose();
    }
    setBusy(true);
    setErr(null);
    try {
      await data.saveBanner(actor, id, doc);
      toast(t('banner.saved'), 'success');
      onClose();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={id ? t('banner.edit') : t('banner.new')}>
      <div className="stack">
        <PromoCard variant={0} figure={bannerFigure(d)} tag={d.tag || '—'} tagTone={d.tone} title={d.title || '…'} body={d.body} />
        <div className="field">
          <label className="label" htmlFor="bn-t">{t('banner.title')}</label>
          <input id="bn-t" className="input" maxLength={60} value={d.title} onChange={(e) => set('title', e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="bn-b">{t('banner.text')}</label>
          <input id="bn-b" className="input" maxLength={140} value={d.body} onChange={(e) => set('body', e.target.value)} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="bn-tag">{t('banner.tag')}</label>
            <input id="bn-tag" className="input" maxLength={20} value={d.tag} onChange={(e) => set('tag', e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="bn-u">{t('banner.untilLabel')}</label>
            <input id="bn-u" className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <span className="label">{t('banner.tone')}</span>
          <div className="chips">
            {(['primary', 'info', 'vip'] as BannerTone[]).map((x) => (
              <button key={x} type="button" className="chip" aria-pressed={d.tone === x} onClick={() => set('tone', x)}>
                {t(`banner.tone.${x}` as StringKey)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="label">{t('banner.picture')}</span>
          <div className="figure-pick">
            {BANNER_FIGURES.map((f: BannerFigure) => (
              <button key={f} type="button" aria-pressed={d.figure === f} onClick={() => set('figure', f)} aria-label={f}>
                <img src={mediaUrl(f)} alt="" />
              </button>
            ))}
          </div>
        </div>
        <label className="check-row" htmlFor="bn-vip">
          <input id="bn-vip" type="checkbox" checked={d.vipOnly} onChange={(e) => set('vipOnly', e.target.checked)} />
          {t('banner.vipOnly')}
        </label>
        {err && <span className="error" role="alert">{err}</span>}
        <div className="row wrap">
          <button className="btn btn-primary grow" disabled={busy} aria-busy={busy} onClick={() => save('PUBLISHED')}>{t('banner.publish')}</button>
          <button className="btn btn-secondary grow" disabled={busy} onClick={() => save('DRAFT')}>{t('banner.draft')}</button>
          {id && (
            <button className="btn btn-danger grow" disabled={busy} onClick={() => save('ARCHIVED')}>
              <Icon name="trash" />
              {t('banner.archive')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
