// Draws a movement model: the stick figure posed from your proportions, the
// load and its line of action, and for each joint its moment arm (the
// perpendicular distance from the joint to that line). Drag across the drawing
// to move through the range.
import { useRef } from 'react';
import type { DiagramView, JointId, JointResult, P2 } from '../../movement/biomech';

const PAD = 0.08;

function bounds(v: DiagramView): { min: P2; max: P2 } {
  const pts: P2[] = [...Object.values(v.points)];
  if (v.bar) pts.push([v.bar.at[0] - v.bar.r, v.bar.at[1] - v.bar.r], [v.bar.at[0] + v.bar.r, v.bar.at[1] + v.bar.r]);
  if (v.bench) pts.push(...v.bench);
  if (v.overhead) pts.push(...v.overhead);
  if (v.anchor) pts.push(v.anchor);
  if (v.floor !== undefined) pts.push([pts[0][0], v.floor - 0.02]);
  const min: P2 = [Infinity, Infinity], max: P2 = [-Infinity, -Infinity];
  for (const p of pts) for (let a = 0; a < 2; a++) (min[a] = Math.min(min[a], p[a])), (max[a] = Math.max(max[a], p[a]));
  return { min: [min[0] - PAD, min[1] - PAD], max: [max[0] + PAD, max[1] + PAD] };
}

export default function LeverageDiagram({
  views,
  joints,
  selected,
  colorOf,
  onSelect,
  phase,
  onPhase,
  height = 300,
}: {
  views: DiagramView[];
  joints: JointResult[];
  selected: JointId | null;
  colorOf: (j: JointResult) => string;
  onSelect: (j: JointId) => void;
  phase: number;
  onPhase: (p: number) => void;
  height?: number;
}) {
  const drag = useRef<{ x: number; phase: number; w: number } | null>(null);
  // the main (first) view is larger; any second view is an inset
  const weights = views.length > 1 ? [1.55, 1] : [1];
  return (
    <div
      className="lever"
      style={{ height }}
      onPointerDown={(e) => {
        if ((e.target as Element).closest('[data-joint]')) return;
        drag.current = { x: e.clientX, phase, w: (e.currentTarget as HTMLElement).clientWidth };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        onPhase(Math.max(0, Math.min(1, d.phase + ((e.clientX - d.x) / d.w) * 1.4)));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      role="group"
      aria-label="Leverage diagram. Drag sideways to move through the movement."
    >
      {views.map((v, vi) => (
        <View key={v.name + vi} view={v} weight={weights[vi]} joints={joints.filter((j) => j.view === vi)} selected={selected} colorOf={colorOf} onSelect={onSelect} />
      ))}
    </div>
  );
}

function View({
  view: v,
  weight,
  joints,
  selected,
  colorOf,
  onSelect,
}: {
  view: DiagramView;
  weight: number;
  joints: JointResult[];
  selected: JointId | null;
  colorOf: (j: JointResult) => string;
  onSelect: (j: JointId) => void;
}) {
  const { min, max } = bounds(v);
  const w = max[0] - min[0], h = max[1] - min[1];
  const W = 1000 * (w / h);
  const k = 1000 / h; // SVG units per metre
  const X = (x: number) => (x - min[0]) * k;
  const Y = (y: number) => (max[1] - y) * k;
  const s = 1.15; // strokes and text are sized in viewBox units, so every view draws them alike
  const P = v.points;
  return (
    <figure className="lever-view" style={{ flex: weight }}>
      <svg viewBox={`0 0 ${W} 1000`} preserveAspectRatio="xMidYMid meet" className="lever-svg">
        {v.floor !== undefined && <line x1={0} x2={W} y1={Y(v.floor)} y2={Y(v.floor)} className="lv-floor" strokeWidth={3 * s} />}
        {v.base && <line x1={X(v.base[0])} x2={X(v.base[1])} y1={Y(0) + 5 * s} y2={Y(0) + 5 * s} className="lv-base" strokeWidth={10 * s} />}
        {v.bench && <line x1={X(v.bench[0][0])} x2={X(v.bench[1][0])} y1={Y(v.bench[0][1])} y2={Y(v.bench[1][1])} className="lv-bench" strokeWidth={16 * s} />}
        {v.overhead && <line x1={X(v.overhead[0][0])} x2={X(v.overhead[1][0])} y1={Y(v.overhead[0][1])} y2={Y(v.overhead[1][1])} className="lv-bar" strokeWidth={8 * s} />}
        {v.anchor && P.hands && <line x1={X(v.anchor[0])} y1={Y(v.anchor[1])} x2={X(P.hands[0])} y2={Y(P.hands[1])} className="lv-band" strokeWidth={4 * s} />}
        {/* load lines and moment arms */}
        {v.forces.map((f, i) => {
          const far = 3;
          return <line key={`ll${i}`} x1={X(f.at[0] - f.dir[0] * far)} y1={Y(f.at[1] - f.dir[1] * far)} x2={X(f.at[0] + f.dir[0] * far)} y2={Y(f.at[1] + f.dir[1] * far)} className="lv-loadline" strokeWidth={2.5 * s} />;
        })}
        {joints.map((j) =>
          j.foot ? (
            <g key={`arm${j.id}`} className={`lv-arm ${selected === j.id ? 'on' : ''}`}>
              <line x1={X(j.at[0])} y1={Y(j.at[1])} x2={X(j.foot[0])} y2={Y(j.foot[1])} stroke={colorOf(j)} strokeWidth={(selected === j.id ? 7 : 4) * s} strokeDasharray={selected === j.id ? undefined : `${10 * s} ${7 * s}`} />
              {selected === j.id && (
                <text
                  x={X(j.foot[0]) + (X(j.foot[0]) >= X(j.at[0]) ? 12 : -12) * s}
                  y={Y(j.foot[1]) - 16 * s}
                  fontSize={34 * s}
                  textAnchor={X(j.foot[0]) >= X(j.at[0]) ? 'start' : 'end'}
                  className="lv-armtext"
                >
                  {Math.abs(Math.round(j.arm * 1000) / 10)} cm
                </text>
              )}
            </g>
          ) : null,
        )}
        {v.bar && v.bar.r > 0 && <circle cx={X(v.bar.at[0])} cy={Y(v.bar.at[1])} r={v.bar.r * k} className="lv-plate behind" strokeWidth={5 * s} />}
        {/* body */}
        {v.bones.map(([a, b], i) =>
          P[a] && P[b] ? <line key={i} x1={X(P[a][0])} y1={Y(P[a][1])} x2={X(P[b][0])} y2={Y(P[b][1])} className="lv-bone" strokeWidth={13 * s} /> : null,
        )}
        {P.head && <circle cx={X(P.head[0])} cy={Y(P.head[1])} r={0.1 * k * 0.95} className="lv-head" strokeWidth={6 * s} />}
        {v.bar && <circle cx={X(v.bar.at[0])} cy={Y(v.bar.at[1])} r={(v.bar.r > 0 ? 14 : 20) * s} className="lv-barend" />}
        {v.dumbbells?.map((d, i) => (
          <rect key={i} x={X(d[0]) - 26 * s} y={Y(d[1]) - 20 * s} width={52 * s} height={40 * s} rx={10 * s} className="lv-plate" strokeWidth={5 * s} />
        ))}
        {v.com && (
          <g className="lv-com">
            <circle cx={X(v.com[0])} cy={Y(v.com[1])} r={16 * s} strokeWidth={4 * s} />
            <path d={`M${X(v.com[0])},${Y(v.com[1]) - 16 * s}V${Y(v.com[1]) + 16 * s}M${X(v.com[0]) - 16 * s},${Y(v.com[1])}H${X(v.com[0]) + 16 * s}`} strokeWidth={4 * s} />
          </g>
        )}
        {/* forces */}
        {v.forces.map((f, i) => {
          const L = 150 * s;
          const tip: P2 = [X(f.at[0]) + f.dir[0] * L, Y(f.at[1]) - f.dir[1] * L];
          const ang = Math.atan2(-f.dir[1], f.dir[0]);
          const hd = 22 * s;
          return (
            <g key={`f${i}`} className="lv-force">
              <line x1={X(f.at[0])} y1={Y(f.at[1])} x2={tip[0]} y2={tip[1]} strokeWidth={6 * s} />
              <path d={`M${tip[0]},${tip[1]}L${tip[0] - hd * Math.cos(ang - 0.45)},${tip[1] - hd * Math.sin(ang - 0.45)}L${tip[0] - hd * Math.cos(ang + 0.45)},${tip[1] - hd * Math.sin(ang + 0.45)}Z`} />
              <text x={tip[0] + 10 * s} y={tip[1] + (f.dir[1] > 0 ? -8 : 34) * s} fontSize={30 * s}>
                {f.label}
              </text>
            </g>
          );
        })}
        {/* joints */}
        {joints.map((j) => (
          <g key={`j${j.id}`} data-joint={j.id} className="lv-joint" onClick={() => onSelect(j.id)} style={{ cursor: 'pointer' }}>
            <circle cx={X(j.at[0])} cy={Y(j.at[1])} r={(selected === j.id ? 30 : 22) * s} fill={colorOf(j)} className={selected === j.id ? 'on' : ''} strokeWidth={5 * s} />
            <circle cx={X(j.at[0])} cy={Y(j.at[1])} r={48 * s} fill="transparent" />
          </g>
        ))}
        <text x={14 * s} y={40 * s} fontSize={30 * s} className="lv-viewname">
          {v.name} view
        </text>
      </svg>
    </figure>
  );
}
