import { useMemo } from 'react';
import { formatMeasure, type Units } from '../../profile/profile';
import { CAPACITY, effortColor, relativeDemand, ROLE_LABEL, type GroupEffort } from '../../movement/activation';
import type { JointId, ModelResult } from '../../movement/biomech';
import { GROUP_BY_ID, type GroupId } from '../../movement/groups';
import { PATTERNS, type PatternDef, type PatternId } from '../../movement/patterns';
import { Seg } from '../common';
import Icon from '../Icon';
import LeverageDiagram from './LeverageDiagram';

export interface PatternState {
  pattern: PatternId;
  variant: string;
  options: Record<string, string>;
  load: number;
  phase: number;
}

function Spark({ values, at, color }: { values: number[]; at: number; color: string }) {
  const W = 84, H = 24;
  const max = Math.max(1, ...values.map(Math.abs));
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${H / 2 - (v / max) * (H / 2 - 2)}`).join(' ');
  return (
    <svg width={W} height={H} className="spark" aria-hidden>
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="spark-zero" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} />
      <line x1={at * W} x2={at * W} y1={1} y2={H - 1} className="spark-at" />
    </svg>
  );
}

export default function PatternPanel({
  state,
  setState,
  pattern,
  result,
  curves,
  efforts,
  mass,
  massSource,
  dimsNote,
  units,
  lastLogged,
  selectedJoint,
  onSelectJoint,
  selectedGroup,
  onSelectGroup,
  playing,
  onPlay,
}: {
  state: PatternState;
  setState: (patch: Partial<PatternState>) => void;
  pattern: PatternDef;
  result: ModelResult;
  curves: Record<string, number[]>;
  efforts: GroupEffort[];
  mass: number;
  massSource: 'profile' | 'health' | 'default';
  dimsNote: string;
  units: Units;
  lastLogged: { load: number; name: string } | null;
  selectedJoint: JointId | null;
  onSelectJoint: (j: JointId | null) => void;
  selectedGroup: GroupId | null;
  onSelectGroup: (g: GroupId | null) => void;
  playing: boolean;
  onPlay: (p: boolean) => void;
}) {
  const variant = pattern.variants.find((v) => v.value === state.variant) ?? pattern.variants[0];
  const hasLoad = variant.load !== 'none' && pattern.loadMax > 0;
  const kg = units === 'imperial' ? 0.45359237 : 1;
  const sorted = useMemo(() => {
    const order = { prime: 0, synergist: 1, stabiliser: 2 };
    return [...efforts].sort((a, b) => order[a.role] - order[b.role] || b.effort - a.effort);
  }, [efforts]);
  const jointColor = (id: JointId) => {
    const j = result.joints.find((x) => x.id === id)!;
    return effortColor(relativeDemand(j, mass, j.demand >= 0 ? 1 : -1));
  };

  return (
    <>
      <div className="side-section">
        <div className="pattern-chips" role="tablist" aria-label="Movement pattern">
          {PATTERNS.map((p) => (
            <button key={p.id} role="tab" aria-selected={p.id === state.pattern} className={`chip ${p.id === state.pattern ? 'on' : ''}`} onClick={() => setState({ pattern: p.id })} title={p.name}>
              {p.short}
            </button>
          ))}
        </div>
        <div className="side-title">
          <span className="crumb">Movement pattern</span>
          <h2>{pattern.name}</h2>
        </div>
        <p className="dim small">{pattern.description}</p>
        {pattern.variants.length > 1 && (
          <select className="input" value={variant.value} onChange={(e) => setState({ variant: e.target.value })} aria-label="Variation">
            {pattern.variants.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        )}
        {pattern.options.map((o) => (
          <div key={o.id} className="row between wrap small" title={o.hint}>
            <span className="dim">{o.label}</span>
            <Seg value={state.options[o.id] ?? o.default} onChange={(v) => setState({ options: { ...state.options, [o.id]: v } })} options={o.choices} label={o.label} />
          </div>
        ))}
        {hasLoad && (
          <div className="row between wrap small">
            <span className="dim">{pattern.loadLabel}</span>
            <span className="row" style={{ gap: 6 }}>
              {lastLogged && Math.abs(lastLogged.load - state.load) > 0.4 && (
                <button className="chip" onClick={() => setState({ load: Math.round(lastLogged.load) })} title={`Your last ${lastLogged.name}`}>
                  Your last: {formatMeasure(lastLogged.load, 'kg', units)}
                </button>
              )}
              <span className="measure-input" style={{ width: 110 }}>
                <input
                  className="input"
                  inputMode="decimal"
                  value={Math.round((state.load / kg) * 10) / 10}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (Number.isFinite(v)) setState({ load: Math.max(0, Math.min(pattern.loadMax, v * kg)) });
                  }}
                  aria-label={pattern.loadLabel}
                />
                <span className="unit">{units === 'imperial' ? 'lb' : 'kg'}</span>
              </span>
            </span>
          </div>
        )}
        <p className="tiny muted">
          {dimsNote} · body mass {formatMeasure(mass, 'kg', units)}
          {massSource === 'default' ? ' (default: add your weight in Profile)' : massSource === 'health' ? ' (from health data)' : ''}
        </p>
      </div>

      <div className="side-section">
        <div className="row between">
          <h4>Leverage</h4>
          <span className="tiny muted">Tap a joint · drag to move</span>
        </div>
        <LeverageDiagram
          views={result.views}
          joints={result.joints}
          selected={selectedJoint}
          colorOf={(j) => jointColor(j.id)}
          onSelect={(j) => onSelectJoint(selectedJoint === j ? null : j)}
          phase={state.phase}
          onPhase={(phase) => (onPlay(false), setState({ phase }))}
          height={result.views.length > 1 ? 250 : 290}
        />
        <div className="row" style={{ gap: 8 }}>
          <button className="btn icon small" onClick={() => onPlay(!playing)} aria-label={playing ? 'Pause' : 'Play the movement'}>
            <Icon name={playing ? 'pause' : 'play'} size={15} />
          </button>
          <div className="grow col" style={{ gap: 2 }}>
            <input type="range" min={0} max={1} step={0.01} value={state.phase} onChange={(e) => (onPlay(false), setState({ phase: Number(e.target.value) }))} aria-label="Point in the movement" />
            <div className="row between tiny muted">
              <span>{pattern.phase[0]}</span>
              <span>{pattern.phase[1]}</span>
            </div>
          </div>
        </div>
        {result.warnings.map((w) => (
          <p key={w} className="small warn-text">
            {w}
          </p>
        ))}
        <div className="joint-table" role="table" aria-label="Joint demands">
          <div className="jt-row jt-head" role="row">
            <span>Joint</span>
            <span>Lever</span>
            <span>Torque</span>
            <span>Over the range</span>
          </div>
          {result.joints.map((j) => {
            const color = jointColor(j.id);
            const rel = relativeDemand(j, mass, j.demand >= 0 ? 1 : -1);
            const small = Math.abs(j.demand) < 4;
            return (
              <button key={j.id} role="row" className={`jt-row ${selectedJoint === j.id ? 'on' : ''}`} onClick={() => onSelectJoint(selectedJoint === j.id ? null : j.id)}>
                <span className="jt-name">
                  <span className="feel-dot" style={{ background: color }} />
                  <span>
                    {j.label}
                    <span className="tiny muted block">{small ? 'held by the joint' : j.demand >= 0 ? j.positive : j.negative}</span>
                  </span>
                </span>
                <span className="mono small">{Math.round(Math.abs(j.arm) * 100)} cm</span>
                <span className="mono small">
                  {small ? '≈ 0' : Math.round(Math.abs(j.demand))} N·m
                  <span className="tiny muted block">{small ? '' : `${Math.round(rel * 100)}% of max${j.perSide ? ' · each side' : ''}`}</span>
                </span>
                <Spark values={curves[j.id] ?? []} at={state.phase} color={color} />
              </button>
            );
          })}
        </div>
        {selectedJoint &&
          (() => {
            const j = result.joints.find((x) => x.id === selectedJoint);
            if (!j) return null;
            return (
              <p className="small dim">
                <strong>{j.label}:</strong> the load’s line passes {Math.round(Math.abs(j.arm) * 1000) / 10} cm from the joint’s axis, so the muscles must make{' '}
                {Math.round(Math.abs(j.demand))} N·m{j.perSide ? ' on each side' : ''} — about {Math.round(relativeDemand(j, mass, j.demand >= 0 ? 1 : -1) * 100)}% of what they typically can ({CAPACITY[j.id]} N·m per kg). Shorten the lever and the work drops.
              </p>
            );
          })()}
      </div>

      <div className="side-section">
        <div className="row between">
          <h4>Muscle groups</h4>
          <span className="tiny muted">Estimated effort now</span>
        </div>
        <div className="group-list">
          {sorted.map((e) => {
            const g = GROUP_BY_ID.get(e.group)!;
            return (
              <button key={e.group} className={`group-row ${selectedGroup === e.group ? 'on' : ''}`} onClick={() => onSelectGroup(selectedGroup === e.group ? null : e.group)}>
                <span className="group-main">
                  <span className="grow">
                    <span className="group-name">{g.name}</span>
                    <span className={`role-chip ${e.role}`}>{ROLE_LABEL[e.role]}</span>
                  </span>
                  <span className="mono small">{Math.round(e.effort * 100)}%</span>
                </span>
                <span className="effort-track">
                  <span className="effort-fill" style={{ width: `${Math.max(2, e.effort * 100)}%`, background: effortColor(e.effort) }} />
                </span>
                {selectedGroup === e.group && <span className="tiny dim">{g.action}.</span>}
              </button>
            );
          })}
        </div>
        <div className="legend">
          <span>Rest</span>
          <span className="legend-bar effort" />
          <span>Max</span>
        </div>
        <p className="tiny muted">
          Estimates from a slow-motion model of your proportions and body mass, with segment masses from Winter’s anthropometric tables. Effort is the
          joint torque as a share of a typical maximum for a trained adult. It is not measured muscle activity.
        </p>
      </div>
    </>
  );
}
