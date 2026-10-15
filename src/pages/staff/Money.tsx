import { useEffect, useState, type FormEvent } from 'react';
import { DateTime } from 'luxon';
import { useApp } from '../../app/AppContext';
import { useGym } from '../../app/GymContext';
import { useLedger, type RowBalance } from '../../app/LedgerContext';
import { useErrorText } from '../../app/useErrorText';
import { Icon } from '../../components/Icon';
import { Modal, Notice } from '../../components/ui';
import { GYM_TZ } from '../../domain/dates';
import { egp, formatEGP } from '../../domain/plans';
import { PAY_METHODS, type PayMethod } from '../../domain/sales';
import { formatEgyptPhone } from '../../domain/text';
import { demoMode } from '../../firebase/client';
import * as data from '../../firebase/data';
import { ShareText } from './Accounts';
import type { MemberRow } from './shared';

/* ---------------------------------------------------------------- method + reference */

export function MethodPicker({ method, setMethod, reference, setReference, id = 'pm' }: { method: PayMethod; setMethod: (m: PayMethod) => void; reference: string; setReference: (r: string) => void; id?: string }) {
  const { t } = useApp();
  return (
    <>
      <div className="field">
        <span className="label" id={`${id}-l`}>{t('reg.method')}</span>
        <div className="chips" role="group" aria-labelledby={`${id}-l`}>
          {PAY_METHODS.map((m) => (
            <button type="button" key={m} className="chip" aria-pressed={method === m} onClick={() => setMethod(m)}>
              {t(`method.${m}`)}
            </button>
          ))}
        </div>
        <span className="hint">{method === 'CASH' ? t('reg.cashNote') : t('sale.transferNote')}</span>
      </div>
      {method !== 'CASH' && (
        <div className="field">
          <label className="label" htmlFor={`${id}-ref`}>{t('sale.reference')}</label>
          <input id={`${id}-ref`} className="input ltr" maxLength={40} value={reference} onChange={(e) => setReference(e.target.value)} style={{ textAlign: 'start' }} />
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- collecting the remainder */

export function PayRemainderModal({ row, onClose }: { row: MemberRow; onClose: () => void }) {
  const { t, lang, fmtDate, toast } = useApp();
  const { balanceOf, payRemainder } = useLedger();
  const errText = useErrorText();
  const b = balanceOf(row.m.id);
  const [pounds, setPounds] = useState<number | ''>(b ? b.remaining / 100 : '');
  const [method, setMethod] = useState<PayMethod>('CASH');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ no: string; amount: number; left: number } | null>(null);
  const money = (p: number) => formatEGP(p, lang);

  if (!b && !receipt) {
    return (
      <Modal open onClose={onClose} title={t('dues.collect')}>
        <p className="muted">{t('sale.noBalance')}</p>
      </Modal>
    );
  }

  const amount = egp(Number(pounds) || 0);
  const ok = !!b && amount > 0 && amount <= b.remaining;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok || !b) return setErr(t('sale.err.amount', { max: money(b?.remaining ?? 0) }));
    setErr(null);
    setBusy(true);
    try {
      const no = await payRemainder(row.m.id, amount, method, reference || null);
      setReceipt({ no, amount, left: b.remaining - amount });
      toast(t('sale.paid', { amount: money(amount) }), 'success');
    } catch (ex) {
      setErr(errText(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`${t('dues.collect')} — ${row.m.name}`}>
      {receipt ? (
        <ReceiptView
          lines={[
            [t('sale.receiptKind'), t('sale.kind.BALANCE')],
            [t('sale.paidAmount'), money(receipt.amount)],
            [t('reg.method'), t(`method.${method}`)],
            [t('pay.remaining'), receipt.left > 0 ? money(receipt.left) : t('sale.settled')],
          ]}
          receiptNo={receipt.no}
          row={row}
          onClose={onClose}
        />
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <div className="summary stack-sm">
            <div className="row-between">
              <span>{t('pay.remaining')}</span>
              <span className="total num">{money(b!.remaining)}</span>
            </div>
            <span className="xs muted">{t('pay.remainingNote', { date: fmtDate(b!.dueDate) })}</span>
          </div>
          <div className="field">
            <label className="label" htmlFor="pr-amt">{t('sale.payAmount')}</label>
            <input id="pr-amt" className="input num" type="number" min={1} inputMode="decimal" value={pounds} onChange={(e) => setPounds(e.target.value === '' ? '' : Number(e.target.value))} aria-invalid={!ok} />
            <span className="hint">{t('sale.partialHint')}</span>
          </div>
          <MethodPicker method={method} setMethod={setMethod} reference={reference} setReference={setReference} id="pr" />
          {err && <span className="error" role="alert">{err}</span>}
          <button className="btn btn-primary btn-lg btn-block" disabled={busy || !ok} aria-busy={busy}>
            <Icon name="wallet" />
            {t('sale.collectNow', { amount: money(ok ? amount : 0) })}
          </button>
        </form>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------- receipt */

/** The receipt after a payment: printable, and ready to send on WhatsApp. */
export function ReceiptView({ lines, receiptNo, row, onClose, extra }: { lines: [string, string][]; receiptNo: string; row: Pick<MemberRow, 'm'>; onClose?: () => void; extra?: React.ReactNode }) {
  const { t, fmtDate, fmtTime } = useApp();
  const gym = useGym();
  const now = DateTime.now().setZone(GYM_TZ);
  const text = [
    `🧾 *${gym.nameAr}* — ${t('sale.receipt')} ${receiptNo}`,
    `👤 ${row.m.name} (${row.m.code})`,
    ...lines.map(([k, v]) => `• ${k}: *${v}*`),
    `🕒 ${fmtDate(now)} ${fmtTime(now)}`,
  ].join('\n');
  return (
    <div className="stack">
      <section className="receipt stack-sm" aria-label={t('sale.receipt')}>
        <div className="row-between">
          <strong>{gym.nameAr}</strong>
          <span className="ltr small">{receiptNo}</span>
        </div>
        <div className="small">
          {row.m.name} · <span className="ltr">{row.m.code}</span> · <span className="ltr">{formatEgyptPhone(row.m.phone)}</span>
        </div>
        <div className="divider" />
        {lines.map(([k, v]) => (
          <div key={k} className="row-between">
            <span>{k}</span>
            <strong className="num">{v}</strong>
          </div>
        ))}
        <div className="divider" />
        <span className="xs muted">
          {fmtDate(now)} · {fmtTime(now)}
        </span>
      </section>
      {extra}
      <ShareText text={text} phone={row.m.phone} />
      <div className="row wrap no-print">
        <button type="button" className="btn btn-secondary grow" onClick={() => window.print()}>
          <Icon name="print" />
          {t('admin.print')}
        </button>
        {onClose && (
          <button type="button" className="btn btn-ghost grow" onClick={onClose}>
            {t('app.close')}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- today's receipts */

export interface DayTotals {
  loading: boolean;
  count: number;
  total: number; // sales + remainders − refunds
  refunds: number;
  byMethod: Record<PayMethod, number>;
  mine: number; // collected by the signed-in staff member
  mineCash: number; // cash in this staff member's drawer (cash receipts − cash refunds)
}

/** Live receipts since 00:00 today (gym time); sample totals in the preview. */
export function useTodayTotals(uid: string): DayTotals {
  const [rows, setRows] = useState<data.PaymentRow[] | null>(null);
  useEffect(() => {
    if (demoMode) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    const since = DateTime.now().setZone(GYM_TZ).startOf('day').toJSDate();
    data.watchPaymentsSince(since, setRows, () => setRows([])).then((u) => (cancelled ? u() : (stop = u)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  const byMethod: Record<PayMethod, number> = { CASH: 0, WALLET: 0, INSTAPAY: 0, BANK: 0 };
  if (demoMode) return { loading: false, count: 14, total: egp(8650), refunds: 0, byMethod: { ...byMethod, CASH: egp(6150), INSTAPAY: egp(2500) }, mine: egp(4300), mineCash: egp(3800) };
  let total = 0;
  let refunds = 0;
  let mine = 0;
  let mineCash = 0;
  for (const p of rows ?? []) {
    const signed = p.kind === 'REFUND' ? -p.amount : p.amount;
    total += signed;
    if (p.kind === 'REFUND') refunds += p.amount;
    byMethod[p.method] += signed;
    if (p.by === uid) mine += signed;
    if (p.by === uid && p.method === 'CASH') mineCash += signed;
  }
  return { loading: rows === null, count: rows?.length ?? 0, total, refunds, byMethod, mine, mineCash };
}

export function balanceLine(b: RowBalance | null, lang: 'ar' | 'en') {
  return b ? formatEGP(b.remaining, lang) : '—';
}

export function LiveNotice({ children }: { children: React.ReactNode }) {
  return <Notice icon="info">{children}</Notice>;
}
