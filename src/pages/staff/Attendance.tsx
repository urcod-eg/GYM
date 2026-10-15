import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { DateTime } from 'luxon';
import { Link } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { useLedger } from '../../app/LedgerContext';
import { useActor } from '../../app/SessionContext';
import { useErrorText } from '../../app/useErrorText';
import { BarChart, LineChart } from '../../components/Charts';
import { Icon } from '../../components/Icon';
import { Avatar, Modal, Notice, Stat, VipBadge } from '../../components/ui';
import { parseQr, type EntryCheck, type EntryReason } from '../../domain/attendance';
import { VIP_TIERS, type VipTierDoc, type VipTierId } from '../../domain/content';
import { GYM_TZ } from '../../domain/dates';
import { formatEGP } from '../../domain/plans';
import { gymDayEndingAt } from '../../domain/sales';
import { demoMode } from '../../firebase/client';
import * as data from '../../firebase/data';
import type { StringKey } from '../../i18n/strings';
import { DEMO_PEAK_HOURS } from '../../mock/demo';
import { searchRows } from './shared';

/* ================================================================ cashier: scan / manual check-in */

const REASON_KEY: Record<EntryReason, StringKey> = {
  NO_MEMBERSHIP: 'checkin.NO_MEMBERSHIP',
  CANCELLED: 'scan.reasonCancelled',
  SCHEDULED: 'scan.reasonScheduled',
  EXPIRED: 'scan.reasonExpired',
  QUOTA_USED: 'checkin.QUOTA_USED',
  BLOCKED: 'scan.reasonBlocked',
  DUES_OVERDUE: 'checkin.DUES_OVERDUE',
  CODE_INVALID: 'checkin.CODE_INVALID',
  CODE_USED: 'checkin.CODE_USED',
  CODE_EXPIRED: 'checkin.CODE_EXPIRED',
  TOO_SOON: 'checkin.TOO_SOON',
};

interface Outcome {
  check: EntryCheck;
  member: data.MemberDoc | null;
  done: boolean;
  at: Date;
}

/** Live check-in at the door: camera QR scan (code refreshes every 45 s) or the member number typed in. */
export function LiveScan() {
  const { t, lang, fmtDate, fmtTime } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const rows = useLedger().rows ?? [];
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [camOn, setCamOn] = useState(false);
  const lastText = useRef<{ text: string; at: number } | null>(null);

  const run = async (memberId: string, method: 'QR' | 'MANUAL', qrCode: string | null) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await data.checkInMember(actor, memberId, method, qrCode);
      setOutcome({ ...r, at: new Date() });
      if (navigator.vibrate) navigator.vibrate(r.done ? 80 : [60, 60, 60]);
    } catch (e) {
      setErr(errText(e));
      setOutcome(null);
    } finally {
      setBusy(false);
    }
  };

  const onQr = (text: string) => {
    // The same picture stays in front of the camera: ignore repeats for a few seconds.
    const now = Date.now();
    if (lastText.current && lastText.current.text === text && now - lastText.current.at < 4000) return;
    lastText.current = { text, at: now };
    const p = parseQr(text);
    if (!p) return setErr(t('checkin.notOurs'));
    if (!busy) run(p.memberId, 'QR', p.code);
  };

  const manual = (e: FormEvent) => {
    e.preventDefault();
    const q = code.trim();
    if (!q) return;
    const hit = rows.find((r) => r.m.code.toLowerCase() === q.toLowerCase()) ?? searchRows(rows, q)[0];
    if (!hit) return setErr(t('app.noResults'));
    run(hit.m.id, 'MANUAL', null);
  };

  const m = outcome?.member;
  const c = outcome?.check;
  const bal = m?.balance;
  const money = (p: number) => formatEGP(p, lang);

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="stack">
        <h1 className="page-title">{t('scan.title')}</h1>
        {camOn ? (
          <Camera onText={onQr} onError={(e) => { setErr(e); setCamOn(false); }} />
        ) : (
          <button className="scan-frame" onClick={() => setCamOn(true)} style={{ cursor: 'pointer', border: 0 }}>
            <span className="small" style={{ position: 'absolute', bottom: 14 }}>{t('checkin.startCamera')}</span>
          </button>
        )}
        {camOn && (
          <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setCamOn(false)}>
            {t('checkin.stopCamera')}
          </button>
        )}
        <form className="row" onSubmit={manual}>
          <input className="input ltr grow" placeholder="PLS-10001" value={code} onChange={(e) => setCode(e.target.value)} aria-label={t('scan.manual')} />
          <button className="btn btn-secondary" disabled={busy}>{t('checkin.manualDo')}</button>
        </form>
        <span className="hint">{t('checkin.manualHint')}</span>
        {err && <Notice tone="danger" icon="alert">{err}</Notice>}
      </section>

      {outcome && c && (
        <section className={`result ${outcome.done ? 'ok' : 'no'} stack`} aria-live="assertive">
          {m && (
            <div className="row">
              <Avatar name={m.fullName} size="lg" />
              <div className="grow">
                <div className="row wrap" style={{ gap: 6 }}>
                  <strong style={{ fontSize: '1.25rem' }}>{m.fullName}</strong>
                  {m.vipTierId && <VipBadge tier={m.vipTierId} />}
                </div>
                <span className="muted small ltr">{m.memberCode}</span>
              </div>
            </div>
          )}
          <div className="row">
            <Icon name={outcome.done ? 'check' : 'x'} className="big-icon" style={{ color: outcome.done ? 'var(--success)' : 'var(--danger)' }} />
            <div>
              <div className="bold" style={{ fontSize: '1.375rem' }}>{outcome.done ? t('scan.allowed') : t('scan.denied')}</div>
              <div className="small">
                {outcome.done ? fmtTime(outcome.at) : t(REASON_KEY[c.reason!], { amount: bal ? money(bal.remaining) : '' })}
              </div>
            </div>
          </div>
          {outcome.done && c.note === 'GRACE' && bal && bal.graceUntil && <Notice tone="warning" icon="wallet">{t('scan.graceWarn', { amount: money(bal.remaining), date: fmtDate(gymDayEndingAt(bal.graceUntil)) })}</Notice>}
          {outcome.done && c.note === 'BALANCE_DUE' && bal && <Notice tone="warning" icon="wallet">{t('scan.dueSoon', { amount: money(bal.remaining), date: fmtDate(gymDayEndingAt(bal.dueAt)) })}</Notice>}
          {outcome.done && c.visitsLeft !== null && <Notice icon="info">{t('checkin.visitsLeft', { n: c.visitsLeft })}</Notice>}
          {m?.membership && (
            <div className="row-between small wrap">
              <span>{lang === 'ar' ? m.membership.planNameAr : m.membership.planNameEn}</span>
              <span>
                {t('cashier.ends')}: {fmtDate(gymDayEndingAt(m.membership.endsAt), 'short')}
              </span>
            </div>
          )}
          {!outcome.done && m && ['EXPIRED', 'NO_MEMBERSHIP', 'QUOTA_USED', 'CANCELLED'].includes(c.reason!) && (
            <Link className="btn btn-primary" to={`/cashier/new?renew=${m.id}`}>
              <Icon name="refresh" />
              {t('scan.openRenew')}
            </Link>
          )}
        </section>
      )}
    </div>
  );
}

/** Camera preview that reads QR codes (BarcodeDetector when the browser has it, otherwise jsQR). */
function Camera({ onText, onError }: { onText: (text: string) => void; onError: (msg: string) => void }) {
  const { t } = useApp();
  const video = useRef<HTMLVideoElement>(null);
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    let timer = 0;
    const canvas = document.createElement('canvas');
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch {
        onError(t('checkin.cameraDenied'));
        return;
      }
      const v = video.current;
      if (!v || stop) return;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      type Detector = { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> };
      const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
      const detector = BD ? new BD({ formats: ['qr_code'] }) : null;
      const jsQR = detector ? null : (await import('jsqr')).default;
      const tick = async () => {
        if (stop || !v.videoWidth) {
          if (!stop) timer = window.setTimeout(tick, 250);
          return;
        }
        try {
          if (detector) {
            const found = await detector.detect(v);
            if (found[0]?.rawValue) cb.current(found[0].rawValue);
          } else if (jsQR) {
            const w = 480;
            const h = Math.round((v.videoHeight / v.videoWidth) * w);
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
            ctx.drawImage(v, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const r = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
            if (r?.data) cb.current(r.data);
          }
        } catch {
          /* keep scanning */
        }
        timer = window.setTimeout(tick, 250);
      };
      tick();
    })();
    return () => {
      stop = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="scan-frame live">
      <video ref={video} playsInline muted aria-label={t('scan.camera')} />
    </div>
  );
}

/* ================================================================ admin: attendance */

type Range = 'today' | '7' | '30';

function useCheckins(since: Date) {
  const [rows, setRows] = useState<data.CheckinRow[] | null>(demoMode ? [] : null);
  useEffect(() => {
    if (demoMode) return;
    setRows(null);
    let stop: (() => void) | undefined;
    let cancelled = false;
    data.watchCheckinsSince(since, setRows, () => setRows([])).then((u) => (cancelled ? u() : (stop = u)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [since]);
  return rows;
}

export function AttendancePage() {
  const { t, fmtDate, fmtTime, fmtNum } = useApp();
  const { rowOf } = useLedger();
  const [range, setRange] = useState<Range>('today');
  const since = useMemo(() => {
    const today = DateTime.now().setZone(GYM_TZ).startOf('day');
    return (range === 'today' ? today : today.minus({ days: Number(range) - 1 })).toJSDate();
  }, [range]);
  const rows = useCheckins(since);
  const list = rows ?? [];
  const unique = new Set(list.map((r) => r.memberId)).size;
  const hours = Array.from({ length: 24 }, () => 0);
  const days = new Map<string, number>();
  for (const r of list) {
    if (!r.at) continue;
    const d = DateTime.fromJSDate(r.at).setZone(GYM_TZ);
    hours[d.hour] += 1;
    days.set(d.toISODate()!, (days.get(d.toISODate()!) ?? 0) + 1);
  }
  const nDays = range === 'today' ? 1 : Number(range);
  const peak = demoMode
    ? DEMO_PEAK_HOURS.map((h) => ({ label: `${h.hour}:00`, value: h.visits }))
    : hours.map((v, h) => ({ label: `${h}:00`, value: Math.round((v / nDays) * 10) / 10 })).filter((x, h) => x.value > 0 || (h >= 6 && h <= 23));
  const byDay = Array.from({ length: nDays }, (_, i) => {
    const d = DateTime.fromJSDate(since).setZone(GYM_TZ).plus({ days: i });
    return { label: fmtDate(d, 'short'), value: days.get(d.toISODate()!) ?? 0 };
  });

  return (
    <div className="stack">
      <h1 className="page-title">{t('admin.attendance')}</h1>
      <div className="chips">
        {(['today', '7', '30'] as Range[]).map((r) => (
          <button key={r} className="chip" aria-pressed={range === r} onClick={() => setRange(r)}>
            {t(`pay.range.${r}` as StringKey)}
          </button>
        ))}
      </div>
      {demoMode && <Notice icon="info">{t('checkin.demoNote')}</Notice>}
      <div className="grid-3">
        <Stat label={t('checkin.visits')} value={rows === null ? '…' : fmtNum(list.length)} icon="clock" />
        <Stat label={t('checkin.unique')} value={rows === null ? '…' : fmtNum(unique)} icon="users" />
        <Stat label={t('checkin.perDay')} value={rows === null ? '…' : fmtNum(Math.round((list.length / nDays) * 10) / 10)} icon="chart" />
      </div>
      <div className="grid-2" style={{ gridTemplateColumns: undefined }}>
        <section className="card stack-sm">
          <h2 className="card-title">{t('admin.peak')}</h2>
          <BarChart ariaLabel={t('admin.peak')} bars={peak} />
        </section>
        {nDays > 1 && (
          <section className="card stack-sm">
            <h2 className="card-title">{t('checkin.byDay')}</h2>
            <LineChart ariaLabel={t('checkin.byDay')} points={byDay} formatValue={(n) => String(n)} />
          </section>
        )}
      </div>
      <section className="card" style={{ padding: 0 }}>
        {list.length === 0 ? (
          <p className="muted" style={{ padding: 16 }}>{rows === null ? '…' : t('checkin.empty')}</p>
        ) : (
          <div className="list">
            {list.slice(0, 200).map((r) => {
              const row = rowOf(r.memberId);
              return (
                <div key={r.id} className="list-item">
                  <Avatar name={row?.m.name ?? '?'} />
                  <div className="grow">
                    <strong>{row?.m.name ?? r.memberId}</strong>
                    <div className="xs muted ltr">{row?.m.code}</div>
                  </div>
                  <span className={`badge ${r.method === 'QR' ? 'badge-success' : 'badge-neutral'}`}>{r.method === 'QR' ? 'QR' : t('checkin.manual')}</span>
                  <span className="small num">{r.at ? `${fmtDate(r.at, 'short')} · ${fmtTime(r.at)}` : '—'}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/** Today's visits for the dashboard tile. */
export function useTodayVisits(): number | null {
  const since = useMemo(() => DateTime.now().setZone(GYM_TZ).startOf('day').toJSDate(), []);
  const rows = useCheckins(since);
  return demoMode ? 87 : rows === null ? null : rows.length;
}

/* ================================================================ admin: VIP */

const DEFAULT_TIERS: Record<VipTierId, VipTierDoc> = {
  PLUS: { nameAr: 'بلس', nameEn: 'Plus', perksAr: 'أولوية في الحجز\nخصم 5% على التجديد', perksEn: 'Booking priority\n5% off renewals' },
  ELITE: { nameAr: 'إيليت', nameEn: 'Elite', perksAr: 'جلسة قياسات شهرية مجانية\nخصم 10% على التجديد\nمنشفة ولوكر', perksEn: 'Free monthly body assessment\n10% off renewals\nTowel and locker' },
};

export function VipPage() {
  const { t, lang, toast } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const rows = useLedger().rows ?? [];
  const [tiers, setTiers] = useState<Partial<Record<VipTierId, VipTierDoc>>>(demoMode ? DEFAULT_TIERS : {});
  const [editing, setEditing] = useState<VipTierId | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (demoMode) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    data.watchVipTiers(setTiers, () => undefined).then((u) => (cancelled ? u() : (stop = u)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  const vips = rows.filter((r) => r.m.vip !== 'STANDARD');
  const setTier = async (memberId: string, tier: VipTierId | null) => {
    if (demoMode) return toast(t('app.demoNoSave'));
    setBusy(memberId);
    try {
      await data.setVip(actor, memberId, tier);
      toast(t('staff.saved'), 'success');
    } catch (e) {
      toast(errText(e), 'danger');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      <div className="row-between wrap">
        <h1 className="page-title">VIP</h1>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" />
          {t('vip.add')}
        </button>
      </div>
      <div className="grid-2">
        {VIP_TIERS.map((tier) => {
          const d = tiers[tier] ?? DEFAULT_TIERS[tier];
          return (
            <section key={tier} className="card stack-sm" style={{ borderColor: 'var(--vip)' }}>
              <div className="row-between">
                <VipBadge tier={tier} />
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(tier)}>
                  <Icon name="edit" />
                  {t('plan.edit')}
                </button>
              </div>
              <strong>{lang === 'ar' ? d.nameAr : d.nameEn}</strong>
              <ul className="small" style={{ margin: 0, paddingInlineStart: 18 }}>
                {(lang === 'ar' ? d.perksAr : d.perksEn).split('\n').filter(Boolean).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <span className="xs muted">{t('vip.count', { n: vips.filter((r) => r.m.vip === tier).length })}</span>
            </section>
          );
        })}
      </div>
      <section className="card stack-sm">
        <h2 className="card-title">{t('vip.members')}</h2>
        {vips.length === 0 ? (
          <p className="muted small">{t('vip.none')}</p>
        ) : (
          vips.map((r) => (
            <div key={r.m.id} className="list-item">
              <Avatar name={r.m.name} />
              <div className="grow">
                <strong>{r.m.name}</strong>
                <div className="xs muted ltr">{r.m.code}</div>
              </div>
              <select className="select" style={{ width: 'auto' }} value={r.m.vip} disabled={busy === r.m.id} onChange={(e) => setTier(r.m.id, e.target.value === 'STANDARD' ? null : (e.target.value as VipTierId))} aria-label={t('vip.tier')}>
                <option value="STANDARD">{t('vip.remove')}</option>
                {VIP_TIERS.map((x) => (
                  <option key={x} value={x}>VIP {x}</option>
                ))}
              </select>
            </div>
          ))
        )}
      </section>
      {editing && <TierEditor tier={editing} initial={tiers[editing] ?? DEFAULT_TIERS[editing]} onClose={() => setEditing(null)} />}
      {adding && <AddVip onPick={(id, tier) => setTier(id, tier).then(() => setAdding(false))} onClose={() => setAdding(false)} />}
    </div>
  );
}

function TierEditor({ tier, initial, onClose }: { tier: VipTierId; initial: VipTierDoc; onClose: () => void }) {
  const { t, toast } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (demoMode) {
      toast(t('app.demoNoSave'));
      return onClose();
    }
    setBusy(true);
    try {
      await data.saveVipTier(actor, tier, d);
      toast(t('staff.saved'), 'success');
      onClose();
    } catch (e) {
      toast(errText(e), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`VIP ${tier}`}>
      <div className="stack">
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="vt-ar">{t('plan.nameAr')}</label>
            <input id="vt-ar" className="input" maxLength={30} value={d.nameAr} onChange={(e) => setD({ ...d, nameAr: e.target.value })} />
          </div>
          <div className="field">
            <label className="label" htmlFor="vt-en">{t('plan.nameEn')}</label>
            <input id="vt-en" className="input" dir="ltr" maxLength={30} value={d.nameEn} onChange={(e) => setD({ ...d, nameEn: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="vt-pa">{t('vip.perksAr')}</label>
          <textarea id="vt-pa" className="input" rows={4} maxLength={600} value={d.perksAr} onChange={(e) => setD({ ...d, perksAr: e.target.value })} style={{ padding: 12 }} />
        </div>
        <div className="field">
          <label className="label" htmlFor="vt-pe">{t('vip.perksEn')}</label>
          <textarea id="vt-pe" className="input" dir="ltr" rows={4} maxLength={600} value={d.perksEn} onChange={(e) => setD({ ...d, perksEn: e.target.value })} style={{ padding: 12 }} />
        </div>
        <button className="btn btn-primary" disabled={busy} aria-busy={busy} onClick={save}>{t('app.save')}</button>
      </div>
    </Modal>
  );
}

function AddVip({ onPick, onClose }: { onPick: (memberId: string, tier: VipTierId) => void; onClose: () => void }) {
  const { t } = useApp();
  const rows = useLedger().rows ?? [];
  const [q, setQ] = useState('');
  const [tier, setTier] = useState<VipTierId>('PLUS');
  const found = q.trim() ? searchRows(rows, q).filter((r) => r.m.vip === 'STANDARD').slice(0, 8) : [];
  return (
    <Modal open onClose={onClose} title={t('vip.add')}>
      <div className="stack">
        <div className="chips">
          {VIP_TIERS.map((x) => (
            <button key={x} className="chip" aria-pressed={tier === x} onClick={() => setTier(x)}>
              VIP {x}
            </button>
          ))}
        </div>
        <input className="input" placeholder={t('cashier.searchPh')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        {found.map((r) => (
          <button key={r.m.id} className="list-item" onClick={() => onPick(r.m.id, tier)}>
            <Avatar name={r.m.name} />
            <div className="grow">
              <strong>{r.m.name}</strong>
              <div className="xs muted ltr">{r.m.code}</div>
            </div>
            <Icon name="plus" />
          </button>
        ))}
      </div>
    </Modal>
  );
}
