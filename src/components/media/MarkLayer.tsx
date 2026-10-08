// Draws measurements over a photo or video frame, and turns taps into points.
// The SVG uses the frame's own pixel size as its coordinate system, so angles
// read the same as on the original.
import { useRef } from 'react';
import type { MediaItem, MediaMark } from '../../db/db';
import { markName, markValue, type P } from '../../media/media';
import { MARK_COLORS } from '../../media/process';

export interface Draft {
  type: MediaMark['type'];
  points: P[];
}

export default function MarkLayer({
  item,
  marks,
  t,
  boxW,
  draft,
  selected,
  onTap,
  onDrag,
  onSelect,
}: {
  item: Pick<MediaItem, 'width' | 'height'>;
  marks: MediaMark[];
  /** Current video time (paths fade beyond it). */
  t?: number | null;
  /** On-screen width of the frame, to keep lines and text a constant size. */
  boxW: number;
  draft?: Draft | null;
  selected?: string | null;
  onTap?: (p: P) => void;
  onDrag?: (markId: string, index: number, p: P) => void;
  onSelect?: (markId: string) => void;
}) {
  const W = item.width, H = item.height;
  const k = boxW ? W / boxW : 1; // frame pixels per screen pixel
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; i: number; pid: number } | null>(null);
  const toP = (e: { clientX: number; clientY: number }): P => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
  };
  const px = (p: P) => [p[0] * W, p[1] * H] as const;

  const label = (m: { type: MediaMark['type']; points: P[]; label?: string }, color: string, key: string) => {
    const v = markValue(m as MediaMark, W, H);
    if (!v) return null;
    const at = px(m.type === 'angle' ? m.points[1] : m.points[m.points.length - 1]);
    const text = `${m.label ? `${markName(m as MediaMark)} ` : ''}${m.type === 'path' ? `${Math.round(v.value)}% drift` : `${Math.round(v.value)}°`}`;
    const fs = 13 * k;
    const w = text.length * fs * 0.58 + 10 * k;
    const x = Math.min(W - w - 4 * k, at[0] + 10 * k), y = Math.max(fs + 8 * k, at[1] - 10 * k);
    return (
      <g key={key} className="mark-label" pointerEvents="none">
        <rect x={x} y={y - fs - 3 * k} width={w} height={fs + 9 * k} rx={4 * k} />
        <text x={x + 5 * k} y={y} fontSize={fs} fill={color}>
          {text}
        </text>
      </g>
    );
  };

  const shape = (m: { id?: string; type: MediaMark['type']; points: P[]; times?: number[]; label?: string }, opts: { draft?: boolean }) => {
    const c = MARK_COLORS[m.type];
    const pts = m.points.map(px);
    if (!pts.length) return null;
    const line = (ps: (readonly [number, number])[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
    // a path is solid up to the current time and faint after it
    let past = pts, future: (readonly [number, number])[] = [];
    if (m.type === 'path' && t != null && m.times?.length === pts.length) {
      const n = m.times.findIndex((x) => x > t + 1e-3);
      if (n >= 0) {
        past = pts.slice(0, n);
        future = pts.slice(Math.max(0, n - 1));
      }
    }
    const isSel = m.id && m.id === selected;
    let arc: string | null = null;
    if (m.type === 'angle' && pts.length === 3) {
      const [a, b, cc] = pts;
      const r = Math.min(28 * k, Math.hypot(a[0] - b[0], a[1] - b[1]) * 0.5, Math.hypot(cc[0] - b[0], cc[1] - b[1]) * 0.5);
      const u = Math.atan2(a[1] - b[1], a[0] - b[0]), v = Math.atan2(cc[1] - b[1], cc[0] - b[0]);
      let dv = v - u;
      while (dv > Math.PI) dv -= 2 * Math.PI;
      while (dv < -Math.PI) dv += 2 * Math.PI;
      arc = `M${b[0] + r * Math.cos(u)},${b[1] + r * Math.sin(u)} A${r},${r} 0 0 ${dv > 0 ? 1 : 0} ${b[0] + r * Math.cos(v)},${b[1] + r * Math.sin(v)}`;
    }
    let vertical: string | null = null;
    if (m.type === 'line' && pts.length === 2) {
      const [top, bot] = pts[0][1] < pts[1][1] ? [pts[0], pts[1]] : [pts[1], pts[0]];
      vertical = `M${bot[0]},${bot[1]} L${bot[0]},${top[1]}`;
    }
    return (
      <g key={m.id ?? 'draft'} className={`mark ${isSel ? 'sel' : ''} ${opts.draft ? 'draft' : ''}`} onPointerDown={m.id && onSelect ? (e) => (e.stopPropagation(), onSelect(m.id!)) : undefined}>
        {past.length > 0 && <path d={line(past)} className="mark-halo" vectorEffect="non-scaling-stroke" />}
        {past.length > 0 && <path d={line(past)} stroke={c} className="mark-line" vectorEffect="non-scaling-stroke" />}
        {future.length > 1 && <path d={line(future)} stroke={c} className="mark-line future" vectorEffect="non-scaling-stroke" />}
        {arc && <path d={arc} stroke={c} className="mark-arc" vectorEffect="non-scaling-stroke" />}
        {vertical && <path d={vertical} stroke={c} className="mark-vertical" vectorEffect="non-scaling-stroke" />}
        {(m.type === 'path' ? [pts[0], pts[pts.length - 1]] : pts).map((p, i) => {
          const index = m.type === 'path' ? (i === 0 ? 0 : pts.length - 1) : i;
          return (
            <circle
              key={i}
              cx={p[0]}
              cy={p[1]}
              r={(isSel ? 7 : 4.5) * k}
              fill={c}
              className="mark-handle"
              onPointerDown={
                m.id && onDrag && isSel
                  ? (e) => {
                      e.stopPropagation();
                      drag.current = { id: m.id!, i: index, pid: e.pointerId };
                      svg.current?.setPointerCapture(e.pointerId);
                    }
                  : undefined
              }
            />
          );
        })}
        {!opts.draft && label(m, c, 'l')}
      </g>
    );
  };

  return (
    <svg
      ref={svg}
      className={`mark-layer ${onTap ? 'tapping' : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onPointerDown={(e) => {
        if (drag.current || !onTap) return;
        onTap(toP(e));
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d && onDrag) onDrag(d.id, d.i, toP(e));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      {marks.map((m) => shape(m, {}))}
      {draft && draft.points.length > 0 && shape({ type: draft.type, points: draft.points }, { draft: true })}
    </svg>
  );
}
