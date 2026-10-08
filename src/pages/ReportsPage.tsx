import { useEffect, useMemo, useState } from 'react';
import { STRUCTURE_BY_ID } from '../anatomy/catalog';
import { Check, Empty, Seg } from '../components/common';
import Icon from '../components/Icon';
import { downloadBlob } from '../db/backup';
import { getSetting, setSetting } from '../db/db';
import { useActivities, useMetrics, useNotesLoaded, useTagCounts } from '../hooks/useData';
import { formatMetric, metricDef } from '../health/metrics';
import { DAY, dayKey, formatDate, formatShort, parseDayKey, startOfDay } from '../lib/dates';
import { CATEGORIES, CATEGORY_BY_ID, feelingColor, formatFeeling, feelingLabel } from '../lib/feeling';
import { buildReportData, defaultReportOptions, type ReportOptions, type ReportSections } from '../report/data';
import { notesToCsv, reportSummaryText } from '../report/export';
import MediaThumb from '../components/media/MediaThumb';
import { getMediaBlob, markName, markValue, measurementChanges, POSE_BY_ID, useMedia } from '../media/media';
import { useMediaUI } from '../media/mediaUI';
import { stillOf } from '../media/process';
import { PATTERN_BY_ID, type PatternId } from '../movement/patterns';
import { formatMeasure, MEASURE_BY_KEY, measureLabel, useBody } from '../profile/profile';
import type { MediaItem } from '../db/db';
import type { Snapshots } from '../report/pdf';
import { useUI } from '../state/ui';

const SECTION_LABELS: [keyof ReportSections, string][] = [
  ['summary', 'Summary & highlights'],
  ['bodyMap', 'Body map (front & back)'],
  ['trend', 'Feeling over time'],
  ['areas', 'Body areas table'],
  ['metrics', 'Health data'],
  ['workouts', 'Training log'],
  ['movement', 'Movement patterns & muscle volume'],
  ['media', 'Progress photos & form checks'],
  ['notes', 'Notes'],
];

const PRESETS = [
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];

export default function ReportsPage() {
  const ui = useUI();
  const { notes, loaded } = useNotesLoaded();
  const metrics = useMetrics();
  const activities = useActivities();
  const tagCounts = useTagCounts(notes).filter((t) => t.tag !== 'demo');
  const [opts, setOpts] = useState<ReportOptions>(() => defaultReportOptions(30));
  const [preset, setPreset] = useState<number | null>(30);
  const [busy, setBusy] = useState<string | null>(null);
  const { shape, entries, profile } = useBody();
  const media = useMedia();

  // remember who the report is for / from
  useEffect(() => {
    Promise.all([getSetting('reportRecipient', ''), getSetting('reportAuthor', '')]).then(([recipient, author]) =>
      setOpts((o) => ({ ...o, recipient: o.recipient || String(recipient), author: o.author || String(author) })),
    );
  }, []);

  const set = (patch: Partial<ReportOptions>) => setOpts((o) => ({ ...o, ...patch }));
  const applyPreset = (days: number) => {
    const today = startOfDay(Date.now());
    setPreset(days);
    set({ from: today - (days - 1) * DAY, to: today + DAY - 1 });
  };

  const data = useMemo(() => buildReportData(notes, metrics, activities, opts, media), [notes, metrics, activities, opts, media]);
  const fileBase = `phoenix-atlas-report-${dayKey(opts.from)}_${dayKey(opts.to)}`;

  const makePdf = async (): Promise<Blob> => {
    await setSetting('reportRecipient', opts.recipient);
    await setSetting('reportAuthor', opts.author);
    const [{ generateReportPdf }, { renderBodySnapshots }] = await Promise.all([import('../report/pdf'), import('../report/snapshot')]);
    const snaps: Snapshots = {};
    if (opts.sections.bodyMap) {
      try {
        snaps.surface = await renderBodySnapshots({ colors: data.colors, notes: data.notes, kind: 'surface', shape });
        if (['skeletal', 'nerves', 'vascular', 'organs', 'deep'].some((l) => data.layersWithNotes.has(l)))
          snaps.deep = await renderBodySnapshots({ colors: data.colors, notes: data.notes, kind: 'deep', shape });
      } catch (e) {
        console.warn('Body map rendering failed', e);
        ui.showToast('Body map could not be rendered on this device — exporting without it');
      }
    }
    if (opts.sections.media && (data.media.progress.length || data.media.form.length)) {
      try {
        snaps.media = await renderMediaStills(data.media, entries, profile.units);
      } catch (e) {
        console.warn('Media stills failed', e);
        ui.showToast('Some photos could not be added to the PDF');
      }
    }
    return generateReportPdf(data, snaps);
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') ui.showToast(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const canShareFiles = typeof navigator !== 'undefined' && 'canShare' in navigator;

  if (loaded && notes.length === 0)
    return (
      <div className="page">
        <div className="page-inner">
          <h1>Reports</h1>
          <Empty title="Nothing to report yet" action={<button className="btn" onClick={() => ui.setRoute('settings')}>Load demo data</button>}>
            Once you have notes, build a PDF report here to share with your coach.
          </Empty>
        </div>
      </div>
    );

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Coach report</h1>
            <p>Choose what to include, preview it, then download or share a PDF.</p>
          </div>
        </div>

        <div className="report-grid">
          <div className="card col" style={{ gap: 14 }}>
            <div className="field">
              <label htmlFor="rtitle">Title</label>
              <input id="rtitle" className="input" value={opts.title} onChange={(e) => set({ title: e.target.value })} />
            </div>
            <div className="grid two" style={{ gap: 10 }}>
              <div className="field">
                <label htmlFor="rfor">For (coach)</label>
                <input id="rfor" className="input" placeholder="Coach name" value={opts.recipient} onChange={(e) => set({ recipient: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="rfrom">From (you)</label>
                <input id="rfrom" className="input" placeholder="Your name" value={opts.author} onChange={(e) => set({ author: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <span className="label">Period</span>
              <Seg value={preset ?? 0} onChange={(v) => v && applyPreset(v)} options={PRESETS} label="Report period" />
              <div className="row" style={{ gap: 6 }}>
                <input
                  className="input"
                  type="date"
                  value={dayKey(opts.from)}
                  max={dayKey(opts.to)}
                  onChange={(e) => {
                    setPreset(null);
                    if (e.target.value) set({ from: parseDayKey(e.target.value) });
                  }}
                  aria-label="From date"
                />
                <span className="muted">to</span>
                <input
                  className="input"
                  type="date"
                  value={dayKey(opts.to)}
                  min={dayKey(opts.from)}
                  onChange={(e) => {
                    setPreset(null);
                    if (e.target.value) set({ to: parseDayKey(e.target.value) + DAY - 1 });
                  }}
                  aria-label="To date"
                />
              </div>
            </div>
            <div className="field">
              <span className="label">Include</span>
              <div className="col" style={{ gap: 6 }}>
                {SECTION_LABELS.map(([k, label]) => (
                  <div key={k} className="row small">
                    <Check on={opts.sections[k]} onChange={(v) => set({ sections: { ...opts.sections, [k]: v } })} label={label} />
                    <span>{label}</span>
                    {k === 'notes' && opts.sections.notes && (
                      <Seg
                        value={opts.notesDetail}
                        onChange={(v) => set({ notesDetail: v })}
                        options={[
                          { value: 'full', label: 'Full' },
                          { value: 'brief', label: 'Brief' },
                        ]}
                        label="Note detail"
                      />
                    )}
                  </div>
                ))}
                {!opts.sections.media && media.length > 0 && <span className="tiny muted">Photos are left out unless you tick them: body photos are private.</span>}
              </div>
            </div>
            <div className="field">
              <span className="label">Note types</span>
              <div className="chips">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    className={`chip ${opts.categories.includes(c.id) ? 'on' : ''}`}
                    onClick={() => set({ categories: opts.categories.includes(c.id) ? opts.categories.filter((x) => x !== c.id) : [...opts.categories, c.id] })}
                  >
                    <span style={{ color: c.color }}>{c.icon}</span> {c.label}
                  </button>
                ))}
              </div>
              <span className="tiny muted">None selected = all types.</span>
            </div>
            {tagCounts.length > 0 && (
              <div className="field">
                <span className="label">Only notes tagged</span>
                <div className="chips">
                  {tagCounts.slice(0, 18).map((t) => (
                    <button
                      key={t.tag}
                      className={`chip tag ${opts.tags.includes(t.tag) ? 'on' : ''}`}
                      onClick={() => set({ tags: opts.tags.includes(t.tag) ? opts.tags.filter((x) => x !== t.tag) : [...opts.tags, t.tag] })}
                    >
                      {t.tag}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="row small">
              <Check on={opts.includePrivate} onChange={(v) => set({ includePrivate: v })} label="Include private notes" />
              <span>Include notes marked private</span>
            </div>
            <div className="field">
              <label htmlFor="rmsg">Note for your coach</label>
              <textarea
                id="rmsg"
                className="input"
                rows={4}
                placeholder="Questions, context, goals for next block…"
                value={opts.message}
                onChange={(e) => set({ message: e.target.value })}
              />
            </div>
            <div className="col" style={{ gap: 8 }}>
              <button
                className="btn primary block"
                disabled={!!busy}
                onClick={() =>
                  run('pdf', async () => {
                    const pdf = await makePdf();
                    downloadBlob(pdf, `${fileBase}.pdf`);
                    ui.showToast('Report downloaded');
                  })
                }
              >
                <Icon name="download" /> {busy === 'pdf' ? 'Building PDF…' : 'Download PDF'}
              </button>
              {canShareFiles && (
                <button
                  className="btn block"
                  disabled={!!busy}
                  onClick={() =>
                    run('share', async () => {
                      const pdf = await makePdf();
                      const file = new File([pdf], `${fileBase}.pdf`, { type: 'application/pdf' });
                      if (navigator.canShare?.({ files: [file] })) {
                        await navigator.share({ files: [file], title: opts.title, text: reportSummaryText(data) });
                      } else {
                        downloadBlob(pdf, file.name);
                        ui.showToast('Sharing files is not supported here — downloaded instead');
                      }
                    })
                  }
                >
                  <Icon name="share" /> {busy === 'share' ? 'Preparing…' : 'Share PDF…'}
                </button>
              )}
              <div className="row">
                <button
                  className="btn grow"
                  onClick={() => {
                    downloadBlob(new Blob([notesToCsv(data.notes)], { type: 'text/csv' }), `${fileBase}-notes.csv`);
                    ui.showToast('CSV downloaded');
                  }}
                >
                  <Icon name="file" /> CSV
                </button>
                <button
                  className="btn grow"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(reportSummaryText(data));
                      ui.showToast('Summary copied — paste it into a message');
                    } catch {
                      ui.showToast('Could not access the clipboard');
                    }
                  }}
                >
                  <Icon name="book" /> Copy summary
                </button>
              </div>
            </div>
          </div>

          <ReportPreview data={data} />
        </div>
      </div>
    </div>
  );
}

function ReportPreview({ data }: { data: ReturnType<typeof buildReportData> }) {
  const o = data.opts;
  return (
    <div className="report-preview col" style={{ gap: 18 }}>
      <div>
        <div className="small muted" style={{ letterSpacing: '0.08em', fontWeight: 700 }}>PHOENIX ATLAS · PREVIEW</div>
        <h1 style={{ marginTop: 6 }}>{o.title || 'Body report'}</h1>
        <div className="muted">
          {formatDate(o.from)} – {formatDate(o.to)} ({data.days} days)
          {o.recipient ? ` · for ${o.recipient}` : ''}
          {o.author ? ` · from ${o.author}` : ''}
        </div>
      </div>
      {o.sections.summary && (
        <div className="grid four" style={{ gap: 10 }}>
          {[
            ['Notes', String(data.notes.length)],
            ['Avg feeling', data.avg !== null ? `${formatFeeling(data.avg)} ${feelingLabel(data.avg)}` : '—'],
            ['Workouts', String(data.workouts.length)],
            ['Areas', String(data.areas.length)],
          ].map(([k, v]) => (
            <div key={k} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>{k}</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{v}</div>
            </div>
          ))}
        </div>
      )}
      {o.message.trim() && (
        <div style={{ background: '#fff6f0', border: '1px solid #ffcdb4', borderRadius: 8, padding: 12, whiteSpace: 'pre-wrap' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#b4501e', marginBottom: 4 }}>NOTE FOR MY COACH</div>
          {o.message}
        </div>
      )}
      {o.sections.summary && data.attention.length > 0 && (
        <div>
          <h3>Needs attention</h3>
          <div className="col" style={{ gap: 4, marginTop: 6 }}>
            {data.attention.map((s) => (
              <div key={s.structureId} className="row small">
                <span className="feel-dot" style={{ background: feelingColor(s.score) }} />
                <span className="grow">{STRUCTURE_BY_ID.get(s.structureId)?.name}</span>
                <span className="muted">{formatFeeling(s.score)} · {s.count} note{s.count === 1 ? '' : 's'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {o.sections.bodyMap && <p className="muted small">Body map images (front &amp; back, coloured by feeling) are rendered into the PDF.</p>}
      {o.sections.areas && data.areas.length > 0 && (
        <div>
          <h3>Body areas</h3>
          <table style={{ marginTop: 6 }}>
            <thead>
              <tr><th>Area</th><th>Notes</th><th>Average</th><th>Latest</th></tr>
            </thead>
            <tbody>
              {data.areas.slice(0, 8).map((s) => (
                <tr key={s.structureId}>
                  <td>{STRUCTURE_BY_ID.get(s.structureId)?.name}</td>
                  <td>{s.count}</td>
                  <td><span className="feel-dot" style={{ background: feelingColor(s.mean), marginRight: 6 }} />{formatFeeling(s.mean)}</td>
                  <td><span className="feel-dot" style={{ background: feelingColor(s.latest), marginRight: 6 }} />{formatFeeling(s.latest)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.areas.length > 8 && <div className="muted small" style={{ marginTop: 4 }}>+{data.areas.length - 8} more in the PDF</div>}
        </div>
      )}
      {o.sections.metrics && data.metrics.length > 0 && (
        <div>
          <h3>Health data</h3>
          <table style={{ marginTop: 6 }}>
            <thead><tr><th>Metric</th><th>Daily average</th><th>Days</th></tr></thead>
            <tbody>
              {data.metrics.map((m) => (
                <tr key={m.metric}><td>{metricDef(m.metric).label}</td><td>{formatMetric(m.metric, m.avg)}</td><td>{m.days}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {o.sections.movement && data.training.sessions > 0 && (
        <div>
          <h3>Movement patterns</h3>
          <div className="col" style={{ gap: 4, marginTop: 6 }}>
            {data.training.insights.map((i) => (
              <div key={i.text} className="small" style={{ color: i.tone === 'warn' ? '#b4501e' : undefined }}>
                • {i.text}
              </div>
            ))}
          </div>
        </div>
      )}
      {o.sections.media && (data.media.progress.length > 0 || data.media.form.length > 0) && <MediaPreview data={data} />}
      {o.sections.notes && (
        <div>
          <h3>Notes ({data.notes.length})</h3>
          <div className="col" style={{ gap: 6, marginTop: 6 }}>
            {data.notes.slice(-6).reverse().map((n) => (
              <div key={n.id} className="row small" style={{ alignItems: 'flex-start' }}>
                <span className="feel-dot" style={{ background: feelingColor(n.feeling), marginTop: 4 }} />
                <span className="muted nowrap">{formatShort(n.date)}</span>
                <span className="grow"><strong>{n.title || CATEGORY_BY_ID.get(n.category)?.label}</strong> {n.body && <span className="muted">— {n.body.slice(0, 90)}</span>}</span>
              </div>
            ))}
            {data.notes.length > 6 && <div className="muted small">…and {data.notes.length - 6} more</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function MediaPreview({ data }: { data: ReturnType<typeof buildReportData> }) {
  const mui = useMediaUI();
  const items = [...data.media.progress.flatMap((p) => [p.then, p.now].filter(Boolean) as MediaItem[]), ...data.media.form];
  return (
    <div>
      <h3>Progress photos &amp; form checks</h3>
      <p className="muted small" style={{ margin: '4px 0 8px' }}>
        {data.media.progress.length ? `${data.media.progress.map((p) => POSE_BY_ID.get(p.pose)?.label).join(', ')} photos, then and now` : ''}
        {data.media.progress.length && data.media.form.length ? '; ' : ''}
        {data.media.form.length ? `${data.media.form.length} form check${data.media.form.length > 1 ? 's' : ''} with their measurements` : ''}.
      </p>
      <div className="thumb-row">
        {items.map((m, i) => (
          <MediaThumb key={`${m.id}-${i}`} item={m} caption={formatShort(m.date)} onClick={() => mui.openViewer(m.id)} />
        ))}
      </div>
    </div>
  );
}

/** Stills (with drawn measurements) for the PDF. */
async function renderMediaStills(rm: ReturnType<typeof buildReportData>['media'], entries: ReturnType<typeof useBody>['entries'], units: ReturnType<typeof useBody>['profile']['units']): Promise<NonNullable<Snapshots['media']>> {
  const still = async (m: MediaItem, t?: number) => {
    const blob = await getMediaBlob(m.id);
    if (!blob) return null;
    const src = await stillOf(m, blob, t, 1000);
    return { src, w: m.width, h: m.height };
  };
  const progress: NonNullable<Snapshots['media']>['progress'] = [];
  for (const p of rm.progress) {
    const now = await still(p.now);
    if (!now) continue;
    const then = p.then ? await still(p.then) : null;
    const changes = p.then
      ? measurementChanges(entries, p.then.date, p.now.date)
          .map((c) => `${measureLabel(c.key)} ${c.diff > 0 ? '+' : ''}${formatMeasure(c.diff, MEASURE_BY_KEY.get(c.key)!.unit, units)}`)
          .join('   ')
      : '';
    progress.push({ pose: POSE_BY_ID.get(p.pose)?.label ?? p.pose, then: then && p.then ? { ...then, date: p.then.date } : undefined, now: { ...now, date: p.now.date }, changes });
  }
  const form: NonNullable<Snapshots['media']>['form'] = [];
  for (const m of rm.form) {
    const t = m.kind === 'video' ? (m.phase1 ?? m.marks?.find((k) => k.t !== undefined)?.t ?? (m.duration ?? 0) * 0.4) : undefined;
    const s = await still(m, t);
    if (!s) continue;
    const pattern = m.pattern ? PATTERN_BY_ID.get(m.pattern as PatternId) : undefined;
    const variant = pattern?.variants.find((v) => v.value === m.variant);
    const lines = [
      [variant && pattern!.variants.length > 1 ? variant.label : '', m.load ? `${formatMeasure(m.load, 'kg', units)}${m.reps ? ` x ${m.reps}` : ''}` : ''].filter(Boolean).join(' - '),
      (m.marks ?? [])
        .map((k) => {
          const v = markValue(k, m.width, m.height);
          return v ? `${markName(k)} ${Math.round(v.value)}${k.type === 'path' ? '%' : '°'}` : '';
        })
        .filter(Boolean)
        .slice(0, 3)
        .join(', '),
      m.notes ? m.notes.slice(0, 60) : '',
    ].filter(Boolean);
    form.push({ ...s, title: `${pattern?.name ?? 'Form check'} - ${formatDate(m.date)}`, lines });
  }
  return { progress, form };
}
