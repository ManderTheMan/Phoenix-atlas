// The details saved with a photo or video: what it is for, the pose or the
// lift, when, and how it links to the rest of your notes.
import { useMemo } from 'react';
import type { MediaItem } from '../../db/db';
import { useNotes, useTagCounts } from '../../hooks/useData';
import { formatShort, fromLocalInput, toLocalInput } from '../../lib/dates';
import { CAMERA_ANGLES, POSES, PURPOSES } from '../../media/media';
import { PATTERN_BY_ID, PATTERNS, type PatternId } from '../../movement/patterns';
import { useProfile } from '../../profile/profile';
import { Check, Seg } from '../common';
import { TagInput } from '../notes/inputs';

export type MediaMeta = Pick<MediaItem, 'purpose' | 'date' | 'tags'> &
  Partial<Pick<MediaItem, 'pose' | 'pattern' | 'variant' | 'load' | 'reps' | 'camera' | 'title' | 'notes' | 'noteId' | 'private'>>;

export default function DetailsForm({ value, onChange, showDate = true, kind }: { value: MediaMeta; onChange: (patch: Partial<MediaMeta>) => void; showDate?: boolean; kind: MediaItem['kind'] | 'mixed' }) {
  const notes = useNotes();
  const tagCounts = useTagCounts(notes);
  const units = useProfile().units;
  const kg = units === 'imperial' ? 0.45359237 : 1;
  const pattern = value.pattern ? PATTERN_BY_ID.get(value.pattern as PatternId) : undefined;
  // notes from around the same day, workouts first, to link the clip to
  const nearby = useMemo(() => {
    const day = 86_400_000;
    return notes
      .filter((n) => Math.abs(n.date - value.date) < 1.5 * day || n.id === value.noteId)
      .sort((a, b) => Number(b.category === 'workout') - Number(a.category === 'workout') || Math.abs(a.date - value.date) - Math.abs(b.date - value.date))
      .slice(0, 12);
  }, [notes, value.date, value.noteId]);

  return (
    <div className="col media-details">
      <div className="field">
        <span className="label">What is it for?</span>
        <Seg value={value.purpose} onChange={(purpose) => onChange({ purpose, ...(purpose === 'progress' && !value.pose ? { pose: 'front' } : {}) })} options={PURPOSES.map((p) => ({ value: p.id, label: p.label, title: p.hint }))} label="Purpose" />
      </div>

      {value.purpose === 'progress' && (
        <div className="field">
          <span className="label">Pose</span>
          <div className="chips">
            {POSES.map((p) => (
              <button key={p.id} className={`chip ${value.pose === p.id ? 'on' : ''}`} onClick={() => onChange({ pose: p.id })} title={p.hint}>
                {p.label}
              </button>
            ))}
          </div>
          <span className="tiny muted">Photos of the same pose are lined up to compare over time.</span>
        </div>
      )}

      {value.purpose === 'form' && (
        <>
          <div className="grid two">
            <label className="field">
              <span className="label">Movement</span>
              <select className="input" value={value.pattern ?? ''} onChange={(e) => onChange({ pattern: e.target.value || undefined, variant: undefined })}>
                <option value="">Not set</option>
                {PATTERNS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {pattern && pattern.variants.length > 1 ? (
              <label className="field">
                <span className="label">Variation</span>
                <select className="input" value={value.variant ?? pattern.variants[0].value} onChange={(e) => onChange({ variant: e.target.value })}>
                  {pattern.variants.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span />
            )}
          </div>
          <div className="grid two">
            <label className="field">
              <span className="label">Load</span>
              <span className="measure-input">
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder="—"
                  value={value.load !== undefined ? Math.round((value.load / kg) * 10) / 10 : ''}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value.replace(',', '.'));
                    onChange({ load: Number.isFinite(v) && v >= 0 ? v * kg : undefined });
                  }}
                />
                <span className="unit">{units === 'imperial' ? 'lb' : 'kg'}</span>
              </span>
            </label>
            <label className="field">
              <span className="label">Reps</span>
              <input
                className="input"
                inputMode="numeric"
                placeholder="—"
                value={value.reps ?? ''}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  onChange({ reps: Number.isFinite(v) && v > 0 ? v : undefined });
                }}
              />
            </label>
          </div>
          <div className="field">
            <span className="label">Filmed from</span>
            <Seg value={value.camera ?? 'side'} onChange={(camera) => onChange({ camera })} options={CAMERA_ANGLES.map((c) => ({ value: c.id, label: c.label }))} label="Camera angle" />
          </div>
        </>
      )}

      {showDate && (
        <label className="field">
          <span className="label">Taken</span>
          <input className="input" type="datetime-local" value={toLocalInput(value.date)} max={toLocalInput(Date.now())} onChange={(e) => onChange({ date: Math.min(Date.now(), fromLocalInput(e.target.value)) })} />
        </label>
      )}

      <label className="field">
        <span className="label">Notes</span>
        <textarea className="input" rows={2} value={value.notes ?? ''} placeholder={value.purpose === 'form' ? 'e.g. last set felt heavy, knees caved on rep 4' : 'Optional'} onChange={(e) => onChange({ notes: e.target.value })} />
      </label>

      <div className="field">
        <span className="label">Tags</span>
        <TagInput value={value.tags} onChange={(tags) => onChange({ tags })} suggestions={tagCounts} />
      </div>

      {(nearby.length > 0 || value.noteId) && (
        <label className="field">
          <span className="label">Link to a note</span>
          <select className="input" value={value.noteId ?? ''} onChange={(e) => onChange({ noteId: e.target.value || undefined })}>
            <option value="">None</option>
            {value.noteId && !notes.some((n) => n.id === value.noteId) && <option value={value.noteId}>The note you’re writing</option>}
            {nearby.map((n) => (
              <option key={n.id} value={n.id}>
                {formatShort(n.date)} · {n.title || n.body.slice(0, 40) || 'Untitled'}
                {n.category === 'workout' ? ' (workout)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="row between">
        <span className="small dim">Keep out of coach reports</span>
        <Check on={!!value.private} onChange={(v) => onChange({ private: v })} label="Keep out of coach reports" />
      </div>
      {kind !== 'photo' && value.purpose === 'form' && <p className="tiny muted">Open the video afterwards to slow it down, mark angles and line it up with the leverage model.</p>}
    </div>
  );
}
