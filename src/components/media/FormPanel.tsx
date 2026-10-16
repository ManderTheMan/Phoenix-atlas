// How each rep looked: the form markers for the lift (depth, trunk lean, bar
// drift, hips rising first...) rep by rep against your usual, what changed as
// the set went on, and the bar's path from the side.
import { useEffect, useMemo } from 'react';
import type { MediaItem } from '../../db/db';
import { updateMedia, useMediaLoaded } from '../../media/media';
import { useBodyDims } from '../../profile/profile';
import type { PoseTrack } from '../../vision/analysis';
import { barPaths, fmtMarker, FORM_MARKERS, FORM_VERSION, formNotes, formSummary, MARKERS_FOR, repWindows, setForm, usualForm, type FormMarkerId } from '../../vision/form';
import { timeScaleOf } from '../../vision/velocity';
import Icon from '../Icon';

function BarPath({ paths, point, origin }: { paths: { x: number; y: number }[][]; point: string; origin: 'midfoot' | 'shoulder' | null }) {
  const all = paths.flat();
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  const pad = 6;
  const x0 = Math.min(0, ...xs) - pad, x1 = Math.max(0, ...xs) + pad;
  const y0 = Math.max(0, Math.min(...ys) - pad), y1 = Math.max(...ys) + pad;
  // same scale both ways, so the path's shape is true; narrow paths get a little room either side
  const w = Math.max(x1 - x0, (y1 - y0) * 0.45);
  const cx = (x0 + x1) / 2;
  const vb = { x: cx - w / 2, y: -y1, w, h: y1 - y0 };
  const stroke = Math.max(vb.w, vb.h) / 160;
  return (
    <figure className="bar-path">
      <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} role="img" aria-label={`Path of the ${point === 'plate' ? 'bar' : point === 'wrist' ? 'hands' : 'shoulders'} each rep, from the side`}>
        {origin && <line x1={0} x2={0} y1={-y1} y2={-y0} className="bar-path-foot" strokeWidth={stroke} strokeDasharray={`${stroke * 4} ${stroke * 3}`} />}
        {paths.map((p, i) => (
          <polyline
            key={i}
            points={p.map((q) => `${q.x},${-q.y}`).join(' ')}
            className="bar-path-line"
            strokeWidth={stroke * (i === paths.length - 1 ? 1.6 : 1)}
            style={{ opacity: 0.35 + (0.65 * (i + 1)) / paths.length }}
          />
        ))}
      </svg>
      <figcaption className="tiny muted">
        {point === 'plate' ? 'The bar (plate centre)' : point === 'wrist' ? 'Hands' : 'Shoulders'} each rep, from the side ({origin === 'shoulder' ? 'head to the left; dashed: over the shoulder' : `you face right${origin ? '; dashed: over the middle of the foot' : ''}`}). Later reps are darker; the last is thickest.
      </figcaption>
    </figure>
  );
}

export default function FormPanel({ item, track, seek }: { item: MediaItem; track: PoseTrack; seek: (t: number) => void }) {
  const dims = useBodyDims();
  const { media } = useMediaLoaded();
  const pattern = item.pattern!;
  const k = timeScaleOf(item);
  const opts = useMemo(() => ({ timeScale: k ?? 1 }), [k]);
  const reps = useMemo(() => setForm(track, pattern, dims, opts), [track, pattern, dims, opts]);
  const windows = useMemo(() => repWindows(track, pattern), [track, pattern]);
  const paths = useMemo(() => barPaths(track, pattern, dims), [track, pattern, dims]);
  const usual = useMemo(() => usualForm(media, pattern, item.variant, item.date, dims.height), [media, pattern, item.variant, item.date, dims.height]);
  const notes = useMemo(() => formNotes(pattern, reps, usual), [pattern, reps, usual]);

  // keep the stored markers (which "your usual" for later clips reads) in step with what's shown
  useEffect(() => {
    if (k === null || !reps.length) return;
    const f = item.form;
    if (f && f.v === FORM_VERSION && f.pattern === pattern && f.reps.length === reps.length && Math.abs(f.h - dims.height) < 1e-6) return;
    const s = formSummary(track, pattern, dims, opts);
    if (s) void updateMedia(item.id, { form: s });
  }, [reps, item.id, item.form, pattern, track, dims, opts, k]);

  if (!reps.length) return null;
  // tempo is in the speed panel and the rep table above
  const ids = (MARKERS_FOR[pattern] ?? []).filter((id): id is FormMarkerId => id !== 'up' && id !== 'down' && reps.some((r) => r[id] !== undefined));
  if (!ids.length) return null;
  const turnOf = (i: number) => (windows[i] ? windows[i].turn : null);

  return (
    <div className="col form-panel" style={{ gap: 8 }}>
      <span className="tiny dim">Form, rep by rep{usual ? ', against your usual for this lift' : ''} (tap a rep to jump)</span>
      <div className="form-table-wrap">
        <table className="table rep-table form-table">
          <thead>
            <tr>
              <th />
              {reps.map((_, i) => (
                <th key={i} className="num clickable" onClick={() => turnOf(i) !== null && seek(turnOf(i)!)}>
                  {i + 1}
                </th>
              ))}
              {usual && <th className="num dim">Usual</th>}
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => {
              const def = FORM_MARKERS[id];
              return (
                <tr key={id}>
                  <th scope="row" title={def.what}>
                    {def.label}
                  </th>
                  {reps.map((r, i) => (
                    <td key={i} className="num">
                      {r[id] === undefined ? '—' : fmtMarker(id, r[id]!)}
                    </td>
                  ))}
                  {usual && <td className="num dim">{usual[id] === undefined ? '—' : fmtMarker(id, usual[id]!)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {notes.length > 0 ? (
        <ul className="form-notes">
          {notes.map((n, i) => (
            <li key={i} className={n.tone}>
              {n.text}
            </li>
          ))}
        </ul>
      ) : (
        reps.length >= 3 && <p className="tiny muted">Form held steady through the set{usual ? ' and matched your usual' : ''}.</p>
      )}
      {!usual && <p className="tiny muted"><Icon name="info" size={13} /> After two more tracked clips of this lift, each marker is compared with your usual.</p>}
      {paths && paths.reps.length > 0 && <BarPath paths={paths.reps} point={paths.point} origin={paths.ref} />}
      <p className="tiny muted">Measured from the joint track side-on, so a camera at an angle shifts the numbers; compare clips filmed the same way. Hover a marker for what it means.</p>
    </div>
  );
}
