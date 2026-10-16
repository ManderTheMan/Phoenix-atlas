// Same lift, different proportions: change your build at the same height
// (legs against torso, thigh against shin, arm length) and see what it does to
// the lift: trunk lean, how far the bar travels, each joint's peak effort and
// where it gets hardest. Optionally shows that build on the model.
import { useEffect, useMemo, useState } from 'react';
import { bodyDims, type ShapeInput } from '../../model/bodyShape';
import { wherePhase, type PatternDef } from '../../movement/patterns';
import { describePercentile, liftMetrics, percentileOf, RATIO_IDS, RATIOS, ratioAt, withRatios, type LiftMetrics, type RatioId } from '../../movement/proportions';
import { usePopulation } from '../../movement/usePopulation';
import { formatMeasure, type Units } from '../../profile/profile';
import { Check } from '../common';
import Icon from '../Icon';

const PRESETS: { label: string; set: Partial<Record<RatioId, number>> }[] = [
  { label: 'Long thighs', set: { thighShin: 92 } },
  { label: 'Short thighs', set: { thighShin: 8 } },
  { label: 'Long torso', set: { legs: 8 } },
  { label: 'Long legs', set: { legs: 92 } },
  { label: 'Long arms', set: { ape: 92 } },
  { label: 'Short arms', set: { ape: 8 } },
  { label: 'Average', set: { legs: 50, thighShin: 50, ape: 50 } },
];

const ordinal = (n: number) => {
  const r = Math.round(n);
  const s = r % 100 >= 11 && r % 100 <= 13 ? 'th' : r % 10 === 1 ? 'st' : r % 10 === 2 ? 'nd' : r % 10 === 3 ? 'rd' : 'th';
  return `${r}${s}`;
};

function change(a: number, b: number, fmt: (v: number) => string, tol: number) {
  const d = b - a;
  if (Math.abs(d) < tol) return <span className="dim">same</span>;
  return <span className={d > 0 ? 'up' : 'down'}>{`${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`}</span>;
}

export default function ProportionsExplorer({
  pattern,
  options,
  load,
  mass,
  input,
  sex,
  units,
  onPreview,
}: {
  pattern: PatternDef;
  options: Record<string, string>;
  load: number;
  mass: number;
  /** Your measurements (the build compared against). */
  input: ShapeInput;
  sex?: string;
  units: Units;
  onPreview: (input: ShapeInput | null) => void;
}) {
  const pop = usePopulation();
  const mine = useMemo(() => bodyDims(input), [input]);
  const own = useMemo(() => Object.fromEntries(RATIO_IDS.map((id) => [id, percentileOf(pop, id, mine, sex)])) as Record<RatioId, number>, [pop, mine, sex]);
  const [pct, setPct] = useState<Record<RatioId, number>>(own);
  const [preview, setPreview] = useState(false);
  // start from your own build whenever it changes
  const ownKey = RATIO_IDS.map((id) => own[id].toFixed(1)).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setPct(own), [ownKey]);

  const changed = RATIO_IDS.filter((id) => Math.abs(pct[id] - own[id]) >= 1);
  const targetKey = changed.map((id) => `${id}:${pct[id]}`).join(',');
  const other = useMemo(() => {
    if (!changed.length) return null;
    return withRatios(input, Object.fromEntries(changed.map((id) => [id, ratioAt(pop, id, pct[id], sex)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, pop, sex, targetKey]);

  const inp = { mass, load, options };
  const a = useMemo(() => liftMetrics(pattern, { ...inp, dims: mine }), [pattern, mine, mass, load, options]); // eslint-disable-line react-hooks/exhaustive-deps
  const b = useMemo<LiftMetrics | null>(() => (other ? liftMetrics(pattern, { ...inp, dims: other.dims }) : null), [pattern, other, mass, load, options]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => onPreview(preview && other ? other.input : null), [preview, other, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

  const len = (m: number) => formatMeasure(m * 100, 'cm', units);
  const pctOf = (v: number) => `${Math.round(v * 100)}%`;
  const joints = Object.keys({ ...a.peaks, ...b?.peaks }).filter((j) => Math.max(a.peaks[j as keyof typeof a.peaks] ?? 0, b?.peaks[j as keyof typeof a.peaks] ?? 0) >= 0.1) as (keyof typeof a.peaks)[];

  return (
    <div className="side-section proportions-explorer">
      <h3 className="side-sub">Same lift, other proportions</h3>
      <p className="small dim">Your build against everyone’s, and what a different one would do to this lift at your height, weight and load.</p>

      <div className="col" style={{ gap: 10 }}>
        {RATIO_IDS.map((id) => {
          const def = RATIOS[id];
          return (
            <label key={id} className="field prop-slider">
              <div className="row between">
                <span className="small" title={def.what}>
                  {def.label}
                </span>
                <span className="tiny mono">
                  {ordinal(pct[id])} percentile{Math.abs(pct[id] - own[id]) < 1 ? ' (you)' : ''}
                </span>
              </div>
              <input type="range" min={1} max={99} step={1} value={Math.round(pct[id])} onChange={(e) => setPct({ ...pct, [id]: Number(e.target.value) })} aria-label={`${def.label} percentile`} />
              <div className="row between tiny muted">
                <span>{def.low}</span>
                <span className="you-mark">you: {ordinal(own[id])}</span>
                <span>{def.high}</span>
              </div>
            </label>
          );
        })}
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.label} className="chip" onClick={() => setPct({ ...own, ...p.set })}>
              {p.label}
            </button>
          ))}
          {changed.length > 0 && (
            <button className="chip" onClick={() => setPct(own)}>
              <Icon name="refresh" size={13} /> You
            </button>
          )}
        </div>
        {pop.approx && <p className="tiny muted">Percentiles from approximate population spreads. Load exact ANSUR II figures in Profile → Your proportions.</p>}
      </div>

      {b && other ? (
        <>
          <table className="table rep-table compare-table">
            <thead>
              <tr>
                <th />
                <th className="num">You</th>
                <th className="num">Other build</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {a.trunkLean !== undefined && b.trunkLean !== undefined && (
                <tr>
                  <th scope="row">Most trunk lean</th>
                  <td className="num">{Math.round(a.trunkLean)}°</td>
                  <td className="num">{Math.round(b.trunkLean)}°</td>
                  <td className="num">{change(a.trunkLean, b.trunkLean, (v) => `${Math.round(v)}°`, 1)}</td>
                </tr>
              )}
              <tr>
                <th scope="row">{pattern.id === 'pullV' ? 'Body travel' : 'Bar travel'}</th>
                <td className="num">{len(a.travel)}</td>
                <td className="num">{len(b.travel)}</td>
                <td className="num">{change(a.travel, b.travel, len, 0.005)}</td>
              </tr>
              {a.work > 0 && (
                <tr>
                  <th scope="row">Work per rep</th>
                  <td className="num">{Math.round(a.work)} J</td>
                  <td className="num">{Math.round(b.work)} J</td>
                  <td className="num">{change(a.work, b.work, (v) => `${Math.round((v / a.work) * 100)}%`, a.work * 0.01)}</td>
                </tr>
              )}
              {joints.map((j) => (
                <tr key={j}>
                  <th scope="row">{a.labels[j] ?? b.labels[j]} peak effort</th>
                  <td className="num">{pctOf(a.peaks[j] ?? 0)}</td>
                  <td className="num">{pctOf(b.peaks[j] ?? 0)}</td>
                  <td className="num">{change(a.peaks[j] ?? 0, b.peaks[j] ?? 0, (v) => `${Math.round(v * 100)} pts`, 0.01)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {a.sticking && b.sticking && (
            <p className="tiny dim">
              Hardest point: yours is the {a.sticking.label.toLowerCase()}, {wherePhase(pattern, a.sticking.phase)}.{' '}
              {a.sticking.joint === b.sticking.joint && Math.abs(a.sticking.phase - b.sticking.phase) < 0.1
                ? 'The same for the other build.'
                : `The other build’s is the ${b.sticking.label.toLowerCase()}, ${wherePhase(pattern, b.sticking.phase)}.`}
            </p>
          )}
          {b.warnings.filter((w) => !a.warnings.includes(w)).map((w) => (
            <p key={w} className="tiny warn-text">
              <Icon name="info" size={13} /> Other build: {w}
            </p>
          ))}
          <label className="row small" style={{ gap: 8, marginTop: 8 }}>
            <Check on={preview} onChange={setPreview} label="Show this build on the model" />
            <span>
              Show this build on the model <span className="dim">(and in the leverage panel above)</span>
            </span>
          </label>
          <p className="tiny muted">
            Peak effort is each joint’s highest demand through the lift as a share of typical strength at that angle. The other build is {changed.map((id) => `${RATIOS[id].label.toLowerCase()} ${describePercentile(pct[id])}`).join('; ')}.
          </p>
        </>
      ) : (
        <p className="tiny muted">
          You: {RATIO_IDS.map((id) => `${RATIOS[id].label.toLowerCase()} ${describePercentile(own[id])}`).join('; ')}. Move a slider or pick a build to compare.
        </p>
      )}
    </div>
  );
}
