import { GenderSettings } from './GenderUI';
import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useApp } from '../../app/AppContext';
import { useLedger, type SettingsView } from '../../app/LedgerContext';
import { useActor } from '../../app/SessionContext';
import { useErrorText } from '../../app/useErrorText';
import { Icon } from '../../components/Icon';
import { Modal, Notice, Stat, VipBadge } from '../../components/ui';
import { GYM_TZ } from '../../domain/dates';
import { balanceStatus, daysLate, quoteRefund, type BalanceStatus } from '../../domain/payments';
import { egp, formatEGP } from '../../domain/plans';
import { GRACE_MAX_DAYS, paidOn } from '../../domain/sales';
import { demoMode } from '../../firebase/client';
import * as data from '../../firebase/data';
import { memberDates, planById } from '../../mock/demo';
import type { StringKey } from '../../i18n/strings';
import { PayRemainderModal } from './Money';
import type { MemberRow } from './shared';

const STATUS_BADGE: Record<Exclude<BalanceStatus, 'NONE'>, string> = {
  ON_TIME: 'badge-warning',
  OVERDUE_BLOCKED: 'badge-danger',
  OVERDUE_GRACE: 'badge-info',
};

/** Totals for the dashboard tile. */
export function useDuesSummary() {
  const { balances } = useLedger();
  const now = DateTime.now();
  const open = balances.filter((b) => b.remaining > 0);
  return {
    total: open.reduce((sum, b) => sum + b.remaining, 0),
    late: open.filter((b) => balanceStatus(now, { remaining: b.remaining, dueDate: b.dueDate, graceUntil: b.graceUntil }) !== 'ON_TIME').length,
  };
}

export function DuesPage() {
  const { t, lang, fmtDate, toast } = useApp();
  const { balances, revokeGrant, cancellations, rowOf, settings, live } = useLedger();
  const errText = useErrorText();
  const [granting, setGranting] = useState<MemberRow | null>(null);
  const [cancelling, setCancelling] = useState<MemberRow | null>(null);
  const [collecting, setCollecting] = useState<MemberRow | null>(null);
  const now = DateTime.now();
  const open = balances.filter((b) => b.remaining > 0);
  const { total, late } = useDuesSummary();

  const revoke = async (id: string) => {
    try {
      await revokeGrant(id);
      toast(t('dues.revoked'));
    } catch (e) {
      toast(errText(e), 'danger');
    }
  };

  return (
    <div className="stack">
      <h1 className="page-title">{t('dues.title')}</h1>
      <div className="grid-2">
        <Stat label={t('dues.total')} value={formatEGP(total, lang)} icon="wallet" />
        <Stat label={t('dues.lateTitle')} value={t('dues.lateCount', { n: late })} icon="alert" />
      </div>

      <section className="card">
        {open.length === 0 ? (
          <p className="muted">{t('dues.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>{t('dues.colMember')}</th>
                  <th>{t('dues.colPaid')}</th>
                  <th>{t('dues.colRemaining')}</th>
                  <th>{t('dues.colDue')}</th>
                  <th>{t('dues.colStatus')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {open
                  .map((b) => ({ b, st: balanceStatus(now, { remaining: b.remaining, dueDate: b.dueDate, graceUntil: b.graceUntil }) as Exclude<BalanceStatus, 'NONE'>, r: rowOf(b.memberId) }))
                  .filter((x) => x.r)
                  .sort((x, y) => x.b.dueDate.localeCompare(y.b.dueDate))
                  .map(({ b, st, r }) => {
                    const row = r!;
                    const remind = t('dues.remindText', { name: row.m.name, amount: formatEGP(b.remaining, 'ar'), date: fmtDate(b.dueDate) });
                    return (
                      <tr key={b.memberId}>
                        <td className="primary-cell">
                          <div className="row wrap" style={{ gap: 6 }}>
                            <strong>{row.m.name}</strong>
                            <VipBadge tier={row.m.vip} label={false} />
                            <span className="muted xs ltr">{row.m.code}</span>
                          </div>
                        </td>
                        <td data-label={t('dues.colPaid')} className="num money">{formatEGP(b.paid, lang)}</td>
                        <td data-label={t('dues.colRemaining')} className="num bold money">{formatEGP(b.remaining, lang)}</td>
                        <td data-label={t('dues.colDue')}>
                          <div className="money">{fmtDate(b.dueDate, 'short')}</div>
                          {st !== 'ON_TIME' && <div className="xs money" style={{ color: 'var(--danger)' }}>{t('dues.daysLate', { n: daysLate(now, { remaining: b.remaining, dueDate: b.dueDate, graceUntil: b.graceUntil }) })}</div>}
                        </td>
                        <td>
                          <div className="stack-sm" style={{ gap: 4 }}>
                            <span className={`badge ${STATUS_BADGE[st]}`}>{t(`dues.${st}` as StringKey)}</span>
                            {st === 'OVERDUE_GRACE' && b.graceUntil && (
                              <span className="xs muted">
                                {t('dues.graceUntil', { date: fmtDate(b.graceUntil, 'short') })}
                                {b.graceReason ? ` · ${b.graceReason}` : ''}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="primary-cell">
                          <div className="row wrap" style={{ gap: 6 }}>
                            <button className="btn btn-secondary btn-sm" onClick={() => setCollecting(row)}>
                              <Icon name="wallet" />
                              {t('dues.collect')}
                            </button>
                            {b.graceUntil ? (
                              <button className="btn btn-secondary btn-sm" onClick={() => revoke(b.memberId)}>
                                {t('dues.revoke')}
                              </button>
                            ) : (
                              <button className="btn btn-secondary btn-sm" onClick={() => setGranting(row)}>
                                <Icon name="shield" />
                                {t('dues.grant')}
                              </button>
                            )}
                            <a className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer" href={`https://wa.me/${row.m.phone.replace('+', '')}?text=${encodeURIComponent(remind)}`}>
                              <Icon name="whatsapp" />
                              {t('dues.remind')}
                            </a>
                            <button className="btn btn-danger btn-sm" onClick={() => setCancelling(row)}>
                              {t('dues.cancel')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!live && cancellations.length > 0 && (
        <section className="card stack-sm">
          <h2 className="card-title">{t('dues.cancelledList')}</h2>
          <div className="list">
            {cancellations.map((c) => (
              <div key={c.memberId} className="list-item">
                <div className="grow">
                  <strong>{rowOf(c.memberId)?.m.name ?? c.memberId}</strong>
                  <div className="xs muted">{c.reason}</div>
                </div>
                <span className="badge badge-neutral">{t('refund.refunded', { amount: formatEGP(c.refund, lang) })}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <Notice icon="shield">{t('refund.who')}</Notice>

      {granting && <GrantModal row={granting} maxDays={Math.min(GRACE_MAX_DAYS, Math.max(settings.maxGraceDays, 1))} onClose={() => setGranting(null)} />}
      {cancelling && <RefundModal row={cancelling} onClose={() => setCancelling(null)} />}
      {collecting && <PayRemainderModal row={collecting} onClose={() => setCollecting(null)} />}
    </div>
  );
}

function GrantModal({ row, maxDays, onClose }: { row: MemberRow; maxDays: number; onClose: () => void }) {
  const { t, toast, fmtDate } = useApp();
  const { grant } = useLedger();
  const errText = useErrorText();
  const today = DateTime.now().setZone(GYM_TZ).startOf('day');
  const min = today.toISODate()!;
  const max = today.plus({ days: maxDays }).toISODate()!;
  const [until, setUntil] = useState(today.plus({ days: 3 }).toISODate()!);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dateOk = until >= min && until <= max;
  const reasonOk = reason.trim().length > 0;

  return (
    <Modal open onClose={onClose} title={t('dues.grantTitle', { name: row.m.name })}>
      <form
        className="stack"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setTouched(true);
          if (!dateOk || !reasonOk) return;
          setBusy(true);
          setErr(null);
          try {
            await grant(row.m.id, until, reason.trim());
            toast(t('dues.grantSaved', { date: fmtDate(until) }), 'success');
            onClose();
          } catch (ex) {
            setErr(errText(ex));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>{t('dues.grantBody')}</p>
        <div className="field">
          <label className="label" htmlFor="g-until">{t('dues.grantUntil')}</label>
          <input id="g-until" className="input" type="date" min={min} max={max} value={until} onChange={(e) => setUntil(e.target.value)} aria-invalid={!dateOk} />
          {!dateOk && <span className="error">{t('dues.untilRange', { n: maxDays })}</span>}
        </div>
        <div className="field">
          <label className="label" htmlFor="g-reason">{t('dues.grantReason')}</label>
          <input id="g-reason" className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={touched && !reasonOk} />
          {touched && !reasonOk && <span className="error">{t('dues.reasonRequired')}</span>}
        </div>
        {err && <span className="error" role="alert">{err}</span>}
        <div className="row wrap">
          <button type="submit" className="btn btn-primary grow" disabled={busy} aria-busy={busy}>{t('dues.grant')}</button>
          <button type="button" className="btn btn-secondary grow" onClick={onClose}>{t('app.cancel')}</button>
        </div>
      </form>
    </Modal>
  );
}

interface RefundBasis {
  paid: number;
  price: number;
  start: DateTime;
  end: DateTime;
  record: data.MembershipRecord | null;
}

/** Cancelling a membership (admin): the suggested refund follows the policy, an override needs a reason. */
export function RefundModal({ row, onClose }: { row: MemberRow; onClose: () => void }) {
  const { t, lang, toast } = useApp();
  const { balances, cancel, balanceOf } = useLedger();
  const actor = useActor();
  const errText = useErrorText();
  const [basis, setBasis] = useState<RefundBasis | null | 'none'>(null);

  useEffect(() => {
    if (demoMode) {
      const plan = planById(row.m.planId);
      const { start, end } = memberDates({ id: row.m.id, planId: row.m.planId, startsAt: row.start!.toISODate()! } as never);
      const b = balances.find((x) => x.memberId === row.m.id);
      setBasis({ paid: b ? b.paid : plan.price, price: plan.price, start, end, record: null });
      return;
    }
    const s = row.doc?.membership;
    if (!s || s.status !== 'ACTIVE') return setBasis('none');
    data
      .readMembership(s.id)
      .then((ms) => {
        if (!ms || ms.status !== 'ACTIVE') return setBasis('none');
        setBasis({
          paid: paidOn(ms.id, ms, row.doc?.balance ?? null),
          price: ms.plan.price || ms.due,
          start: DateTime.fromJSDate(ms.startsAt).setZone(GYM_TZ),
          end: DateTime.fromJSDate(ms.endsAt).setZone(GYM_TZ),
          record: ms,
        });
      })
      .catch(() => setBasis('none'));
  }, [row, balances]);

  return (
    <Modal open onClose={onClose} title={t('refund.title', { name: row.m.name })}>
      {basis === null ? (
        <p className="muted" aria-busy="true">{t('refund.loading')}</p>
      ) : basis === 'none' ? (
        <Notice icon="info">{t('refund.notLatest')}</Notice>
      ) : (
        <RefundForm
          basis={basis}
          onDone={async (refund, overridden, reason) => {
            if (demoMode) {
              cancel({ memberId: row.m.id, refund, overridden, reason, at: DateTime.now().toISO()! });
            } else {
              await data.cancelWithRefund(actor, row.doc!, basis.record!, refund, overridden, reason);
            }
            toast(t('refund.done', { amount: formatEGP(refund, lang) }), 'success');
            onClose();
          }}
          onClose={onClose}
          errText={errText}
          owes={balanceOf(row.m.id)?.remaining ?? 0}
        />
      )}
    </Modal>
  );
}

function RefundForm({ basis, onDone, onClose, errText }: { basis: RefundBasis; onDone: (refund: number, overridden: boolean, reason: string) => Promise<void>; onClose: () => void; errText: (e: unknown) => string; owes: number }) {
  const { t, lang } = useApp();
  const q = useMemo(() => quoteRefund(DateTime.now(), basis.paid, basis.price, basis.start, basis.end), [basis]);
  const [override, setOverride] = useState(false);
  const [amount, setAmount] = useState<number | ''>(q.refund / 100);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const refund = override ? egp(Number(amount) || 0) : q.refund;
  const amountOk = refund >= 0 && refund <= basis.paid;
  const reasonOk = reason.trim().length > 0;
  const money = (p: number) => formatEGP(p, lang);

  return (
    <form
      className="stack"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setTouched(true);
        if (!amountOk || !reasonOk) return;
        setBusy(true);
        setErr(null);
        try {
          await onDone(refund, override, reason.trim());
        } catch (ex) {
          setErr(errText(ex));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="summary stack-sm">
        <div className="row-between">
          <span>{t('refund.paid')}</span>
          <span className="num bold">{money(q.paid)}</span>
        </div>
        <div className="row-between">
          <span>{t('refund.used')}</span>
          <span className="num">{t('refund.usedOf', { used: q.usedDays, total: q.totalDays })}</span>
        </div>
        <div className="row-between">
          <span>{t('refund.usedValue')}</span>
          <span className="num">− {money(q.usedValue)}</span>
        </div>
        <div className="divider" />
        <div className="row-between">
          <span className="bold">{t('refund.suggested')}</span>
          <span className="total num">{money(q.refund)}</span>
        </div>
        <span className="xs muted">{q.usedDays === 0 ? t('refund.ruleBefore') : t('refund.ruleAfter')}</span>
      </div>
      <label className="check-row" htmlFor="rf-ov">
        <input id="rf-ov" type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
        {t('refund.override')}
      </label>
      {override && (
        <div className="field">
          <label className="label" htmlFor="rf-amt">{t('refund.amount')}</label>
          <input id="rf-amt" className="input num" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))} aria-invalid={!amountOk} />
          {!amountOk && <span className="error">{t('refund.err.amount', { max: money(basis.paid) })}</span>}
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="rf-reason">{t('refund.reason')}</label>
        <input id="rf-reason" className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={touched && !reasonOk} />
        {touched && !reasonOk && <span className="error">{t('dues.reasonRequired')}</span>}
      </div>
      <Notice tone="warning" icon="alert">{t('refund.who')}</Notice>
      {err && <span className="error" role="alert">{err}</span>}
      <div className="row wrap">
        <button type="submit" className="btn btn-danger-solid grow" disabled={busy} aria-busy={busy}>{t('refund.confirm')}</button>
        <button type="button" className="btn btn-secondary grow" onClick={onClose}>{t('app.cancel')}</button>
      </div>
    </form>
  );
}

export function SettingsPage() {
  const { t, toast } = useApp();
  const { settings, saveSettings, settingsSaved } = useLedger();
  const errText = useErrorText();
  const [d, setD] = useState<SettingsView>(settings);
  const [busy, setBusy] = useState(false);
  useEffect(() => setD(settings), [settings]);
  const ok =
    d.minPercent >= 10 && d.minPercent <= 90 && d.graceDays >= 1 && d.graceDays <= 60 && d.maxGraceDays >= d.graceDays && d.maxGraceDays <= 60 && Number.isInteger(d.cashierMaxDiscount) && d.cashierMaxDiscount >= 0 && d.cashierMaxDiscount <= 100;
  const num = (k: keyof Omit<SettingsView, 'enabled'>) => (e: React.ChangeEvent<HTMLInputElement>) => setD((x) => ({ ...x, [k]: Number(e.target.value) }));

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <h1 className="page-title">{t('admin.settings')}</h1>
      {!settingsSaved && <Notice tone="warning" icon="settings">{t('settings.notSaved')}</Notice>}
      <form
        className="card stack"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ok) return;
          setBusy(true);
          try {
            await saveSettings(d);
            toast(t('settings.saved'), 'success');
          } catch (ex) {
            toast(errText(ex), 'danger');
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="section-title">{t('settings.depositTitle')}</h2>
        <label className="check-row" htmlFor="st-en">
          <input id="st-en" type="checkbox" checked={d.enabled} onChange={(e) => setD((x) => ({ ...x, enabled: e.target.checked }))} />
          {t('settings.depositEnabled')}
        </label>
        <div className="grid-3">
          <div className="field">
            <label className="label" htmlFor="st-min">{t('settings.minPercent')}</label>
            <input id="st-min" className="input num" type="number" min={10} max={90} value={d.minPercent} onChange={num('minPercent')} disabled={!d.enabled} />
          </div>
          <div className="field">
            <label className="label" htmlFor="st-gr">{t('settings.graceDays')}</label>
            <input id="st-gr" className="input num" type="number" min={1} max={60} value={d.graceDays} onChange={num('graceDays')} disabled={!d.enabled} />
          </div>
          <div className="field">
            <label className="label" htmlFor="st-max">{t('settings.maxGraceDays')}</label>
            <input id="st-max" className="input num" type="number" min={1} max={60} value={d.maxGraceDays} onChange={num('maxGraceDays')} disabled={!d.enabled} />
          </div>
        </div>
        <div className="field" style={{ maxWidth: 320 }}>
          <label className="label" htmlFor="st-disc">{t('settings.cashierDiscount')}</label>
          <input id="st-disc" className="input num" type="number" min={0} max={100} value={d.cashierMaxDiscount} onChange={num('cashierMaxDiscount')} />
        </div>
        <div className="divider" />
        <GenderSettings mode={d.genderMode} hours={d.ladiesHours} onChange={(genderMode, ladiesHours) => setD((x) => ({ ...x, genderMode, ladiesHours }))} />
        {!ok && <span className="error">{t('settings.err')}</span>}
        <div className="stack-sm">
          <span className="label">{t('settings.refundPolicy')}</span>
          <p className="small muted">{t('settings.refundPolicyBody')}</p>
        </div>
        <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={!ok || busy} aria-busy={busy}>{t('app.save')}</button>
      </form>
      <Notice icon="info">{t('settings.otherLater')}</Notice>
    </div>
  );
}
