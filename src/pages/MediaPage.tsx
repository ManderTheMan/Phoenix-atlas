// Photos and videos over time: progress photos by pose (then and now,
// time-lapse, how your measurements changed) and form clips by movement (with
// the angles you measured on them, followed over time).
import { useEffect, useMemo, useState } from 'react';
import LineChart from '../components/charts/LineChart';
import { Check, Empty, Seg } from '../components/common';
import Icon from '../components/Icon';
import ArchiveTab from '../components/media/ArchiveTab';
import DatasetTab from '../components/media/DatasetTab';
import MediaThumb from '../components/media/MediaThumb';
import type { MediaItem, PoseId } from '../db/db';
import { DAY, formatDate, formatShort, formatSpan } from '../lib/dates';
import {
  firstAndLatest,
  formatBytes,
  formSeries,
  markName,
  markTrends,
  markValue,
  measurementChanges,
  POSE_BY_ID,
  POSES,
  poseSeries,
  storageInfo,
  useMediaLoaded,
} from '../media/media';
import { useMediaUI, type MediaTab } from '../media/mediaUI';
import { PATTERN_BY_ID, PATTERNS, type PatternId } from '../movement/patterns';
import { formatMeasure, MEASURE_BY_KEY, measureLabel, useBody } from '../profile/profile';
import { useUI } from '../state/ui';
import { JOINTS, type JointId } from '../vision/analysis';
import { refreshSummaries } from '../vision/jobs';

type Filter = 'all' | 'photo' | 'video' | 'progress' | 'form' | 'other';

const TIPS_BODY = [
  'Same place, same light, same time of day (mornings before eating are most consistent).',
  'Phone at chest height, about 2–3 m away, upright. Lean it on something and use the self-timer.',
  'Turn on the ghost to line up with your last photo of the pose.',
  'Fitted clothes or swimwear, so the shape shows. Same clothes each time.',
];
const TIPS_FORM = [
  'Film side-on at hip height, 3–4 m away, with your whole body and the bar in frame.',
  'Use the same spot each time so clips line up.',
  'Open a clip to slow it down, mark the start and bottom positions, and measure angles like knee, hip and torso lean.',
  'Give measurements the same names each time (e.g. “Knee”) to follow them over weeks.',
];

export default function MediaPage() {
  const ui = useUI();
  const mui = useMediaUI();
  const { media, loaded } = useMediaLoaded();
  const { entries, profile } = useBody();
  const [tab, setTab] = useState<MediaTab>(() => mui.focus?.tab ?? 'body');
  const [pattern, setPattern] = useState<string | null>(() => mui.focus?.pattern ?? null);
  const [filter, setFilter] = useState<Filter>('all');
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});

  // opened from another page with a tab in mind
  useEffect(() => {
    if (!mui.focus) return;
    setTab(mui.focus.tab);
    if (mui.focus.pattern) setPattern(mui.focus.pattern);
    mui.set({ focus: null });
  }, [mui.focus]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void storageInfo().then(setStorage);
  }, [media.length]);

  const photos = media.filter((m) => m.kind === 'photo').length;
  const videos = media.length - photos;
  const bytes = media.reduce((s, m) => s + m.size, 0);

  const takePhotos = () => mui.openCamera({ mode: 'photo', purpose: 'progress', pose: 'front', sequence: true });
  const recordForm = (p?: string) => mui.openCamera({ mode: 'video', purpose: 'form', pattern: p ?? pattern ?? undefined });

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Photos &amp; videos</h1>
            <p>Watch your body and your form change over time. Everything stays on this device.</p>
          </div>
          <div className="row wrap">
            <button className="btn primary" onClick={takePhotos}>
              <Icon name="camera" /> Progress photos
            </button>
            <button className="btn" onClick={() => recordForm()}>
              <Icon name="video" /> Record form
            </button>
            <button className="btn ghost" onClick={() => mui.openCamera({ mode: 'photo', purpose: tab === 'form' ? 'form' : tab === 'body' ? 'progress' : 'other', upload: true, pattern: pattern ?? undefined })}>
              <Icon name="upload" /> Import
            </button>
          </div>
        </div>

        <Seg
          value={tab}
          onChange={setTab}
          label="Show"
          options={[
            { value: 'body', label: <><Icon name="user" size={15} /> Body</> },
            { value: 'form', label: <><Icon name="movement" size={15} /> Form</> },
            { value: 'all', label: <><Icon name="image" size={15} /> All</> },
            { value: 'archive', label: <><Icon name="film" size={15} /> Archive</> },
            { value: 'dataset', label: <><Icon name="share" size={15} /> Dataset</> },
          ]}
        />

        {!loaded ? (
          <div className="viewer-loading" style={{ position: 'relative', height: 200 }}>
            <div className="spinner" />
          </div>
        ) : tab === 'body' ? (
          <BodyTab media={media} entries={entries} units={profile.units} onTake={takePhotos} />
        ) : tab === 'form' ? (
          <FormTab media={media} pattern={pattern} setPattern={setPattern} onRecord={recordForm} units={profile.units} onMovement={(p) => ui.openMovement(p)} />
        ) : tab === 'archive' ? (
          <ArchiveTab media={media} />
        ) : tab === 'dataset' ? (
          <DatasetTab media={media} />
        ) : (
          <AllTab media={media} filter={filter} setFilter={setFilter} />
        )}

        <div className="card col media-storage">
          <div className="row between wrap">
            <span className="small">
              {photos} photo{photos === 1 ? '' : 's'} · {videos} video{videos === 1 ? '' : 's'} · {formatBytes(bytes)}
              {storage.quota ? <span className="dim"> · {formatBytes(storage.quota - (storage.usage ?? 0))} free for the app</span> : null}
            </span>
            <span className="row small" style={{ gap: 8 }}>
              <span className="dim">Blur body photos in lists</span>
              <Check on={mui.blurBody} onChange={(v) => mui.set({ blurBody: v })} label="Blur body photos in lists" />
            </span>
          </div>
          <p className="tiny muted">
            Photos and videos are kept in this browser’s storage, never uploaded. Photos lose any location data when saved.
            {storage.persisted === false ? ' The browser may clear them if space runs low; ' : ' '}
            Download a backup with media from Settings to keep a copy.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- body

function BodyTab({ media, entries, units, onTake }: { media: MediaItem[]; entries: ReturnType<typeof useBody>['entries']; units: ReturnType<typeof useBody>['profile']['units']; onTake: () => void }) {
  const mui = useMediaUI();
  const poses = POSES.map((p) => ({ pose: p, series: poseSeries(media, p.id) })).filter((x) => x.series.length);
  const all = poses.flatMap((p) => p.series).sort((a, b) => a.date - b.date);

  if (!all.length)
    return (
      <div className="card">
        <Empty
          title="No progress photos yet"
          action={
            <div className="row wrap" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={onTake}>
                <Icon name="camera" /> Take front, side and back
              </button>
              <button className="btn" onClick={() => mui.openCamera({ mode: 'photo', purpose: 'progress', pose: 'front', upload: true })}>
                <Icon name="upload" /> Import earlier photos
              </button>
            </div>
          }
        >
          Take the same three photos every few weeks. Line them up here, play them as a time-lapse and see how your measurements changed alongside.
        </Empty>
        <Tips tips={TIPS_BODY} />
      </div>
    );

  const first = all[0], last = all[all.length - 1];
  const changes = measurementChanges(entries, first.date, last.date);
  const days = Math.round((last.date - first.date) / DAY);

  return (
    <>
      {all.length > 1 && (
        <div className="card col">
          <div className="row between wrap">
            <h3>Since your first photo</h3>
            <span className="tiny muted">
              {formatDate(first.date)} → {formatDate(last.date)} · {days} days
            </span>
          </div>
          {changes.length ? (
            <div className="delta-chips">
              {changes.map((c) => {
                const def = MEASURE_BY_KEY.get(c.key)!;
                return (
                  <span key={c.key} className="delta-chip">
                    <span className="dim">{measureLabel(c.key)}</span>
                    <strong className={c.diff === 0 ? '' : c.diff < 0 ? 'down' : 'up'}>
                      {c.diff > 0 ? '+' : ''}
                      {formatMeasure(c.diff, def.unit, units)}
                    </strong>
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="tiny muted">Save measurements in your Profile around the days you take photos to see the numbers next to the pictures.</p>
          )}
        </div>
      )}

      {poses.map(({ pose, series }) => {
        const pair = firstAndLatest(series);
        const ids = series.map((m) => m.id);
        return (
          <div key={pose.id} className="card col">
            <div className="row between wrap">
              <div>
                <h3>{pose.label}</h3>
                <span className="tiny muted">
                  {series.length} photo{series.length === 1 ? '' : 's'}
                  {series.length > 1 ? ` · ${formatSpan(series[0].date, series[series.length - 1].date)}` : ''}
                </span>
              </div>
              <div className="row wrap">
                {pair && (
                  <button className="btn small" onClick={() => mui.openCompare(pair[0].id, pair[1].id)}>
                    <Icon name="compare" /> Then and now
                  </button>
                )}
                {series.length > 2 && (
                  <button className="btn small" onClick={() => mui.openTimelapse(pose.id as PoseId)}>
                    <Icon name="film" /> Time-lapse
                  </button>
                )}
                <button className="btn small ghost" onClick={() => mui.openCamera({ mode: 'photo', purpose: 'progress', pose: pose.id })}>
                  <Icon name="camera" /> Add
                </button>
              </div>
            </div>
            {pair ? (
              <div className="then-now">
                {pair.map((m, i) => (
                  <MediaThumb key={m.id} item={m} className="big" caption={`${i === 0 ? 'Then' : 'Now'} · ${formatShort(m.date)}`} onClick={() => mui.openViewer(m.id, ids)} />
                ))}
              </div>
            ) : null}
            <div className="thumb-row">
              {[...series].reverse().map((m) => (
                <MediaThumb key={m.id} item={m} caption={formatShort(m.date)} onClick={() => mui.openViewer(m.id, ids)} />
              ))}
            </div>
          </div>
        );
      })}
      <div className="card">
        <Tips tips={TIPS_BODY} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- form

function FormTab({
  media,
  pattern,
  setPattern,
  onRecord,
  units,
  onMovement,
}: {
  media: MediaItem[];
  pattern: string | null;
  setPattern: (p: string | null) => void;
  onRecord: (p?: string) => void;
  units: ReturnType<typeof useBody>['profile']['units'];
  onMovement: (p: string) => void;
}) {
  const mui = useMediaUI();
  const form = useMemo(() => formSeries(media), [media]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of form) m.set(f.pattern ?? '', (m.get(f.pattern ?? '') ?? 0) + 1);
    return m;
  }, [form]);
  // default to the movement filmed most recently
  const current = pattern !== null && (counts.has(pattern) || PATTERN_BY_ID.has(pattern as PatternId)) ? pattern : (form[form.length - 1]?.pattern ?? '');
  const def = current ? PATTERN_BY_ID.get(current as PatternId) : undefined;
  const series = useMemo(() => form.filter((m) => (m.pattern ?? '') === current), [form, current]);
  // keep each clip's tracked reps and depth up to date (a few at a time), then chart the depth over time
  useEffect(() => {
    void refreshSummaries(series);
  }, [series]);
  const trends = useMemo(() => {
    const marked = markTrends(series);
    const pts = series.filter((m) => m.tracked?.pattern === current && m.tracked.deepest !== undefined).map((m) => ({ x: m.date, y: m.tracked!.deepest!, id: m.id }));
    const joint = series.find((m) => m.tracked?.pattern === current)?.tracked?.joint as JointId | undefined;
    if (pts.length < 2 || !joint) return marked;
    return [{ key: 'tracked', label: `Deepest ${JOINTS[joint].label.toLowerCase()} (tracked)`, type: 'angle' as const, unit: '°' as const, points: pts }, ...marked];
  }, [series, current]);
  const videos = series.filter((m) => m.kind === 'video');
  const pair = firstAndLatest(videos.length >= 2 ? videos : series.filter((m) => m.kind === 'photo'));
  const ids = [...series].reverse().map((m) => m.id);

  if (!form.length && !def)
    return (
      <div className="card">
        <Empty
          title="No form videos yet"
          action={
            <div className="row wrap" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={() => onRecord()}>
                <Icon name="video" /> Record a set
              </button>
              <button className="btn" onClick={() => mui.openCamera({ mode: 'video', purpose: 'form', upload: true })}>
                <Icon name="upload" /> Import videos
              </button>
            </div>
          }
        >
          Film a set from the side, then slow it down, measure joint angles and bar path, and line it up with the movement model. Compare clips weeks apart to see your technique change.
        </Empty>
        <Tips tips={TIPS_FORM} />
      </div>
    );

  return (
    <>
      <div className="pattern-chips" role="tablist" aria-label="Movement">
        {PATTERNS.filter((p) => counts.has(p.id) || p.id === current).map((p) => (
          <button key={p.id} role="tab" aria-selected={p.id === current} className={`chip ${p.id === current ? 'on' : ''}`} onClick={() => setPattern(p.id)}>
            {p.short} <span className="muted">{counts.get(p.id) ?? 0}</span>
          </button>
        ))}
        {counts.has('') && (
          <button role="tab" aria-selected={current === ''} className={`chip ${current === '' ? 'on' : ''}`} onClick={() => setPattern('')}>
            Not set <span className="muted">{counts.get('')}</span>
          </button>
        )}
        <select className="input small" style={{ width: 'auto' }} value="" onChange={(e) => e.target.value && setPattern(e.target.value)} aria-label="Other movement">
          <option value="">Other movement…</option>
          {PATTERNS.filter((p) => !counts.has(p.id) && p.id !== current).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="card col">
        <div className="row between wrap">
          <div>
            <h3>{def?.name ?? 'Movement not set'}</h3>
            <span className="tiny muted">
              {series.length} clip{series.length === 1 ? '' : 's'}
              {series.length > 1 ? ` · ${formatSpan(series[0].date, series[series.length - 1].date)}` : ''}
            </span>
          </div>
          <div className="row wrap">
            {pair && (
              <button className="btn small" onClick={() => mui.openCompare(pair[0].id, pair[1].id)}>
                <Icon name="compare" /> First vs latest
              </button>
            )}
            <button className="btn small primary" onClick={() => onRecord(current || undefined)}>
              <Icon name="video" /> Record
            </button>
            {def && (
              <button className="btn small ghost" onClick={() => onMovement(def.id)}>
                <Icon name="movement" /> Leverage
              </button>
            )}
          </div>
        </div>

        {trends.some((t) => t.points.length > 1) && (
          <div className="trend-grid">
            {trends
              .filter((t) => t.points.length > 1)
              .slice(0, 4)
              .map((t) => {
                const firstV = t.points[0].y, lastV = t.points[t.points.length - 1].y;
                return (
                  <div key={t.key} className="trend">
                    <div className="row between">
                      <span className="small">{t.label}</span>
                      <span className="mono small">
                        {Math.round(firstV)}
                        {t.unit} → {Math.round(lastV)}
                        {t.unit}
                      </span>
                    </div>
                    <LineChart
                      ariaLabel={`${t.label} over time`}
                      height={110}
                      compact
                      formatY={(y) => `${Math.round(y)}${t.unit}`}
                      series={[{ id: t.key, label: t.label, color: t.type === 'angle' ? '#ffb347' : t.type === 'line' ? '#5ad1c4' : '#ff6fa8', points: t.points }]}
                      onPointClick={(p) => p.id && mui.openViewer(p.id, ids)}
                    />
                  </div>
                );
              })}
          </div>
        )}

        {series.length === 0 ? (
          <p className="dim small">No clips of this movement yet.</p>
        ) : (
          <div className="clip-list">
            {[...series].reverse().map((m) => {
              const variant = def?.variants.find((v) => v.value === m.variant);
              const tr = m.tracked?.pattern === m.pattern ? m.tracked : undefined;
              return (
                <div key={m.id} className="clip">
                  <MediaThumb item={m} onClick={() => mui.openViewer(m.id, ids)} />
                  <div className="col clip-info">
                    <div className="row between wrap" style={{ gap: 6 }}>
                      <strong className="small">{formatDate(m.date)}</strong>
                      <span className="tiny dim">
                        {[variant && def!.variants.length > 1 ? variant.label : '', m.load ? `${formatMeasure(m.load, 'kg', units)}${m.reps ? ` × ${m.reps}` : ''}` : m.reps ? `${m.reps} reps` : ''].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    {(m.marks?.length ?? 0) > 0 && (
                      <div className="chips">
                        {m.marks!.slice(0, 5).map((k) => {
                          const v = markValue(k, m.width, m.height);
                          return (
                            <span key={k.id} className="chip mini">
                              {markName(k)} {v ? (k.type === 'path' ? `${Math.round(v.value)}%` : `${Math.round(v.value)}°`) : ''}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {m.notes && <p className="tiny dim ellipsis">{m.notes}</p>}
                    {tr && tr.reps > 0 && (
                      <p className="tiny dim">
                        Deepest {JOINTS[tr.joint as JointId]?.label.toLowerCase() ?? tr.joint} {Math.round(tr.deepest ?? 0)}° · {tr.reps} rep{tr.reps === 1 ? '' : 's'}
                        {tr.down !== undefined && tr.up !== undefined ? ` · ${tr.down.toFixed(1)} s down, ${tr.up.toFixed(1)} s up` : ''}
                      </p>
                    )}
                    {!m.marks?.length && !tr?.reps && m.kind === 'video' && <p className="tiny muted">Open to slow it down and measure.</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="card">
        <Tips tips={TIPS_FORM} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- all

function AllTab({ media, filter, setFilter }: { media: MediaItem[]; filter: Filter; setFilter: (f: Filter) => void }) {
  const mui = useMediaUI();
  const shown = media.filter((m) => (filter === 'all' ? true : filter === 'photo' || filter === 'video' ? m.kind === filter : m.purpose === filter));
  const months = useMemo(() => {
    const out: { key: string; label: string; items: MediaItem[] }[] = [];
    for (const m of shown) {
      const d = new Date(m.date);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const last = out[out.length - 1];
      if (last?.key === key) last.items.push(m);
      else out.push({ key, label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), items: [m] });
    }
    return out;
  }, [shown]);
  const ids = shown.map((m) => m.id);
  const describe = (m: MediaItem) =>
    m.purpose === 'progress' ? (POSE_BY_ID.get(m.pose ?? 'other')?.label ?? '') : m.purpose === 'form' ? (PATTERN_BY_ID.get(m.pattern as PatternId)?.short ?? 'Form') : formatShort(m.date);

  return (
    <>
      <div className="chips">
        {(
          [
            ['all', 'All'],
            ['photo', 'Photos'],
            ['video', 'Videos'],
            ['progress', 'Body'],
            ['form', 'Form'],
            ['other', 'Other'],
          ] as [Filter, string][]
        ).map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
      </div>
      {months.length === 0 ? (
        <div className="card">
          <Empty title="Nothing here yet">Take a photo or record a video with the buttons above, or attach one to a note.</Empty>
        </div>
      ) : (
        months.map((g) => (
          <div key={g.key} className="col" style={{ gap: 8 }}>
            <h4>
              {g.label} <span className="muted">· {g.items.length}</span>
            </h4>
            <div className="thumb-grid">
              {g.items.map((m) => (
                <MediaThumb key={m.id} item={m} caption={describe(m)} onClick={() => mui.openViewer(m.id, ids)} />
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}

function Tips({ tips }: { tips: string[] }) {
  return (
    <details className="tips">
      <summary className="small">Tips for comparable shots</summary>
      <ul className="small dim">
        {tips.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </details>
  );
}
