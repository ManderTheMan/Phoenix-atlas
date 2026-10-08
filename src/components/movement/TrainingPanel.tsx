import { effortColor } from '../../movement/activation';
import { GROUPS, type GroupId, type Region } from '../../movement/groups';
import { PATTERNS, type PatternId } from '../../movement/patterns';
import type { TrainingSummary } from '../../movement/training';
import { formatShort } from '../../lib/dates';
import BarChart from '../charts/BarChart';
import { FeelBadge, Seg } from '../common';
import Icon from '../Icon';

/** Sets a week that colour a group fully. */
export const FULL_SETS = 16;

const REGION_LABEL: Record<Region, string> = { lower: 'Legs & hips', core: 'Trunk', upper: 'Upper body' };

function Ratio({ label, value, target, hint }: { label: string; value: number | null; target: [number, number]; hint: string }) {
  const ok = value !== null && value >= target[0] && value <= target[1];
  const text = value === null ? '—' : value === Infinity ? 'only one side' : `${Math.round(value * 10) / 10} : 1`;
  return (
    <div className={`ratio ${value === null ? '' : ok ? 'good' : 'warn'}`} title={hint}>
      <span className="k">{label}</span>
      <span className="v mono">{text}</span>
    </div>
  );
}

export default function TrainingPanel({
  summary,
  weeks,
  setWeeks,
  onOpenPattern,
  selectedGroup,
  onSelectGroup,
}: {
  summary: TrainingSummary;
  weeks: number;
  setWeeks: (w: number) => void;
  onOpenPattern: (p: PatternId) => void;
  selectedGroup: GroupId | null;
  onSelectGroup: (g: GroupId | null) => void;
}) {
  const s = summary;
  const maxPattern = Math.max(1, ...PATTERNS.filter((p) => p.id !== 'gait').map((p) => s.patternPerWeek[p.id]));
  const total = s.weekly.map((w) => ({
    key: String(w.start),
    label: formatShort(w.start),
    value: Math.round(PATTERNS.filter((p) => p.id !== 'gait').reduce((t, p) => t + w.byPattern[p.id], 0) * 10) / 10,
    detail: `sets, week of ${formatShort(w.start)}`,
  }));
  const empty = s.sessions === 0;
  return (
    <>
      <div className="side-section">
        <div className="side-head">
          <div className="side-title">
            <span className="crumb">Your training</span>
            <h2>Patterns & muscle volume</h2>
          </div>
        </div>
        <div className="row between small">
          <span className="dim">Window</span>
          <Seg value={weeks} onChange={setWeeks} options={[{ value: 4, label: '4 wk' }, { value: 8, label: '8 wk' }, { value: 12, label: '12 wk' }]} label="Weeks" />
        </div>
        {empty ? (
          <p className="dim small">No workouts with exercises in this window. Log a workout (exercises and sets) to see your movement balance here.</p>
        ) : (
          <>
            <div className="ratio-grid">
              <Ratio label="Push : pull" value={s.balance.pushPull} target={[0.7, 1.25]} hint="Pressing sets vs pulling sets" />
              <Ratio label="Knee : hip" value={s.balance.kneeHip} target={[0.55, 1.8]} hint="Squat and lunge sets vs hinge sets" />
              <Ratio label="Horizontal push : pull" value={s.balance.horizontal} target={[0.7, 1.3]} hint="Bench and push-ups vs rows" />
              <Ratio label="Vertical push : pull" value={s.balance.vertical} target={[0.6, 1.5]} hint="Overhead presses vs pull-ups and pulldowns" />
            </div>
            <div className="insights">
              {s.insights.map((i) => (
                <p key={i.text} className={`insight ${i.tone}`}>
                  <Icon name={i.tone === 'good' ? 'check' : 'info'} size={15} /> {i.text}
                </p>
              ))}
            </div>
          </>
        )}
      </div>

      {!empty && (
        <>
          <div className="side-section">
            <div className="row between">
              <h4>Sets per week by pattern</h4>
              <span className="tiny muted">tap to analyse</span>
            </div>
            <div className="pattern-volume">
              {PATTERNS.map((p) => {
                const v = s.patternPerWeek[p.id];
                const gait = p.id === 'gait';
                return (
                  <button key={p.id} className="pv-row" onClick={() => onOpenPattern(p.id)}>
                    <span className="pv-name">{p.name}</span>
                    <span className="effort-track">
                      <span className="effort-fill" style={{ width: `${gait ? Math.min(100, v * 25) : (v / maxPattern) * 100}%`, background: gait ? '#5fa8d3' : '#f4a261' }} />
                    </span>
                    <span className="mono small">{Math.round(v * 10) / 10}{gait ? ' runs' : ''}</span>
                  </button>
                );
              })}
            </div>
            <BarChart bars={total} height={120} ariaLabel="Total sets per week" color="#f4a261" format={(v) => `${v}`} />
          </div>

          <div className="side-section">
            <div className="row between">
              <h4>Muscle groups</h4>
              <span className="tiny muted">sets / week · how they felt</span>
            </div>
            {(['lower', 'core', 'upper'] as Region[]).map((r) => (
              <div key={r} className="col" style={{ gap: 4 }}>
                <span className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {REGION_LABEL[r]}
                </span>
                {GROUPS.filter((g) => g.region === r).map((g) => {
                  const v = s.groupPerWeek[g.id];
                  const f = s.groupFeeling[g.id];
                  return (
                    <button key={g.id} className={`gv-row ${selectedGroup === g.id ? 'on' : ''}`} onClick={() => onSelectGroup(selectedGroup === g.id ? null : g.id)}>
                      <span className="pv-name">{g.name}</span>
                      <span className="effort-track">
                        <span className="effort-fill" style={{ width: `${Math.min(100, (v / FULL_SETS) * 100)}%`, background: effortColor(Math.min(1, v / FULL_SETS)) }} />
                      </span>
                      <span className="mono small">{Math.round(v * 10) / 10}</span>
                      <span className="gv-feel">{f ? <FeelBadge value={f.score} label={false} /> : null}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="legend">
              <span>0</span>
              <span className="legend-bar effort" />
              <span>{FULL_SETS}+ sets</span>
            </div>
            <p className="tiny muted">
              A prime mover gets a full set, a synergist half and a stabiliser a quarter. Runs count as sessions. Exercises logged without sets count as one set.
            </p>
            {s.unclassified.length > 0 && (
              <p className="tiny muted">
                Not recognised: {s.unclassified.slice(0, 8).join(', ')}
                {s.unclassified.length > 8 ? '…' : ''}
              </p>
            )}
          </div>
        </>
      )}
    </>
  );
}
