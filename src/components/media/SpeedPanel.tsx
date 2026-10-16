// Rep speeds and how hard the set was: each rep's lifting speed from the joint
// track, the slowdown across the set, the app's RPE estimate (from the speed and,
// with a weight entered, from your max), and your own RPE, which it learns from.
import { useEffect, useMemo } from 'react';
import type { MediaItem } from '../../db/db';
import { updateMedia } from '../../media/media';
import { PATTERN_BY_ID, type PatternId } from '../../movement/patterns';
import { liftKey } from '../../movement/rpe';
import { fmtRpe, useRpe } from '../../movement/useRpe';
import { toDisplay, useBodyDims, useProfile } from '../../profile/profile';
import type { PoseTrack } from '../../vision/analysis';
import { fatigue, setVelocity, timeScaleOf, velocitySummary } from '../../vision/velocity';

const RPES = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

function SpeedBars({ speeds, onSeek }: { speeds: { mean: number; t0: number }[]; onSeek: (t: number) => void }) {
  const W = 320, H = 96, padB = 16, padT = 14;
  const max = Math.max(...speeds.map((s) => s.mean)) * 1.12;
  const bw = Math.min(36, (W - 8) / speeds.length - 6);
  return (
    <svg className="speed-bars" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Lifting speed of each rep">
      {speeds.map((s, i) => {
        const h = ((H - padB - padT) * s.mean) / max;
        const x = 4 + i * (bw + 6);
        return (
          <g key={i} className="clickable" onClick={() => onSeek(s.t0)}>
            <rect x={x} y={H - padB - h} width={bw} height={h} rx={3} className="speed-bar" />
            <text x={x + bw / 2} y={H - padB - h - 3} className="chart-tick" textAnchor="middle">
              {s.mean.toFixed(2)}
            </text>
            <text x={x + bw / 2} y={H - 3} className="chart-tick" textAnchor="middle">
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function SpeedPanel({ item, track, seek }: { item: MediaItem; track: PoseTrack; seek: (t: number) => void }) {
  const dims = useBodyDims();
  const units = useProfile().units;
  const { obs, learner } = useRpe();
  const pattern = item.pattern as PatternId;
  const k = timeScaleOf(item);
  const sv = useMemo(() => (k === null ? null : setVelocity(track, pattern, dims, { timeScale: k })), [track, pattern, dims, k]);

  // keep the clip's stored speeds (which the RPE model reads) in step with what's shown
  useEffect(() => {
    if (k === null || !sv?.reps.length) return;
    const v = item.velocity;
    if (v && v.pattern === pattern && v.v.length === sv.reps.length && Math.abs(v.h - dims.height) < 1e-6 && Math.abs(v.v[0] - sv.reps[0].mean) < 0.002) return;
    const s = velocitySummary(track, pattern, dims, { timeScale: k });
    if (s) void updateMedia(item.id, { velocity: s });
  }, [sv, item.id, item.velocity, pattern, track, dims, k]);

  if (k === null) return <p className="tiny muted">Slow-motion clip with an unknown frame rate: speeds can’t be measured.</p>;
  if (!sv || !sv.reps.length) return <p className="tiny muted">No lifting phases found to time. Rep speed needs the joints seen side-on through each rep.</p>;

  const f = fatigue({ pattern, v: sv.reps.map((r) => r.mean), peak: sv.reps.map((r) => r.peak), rom: sv.reps.map((r) => r.rom), dur: sv.reps.map((r) => r.t1 - r.t0), h: dims.height, point: sv.point });
  const def = PATTERN_BY_ID.get(pattern);
  const mine = obs.find((o) => o.mediaId === item.id);
  const setObs = mine ?? {
    id: `media:${item.id}`,
    date: item.date,
    lift: liftKey(def?.variants.find((v) => v.value === item.variant)?.label ?? def?.name ?? pattern),
    pattern,
    load: item.load,
    reps: item.reps ?? f.reps,
    speed: { best: f.best, last: f.last, loss: f.loss, slowdown: f.slowdown, reps: f.reps },
  };
  // a set you've rated was learned from: show what it would have guessed beforehand
  const past = mine && item.rpe !== undefined ? learner.history.find((h) => h.id === mine.id) : undefined;
  const est = learner.estimate(setObs);
  const unitLabel = units === 'imperial' ? 'lb' : 'kg';

  return (
    <div className="col speed-panel" style={{ gap: 8 }}>
      <div className="row between">
        <span className="tiny dim">Lifting speed per rep, m/s ({sv.point === 'wrist' ? 'hands' : 'shoulders'}, tap to jump)</span>
        <span className="tiny muted">{f.reps} rep{f.reps === 1 ? '' : 's'}</span>
      </div>
      <SpeedBars speeds={sv.reps.map((r) => ({ mean: r.mean, t0: r.t0 / sv.timeScale }))} onSeek={seek} />
      {f.reps > 1 && (
        <p className="tiny dim">
          Fastest {f.best.toFixed(2)} m/s, last {f.last.toFixed(2)} m/s: <strong>{Math.round(f.loss * 100)}% slower</strong>
          {f.slowdown > 1.05 ? `, the last rep took ${f.slowdown.toFixed(1)}× as long to lift` : ''}.
        </p>
      )}

      <div className="effort-box">
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <span className="small">How hard it was</span>
          {past?.guess !== undefined ? (
            <span className="small">
              Guessed <strong>{fmtRpe(past.guess)}</strong>, you said <strong>{fmtRpe(item.rpe!)}</strong>
            </span>
          ) : est ? (
            <span className="small">
              About <strong>{fmtRpe(est.rpe)}</strong> {est.rpe > 5 && <span className="dim">{est.sd > 2.5 ? '(rough)' : `± ${Math.max(0.5, Math.round(est.sd * 2) / 2)}`}</span>}
            </span>
          ) : null}
        </div>
        {est && !past && (
          <p className="tiny muted">
            {[
              est.fromSpeed && `From the slowdown: ${fmtRpe(est.fromSpeed.rpe)}${est.fromSpeed.learnedFrom ? `, tuned to ${est.fromSpeed.learnedFrom} of your rated ${def?.name.toLowerCase() ?? ''} sets` : ', from typical bar speeds until you rate a few sets'}.`,
              est.fromLoad && `From the weight: ${fmtRpe(est.fromLoad.rpe)} against your max of ${Math.round(toDisplay(est.fromLoad.e1rm, 'kg', units))} ${unitLabel}${est.fromLoad.rough ? ' (a rough max: rate some sets to firm it up)' : ''}.`,
              !est.fromLoad && (item.load ? 'No max for this lift yet: rate a set to start one.' : 'Add the weight in Details for an estimate from your max too.'),
            ]
              .filter(Boolean)
              .join(' ')}
          </p>
        )}
        <div className="field">
          <span className="tiny dim">Your RPE for this set (it learns from these)</span>
          <div className="chips rpe-chips">
            {RPES.map((r) => (
              <button key={r} className={`chip ${item.rpe === r ? 'on' : ''}`} onClick={() => void updateMedia(item.id, { rpe: item.rpe === r ? undefined : r })} aria-pressed={item.rpe === r}>
                {r}
              </button>
            ))}
          </div>
          <span className="tiny muted">10 = nothing left; 9 = one more rep possible; 8 = two; 7 = three.</span>
        </div>
      </div>
    </div>
  );
}
