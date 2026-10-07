// Column chart: one series, thin rounded columns from a shared baseline, per-bar hover.
import { useEffect, useRef, useState } from 'react';

export interface Bar {
  key: string;
  label: string;
  value: number;
  color?: string;
  detail?: string;
}

export default function BarChart({ bars, height = 160, color = '#5a9fd8', ariaLabel, format = (v) => String(v) }: { bars: Bar[]; height?: number; color?: string; ariaLabel: string; format?: (v: number) => string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const pad = { l: 30, r: 6, t: 10, b: 22 };
  const max = Math.max(1, ...bars.map((b) => b.value));
  const width = Math.max(w, 100);
  const band = (width - pad.l - pad.r) / Math.max(1, bars.length);
  const bw = Math.min(24, band * 0.7);
  const sy = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.round(max / 2), max];
  const labelEvery = Math.ceil(bars.length / Math.max(1, Math.floor((width - pad.l) / 46)));
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg className="chart" width={width} height={height} role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={pad.l} x2={width - pad.r} y1={sy(t)} y2={sy(t)} />
            <text x={pad.l - 6} y={sy(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = pad.l + i * band + (band - bw) / 2;
          const y = sy(b.value);
          const h = Math.max(0, height - pad.b - y);
          const r = Math.min(4, h, bw / 2);
          const path = h > 0 ? `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y + h}Z` : '';
          return (
            <g key={b.key} onPointerEnter={() => setHover(i)}>
              <rect x={pad.l + i * band} y={pad.t} width={band} height={height - pad.t - pad.b} fill="transparent" />
              {path && <path d={path} fill={b.color ?? color} opacity={hover === null || hover === i ? 1 : 0.55} />}
              {i % labelEvery === 0 && (
                <text x={pad.l + i * band + band / 2} y={height - 6} textAnchor="middle">
                  {b.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && bars[hover] && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(pad.l + hover * band + band / 2, 60), width - 60), top: sy(bars[hover].value) }}>
          <strong>{format(bars[hover].value)}</strong> <span className="dim">{bars[hover].detail ?? bars[hover].label}</span>
        </div>
      )}
    </div>
  );
}
