// How hard your sets are, and how well the app reads it: your estimated max per
// lift, your own speed at failure per movement, and the RPE estimate's average
// miss over time, which shrinks as you rate sets.
import { useMemo } from 'react';
import { formatShort } from '../../lib/dates';
import { PATTERN_BY_ID, type PatternId } from '../../movement/patterns';
import { accuracyOverTime, maxFromSpeed, priorSpeedModel, failureSpeed, speedAtFailure } from '../../movement/rpe';
import { useRpe } from '../../movement/useRpe';
import { toDisplay, useProfile } from '../../profile/profile';
import LineChart from '../charts/LineChart';
import Icon from '../Icon';

const DAY = 86_400_000;

export default function EffortPanel() {
  const { obs, learner } = useRpe();
  const units = useProfile().units;
  const unit = units === 'imperial' ? 'lb' : 'kg';
  const w = (kg: number) => Math.round(toDisplay(kg, 'kg', units));

  const rated = learner.history.length;
  const guessed = learner.history.filter((h) => h.guess !== undefined);
  const acc = useMemo(() => accuracyOverTime(learner.history, 8), [learner]);
  const missNow = guessed.length ? guessed.slice(-8).reduce((s, h) => s + Math.abs(h.guess! - h.rpe), 0) / Math.min(8, guessed.length) : null;

  const lifts = useMemo(() => {
    const by = new Map<string, { name: string; pattern?: PatternId; sets: number; rated: number; filmed: number; last: number }>();
    for (const o of obs) {
      if (!o.load) continue;
      const e = by.get(o.lift) ?? { name: o.name, pattern: o.pattern, sets: 0, rated: 0, filmed: 0, last: 0 };
      e.sets++;
      if (o.rpe !== undefined) e.rated++;
      if (o.speed) e.filmed++;
      e.last = Math.max(e.last, o.date);
      e.name = o.name;
      by.set(o.lift, e);
    }
    return [...by.entries()]
      .map(([lift, e]) => {
        const max = learner.maxAt(lift);
        const mvt = e.pattern ? (speedAtFailure(obs, e.pattern)?.speed ?? (priorSpeedModel(e.pattern) ? failureSpeed(priorSpeedModel(e.pattern)!, e.pattern) : null)) : null;
        const fromSpeed = mvt ? maxFromSpeed(obs, lift, mvt) : null;
        const history = (learner.maxes.get(lift) ?? []).filter((p) => p.exact).map((p) => ({ x: p.date, y: toDisplay(p.value, 'kg', units) }));
        return { lift, ...e, max, fromSpeed, history };
      })
      .filter((l) => l.max)
      .sort((a, b) => b.last - a.last)
      .slice(0, 8);
  }, [obs, learner, units]);

  const movements = useMemo(() => {
    const ids = [...new Set(obs.filter((o) => o.speed && o.pattern).map((o) => o.pattern!))];
    return ids.map((p) => {
      const prior = priorSpeedModel(p);
      return { id: p, own: speedAtFailure(obs, p), typical: prior ? failureSpeed(prior, p) : null, filmed: obs.filter((o) => o.pattern === p && o.speed).length };
    });
  }, [obs]);

  return (
    <>
      <div className="side-section">
        <div className="side-head">
          <div className="side-title">
            <span className="crumb">Your training</span>
            <h2>Effort & maxes</h2>
          </div>
        </div>
        <p className="small dim">
          The app estimates how hard each set was (RPE) from two things: the weight against your max, and, on video, how much the bar slowed through the set. Every RPE you enter, on a clip or a logged exercise, tunes both to you.
        </p>
        <div className="ratio-grid">
          <div className="ratio">
            <span className="k">Sets you’ve rated</span>
            <span className="v mono">{rated}</span>
          </div>
          <div className="ratio">
            <span className="k">Typical miss now</span>
            <span className="v mono">{missNow === null ? '—' : `± ${missNow.toFixed(1)} RPE`}</span>
          </div>
        </div>
        {acc.length >= 2 ? (
          <>
            <span className="tiny dim">Average miss over each 8 rated sets (lower is better)</span>
            <LineChart
              ariaLabel="RPE estimate's average miss over time"
              series={[{ id: 'miss', label: 'Average miss', color: 'var(--accent)', points: acc.map((a) => ({ x: a.date, y: Math.round(a.error * 100) / 100 })) }]}
              formatX={(x) => formatShort(x)}
              formatY={(y) => `±${y.toFixed(1)}`}
              height={140}
            />
          </>
        ) : (
          <p className="tiny muted">
            <Icon name="info" size={13} /> Rate {Math.max(1, 9 - guessed.length)} more set{9 - guessed.length === 1 ? '' : 's'} to see the estimate’s accuracy over time. On a clip: Joints → How hard it was. In a workout note: the RPE column.
          </p>
        )}
      </div>

      <div className="side-section">
        <h3 className="side-sub">Your maxes</h3>
        {lifts.length === 0 ? (
          <p className="small dim">Log exercises with weight and reps (and an RPE for the last set) to see your estimated max for each lift.</p>
        ) : (
          <div className="col" style={{ gap: 10 }}>
            {lifts.map((l) => (
              <div key={l.lift} className="max-row">
                <div className="row between">
                  <strong className="small">{l.name}</strong>
                  <span className="mono small">
                    {w(l.max!.value)} {unit}
                    {l.max!.rough ? <span className="dim"> (rough)</span> : null}
                  </span>
                </div>
                <span className="tiny muted">
                  {l.sets} set{l.sets === 1 ? '' : 's'}, {l.rated} rated, {l.filmed} filmed · last {formatShort(l.last)}
                  {l.fromSpeed ? ` · from bar speed: ${w(l.fromSpeed.e1rm)} ${unit} (${l.fromSpeed.points} clips)` : ''}
                  {Date.now() - l.last > 60 * DAY ? ' · not done for a while' : ''}
                </span>
                {l.history.length >= 3 && (
                  <LineChart
                    ariaLabel={`${l.name} estimated max over time`}
                    series={[{ id: l.lift, label: 'Estimated max', color: 'var(--accent)', points: l.history }]}
                    formatX={(x) => formatShort(x)}
                    formatY={(y) => `${Math.round(y)} ${unit}`}
                    height={90}
                    compact
                  />
                )}
              </div>
            ))}
            <p className="tiny muted">Estimated with Epley’s formula from your sets and their RPE (reps done plus reps left), newest weighted most.</p>
          </div>
        )}
      </div>

      {movements.length > 0 && (
        <div className="side-section">
          <h3 className="side-sub">Your speed at failure</h3>
          <table className="table rep-table">
            <thead>
              <tr>
                <th>Movement</th>
                <th className="num">Yours</th>
                <th className="num">Typical</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td>{PATTERN_BY_ID.get(m.id)?.name ?? m.id}</td>
                  <td className="num">{m.own ? `${m.own.speed.toFixed(2)} m/s` : '—'}</td>
                  <td className="num">{m.typical ? `${m.typical.toFixed(2)} m/s` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tiny muted">
            The last rep’s speed when nothing is left, from your filmed and rated sets (needs four, across at least two RPE points). Speeds are of the body point that moves with the bar, measured on video, so they read a little differently from a bar sensor.
          </p>
        </div>
      )}
    </>
  );
}
