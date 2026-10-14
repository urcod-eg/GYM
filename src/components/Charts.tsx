import { useEffect, useRef, useState } from 'react';

/** Lightweight SVG charts (no chart library → small bundle). Drawn at the container's real width,
 *  so labels stay 11px on a phone and on a wide desktop alike. */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

interface LineProps {
  points: { label: string; value: number }[];
  ariaLabel: string;
  formatValue: (n: number) => string;
  height?: number;
}

export function LineChart({ points, ariaLabel, formatValue, height = 200 }: LineProps) {
  const [ref, W] = useWidth();
  const H = height;
  const pad = { l: 40, r: 12, t: 12, b: 26 };
  const max = Math.max(...points.map((p) => p.value)) * 1.1;
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const x = (i: number) => pad.l + (i / Math.max(1, points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join('');
  const area = `${d}L${x(points.length - 1)} ${y(0)}L${x(0)} ${y(0)}Z`;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.ceil(points.length / Math.max(3, Math.floor(W / 90)));
  const last = points.at(-1)!;

  return (
    <div className="chart" dir="ltr" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={ariaLabel}>
        <g className="grid">
          {ticks.map((tk) => (
            <g key={tk}>
              <line x1={pad.l} x2={W - pad.r} y1={y(tk)} y2={y(tk)} />
              <text x={pad.l - 8} y={y(tk) + 4} textAnchor="end">
                {formatValue(tk)}
              </text>
            </g>
          ))}
        </g>
        <path d={area} fill="var(--primary)" opacity="0.1" />
        <path d={d} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(points.length - 1)} cy={y(last.value)} r="4.5" fill="var(--primary)" />
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={p.label} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>
              {p.label}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

export function BarChart({ bars, ariaLabel, height = 180 }: { bars: { label: string; value: number }[]; ariaLabel: string; height?: number }) {
  const [ref, W] = useWidth();
  const H = height;
  const pad = { l: 12, r: 12, t: 22, b: 26 };
  const max = Math.max(...bars.map((b) => b.value));
  const bw = (W - pad.l - pad.r) / bars.length;
  const peak = bars.findIndex((b) => b.value === max);
  return (
    <div className="chart" dir="ltr" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={ariaLabel}>
        {bars.map((b, i) => {
          const h = (b.value / max) * (H - pad.t - pad.b);
          const bx = pad.l + i * bw + bw * 0.18;
          return (
            <g key={b.label}>
              <rect x={bx} y={H - pad.b - h} width={bw * 0.64} height={h} rx={Math.min(6, bw * 0.15)} fill="var(--primary)" opacity={i === peak ? 1 : 0.35} />
              <text x={bx + bw * 0.32} y={H - pad.b - h - 6} textAnchor="middle">
                {b.value}
              </text>
              <text x={bx + bw * 0.32} y={H - 6} textAnchor="middle">
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function niceStep(raw: number) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
