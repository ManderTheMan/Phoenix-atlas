import { useMemo, useState } from 'react';
import { STRUCTURE_BY_ID } from '../anatomy/catalog';
import {
  correlationStrength,
  dailyMeanFeeling,
  mean,
  metricCorrelations,
  rollingMean,
  sensationCounts,
  structureStats,
  tagCooccurrence,
  tagStats,
  weeklyCounts,
} from '../analysis/stats';
import BarChart from '../components/charts/BarChart';
import LineChart from '../components/charts/LineChart';
import TagGraph from '../components/charts/TagGraph';
import { Empty, FeelBadge, Seg } from '../components/common';
import Icon from '../components/Icon';
import { TrendText } from '../components/viewer/StructurePanel';
import { useMetrics, useNotesLoaded } from '../hooks/useData';
import { metricDef } from '../health/metrics';
import { DAY, formatShort, parseDayKey, relativeDay, startOfDay } from '../lib/dates';
import { CATEGORIES, SENSATION_BY_ID, feelingColor, formatFeeling, type CategoryId } from '../lib/feeling';
import { useUI } from '../state/ui';

export default function InsightsPage() {
  const ui = useUI();
  const { notes: allNotes, loaded } = useNotesLoaded();
  const allMetrics = useMetrics();
  const [range, setRange] = useState(90);
  const [cats, setCats] = useState<CategoryId[]>([]);
  const [metricSel, setMetricSel] = useState<string | null>(null);

  const now = Date.now();
  const from = range ? startOfDay(now) - (range - 1) * DAY : -Infinity;
  const prevFrom = range ? from - range * DAY : -Infinity;
  const scoped = useMemo(() => allNotes.filter((n) => !cats.length || cats.includes(n.category)), [allNotes, cats]);
  const notes = useMemo(() => scoped.filter((n) => n.date >= from), [scoped, from]);
  const prevNotes = useMemo(() => (range ? scoped.filter((n) => n.date >= prevFrom && n.date < from) : []), [scoped, prevFrom, from, range]);
  const metrics = useMemo(() => allMetrics.filter((m) => parseDayKey(m.date) >= from), [allMetrics, from]);

  const avg = mean(notes.map((n) => n.feeling));
  const prevAvg = mean(prevNotes.map((n) => n.feeling));
  const workouts = notes.filter((n) => n.category === 'workout').length;
  const structures = useMemo(() => structureStats(notes), [notes]);
  const tagsAll = useMemo(() => tagStats(notes), [notes]);
  const topTags = tagsAll.slice(0, 24);
  const edges = useMemo(() => tagCooccurrence(notes, topTags.map((t) => t.tag)), [notes, topTags]);
  const sens = useMemo(() => sensationCounts(notes).slice(0, 10), [notes]);
  const weeks = useMemo(() => weeklyCounts(allNotes.filter((n) => n.category === 'workout'), Math.min(26, Math.max(6, Math.ceil((range || 180) / 7)))), [allNotes, range]);

  const daily = useMemo(() => {
    const d = dailyMeanFeeling(notes);
    return [...d.entries()].map(([k, v]) => ({ x: parseDayKey(k) + 12 * 3600_000, y: v.mean, count: v.count })).sort((a, b) => a.x - b.x);
  }, [notes]);
  const rolling = useMemo(() => rollingMean(daily, 7), [daily]);

  const correlations = useMemo(() => metricCorrelations(notes, metrics).filter((c) => c.n0 >= 3), [notes, metrics]);
  const metricKeys = correlations.map((c) => c.metric);
  const mSel = metricSel && metricKeys.includes(metricSel) ? metricSel : metricKeys[0];
  const metricSeries = useMemo(
    () => (mSel ? metrics.filter((m) => m.metric === mSel).map((m) => ({ x: parseDayKey(m.date) + 12 * 3600_000, y: m.value })).sort((a, b) => a.x - b.x) : []),
    [metrics, mSel],
  );
  const xDomain: [number, number] | undefined = daily.length || metricSeries.length
    ? [Math.min(...[...daily, ...metricSeries].map((p) => p.x)), Math.max(...[...daily, ...metricSeries].map((p) => p.x))]
    : undefined;

  const improving = structures.filter((s) => s.slopePerWeek !== null && s.slopePerWeek > 0.15 && s.count >= 3).sort((a, b) => b.slopePerWeek! - a.slopePerWeek!).slice(0, 3);
  const worsening = structures.filter((s) => s.slopePerWeek !== null && s.slopePerWeek < -0.15 && s.count >= 3).sort((a, b) => a.slopePerWeek! - b.slopePerWeek!).slice(0, 3);

  const openStructure = (id: string) => {
    const def = STRUCTURE_BY_ID.get(id);
    if (!def) return;
    if (!ui.layers[def.layer].visible || ui.layers[def.layer].opacity < 0.35) ui.setLayer(def.layer, { visible: true, opacity: 1 });
    const n = allNotes.find((x) => x.structureIds.includes(id));
    ui.set({ selection: n?.locations.find((l) => l.structureId === id) ?? { structureId: id }, atDate: null });
    ui.setRoute('atlas');
  };

  if (loaded && allNotes.length === 0)
    return (
      <div className="page">
        <div className="page-inner">
          <h1>Insights</h1>
          <Empty title="Nothing to analyse yet" action={<button className="btn" onClick={() => ui.setRoute('settings')}>Load demo data</button>}>
            Log a few notes on the atlas (or load the demo data) and patterns will show up here.
          </Empty>
        </div>
      </div>
    );

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Insights</h1>
            <p>Trends, links between notes, and how your health data lines up with how you feel.</p>
          </div>
        </div>

        <div className="row wrap">
          <Seg
            value={range}
            onChange={setRange}
            label="Date range"
            options={[
              { value: 30, label: 'Last 30 days' },
              { value: 90, label: '90 days' },
              { value: 365, label: '1 year' },
              { value: 0, label: 'All time' },
            ]}
          />
          <div className="chips">
            {CATEGORIES.map((c) => (
              <button key={c.id} className={`chip ${cats.includes(c.id) ? 'on' : ''}`} onClick={() => setCats((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))}>
                <span style={{ color: c.color }}>{c.icon}</span> {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid four">
          <div className="card stat">
            <div className="k">Notes logged</div>
            <div className="v">{notes.length}</div>
            {range > 0 && <div className="d muted">{prevNotes.length} in the previous {range} days</div>}
          </div>
          <div className="card stat">
            <div className="k">Average feeling</div>
            <div className="v" style={{ color: avg !== null ? feelingColor(avg) : undefined }}>{avg !== null ? formatFeeling(avg) : '—'}</div>
            {avg !== null && prevAvg !== null && (
              <div className={`d ${avg - prevAvg >= 0 ? 'trend-up' : 'trend-down'}`}>
                {avg - prevAvg >= 0 ? '▲' : '▼'} {formatFeeling(avg - prevAvg)} vs previous period
              </div>
            )}
          </div>
          <div className="card stat">
            <div className="k">Workouts</div>
            <div className="v">{workouts}</div>
            <div className="d muted">{range ? `${(workouts / (range / 7)).toFixed(1)} per week` : 'all time'}</div>
          </div>
          <div className="card stat">
            <div className="k">Body areas logged</div>
            <div className="v">{structures.length}</div>
            <div className="d muted ellipsis">{structures[0] ? `Most: ${STRUCTURE_BY_ID.get(structures[0].structureId)?.name}` : ''}</div>
          </div>
        </div>

        {(improving.length > 0 || worsening.length > 0) && (
          <div className="grid two">
            <div className="card">
              <div className="card-head">
                <h3>Improving</h3>
                <span className="muted small">feeling trend per week</span>
              </div>
              {improving.length ? (
                improving.map((s) => (
                  <button key={s.structureId} className="row" style={{ width: '100%', background: 'none', border: 0, padding: '6px 0', cursor: 'pointer', textAlign: 'left' }} onClick={() => openStructure(s.structureId)}>
                    <span className="feel-dot" style={{ background: feelingColor(s.latest) }} />
                    <span className="grow ellipsis">{STRUCTURE_BY_ID.get(s.structureId)?.name}</span>
                    <span className="small mono">{formatFeeling(s.first)} → {formatFeeling(s.latest)}</span>
                    <TrendText slope={s.slopePerWeek} />
                  </button>
                ))
              ) : (
                <p className="dim small">No clear improvements in this range yet.</p>
              )}
            </div>
            <div className="card">
              <div className="card-head">
                <h3>Getting worse</h3>
                <span className="muted small">worth mentioning to your coach</span>
              </div>
              {worsening.length ? (
                worsening.map((s) => (
                  <button key={s.structureId} className="row" style={{ width: '100%', background: 'none', border: 0, padding: '6px 0', cursor: 'pointer', textAlign: 'left' }} onClick={() => openStructure(s.structureId)}>
                    <span className="feel-dot" style={{ background: feelingColor(s.latest) }} />
                    <span className="grow ellipsis">{STRUCTURE_BY_ID.get(s.structureId)?.name}</span>
                    <span className="small mono">{formatFeeling(s.first)} → {formatFeeling(s.latest)}</span>
                    <TrendText slope={s.slopePerWeek} />
                  </button>
                ))
              ) : (
                <p className="dim small">Nothing trending down — nice.</p>
              )}
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-head">
            <h3>Feeling over time</h3>
            <div className="legend">
              <span className="row" style={{ gap: 5 }}><span style={{ width: 14, height: 2, background: '#c9cfda', display: 'inline-block' }} /> 7-day average</span>
              <span className="row" style={{ gap: 5 }}><span className="feel-dot" style={{ width: 8, height: 8, background: '#9aa3ad' }} /> daily mean (coloured by feeling)</span>
            </div>
          </div>
          <LineChart
            ariaLabel="Daily mean feeling with 7-day average"
            height={230}
            yDomain={[-5, 5]}
            yTicks={[-5, -2.5, 0, 2.5, 5]}
            zeroLine
            xDomain={xDomain}
            formatY={(y) => formatFeeling(y)}
            series={[
              { id: 'daily', label: 'Daily mean', color: 'transparent', dots: true, points: daily.map((p) => ({ x: p.x, y: p.y, color: feelingColor(p.y) })) },
              { id: 'roll', label: '7-day average', color: '#c9cfda', dots: false, points: rolling },
            ]}
          />
          <details className="disclosure" style={{ marginTop: 10 }}>
            <summary>Data table</summary>
            <div className="table-wrap" style={{ maxHeight: 240, overflowY: 'auto' }}>
              <table className="table">
                <thead><tr><th>Day</th><th className="num">Notes</th><th className="num">Mean feeling</th></tr></thead>
                <tbody>
                  {[...daily].reverse().map((d) => (
                    <tr key={d.x}><td>{formatShort(d.x)}</td><td className="num">{d.count}</td><td className="num">{formatFeeling(d.y)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Health data vs. how you feel</h3>
            {metricKeys.length > 0 && (
              <select className="input" style={{ width: 'auto', minHeight: 32, padding: '4px 10px' }} value={mSel ?? ''} onChange={(e) => setMetricSel(e.target.value)} aria-label="Health metric">
                {metricKeys.map((k) => (
                  <option key={k} value={k}>{metricDef(k).label}</option>
                ))}
              </select>
            )}
          </div>
          {metricKeys.length === 0 ? (
            <p className="dim small">
              Import health data (Health data tab) to see how sleep, steps, heart rate and HRV relate to your notes.
            </p>
          ) : (
            <div className="col" style={{ gap: 14 }}>
              <p className="small dim">Same dates, two separate charts — compare the shapes rather than the scales.</p>
              <div>
                <div className="small dim" style={{ marginBottom: 2 }}>{metricDef(mSel!).label} ({metricDef(mSel!).unit})</div>
                <LineChart
                  ariaLabel={`${metricDef(mSel!).label} per day`}
                  height={150}
                  xDomain={xDomain}
                  formatY={(y) => y.toLocaleString(undefined, { maximumFractionDigits: metricDef(mSel!).decimals })}
                  series={[{ id: 'm', label: metricDef(mSel!).label, color: '#5a9fd8', area: true, dots: false, points: metricSeries }]}
                />
              </div>
              <div>
                <div className="small dim" style={{ marginBottom: 2 }}>Feeling (7-day average)</div>
                <LineChart ariaLabel="Feeling 7-day average" height={130} yDomain={[-5, 5]} yTicks={[-5, 0, 5]} zeroLine xDomain={xDomain} formatY={(y) => formatFeeling(y)} series={[{ id: 'roll', label: 'Feeling', color: '#c9cfda', dots: false, points: rolling }]} />
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th className="num">Same day (r)</th>
                      <th className="num">Next day (r)</th>
                      <th className="num">Days</th>
                      <th>Reading</th>
                    </tr>
                  </thead>
                  <tbody>
                    {correlations.map((c) => (
                      <tr key={c.metric} className="click" onClick={() => setMetricSel(c.metric)}>
                        <td>{metricDef(c.metric).label}</td>
                        <td className="num">{c.r0 !== null ? c.r0.toFixed(2) : '—'}</td>
                        <td className="num">{c.r1 !== null ? c.r1.toFixed(2) : '—'}</td>
                        <td className="num">{c.n0}</td>
                        <td className="dim">{correlationStrength(c.r0, c.n0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="tiny muted">
                r is the correlation between the metric and your average feeling that day (or the next day). It shows things that move
                together — not cause and effect — and needs at least 10 days to mean much. Narrow the type filter above (e.g. Energy) for
                cleaner signals.
              </p>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Body areas</h3>
            <span className="muted small">{structures.length} areas · tap to view on the body</span>
          </div>
          {structures.length === 0 ? (
            <p className="dim small">No notes with locations in this range.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Area</th>
                    <th className="num">Notes</th>
                    <th className="num">Average</th>
                    <th className="num">Latest</th>
                    <th>Trend</th>
                    <th>Last logged</th>
                  </tr>
                </thead>
                <tbody>
                  {structures.slice(0, 30).map((s) => (
                    <tr key={s.structureId} className="click" onClick={() => openStructure(s.structureId)}>
                      <td>{STRUCTURE_BY_ID.get(s.structureId)?.name ?? s.structureId}</td>
                      <td className="num">{s.count}</td>
                      <td className="num"><FeelBadge value={s.mean} label={false} /></td>
                      <td className="num"><FeelBadge value={s.latest} label={false} /></td>
                      <td className="small"><TrendText slope={s.slopePerWeek} /></td>
                      <td className="small muted nowrap">{relativeDay(s.latestDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="grid two">
          <div className="card">
            <div className="card-head">
              <h3>Workouts per week</h3>
              <span className="muted small">all workout notes</span>
            </div>
            <BarChart
              ariaLabel="Workout notes per week"
              bars={weeks.map((w) => ({ key: String(w.weekStart), label: formatShort(w.weekStart), value: w.count, detail: `week of ${formatShort(w.weekStart)}${w.minutes ? ` · ${w.minutes} min` : ''}` }))}
              format={(v) => `${v} workout${v === 1 ? '' : 's'}`}
            />
          </div>
          <div className="card">
            <div className="card-head">
              <h3>Most common sensations</h3>
            </div>
            {sens.length === 0 ? (
              <p className="dim small">No sensations logged in this range.</p>
            ) : (
              <div className="col" style={{ gap: 7 }}>
                {sens.map((s) => (
                  <div key={s.id} className="row small">
                    <span style={{ width: 110 }} className="ellipsis">{SENSATION_BY_ID.get(s.id)?.label ?? s.id}</span>
                    <div className="grow" style={{ background: 'var(--line)', borderRadius: 4, height: 8 }}>
                      <div style={{ width: `${(s.count / sens[0].count) * 100}%`, height: 8, borderRadius: 4, background: '#5a9fd8' }} />
                    </div>
                    <span className="mono" style={{ width: 32, textAlign: 'right' }}>{s.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>How your tags connect</h3>
            <span className="muted small">size = notes · colour = average feeling · lines = used together</span>
          </div>
          {topTags.length < 2 ? (
            <p className="dim small">Add tags to notes (e.g. <code>left-knee</code>, <code>running</code>, <code>poor-sleep</code>) to see how they relate.</p>
          ) : (
            <>
              <TagGraph tags={topTags} edges={edges} onPick={(t) => ui.showJournal({ tag: t })} />
              <div className="chips" style={{ marginTop: 8 }}>
                {topTags.slice(0, 16).map((t) => (
                  <button key={t.tag} className="chip tag" onClick={() => ui.showJournal({ tag: t.tag })}>
                    {t.tag} <span className="muted">{t.count} · {formatFeeling(t.mean)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <p className="tiny muted">
          <Icon name="info" size={12} /> Insights describe your own logs. They’re not medical advice.
        </p>
      </div>
    </div>
  );
}
