import { useEffect, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import { useLedger } from '../app/LedgerContext';
import { balanceStatus } from '../domain/payments';
import { useApp } from '../app/AppContext';
import type { MembershipPhase } from '../domain/dates';
import type { VipTier } from '../mock/demo';
import { Icon, type IconName } from './Icon';

export function StatusBadge({ phase, blocked, cancelled }: { phase: MembershipPhase; blocked?: boolean; cancelled?: boolean }) {
  const { t } = useApp();
  if (cancelled) return <span className="badge badge-neutral">{t('status.CANCELLED')}</span>;
  if (blocked) return <span className="badge badge-danger">{t('status.BLOCKED')}</span>;
  const cls = phase === 'ACTIVE' ? 'badge-success' : phase === 'SCHEDULED' ? 'badge-info' : 'badge-neutral';
  return <span className={`badge ${cls}`}>{t(`status.${phase}`)}</span>;
}

export function VipBadge({ tier, label }: { tier: VipTier; label?: boolean }) {
  const { t } = useApp();
  if (tier === 'STANDARD') return null;
  return (
    <span className="badge badge-vip" title={`VIP ${tier}`}>
      <Icon name="crown" />
      {label === false ? 'VIP' : `VIP ${t(`vip.${tier}`)}`}
    </span>
  );
}

export function Notice({ tone = 'info', icon = 'info', children }: { tone?: 'info' | 'warning' | 'danger'; icon?: IconName; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const { t } = useApp();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h2 className="section-title">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('app.close')}>
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className="toast" onClick={() => dismissToast(x.id)}>
          <Icon name={x.tone === 'danger' ? 'alert' : x.tone === 'success' ? 'check' : 'info'} />
          <span>{x.text}</span>
        </div>
      ))}
    </div>
  );
}

export function Avatar({ name, size }: { name: string; size?: 'lg' }) {
  const letters = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('');
  return (
    <span className={`avatar ${size ?? ''}`} aria-hidden="true">
      {letters}
    </span>
  );
}

export function Stat({ label, value, delta, icon }: { label: string; value: string; delta?: { text: string; up: boolean }; icon?: IconName }) {
  return (
    <div className="card stat">
      <div className="row-between">
        <span className="label">{label}</span>
        {icon && <Icon name={icon} width={20} height={20} style={{ color: 'var(--text-muted)' }} />}
      </div>
      <span className="value">{value}</span>
      {delta && <span className={`delta ${delta.up ? 'up' : 'down'}`}>{delta.text}</span>}
    </div>
  );
}

export function PlaceholderPage({ title, phase }: { title: string; phase: number }) {
  const { t } = useApp();
  return (
    <div className="placeholder-page">
      <div className="stack-sm" style={{ alignItems: 'center' }}>
        <Icon name="clock" />
        <h1 className="page-title">{title}</h1>
        <p className="muted">{t('admin.comingPhase', { n: phase })}</p>
      </div>
    </div>
  );
}

/**
 * Original illustration tile (no stock photos; replaced by licensed imagery per gym).
 * It always occupies its OWN box beside or above the text, never behind it, so words stay readable.
 * `square` for banner/hero cards, `wide` for a full-width band.
 */
export function ArtTile({ variant = 0, shape = 'square' }: { variant?: number; shape?: 'square' | 'wide' }) {
  const v = ((variant % 4) + 4) % 4;
  const wide = shape === 'wide';
  const W = wide ? 400 : 120;
  const H = wide ? 140 : 120;
  const cx = W / 2;
  const cy = H / 2;
  const s = wide ? 1.1 : 1; // scale of the motif
  return (
    <div className={`art-tile ${wide ? 'wide' : ''}`} aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio={wide ? "xMidYMid slice" : "xMidYMid meet"}>
        <rect width={W} height={H} fill={['#1d1013', '#15161b', '#121419', '#1a1610'][v]} />
        <g transform={`translate(${cx} ${cy}) scale(${s})`}>
          {v === 0 && (
            <g>
              <polygon points="-18,-52 14,-52 -10,52 -42,52" fill="#e51c35" />
              <polygon points="22,-52 34,-52 10,52 -2,52" fill="#e51c35" opacity="0.5" />
              {wide && <polygon points="62,-52 74,-52 50,52 38,52" fill="#e51c35" opacity="0.25" />}
              {wide && <polygon points="-82,-52 -70,-52 -94,52 -106,52" fill="#e51c35" opacity="0.25" />}
            </g>
          )}
          {v === 1 && (
            <g>
              <rect x="-44" y="-4" width="88" height="8" rx="4" fill="#d4d6dd" />
              <rect x="-40" y="-26" width="12" height="52" rx="4" fill="#e51c35" />
              <rect x="-26" y="-19" width="8" height="38" rx="3" fill="#e51c35" opacity="0.75" />
              <rect x="28" y="-26" width="12" height="52" rx="4" fill="#e51c35" />
              <rect x="18" y="-19" width="8" height="38" rx="3" fill="#e51c35" opacity="0.75" />
            </g>
          )}
          {v === 2 && (
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
              <polyline points={wide ? '-150,0 -24,0 -12,-30 6,30 18,-12 26,0 150,0' : '-46,0 -20,0 -10,-28 6,28 16,-10 24,0 46,0'} stroke="#e51c35" strokeWidth="5" />
            </g>
          )}
          {v === 3 && (
            <g>
              <polygon points="0,-40 34.6,-20 34.6,20 0,40 -34.6,20 -34.6,-20" fill="none" stroke="#e3b65a" strokeWidth="6" strokeLinejoin="round" />
              <path d="M-14 6 L-9 -10 L0 0 L9 -10 L14 6 Z" fill="#e3b65a" />
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}

/** A promo / announcement card: text on one side, its illustration in its own tile on the other. */
export function PromoCard({
  variant,
  tag,
  tagTone = 'primary',
  title,
  body,
  as = 'h3',
  large,
}: {
  variant: number;
  tag: string;
  tagTone?: 'primary' | 'vip' | 'info';
  title: string;
  body: string;
  as?: 'h1' | 'h2' | 'h3';
  large?: boolean;
}) {
  const Heading = as;
  return (
    <article className={`promo ${large ? 'large' : ''}`}>
      <div className="promo-text">
        <span className={`promo-tag ${tagTone}`}>{tag}</span>
        <Heading className="promo-title">{title}</Heading>
        <p className="promo-body">{body}</p>
      </div>
      <ArtTile variant={variant} />
    </article>
  );
}

/** Illustrative QR-like pattern. NOT a scannable or valid code; the server issues real codes in Phase 4. */
export function IllustrativeCode({ seed }: { seed: number }) {
  const n = 25;
  let x = seed * 9301 + 49297;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const cells: { r: number; c: number }[] = [];
  const finder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!finder(r, c) && rnd() > 0.52) cells.push({ r, c });
  const Finder = ({ r, c }: { r: number; c: number }) => (
    <g>
      <rect x={c} y={r} width="7" height="7" fill="#101115" />
      <rect x={c + 1} y={r + 1} width="5" height="5" fill="#fff" />
      <rect x={c + 2} y={r + 2} width="3" height="3" fill="#101115" />
    </g>
  );
  return (
    <svg viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="Illustrative entry code">
      <rect width={n} height={n} fill="#fff" />
      {cells.map(({ r, c }) => (
        <rect key={`${r}-${c}`} x={c} y={r} width="1" height="1" fill="#101115" />
      ))}
      <Finder r={0} c={0} />
      <Finder r={0} c={n - 7} />
      <Finder r={n - 7} c={0} />
    </svg>
  );
}

/** "Balance due" / "Payment overdue" chip, derived from the ledger. Renders nothing without a balance. */
export function BalanceBadge({ memberId }: { memberId: string }) {
  const { t } = useApp();
  const { balanceOf } = useLedger();
  const b = balanceOf(memberId);
  const st = balanceStatus(DateTime.now(), b);
  if (st === 'NONE') return null;
  return <span className={`badge ${st === 'ON_TIME' ? 'badge-warning' : 'badge-danger'}`}>{st === 'ON_TIME' ? t('dues.badge') : t('dues.badgeLate')}</span>;
}
