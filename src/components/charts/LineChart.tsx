// Small dependency-free SVG line chart with a snapping crosshair tooltip.
// One y-axis only; multiple series share the same scale.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export interface ChartPoint {
  x: number;
  y: number;
  /** Optional per-point marker colour (e.g. feeling colour). */
  color?: string;
  id?: string;
}

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  points: ChartPoint[];
  /** Draw markers at points (default true when <= 60 points). */
  dots?: boolean;
  /** Draw as a light area wash under the line. */
  area?: boolean;
  dashed?: boolean;
}

export interface LineChartProps {
  series: ChartSeries[];
  height?: number;
  yDomain?: [number, number];
  xDomain?: [number, number];
  yTicks?: number[];
  formatX?: (x: number) => string;
  formatY?: (y: number) => string;
  zeroLine?: boolean;
  compact?: boolean;
  onPointClick?: (p: ChartPoint, s: ChartSeries) => void;
  ariaLabel: string;
  empty?: ReactNode;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Width of an element, tracked with a ResizeObserver (callback ref, so late mounts work). */
function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [w, setW] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    ro.current?.disconnect();
    if (!el) return;
    ro.current = new ResizeObserver(() => setW(el.clientWidth));
    ro.current.observe(el);
    setW(el.clientWidth);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);
  return [ref, w];
}

export default function LineChart({
  series,
  height = 220,
  yDomain,
  xDomain,
  yTicks,
  formatX = (x) => new Date(x).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  formatY = (y) => String(Math.round(y * 10) / 10),
  zeroLine,
  compact,
  onPointClick,
  ariaLabel,
  empty,
}: LineChartProps) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const all = series.flatMap((s) => s.points);
  const pad = compact ? { l: 4, r: 6, t: 6, b: 6 } : { l: 40, r: 14, t: 10, b: 26 };

  const { x0, x1, y0, y1 } = useMemo(() => {
    let x0 = xDomain?.[0] ?? Infinity, x1 = xDomain?.[1] ?? -Infinity;
    let y0 = yDomain?.[0] ?? Infinity, y1 = yDomain?.[1] ?? -Infinity;
    if (!xDomain || !yDomain)
      for (const p of all) {
        if (!xDomain) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); }
        if (!yDomain) { y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      }
    if (!yDomain) {
      const span = y1 - y0 || Math.abs(y1) || 1;
      y0 -= span * 0.08;
      y1 += span * 0.08;
    }
    if (x0 === x1) { x0 -= 86_400_000; x1 += 86_400_000; }
    return { x0, x1, y0, y1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, xDomain, yDomain]);

  if (!all.length) return <div ref={wrapRef} className="empty small">{empty ?? 'No data yet'}</div>;

  const w = Math.max(width, 120);
  const h = height;
  const sx = (x: number) => pad.l + ((x - x0) / (x1 - x0)) * (w - pad.l - pad.r);
  const sy = (y: number) => pad.t + (1 - (y - y0) / (y1 - y0)) * (h - pad.t - pad.b);
  const ticksY = yTicks ?? niceTicks(y0, y1, compact ? 2 : 4);
  const ticksX = compact ? [] : niceTimeTicks(x0, x1, Math.max(2, Math.floor((w - pad.l - pad.r) / 90)));

  // hover: nearest x among all points
  const xs = [...new Set(all.map((p) => p.x))].sort((a, b) => a - b);
  const nearest = (px: number) => {
    const xv = x0 + ((px - pad.l) / (w - pad.l - pad.r)) * (x1 - x0);
    let best = xs[0];
    for (const x of xs) if (Math.abs(x - xv) < Math.abs(best - xv)) best = x;
    return best;
  };
  const hoverRows =
    hoverX === null
      ? []
      : series
          .map((s) => ({ s, p: s.points.find((p) => p.x === hoverX) }))
          .filter((r): r is { s: ChartSeries; p: ChartPoint } => !!r.p);

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <svg
        className="chart"
        width={w}
        height={h}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          setHoverX(nearest(e.clientX - r.left));
        }}
        onPointerLeave={() => setHoverX(null)}
        onClick={() => {
          if (hoverX === null || !onPointClick) return;
          const r = hoverRows[0];
          if (r) onPointClick(r.p, r.s);
        }}
        style={{ cursor: onPointClick ? 'pointer' : undefined, touchAction: 'pan-y' }}
      >
        {!compact &&
          ticksY.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={pad.l} x2={w - pad.r} y1={sy(t)} y2={sy(t)} />
              <text x={pad.l - 8} y={sy(t) + 4} textAnchor="end" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatY(t)}
              </text>
            </g>
          ))}
        {zeroLine && y0 < 0 && y1 > 0 && (
          <line x1={pad.l} x2={w - pad.r} y1={sy(0)} y2={sy(0)} stroke="#4a5468" strokeWidth={1} />
        )}
        {ticksX.map((t) => (
          <text key={t} x={sx(t)} y={h - 6} textAnchor="middle">
            {formatX(t)}
          </text>
        ))}
        {series.map((s) => {
          const pts = [...s.points].sort((a, b) => a.x - b.x);
          const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
          const showDots = s.dots ?? pts.length <= 60;
          return (
            <g key={s.id}>
              {s.area && pts.length > 1 && (
                <path
                  d={`${d}L${sx(pts[pts.length - 1].x)},${sy(Math.max(y0, 0))}L${sx(pts[0].x)},${sy(Math.max(y0, 0))}Z`}
                  fill={s.color}
                  opacity={0.1}
                />
              )}
              {pts.length > 1 && (
                <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '4 4' : undefined} />
              )}
              {showDots &&
                pts.map((p, i) => (
                  <circle
                    key={i}
                    cx={sx(p.x)}
                    cy={sy(p.y)}
                    r={compact ? 3.5 : 4.5}
                    fill={p.color ?? s.color}
                    stroke="var(--panel)"
                    strokeWidth={2}
                  />
                ))}
            </g>
          );
        })}
        {hoverX !== null && (
          <g pointerEvents="none">
            <line x1={sx(hoverX)} x2={sx(hoverX)} y1={pad.t} y2={h - pad.b} stroke="#5b6680" strokeWidth={1} />
            {hoverRows.map(({ s, p }) => (
              <circle key={s.id} cx={sx(p.x)} cy={sy(p.y)} r={6} fill={p.color ?? s.color} stroke="#fff" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hoverX !== null && hoverRows.length > 0 && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(sx(hoverX), 70), w - 70), top: Math.min(...hoverRows.map((r) => sy(r.p.y))) }}>
          <div className="muted tiny">{formatX(hoverX)}</div>
          {hoverRows.map(({ s, p }) => (
            <div key={s.id} className="row" style={{ gap: 6 }}>
              <span style={{ width: 10, height: 2, background: s.color, display: 'inline-block', borderRadius: 1 }} />
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatY(p.y)}</strong>
              {series.length > 1 && <span className="dim">{s.label}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function niceTimeTicks(x0: number, x1: number, count: number): number[] {
  const DAY = 86_400_000;
  const span = x1 - x0;
  const steps = [1, 2, 7, 14, 30, 61, 91, 182, 365].map((d) => d * DAY);
  const step = steps.find((s) => span / s <= count) ?? 365 * DAY;
  const out: number[] = [];
  const start = new Date(x0);
  start.setHours(0, 0, 0, 0);
  for (let t = start.getTime(); t <= x1; t += step) if (t >= x0) out.push(t);
  return out;
}
