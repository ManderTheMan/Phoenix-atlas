// Automatic joint tracking for one photo or video: run it, see the skeleton,
// the angles now, the angle over the whole clip with each rep marked, and how
// it agrees with the angles you drew by hand.
import { useMemo } from 'react';
import { uid, type MediaItem, type MediaMark } from '../../db/db';
import { markValue } from '../../media/media';
import {
  agreement,
  angleSeries,
  frameAt,
  JOINTS,
  KEY_JOINTS,
  marksFromPose,
  meanAbsError,
  nearSide,
  smooth,
  summarizeReps,
  valueAt,
  type JointId,
  type PoseTrack,
  type Rep,
  type SeriesPoint,
} from '../../vision/analysis';
import { useVisionJobs } from '../../vision/jobs';
import { Check } from '../common';
import Icon from '../Icon';
import { fmtTime } from './VideoBar';

function AngleChart({ series, duration, t, reps, onSeek, label }: { series: SeriesPoint[]; duration: number; t: number; reps: Rep[]; onSeek: (t: number) => void; label: string }) {
  const W = 320, H = 110, padL = 30, padB = 16, padT = 8;
  const vals = series.filter((p) => p.v !== null).map((p) => p.v!);
  if (vals.length < 2) return <p className="tiny muted">Not enough frames with this joint visible to chart it.</p>;
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 8) / 10) * 10), hi = Math.min(180, Math.ceil((Math.max(...vals) + 8) / 10) * 10);
  const x = (s: number) => padL + (s / Math.max(duration, 1e-3)) * (W - padL - 4);
  const y = (v: number) => padT + ((hi - v) / (hi - lo || 1)) * (H - padT - padB);
  let d = '', pen = false;
  for (const p of series) {
    if (p.v === null) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
    pen = true;
  }
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  return (
    <svg
      className="angle-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${label} angle over the clip`}
      onPointerDown={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const s = (((e.clientX - r.left) / r.width) * W - padL) / (W - padL - 4);
        onSeek(Math.max(0, Math.min(1, s)) * duration);
      }}
    >
      {reps.map((r, i) => (
        <rect key={i} x={x(r.start)} y={padT} width={Math.max(1, x(r.end) - x(r.start))} height={H - padT - padB} className={`rep-band ${i % 2 ? 'odd' : ''}`} />
      ))}
      {ticks.map((v) => (
        <g key={v}>
          <line x1={padL} x2={W - 4} y1={y(v)} y2={y(v)} className="chart-grid" />
          <text x={padL - 4} y={y(v) + 3} className="chart-tick" textAnchor="end">
            {v}°
          </text>
        </g>
      ))}
      <path d={d} className="angle-line" />
      {reps.map((r, i) => (
        <g key={`b${i}`}>
          <circle cx={x(r.bottom)} cy={y(r.min)} r={3} className="rep-dot" />
          <text x={x(r.bottom)} y={H - 3} className="chart-tick" textAnchor="middle">
            {i + 1}
          </text>
        </g>
      ))}
      <line x1={x(t)} x2={x(t)} y1={padT - 4} y2={H - padB} className="chart-cursor" />
    </svg>
  );
}

export default function PosePanel({
  item,
  track,
  t,
  duration,
  seek,
  marks,
  onAddMarks,
  showSkeleton,
  setShowSkeleton,
  onSetPhases,
}: {
  item: MediaItem;
  track: PoseTrack | null | undefined;
  t: number;
  duration: number;
  seek: (t: number) => void;
  marks: MediaMark[];
  onAddMarks: (marks: MediaMark[]) => void;
  showSkeleton: boolean;
  setShowSkeleton: (v: boolean) => void;
  onSetPhases: (p0: number, p1: number) => void;
}) {
  const jobs = useVisionJobs();
  const job = jobs.jobs[item.id];
  const queued = jobs.queue.includes(item.id);
  const error = jobs.error[item.id];
  const isVideo = item.kind === 'video';
  const pattern = item.pattern ?? 'squat';
  const keyJoints: JointId[] = KEY_JOINTS[pattern] ?? ['knee', 'hip', 'torsoLean'];
  const side = useMemo(() => (track ? nearSide(track) : 'left'), [track]);
  const summary = useMemo(() => (track && isVideo ? summarizeReps(track, item.pattern) : null), [track, isVideo, item.pattern]);
  const series = useMemo(() => {
    if (!track) return {} as Record<string, SeriesPoint[]>;
    return Object.fromEntries(keyJoints.map((j) => [j, smooth(angleSeries(track, j, side))]));
  }, [track, keyJoints, side]);
  const agree = useMemo(() => (track ? agreement(marks, track, (m) => markValue(m, item.width, item.height)?.value ?? null) : []), [track, marks, item.width, item.height]);
  const mae = meanAbsError(agree);
  const found = track ? track.frames.filter((f) => f.lm).length / Math.max(1, track.frames.length) : 0;

  if (job || queued) {
    const p = job ? job.done / Math.max(1, job.total) : 0;
    return (
      <div className="col" style={{ gap: 8 }}>
        <div className="progress">
          <span style={{ width: `${Math.round(p * 100)}%` }} />
        </div>
        <div className="row between tiny dim">
          <span>{queued ? 'Waiting…' : isVideo ? `Finding joints: frame ${job.done} of ${job.total}` : 'Finding joints…'}</span>
          <button className="btn ghost small" onClick={jobs.stop}>
            Stop
          </button>
        </div>
        <p className="tiny muted">Runs on this device; nothing is uploaded. The first run loads the model (about 9 MB).</p>
      </div>
    );
  }

  if (!track)
    return (
      <div className="col" style={{ gap: 8 }}>
        <button className="btn primary small" onClick={() => jobs.start([item])} disabled={track === undefined}>
          <Icon name="sparkle" /> Find joints automatically
        </button>
        <p className="tiny muted">
          A pose model (MediaPipe Pose) finds 33 body landmarks in every frame{isVideo ? ', then measures your angles through each rep' : ''}. It runs on this device and nothing is uploaded.
        </p>
        {error && <p className="tiny" style={{ color: 'var(--bad)' }}>{error}</p>}
      </div>
    );

  const primary = summary?.joint ?? keyJoints[0];
  const rep1 = summary?.reps[0];
  const addBottomMarks = () => {
    const at = isVideo ? rep1?.bottom ?? t : 0;
    const f = frameAt(track, at);
    if (!f?.lm) return;
    onAddMarks(marksFromPose(f, side, keyJoints.filter((j) => j !== 'shinAngle' || pattern === 'squat'), uid));
  };

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row between">
        <span className="small dim">
          {found < 0.05 ? 'No person found' : `${isVideo ? `${Math.round(found * 100)}% of frames · ` : ''}${side} side nearer the camera`}
        </span>
        <span className="row small" style={{ gap: 8 }}>
          <span className="dim">Skeleton</span>
          <Check on={showSkeleton} onChange={setShowSkeleton} label="Show the tracked skeleton" />
        </span>
      </div>
      {found >= 0.05 && (
        <>
          <div className="live-angles">
            {keyJoints.map((j) => {
              const v = isVideo ? valueAt(series[j] ?? [], t, 0.25) : series[j]?.[0]?.v ?? null;
              return (
                <div key={j} className="live-angle" title={JOINTS[j].what}>
                  <span className="tiny dim">{JOINTS[j].label}</span>
                  <strong className="mono">{v === null ? '—' : `${Math.round(v)}°`}</strong>
                </div>
              );
            })}
          </div>
          {isVideo && series[primary] && (
            <>
              <div className="row between">
                <span className="tiny dim">{JOINTS[primary].label} angle through the clip (tap to jump)</span>
                <span className="tiny muted">{summary?.reps.length ?? 0} rep{summary?.reps.length === 1 ? '' : 's'}</span>
              </div>
              <AngleChart series={series[primary]} duration={duration} t={t} reps={summary?.reps ?? []} onSeek={seek} label={JOINTS[primary].label} />
            </>
          )}
          {summary && summary.reps.length > 0 && (
            <>
              <table className="table rep-table">
                <thead>
                  <tr>
                    <th>Rep</th>
                    <th className="num">Deepest {JOINTS[primary].label.toLowerCase()}</th>
                    <th className="num">Down</th>
                    <th className="num">Up</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.reps.map((r, i) => (
                    <tr key={i} onClick={() => seek(r.bottom)} className="clickable">
                      <td>{i + 1}</td>
                      <td className="num">{Math.round(r.min)}°</td>
                      <td className="num">{r.down.toFixed(1)} s</td>
                      <td className="num">{r.up.toFixed(1)} s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {summary.reps.length > 1 && (
                <p className="tiny dim">
                  Depth varied by ±{Math.round(summary.sdMin ?? 0)}° across reps
                  {(summary.sdMin ?? 0) > 6 ? ' — some reps were noticeably shallower.' : '.'}
                </p>
              )}
            </>
          )}
          <div className="row wrap" style={{ gap: 6 }}>
            <button className="btn small" onClick={addBottomMarks}>
              <Icon name="angle" /> Add angles {isVideo ? 'at rep 1’s bottom' : ''}
            </button>
            {isVideo && rep1 && (
              <button className="btn small" onClick={() => onSetPhases(rep1.start, rep1.bottom)}>
                <Icon name="flag" /> Markers from rep 1
              </button>
            )}
            <button className="btn ghost small" onClick={() => jobs.start([item])}>
              <Icon name="refresh" /> Re-run
            </button>
          </div>
          {agree.length > 0 && (
            <div className="col" style={{ gap: 4 }}>
              <span className="tiny dim">Your marks vs the tracker</span>
              <table className="table rep-table">
                <tbody>
                  {agree.map((a) => (
                    <tr key={a.markId} className="clickable" onClick={() => seek(a.t)}>
                      <td>{a.label}</td>
                      <td className="num">{Math.round(a.manual)}°</td>
                      <td className="num">{Math.round(a.auto)}°</td>
                      <td className="num">
                        {a.diff > 0 ? '+' : ''}
                        {Math.round(a.diff)}°
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="tiny muted">
                Average difference {mae!.toFixed(1)}°. Hand marks are the reference; a few degrees is normal, and the tracker tends to read straight knees and hips a little smaller.
              </p>
            </div>
          )}
          <p className="tiny muted">Angles are measured flat in the picture, so compare clips filmed from the same side-on spot. Analysed at {track.fps} frame{track.fps === 1 ? '' : 's'} per second{isVideo && rep1 ? `; rep 1 bottoms out at ${fmtTime(rep1.bottom)}` : ''}.</p>
        </>
      )}
    </div>
  );
}
