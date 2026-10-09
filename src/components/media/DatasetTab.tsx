// Building a dataset from your photos and videos: what to capture (the shot
// list), whether each file is good enough (computer-vision quality checks), how
// accurate the tracker is (a test against known angles), and a privacy-safe
// export with the documents others need to use it.
import { useMemo, useState } from 'react';
import type { MediaItem, PoseId } from '../../db/db';
import { downloadBlob } from '../../db/backup';
import { APP_URL, LICENSES, type DatePrecision, type License } from '../../dataset/card';
import type { ExportOptions, ExportReport } from '../../dataset/export';
import { formatBytes, POSE_BY_ID } from '../../media/media';
import { useMediaUI } from '../../media/mediaUI';
import { PATTERN_BY_ID, type PatternId } from '../../movement/patterns';
import { useProfile } from '../../profile/profile';
import { useUI } from '../../state/ui';
import { usePoseTracksFor, useVisionJobs } from '../../vision/jobs';
import { qualityChecks, qualitySummary } from '../../vision/quality';
import type { TrackerTest } from '../../vision/validate';
import { Check, Seg } from '../common';
import Icon from '../Icon';
import MediaThumb from './MediaThumb';
import { STATUS_ICON } from './QualityPanel';

const GUIDE_URL = `${APP_URL}/tree/HEAD/docs/dataset`;
const DAY = 86_400_000;

function loadValidation(): TrackerTest | null {
  try {
    return JSON.parse(localStorage.getItem('phoenix-atlas-tracker-test') ?? 'null');
  } catch {
    return null;
  }
}

export default function DatasetTab({ media }: { media: MediaItem[] }) {
  const mui = useMediaUI();
  const ui = useUI();
  const profile = useProfile();
  const jobs = useVisionJobs();
  // archive clips (possibly years of them) stay in the Archive tab for now
  const usable = useMemo(() => media.filter((m) => !m.private && !m.source?.startsWith('archive:')), [media]);
  const archiveCount = media.length - media.filter((m) => !m.source?.startsWith('archive:')).length;
  const tracks = usePoseTracksFor(usable.map((m) => m.id));

  // ---------------------------------------------------------------- shot list
  const shot = useMemo(() => {
    const now = Date.now();
    const poses: PoseId[] = ['front', 'side', 'back'];
    const progress = (p: PoseId) => usable.filter((m) => m.purpose === 'progress' && m.kind === 'photo' && m.pose === p);
    const recentSet = poses.every((p) => progress(p).some((m) => now - m.date < 28 * DAY));
    const sets = Math.min(...poses.map((p) => progress(p).length));
    const form = usable.filter((m) => m.purpose === 'form');
    const patterns = [...new Set(form.map((m) => m.pattern).filter(Boolean))] as string[];
    const sideOn = patterns.filter((p) => form.some((m) => m.pattern === p && (m.camera ?? 'side') === 'side'));
    const front = form.some((m) => (m.pattern === 'squat' || m.pattern === 'lunge') && m.camera === 'front');
    const flawed = form.some((m) => m.tags.includes('flawed'));
    const scale = form.some((m) => m.tags.includes('scale'));
    const handMarked = form.filter((m) => (m.marks ?? []).some((k) => k.source !== 'pose')).length;
    const videos = form.filter((m) => m.kind === 'video');
    const tracked = videos.filter((m) => tracks.has(m.id)).length;
    return [
      { done: recentSet, label: 'A set of progress photos (front, side, back) in the last 4 weeks', detail: poses.map((p) => `${POSE_BY_ID.get(p)!.label} ${progress(p).length}`).join(' · ') },
      { done: sets >= 3, label: 'Progress photos repeated at least 3 times', detail: `${sets} complete set${sets === 1 ? '' : 's'}` },
      { done: patterns.length > 0 && sideOn.length === patterns.length, label: 'A side-on clip of each movement you film', detail: patterns.length ? patterns.map((p) => `${PATTERN_BY_ID.get(p as PatternId)?.short ?? p} ${sideOn.includes(p) ? '✓' : '—'}`).join(' · ') : 'no form clips yet' },
      { done: front, optional: true, label: 'A front-on squat or lunge, to see the knees track', detail: front ? 'yes' : 'tag the camera angle “Front” when you save it' },
      { done: flawed, optional: true, label: 'A clip with a deliberately imperfect rep (tag it “flawed”)', detail: 'shows whether the analysis catches it' },
      { done: handMarked >= 3, label: 'At least 3 clips with angles you drew by hand', detail: `${handMarked} so far: your reference for checking the tracker` },
      { done: videos.length > 0 && tracked === videos.length, label: 'Joints found in every clip', detail: `${tracked} of ${videos.length}` },
      { done: scale, optional: true, label: 'A known size in frame for some clips (a 45 cm plate; tag “scale”)', detail: 'lets distances and bar speed be measured later' },
    ];
  }, [usable, tracks]);

  // ---------------------------------------------------------------- quality
  const rows = useMemo(
    () =>
      usable.map((m) => {
        const t = tracks.get(m.id) ?? null;
        return { m, t, verdict: qualitySummary(qualityChecks(m, t)) };
      }),
    [usable, tracks],
  );
  const counts = { pass: 0, warn: 0, fail: 0, info: 0 };
  for (const r of rows) counts[r.verdict.status]++;
  const untracked = usable.filter((m) => !tracks.has(m.id) && !jobs.jobs[m.id] && !jobs.queue.includes(m.id));
  const busy = Object.keys(jobs.jobs).length + jobs.queue.length;
  const [showAll, setShowAll] = useState(false);

  // ---------------------------------------------------------------- tracker test
  const [test, setTest] = useState<TrackerTest | null>(loadValidation);
  const [testing, setTesting] = useState<number | null>(null);
  const runTest = async () => {
    setTesting(0);
    try {
      const { testTracker } = await import('../../vision/validate');
      const r = await testTracker(undefined, 8, (d, t) => setTesting(d / t));
      setTest(r);
      try {
        localStorage.setItem('phoenix-atlas-tracker-test', JSON.stringify({ ...r, series: r.series.filter((_, i) => i % 2 === 0) }));
      } catch {
        // remembering it is optional
      }
    } catch (e) {
      ui.showToast((e as Error).message);
    } finally {
      setTesting(null);
    }
  };

  // ---------------------------------------------------------------- export
  const [o, setO] = useState<Omit<ExportOptions, 'validation'>>(() => ({
    name: '',
    creator: profile.name ?? '',
    description: '',
    license: 'CC-BY-4.0',
    purposes: ['progress', 'form'],
    dates: 'day',
    measurements: false,
    notes: false,
    pixelateFaces: true,
    skipProblems: false,
    includeSynthetic: false,
  }));
  const set = (patch: Partial<typeof o>) => setO((x) => ({ ...x, ...patch }));
  const [progress, setProgress] = useState<{ text: string; p: number } | null>(null);
  const [report, setReport] = useState<ExportReport | null>(null);
  const candidates = usable.filter((m) => o.purposes.includes(m.purpose) && (o.includeSynthetic || !m.tags.includes('synthetic')));
  const needTracks = o.pixelateFaces ? candidates.filter((m) => !m.tags.includes('synthetic') && !tracks.has(m.id)) : [];
  const videosToPixelate = o.pixelateFaces ? candidates.filter((m) => m.kind === 'video' && !m.tags.includes('synthetic')) : [];
  const pixelSeconds = videosToPixelate.reduce((s, m) => s + (m.duration ?? 0), 0);

  const doExport = async () => {
    setReport(null);
    setProgress({ text: 'Starting', p: 0 });
    try {
      const { exportDataset } = await import('../../dataset/export');
      const validation = test?.joints.filter((j) => Number.isFinite(j.mae)).map((j) => ({ joint: j.joint, mae: j.mae, bias: j.bias }));
      const { blob, report: r } = await exportDataset({ ...o, validation }, (text, p) => setProgress({ text, p }));
      const name = (o.name.trim() || 'phoenix-atlas-dataset').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      downloadBlob(blob, `${name || 'dataset'}.zip`);
      setReport(r);
    } catch (e) {
      ui.showToast((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const shown = showAll ? rows : rows.filter((r) => r.verdict.status !== 'pass').slice(0, 12);

  return (
    <>
      <div className="card col dataset-intro">
        <div className="row between wrap">
          <h3>Build a dataset others can learn from</h3>
          <a className="btn small" href={GUIDE_URL} target="_blank" rel="noreferrer">
            <Icon name="book" /> Read the dataset guide
          </a>
        </div>
        <p className="small dim">
          A dataset is your photos and videos plus everything needed to understand and reuse them: how they were captured, what was measured, how
          accurate the measurements are, and what people may do with them. Work down this page: capture the shot list, check each file, test the
          tracker, then export.
        </p>
        <p className="tiny muted">Private files are never exported. Publishing your body photos is permanent once others have copies: export a draft first and look through it.</p>
        {archiveCount > 0 && <p className="tiny muted">The {archiveCount} clips brought in from your video archive aren’t included here yet.</p>}
      </div>

      <div className="card col">
        <h3>1. Shot list</h3>
        <div className="shot-list">
          {shot.map((s) => (
            <div key={s.label} className={`shot ${s.done ? 'done' : ''}`}>
              <span className={`check-dot ${s.done ? 'pass' : s.optional ? 'info' : ''}`}>
                <Icon name={s.done ? 'check' : s.optional ? 'plus' : 'chevronRight'} size={12} />
              </span>
              <span className="grow">
                <span className="small">
                  {s.label}
                  {s.optional ? <span className="tiny muted"> · optional</span> : null}
                </span>
                <span className="tiny dim block">{s.detail}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card col">
        <div className="row between wrap">
          <h3>2. Check every file</h3>
          {busy > 0 ? (
            <span className="row small" style={{ gap: 8 }}>
              <span className="dim">Finding joints… {busy} left</span>
              <button className="btn ghost small" onClick={jobs.stop}>
                Stop
              </button>
            </span>
          ) : (
            untracked.length > 0 && (
              <button className="btn small primary" onClick={() => jobs.start(untracked)}>
                <Icon name="sparkle" /> Find joints in {untracked.length} file{untracked.length === 1 ? '' : 's'}
              </button>
            )
          )}
        </div>
        <div className="delta-chips">
          {(
            [
              ['pass', 'Ready'],
              ['warn', 'Could be better'],
              ['fail', 'Problems'],
              ['info', 'Not checked'],
            ] as const
          ).map(([k, l]) => (
            <span key={k} className={`delta-chip q-${k}`}>
              <span className="dim">{l}</span>
              <strong>{counts[k]}</strong>
            </span>
          ))}
        </div>
        <p className="tiny muted">Joint finding runs on this device, one file at a time. Open a file and choose Quality to see each check, why it matters and what to change.</p>
        <div className="quality-list">
          {shown.map(({ m, verdict }) => (
            <button key={m.id} className="quality-row" onClick={() => mui.openViewer(m.id, rows.map((r) => r.m.id))}>
              <MediaThumb item={m} />
              <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                <span className="small ellipsis">{describe(m)}</span>
                <span className={`tiny q-text ${verdict.status}`}>
                  <Icon name={STATUS_ICON[verdict.status]} size={11} /> {jobs.jobs[m.id] ? `Finding joints… ${Math.round((jobs.jobs[m.id].done / jobs.jobs[m.id].total) * 100)}%` : verdict.text}
                </span>
              </span>
            </button>
          ))}
        </div>
        {rows.length > shown.length || showAll ? (
          <button className="btn ghost small" onClick={() => setShowAll((s) => !s)}>
            {showAll ? 'Show only files to improve' : `Show all ${rows.length} files`}
          </button>
        ) : null}
      </div>

      <div className="card col">
        <div className="row between wrap">
          <h3>3. Test the tracker</h3>
          <button className="btn small" onClick={runTest} disabled={testing !== null}>
            <Icon name="sparkle" /> {testing !== null ? `Testing… ${Math.round(testing * 100)}%` : test ? 'Run again' : 'Run the test'}
          </button>
        </div>
        <p className="small dim">
          Before trusting any measurement, check the instrument. This renders a squat with the 3D body, where every joint angle is known, films it
          side-on, runs the pose tracker on each frame and compares its angles with the truth. The results go into your dataset card.
        </p>
        {test && (
          <>
            <table className="table rep-table">
              <thead>
                <tr>
                  <th>Joint</th>
                  <th className="num">Average error</th>
                  <th className="num">Largest</th>
                  <th className="num">Bias</th>
                </tr>
              </thead>
              <tbody>
                {test.joints.map((j) => (
                  <tr key={j.joint}>
                    <td>{j.joint === 'torsoLean' ? 'Torso lean' : j.joint === 'shinAngle' ? 'Shin angle' : j.joint[0].toUpperCase() + j.joint.slice(1)}</td>
                    <td className="num">{j.mae.toFixed(1)}°</td>
                    <td className="num">{j.max.toFixed(1)}°</td>
                    <td className="num">
                      {j.bias > 0 ? '+' : ''}
                      {j.bias.toFixed(1)}°
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="tiny dim">
              Person found in {Math.round(test.found * 100)}% of {test.frames} frames; {test.reps.found} of {test.reps.truth} reps found
              {test.reps.timingError !== null ? `, bottoms within ${test.reps.timingError.toFixed(2)} s` : ''}. At the bottom of each rep the knee read{' '}
              {test.bottom
                .filter((b) => b.joint === 'knee')
                .map((b) => `${b.error > 0 ? '+' : ''}${b.error.toFixed(1)}°`)
                .join(', ')}{' '}
              off. A negative bias means the tracker reads smaller angles than the truth, most of all near straight legs. Real footage adds clothing,
              lighting and camera angle on top: your hand-drawn angles are how you check those.
            </p>
          </>
        )}
      </div>

      <div className="card col">
        <h3>4. Export</h3>
        <div className="grid two">
          <label className="field">
            <span className="label">Dataset name</span>
            <input className="input" value={o.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. One lifter, one year of squats" />
          </label>
          <label className="field">
            <span className="label">Creator (as you want to be credited)</span>
            <input className="input" value={o.creator} onChange={(e) => set({ creator: e.target.value })} placeholder="Name or handle" />
          </label>
        </div>
        <label className="field">
          <span className="label">Description</span>
          <textarea className="input" rows={2} value={o.description} onChange={(e) => set({ description: e.target.value })} placeholder="What it is and why you're sharing it" />
        </label>
        <div className="field">
          <span className="label">Include</span>
          <div className="chips">
            {(
              [
                ['progress', 'Body progress'],
                ['form', 'Form checks'],
                ['other', 'Other'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={`chip ${o.purposes.includes(k) ? 'on' : ''}`} onClick={() => set({ purposes: o.purposes.includes(k) ? o.purposes.filter((x) => x !== k) : [...o.purposes, k] })}>
                {l}
              </button>
            ))}
            <button className={`chip ${o.includeSynthetic ? 'on' : ''}`} onClick={() => set({ includeSynthetic: !o.includeSynthetic })}>
              Synthetic demo clips
            </button>
          </div>
        </div>
        <div className="field">
          <span className="label">Dates</span>
          <Seg<DatePrecision>
            value={o.dates}
            onChange={(dates) => set({ dates })}
            label="Date precision"
            options={[
              { value: 'relative', label: 'Days from start', title: 'Day 0, day 14… (no calendar dates)' },
              { value: 'day', label: 'Day', title: 'Calendar day, no time' },
              { value: 'exact', label: 'Exact time' },
            ]}
          />
        </div>
        <div className="export-opts">
          <Option on={o.pixelateFaces} set={(v) => set({ pixelateFaces: v })} label="Pixelate my face" hint={`Uses the tracker’s face landmarks.${videosToPixelate.length ? ` Videos are re-recorded to do it (about ${Math.ceil(pixelSeconds)} s) and lose their sound.` : ''}`} />
          <Option on={o.measurements} set={(v) => set({ measurements: v })} label="Include my body measurements" hint="Height, weight, girths over time (measurements.csv)." />
          <Option on={o.notes} set={(v) => set({ notes: v })} label="Include my notes on each file" hint="Read them first: they may mention people or places." />
          <Option on={o.skipProblems} set={(v) => set({ skipProblems: v })} label="Leave out files with quality problems" hint="Files that failed a check (for example, cropped feet)." />
        </div>
        <div className="field">
          <span className="label">License</span>
          <select className="input" value={o.license} onChange={(e) => set({ license: e.target.value as License })}>
            {(Object.keys(LICENSES) as License[]).map((k) => (
              <option key={k} value={k}>
                {LICENSES[k].name}
              </option>
            ))}
          </select>
          <span className="tiny muted">{LICENSES[o.license].summary}</span>
        </div>
        {needTracks.length > 0 && (
          <p className="tiny warn-text">
            {needTracks.length} file{needTracks.length === 1 ? ' has' : 's have'} no joints found yet, so the face can’t be located and {needTracks.length === 1 ? 'it' : 'they'} would be left out.{' '}
            <button className="btn ghost small" onClick={() => jobs.start(needTracks)}>
              Find joints now
            </button>
          </p>
        )}
        <div className="row wrap">
          <button className="btn primary" disabled={!!progress || !candidates.length || !o.purposes.length} onClick={doExport}>
            <Icon name="download" /> {progress ? progress.text : `Export ${candidates.length} file${candidates.length === 1 ? '' : 's'} (.zip)`}
          </button>
          {progress && (
            <div className="progress grow" style={{ maxWidth: 260 }}>
              <span style={{ width: `${Math.round(progress.p * 100)}%` }} />
            </div>
          )}
        </div>
        {report && (
          <div className="col" style={{ gap: 4 }}>
            <p className="small">
              Exported {report.included} file{report.included === 1 ? '' : 's'} ({formatBytes(report.bytes)}). Open the ZIP and read README.md and DATASHEET.md before publishing; fill in the
              parts marked “to be completed by the creator”.
            </p>
            {report.skipped.length > 0 && (
              <details className="tips">
                <summary className="small">{report.skipped.length} left out</summary>
                <ul className="tiny dim">
                  {report.skipped.map((s) => (
                    <li key={s.id}>
                      {s.id}: {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        <p className="tiny muted">
          The ZIP holds the media, metadata.csv, pose and measurement annotations, quality checks, a dataset card (README.md) in the format Hugging Face
          and Zenodo understand, a datasheet and the license. Location data is removed from every file.
        </p>
      </div>
    </>
  );
}

function Option({ on, set, label, hint }: { on: boolean; set: (v: boolean) => void; label: string; hint: string }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <Check on={on} onChange={set} label={label} />
      <span className="col" style={{ gap: 1 }}>
        <span className="small">{label}</span>
        <span className="tiny muted">{hint}</span>
      </span>
    </div>
  );
}

function describe(m: MediaItem): string {
  const when = new Date(m.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (m.purpose === 'progress') return `${POSE_BY_ID.get(m.pose ?? 'other')?.label ?? ''} photo · ${when}`;
  if (m.purpose === 'form') return `${PATTERN_BY_ID.get(m.pattern as PatternId)?.name ?? 'Form check'} ${m.kind} · ${when}`;
  return `${m.kind === 'video' ? 'Video' : 'Photo'} · ${when}`;
}
