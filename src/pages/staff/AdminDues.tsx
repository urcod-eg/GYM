import { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useApp, useServerAction } from '../../app/AppContext';
import { useLedger } from '../../app/LedgerContext';
import { Icon } from '../../components/Icon';
import { Modal, Notice, Stat, VipBadge } from '../../components/ui';
import { GYM_TZ } from '../../domain/dates';
import { balanceStatus, daysLate, quoteRefund, type BalanceStatus, type DepositSettings } from '../../domain/payments';
import { egp, formatEGP } from '../../domain/plans';
import { DEMO_MEMBERS, memberDates, planById } from '../../mock/demo';
import type { StringKey } from '../../i18n/strings';

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
    late: open.filter((b) => balanceStatus(now, b) !== 'ON_TIME').length,
  };
}

export function DuesPage() {
  const { t, lang, fmtDate } = useApp();
  const server = useServerAction();
  const { balances, settings, revokeGrant, cancellations, toastRevoke } = useDuesActions();
  const [granting, setGranting] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const now = DateTime.now();
  const open = balances.filter((b) => b.remaining > 0);
  const { total, late } = useDuesSummary();
  const member = (id: string) => DEMO_MEMBERS.find((m) => m.id === id)!;

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
                  .map((b) => ({ b, st: balanceStatus(now, b) as Exclude<BalanceStatus, 'NONE'> }))
                  .sort((x, y) => x.b.dueDate.localeCompare(y.b.dueDate))
                  .map(({ b, st }) => {
                    const m = member(b.memberId);
                    return (
                      <tr key={b.memberId}>
                        <td className="primary-cell">
                          <div className="row wrap" style={{ gap: 6 }}>
                            <strong>{m.name}</strong>
                            <VipBadge tier={m.vip} label={false} />
                            <span className="muted xs ltr">{m.code}</span>
                          </div>
                        </td>
                        <td data-label={t('dues.colPaid')} className="num money">{formatEGP(b.paid, lang)}</td>
                        <td data-label={t('dues.colRemaining')} className="num bold money">{formatEGP(b.remaining, lang)}</td>
                        <td data-label={t('dues.colDue')}>
                          <div className="money">{fmtDate(b.dueDate, 'short')}</div>
                          {st !== 'ON_TIME' && <div className="xs money" style={{ color: 'var(--danger)' }}>{t('dues.daysLate', { n: daysLate(now, b) })}</div>}
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
                            <button className="btn btn-secondary btn-sm" onClick={server}>
                              <Icon name="wallet" />
                              {t('dues.collect')}
                            </button>
                            {st === 'OVERDUE_GRACE' ? (
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                  revokeGrant(b.memberId);
                                  toastRevoke();
                                }}
                              >
                                {t('dues.revoke')}
                              </button>
                            ) : (
                              <button className="btn btn-secondary btn-sm" onClick={() => setGranting(b.memberId)}>
                                <Icon name="shield" />
                                {t('dues.grant')}
                              </button>
                            )}
                            <button className="btn btn-secondary btn-sm" onClick={server}>
                              <Icon name="whatsapp" />
                              {t('dues.remind')}
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={() => setCancelling(b.memberId)}>
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

      {cancellations.length > 0 && (
        <section className="card stack-sm">
          <h2 className="card-title">{t('dues.cancelledList')}</h2>
          <div className="list">
            {cancellations.map((c) => (
              <div key={c.memberId} className="list-item">
                <div className="grow">
                  <strong>{member(c.memberId).name}</strong>
                  <div className="xs muted">{c.reason}</div>
                </div>
                <span className="badge badge-neutral">{t('refund.refunded', { amount: formatEGP(c.refund, lang) })}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <Notice icon="shield">{t('refund.who')}</Notice>

      {granting && <GrantModal memberId={granting} maxDays={settings.maxGraceDays} onClose={() => setGranting(null)} />}
      {cancelling && <RefundModal memberId={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  );
}

function useDuesActions() {
  const { t, toast } = useApp();
  const l = useLedger();
  return { ...l, toastRevoke: () => toast(t('dues.revoked')) };
}

function GrantModal({ memberId, maxDays, onClose }: { memberId: string; maxDays: number; onClose: () => void }) {
  const { t, toast, fmtDate } = useApp();
  const { grant } = useLedger();
  const today = DateTime.now().setZone(GYM_TZ).startOf('day');
  const min = today.toISODate()!;
  const max = today.plus({ days: maxDays }).toISODate()!;
  const [until, setUntil] = useState(today.plus({ days: 3 }).toISODate()!);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const m = DEMO_MEMBERS.find((x) => x.id === memberId)!;
  const dateOk = until >= min && until <= max;
  const reasonOk = reason.trim().length > 0;

  return (
    <Modal open onClose={onClose} title={t('dues.grantTitle', { name: m.name })}>
      <form
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!dateOk || !reasonOk) return;
          grant(memberId, until, reason.trim());
          toast(t('dues.grantSaved', { date: fmtDate(until) }), 'success');
          onClose();
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
          <input id="g-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={touched && !reasonOk} />
          {touched && !reasonOk && <span className="error">{t('dues.reasonRequired')}</span>}
        </div>
        <div className="row wrap">
          <button type="submit" className="btn btn-primary grow">{t('dues.grant')}</button>
          <button type="button" className="btn btn-secondary grow" onClick={onClose}>{t('app.cancel')}</button>
        </div>
      </form>
    </Modal>
  );
}

function RefundModal({ memberId, onClose }: { memberId: string; onClose: () => void }) {
  const { t, lang, toast } = useApp();
  const { balances, cancel } = useLedger();
  const m = DEMO_MEMBERS.find((x) => x.id === memberId)!;
  const b = balances.find((x) => x.memberId === memberId)!;
  const plan = planById(m.planId);
  const { start, end } = memberDates(m);
  const q = useMemo(() => quoteRefund(DateTime.now(), b.paid, plan.price, start, end), [b.paid, plan.price, start, end]);
  const [override, setOverride] = useState(false);
  const [amount, setAmount] = useState<number | ''>(q.refund / 100);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const refund = override ? egp(Number(amount) || 0) : q.refund;
  const amountOk = refund >= 0 && refund <= b.paid;
  const reasonOk = reason.trim().length > 0;
  const money = (p: number) => formatEGP(p, lang);

  return (
    <Modal open onClose={onClose} title={t('refund.title', { name: m.name })}>
      <form
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!amountOk || !reasonOk) return;
          cancel({ memberId, refund, overridden: override, reason: reason.trim(), at: DateTime.now().toISO()! });
          toast(t('refund.done', { amount: money(refund) }), 'success');
          onClose();
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
            {!amountOk && <span className="error">{t('refund.err.amount', { max: money(b.paid) })}</span>}
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="rf-reason">{t('refund.reason')}</label>
          <input id="rf-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={touched && !reasonOk} />
          {touched && !reasonOk && <span className="error">{t('dues.reasonRequired')}</span>}
        </div>
        <Notice tone="warning" icon="alert">{t('refund.who')}</Notice>
        <div className="row wrap">
          <button type="submit" className="btn btn-danger-solid grow">{t('refund.confirm')}</button>
          <button type="button" className="btn btn-secondary grow" onClick={onClose}>{t('app.cancel')}</button>
        </div>
      </form>
    </Modal>
  );
}

export function SettingsPage() {
  const { t, toast } = useApp();
  const { settings, setSettings } = useLedger();
  const [d, setD] = useState<DepositSettings>(settings);
  const ok = d.minPercent >= 10 && d.minPercent <= 90 && d.graceDays >= 1 && d.graceDays <= 60 && d.maxGraceDays >= d.graceDays && d.maxGraceDays <= 60;
  const num = (k: keyof Omit<DepositSettings, 'enabled'>) => (e: React.ChangeEvent<HTMLInputElement>) => setD((x) => ({ ...x, [k]: Number(e.target.value) }));

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <h1 className="page-title">{t('admin.settings')}</h1>
      <form
        className="card stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          setSettings(d);
          toast(t('settings.saved'), 'success');
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
        {!ok && <span className="error">{t('settings.err')}</span>}
        <div className="stack-sm">
          <span className="label">{t('settings.refundPolicy')}</span>
          <p className="small muted">{t('settings.refundPolicyBody')}</p>
        </div>
        <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={!ok}>{t('app.save')}</button>
      </form>
      <Notice icon="info">{t('settings.otherLater')}</Notice>
    </div>
  );
}
