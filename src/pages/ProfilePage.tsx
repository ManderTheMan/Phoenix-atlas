import { useEffect, useMemo, useState } from 'react';
import type { LayerId } from '../anatomy/types';
import LineChart from '../components/charts/LineChart';
import { Check, ConfirmButton, Seg } from '../components/common';
import Icon from '../components/Icon';
import BodyViewer from '../components/viewer/BodyViewer';
import { DAY, formatDate, formatShort } from '../lib/dates';
import { bodyDims, computeBodyShape, type BodyDims } from '../model/bodyShape';
import {
  deleteMeasurement,
  formatMeasure,
  fromDisplay,
  MEASURE_BY_KEY,
  measureLabel,
  MEASURES,
  saveMeasurements,
  saveProfile,
  shapeInputFrom,
  toDisplay,
  unitLabel,
  useBody,
  type MeasureDef,
  type MeasureKey,
  type Profile,
} from '../profile/profile';
import type { LayerState } from '../state/ui';
import { useUI } from '../state/ui';

type Preview = 'surface' | 'muscles' | 'skeleton';

const PREVIEW_LAYERS: Record<Preview, Partial<Record<LayerId, number>>> = {
  surface: { skin: 1 },
  muscles: { muscular: 1, skeletal: 1 },
  skeleton: { skeletal: 1, skin: 0.12 },
};

function layersFor(p: Preview): Record<LayerId, LayerState> {
  const on = PREVIEW_LAYERS[p];
  const ids: LayerId[] = ['skin', 'muscular', 'skeletal', 'nerves', 'vascular', 'organs'];
  return Object.fromEntries(ids.map((id) => [id, { visible: on[id] !== undefined, opacity: on[id] ?? 1 }])) as Record<LayerId, LayerState>;
}

const NO_COLORS = new Map<string, string>();

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const dayInput = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function ProfilePage() {
  const ui = useUI();
  const { profile, values, entries } = useBody();
  const units = profile.units;
  const [draft, setDraft] = useState<Partial<Record<MeasureKey, string>>>({});
  const [date, setDate] = useState(() => dayInput(Date.now()));
  const [preview, setPreview] = useState<Preview>('surface');
  const [metric, setMetric] = useState<MeasureKey>('weight');
  const [saving, setSaving] = useState(false);

  // the form shows the current values; edits are kept until saved
  const shown = (m: MeasureDef): string => {
    if (draft[m.key] !== undefined) return draft[m.key]!;
    const v = values[m.key];
    return v === undefined ? '' : String(Math.round(toDisplay(v, m.unit, units) * 10) / 10);
  };
  const parsed = useMemo(() => {
    const out: Partial<Record<MeasureKey, number>> = { ...values };
    for (const m of MEASURES) {
      const s = draft[m.key];
      if (s === undefined) continue;
      const n = parseFloat(s.replace(',', '.'));
      if (s.trim() === '') delete out[m.key];
      else if (Number.isFinite(n)) out[m.key] = fromDisplay(n, m.unit, units);
    }
    return out;
  }, [draft, values, units]);
  const invalid = MEASURES.filter((m) => {
    const v = draft[m.key] !== undefined ? parsed[m.key] : undefined;
    return v !== undefined && (v < m.min || v > m.max);
  });
  const changed = MEASURES.filter((m) => draft[m.key] !== undefined && parsed[m.key] !== values[m.key]);

  const previewInput = useDebounced(shapeInputFrom(parsed), 300);
  const previewShape = useMemo(() => computeBodyShape(previewInput), [previewInput]);
  const dims = useMemo(() => bodyDims(previewInput), [previewInput]);

  const setP = (patch: Partial<Profile>) => saveProfile({ ...profile, ...patch });

  const save = async () => {
    if (invalid.length) return ui.showToast(`Check ${measureLabel(invalid[0].key).toLowerCase()}: it looks out of range`);
    const out: Partial<Record<MeasureKey, number>> = {};
    for (const m of changed) if (parsed[m.key] !== undefined) out[m.key] = Math.round(parsed[m.key]! * 10) / 10;
    if (!Object.keys(out).length) return;
    setSaving(true);
    try {
      const [y, mo, d] = date.split('-').map(Number);
      const when = new Date(y, mo - 1, d, 12).getTime();
      await saveMeasurements(out, Math.min(when, Date.now()));
      setDraft({});
      ui.showToast(`Saved ${Object.keys(out).length} measurement${Object.keys(out).length > 1 ? 's' : ''}`);
    } finally {
      setSaving(false);
    }
  };

  const tracked = MEASURES.filter((m) => entries.some((e) => e.values[m.key] !== undefined));
  const series = useMemo(() => {
    const def = MEASURE_BY_KEY.get(metric)!;
    return entries
      .filter((e) => e.values[metric] !== undefined)
      .map((e) => ({ x: e.date, y: Math.round(toDisplay(e.values[metric], def.unit, units) * 10) / 10 }))
      .sort((a, b) => a.x - b.x);
  }, [entries, metric, units]);

  const field = (m: MeasureDef, inRow = false) => (
    <label key={m.key} className="measure" title={m.how}>
      <span className="measure-label">
        {m.pair ? (m.pair === 'L' ? 'Left' : 'Right') : inRow ? '' : m.label}
        {draft[m.key] !== undefined && parsed[m.key] !== values[m.key] && <span className="dot-changed" aria-label="changed" />}
      </span>
      <span className={`measure-input ${invalid.includes(m) ? 'bad' : ''}`}>
        <input
          className="input"
          inputMode="decimal"
          value={shown(m)}
          placeholder={m.ref ? String(Math.round(toDisplay(m.ref * (previewShape?.scale ?? 1), m.unit, units) * 10) / 10) : ''}
          onChange={(e) => setDraft((d) => ({ ...d, [m.key]: e.target.value }))}
          aria-label={measureLabel(m.key)}
        />
        <span className="unit">{unitLabel(m.unit, units)}</span>
      </span>
    </label>
  );

  const group = (g: MeasureDef['group']) => MEASURES.filter((m) => m.group === g);
  const pairs = (() => {
    const out: [MeasureDef, MeasureDef | undefined][] = [];
    for (const m of group('girths')) {
      if (m.pair === 'R') continue;
      out.push([m, m.pair === 'L' ? MEASURES.find((x) => x.key === m.key.replace(/L$/, 'R')) : undefined]);
    }
    return out;
  })();

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Profile</h1>
            <p>Your measurements fit the 3D body to you and set the proportions the movement analysis uses.</p>
          </div>
        </div>

        <div className="profile-grid">
          <div className="col profile-preview-col">
            <div className="card profile-preview">
              <div className="viewer-wrap">
                <BodyViewer layers={layersFor(preview)} showDeep={false} colorMode="anatomy" colors={NO_COLORS} selection={null} pins={[]} shape={previewShape} />
              </div>
              <div className="row between wrap" style={{ padding: '10px 12px 4px' }}>
                <Seg
                  value={preview}
                  onChange={setPreview}
                  label="Preview layers"
                  options={[
                    { value: 'surface', label: 'Surface' },
                    { value: 'muscles', label: 'Muscles' },
                    { value: 'skeleton', label: 'Skeleton' },
                  ]}
                />
                <span className="tiny muted">{previewShape ? 'Fitted to your measurements' : 'Reference body'}</span>
              </div>
              <div className="row between" style={{ padding: '6px 12px 12px' }}>
                <span className="small">Fit the body everywhere in the app</span>
                <Check on={profile.applyToModel} onChange={(v) => setP({ applyToModel: v })} label="Fit the 3D body to my measurements" />
              </div>
            </div>
            <Proportions dims={dims} values={parsed} />
          </div>

          <div className="col">
            <div className="card col">
              <div className="row between wrap">
                <h3>About you</h3>
                <Seg
                  value={units}
                  onChange={(u) => setP({ units: u })}
                  label="Units"
                  options={[
                    { value: 'metric', label: 'cm · kg' },
                    { value: 'imperial', label: 'in · lb' },
                  ]}
                />
              </div>
              <div className="grid three profile-about">
                <label className="field">
                  <span className="label">Name</span>
                  <input className="input" value={profile.name ?? ''} onChange={(e) => setP({ name: e.target.value })} placeholder="Optional" />
                </label>
                <label className="field">
                  <span className="label">Sex</span>
                  <select className="input" value={profile.sex ?? ''} onChange={(e) => setP({ sex: (e.target.value || undefined) as Profile['sex'] })}>
                    <option value="">Prefer not to say</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="field">
                  <span className="label">Year of birth</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={profile.birthYear ?? ''}
                    onChange={(e) => {
                      const y = parseInt(e.target.value, 10);
                      setP({ birthYear: Number.isFinite(y) && y > 1900 && y <= new Date().getFullYear() ? y : undefined });
                    }}
                    placeholder="Optional"
                  />
                </label>
              </div>
              <p className="tiny muted">
                The 3D model is one adult male body. Your measurements change its proportions and girths, not its anatomy. Sex is only used to read
                your waist-to-hip ratio.
              </p>
            </div>

            <div className="card col">
              <div className="row between wrap">
                <h3>Measurements</h3>
                <label className="row small" style={{ gap: 8 }}>
                  <span className="dim">Measured on</span>
                  <input className="input" type="date" value={date} max={dayInput(Date.now())} onChange={(e) => setDate(e.target.value)} style={{ width: 'auto' }} />
                </label>
              </div>
              <p className="tiny muted">Hover or long-press a field to see how to measure it. Empty fields use the reference body’s proportions, scaled to your height (shown faded).</p>

              <h4>Body</h4>
              <div className="measure-grid">{group('body').map((m) => field(m))}</div>
              <h4>Lengths</h4>
              <div className="measure-grid">{group('lengths').map((m) => field(m))}</div>
              <h4>Girths</h4>
              <div className="girth-grid">
                {pairs.map(([a, b]) => (
                  <div key={a.key} className="girth-row">
                    <span className="girth-name" title={a.how}>
                      {a.label}
                    </span>
                    {field(a, true)}
                    {b ? field(b, true) : <span />}
                  </div>
                ))}
              </div>

              <div className="row wrap" style={{ marginTop: 6 }}>
                <button className="btn primary" disabled={!changed.length || saving} onClick={save}>
                  <Icon name="check" /> {saving ? 'Saving…' : changed.length ? `Save ${changed.length} change${changed.length > 1 ? 's' : ''}` : 'Saved'}
                </button>
                {changed.length > 0 && (
                  <button className="btn ghost" onClick={() => setDraft({})}>
                    Discard
                  </button>
                )}
                {invalid.length > 0 && <span className="small" style={{ color: 'var(--bad)' }}>Check the highlighted values</span>}
              </div>
            </div>

            <div className="card col">
              <div className="row between wrap">
                <h3>History</h3>
                <span className="tiny muted">{entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</span>
              </div>
              {tracked.length === 0 ? (
                <p className="dim small">Save measurements to start tracking them over time.</p>
              ) : (
                <>
                  <div className="chips">
                    {tracked.map((m) => (
                      <button key={m.key} className={`chip ${metric === m.key ? 'on' : ''}`} onClick={() => setMetric(m.key)}>
                        {measureLabel(m.key)}
                      </button>
                    ))}
                  </div>
                  {series.length > 1 ? (
                    <LineChart
                      ariaLabel={`${measureLabel(metric)} over time`}
                      height={170}
                      formatY={(y) => `${y}`}
                      series={[{ id: metric, label: measureLabel(metric), color: '#5a9fd8', points: series, area: true }]}
                    />
                  ) : (
                    <p className="dim small">
                      {series.length === 1 ? `One entry so far: ${formatMeasure(values[metric], MEASURE_BY_KEY.get(metric)!.unit, units)}.` : `Pick a measurement above.`}
                    </p>
                  )}
                  {series.length > 1 && (
                    <p className="small dim">
                      {(() => {
                        const def = MEASURE_BY_KEY.get(metric)!;
                        const first = series[0], last = series[series.length - 1];
                        const d = Math.round((last.y - first.y) * 10) / 10;
                        const days = Math.round((last.x - first.x) / DAY);
                        return `${d > 0 ? '+' : ''}${d} ${unitLabel(def.unit, units)} since ${formatDate(first.x)} (${days} days)`;
                      })()}
                    </p>
                  )}
                  <div className="history-list">
                    {[...entries]
                      .sort((a, b) => b.date - a.date)
                      .slice(0, 12)
                      .map((e) => (
                        <div key={e.id} className="history-row">
                          <span className="mono small">{formatShort(e.date)}</span>
                          <span className="grow small dim ellipsis">
                            {Object.entries(e.values)
                              .map(([k, v]) => `${measureLabel(k as MeasureKey)} ${formatMeasure(v, MEASURE_BY_KEY.get(k as MeasureKey)?.unit ?? 'cm', units)}`)
                              .join(' · ')}
                          </span>
                          {e.source === 'demo' && <span className="chip" style={{ fontSize: 11 }}>demo</span>}
                          <ConfirmButton className="btn ghost small" onConfirm={() => deleteMeasurement(e.id)}>
                            <Icon name="trash" size={14} />
                          </ConfirmButton>
                        </div>
                      ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** What your proportions and girths mean, compared with typical values. */
function Proportions({ dims, values }: { dims: BodyDims; values: Partial<Record<MeasureKey, number>> }) {
  const { profile } = useBody();
  const units = profile.units;
  const ref = bodyDims({});
  const femurTibia = dims.thigh / dims.shank;
  const refFT = ref.thigh / ref.shank;
  const legs = (dims.height - dims.headNeck - dims.torso) / dims.height;
  const refLegs = (ref.height - ref.headNeck - ref.torso) / ref.height;
  const ape = values.armSpan && values.height ? values.armSpan / values.height : (dims.shoulderWidth + 2 * (dims.upperArm + dims.forearm + dims.hand)) / dims.height;
  const h = values.height ? values.height / 100 : undefined;
  const bmi = h && values.weight ? values.weight / (h * h) : undefined;
  const whr = values.waist && values.hips ? values.waist / values.hips : undefined;
  const whtr = values.waist && values.height ? values.waist / values.height : undefined;
  const asym = (['arm', 'forearm', 'thigh', 'calf'] as const)
    .map((k) => {
      const l = values[`${k}L` as MeasureKey], r = values[`${k}R` as MeasureKey];
      if (!l || !r) return null;
      return { k, pct: ((r - l) / ((l + r) / 2)) * 100, l, r };
    })
    .filter(Boolean) as { k: string; pct: number; l: number; r: number }[];
  const whrLimit = profile.sex === 'female' ? 0.85 : profile.sex === 'male' ? 0.9 : undefined;
  const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}%`;

  return (
    <div className="card col">
      <h3>Your proportions</h3>
      <div className="prop-list">
        <div className="prop">
          <span className="k">Thigh : shin</span>
          <span className="v mono">{femurTibia.toFixed(2)}</span>
          <span className="d">
            {femurTibia > refFT * 1.04
              ? 'Long thighs for your shins: expect more forward lean and more hip work in squats.'
              : femurTibia < refFT * 0.96
                ? 'Short thighs for your shins: squats stay more upright and knee-dominant.'
                : 'Typical: balanced knee and hip demands in squats.'}
          </span>
        </div>
        <div className="prop">
          <span className="k">Legs : height</span>
          <span className="v mono">{legs.toFixed(2)}</span>
          <span className="d">{legs > refLegs * 1.02 ? 'Long-legged.' : legs < refLegs * 0.98 ? 'Long torso for your height.' : 'Typical leg length for your height.'}</span>
        </div>
        <div className="prop">
          <span className="k">Arm span : height</span>
          <span className="v mono">{ape.toFixed(2)}</span>
          <span className="d">
            {ape > 1.03 ? 'Long arms: shorter pull in deadlifts, longer press in bench.' : ape < 0.98 ? 'Short arms: a shorter bench press, a longer deadlift pull.' : 'Typical arm length.'}
          </span>
        </div>
        {bmi && (
          <div className="prop">
            <span className="k">BMI</span>
            <span className="v mono">{bmi.toFixed(1)}</span>
            <span className="d">
              {bmi < 18.5 ? 'Below 18.5 (underweight range).' : bmi < 25 ? '18.5–24.9 (healthy range).' : bmi < 30 ? '25–29.9 (overweight range).' : '30 or more (obesity range).'} BMI doesn’t tell muscle from fat.
            </span>
          </div>
        )}
        {whtr && (
          <div className="prop">
            <span className="k">Waist : height</span>
            <span className="v mono">{whtr.toFixed(2)}</span>
            <span className="d">{whtr >= 0.5 ? 'At or above 0.5, the usual threshold for raised cardiometabolic risk.' : 'Below 0.5, the usual threshold for raised cardiometabolic risk.'}</span>
          </div>
        )}
        {whr && (
          <div className="prop">
            <span className="k">Waist : hip</span>
            <span className="v mono">{whr.toFixed(2)}</span>
            <span className="d">
              {whrLimit
                ? whr >= whrLimit
                  ? `At or above ${whrLimit}, the WHO threshold for raised risk.`
                  : `Below ${whrLimit}, the WHO threshold for raised risk.`
                : 'WHO uses 0.90 for men and 0.85 for women as the threshold for raised risk.'}
            </span>
          </div>
        )}
        {asym.map((a) => (
          <div className="prop" key={a.k}>
            <span className="k">{a.k === 'arm' ? 'Upper arms' : a.k === 'forearm' ? 'Forearms' : a.k === 'thigh' ? 'Thighs' : 'Calves'} R vs L</span>
            <span className="v mono">{pct(a.pct)}</span>
            <span className="d">
              {formatMeasure(a.l, 'cm', units)} left, {formatMeasure(a.r, 'cm', units)} right.{Math.abs(a.pct) >= 3 ? ' A noticeable difference.' : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
