import { useMemo, useState } from 'react';
import { STRUCTURE_BY_ID } from '../../anatomy/catalog';
import type { ExerciseEntry, Measurement, Note } from '../../db/db';
import type { NoteDraft } from '../../db/notes';
import { fromLocalInput, toLocalInput, formatShort } from '../../lib/dates';
import { CATEGORIES, SENSATIONS, SENSATION_BY_ID, feelingColor } from '../../lib/feeling';
import { useTagCounts } from '../../hooks/useData';
import { Check, ConfirmButton } from '../common';
import Icon from '../Icon';
import { FeelingPicker, LocationList, NoteLinkPicker, StructurePicker, TagInput } from './inputs';

const MEASURE_PRESETS: Measurement[] = [
  { label: 'Pain', value: 0, unit: '/10' },
  { label: 'Energy', value: 5, unit: '/10' },
  { label: 'Range of motion', value: 0, unit: '°' },
  { label: 'Body weight', value: 0, unit: 'kg' },
  { label: 'Resting HR', value: 0, unit: 'bpm' },
  { label: 'Sleep', value: 0, unit: 'h' },
];

export interface NoteEditorProps {
  draft: NoteDraft;
  notes: Note[];
  onChange: (patch: Partial<NoteDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  /** True when shown next to the 3D model (taps add locations). */
  atlas?: boolean;
  saving?: boolean;
}

export default function NoteEditor({ draft, notes, onChange, onSave, onCancel, onDelete, atlas, saving }: NoteEditorProps) {
  const tagCounts = useTagCounts(notes);
  const [showWorkout, setShowWorkout] = useState(!!draft.workout || draft.category === 'workout');
  const [showMeasures, setShowMeasures] = useState(!!draft.measurements?.length);
  const linked = useMemo(() => notes.filter((n) => draft.links.includes(n.id)), [notes, draft.links]);
  const exercises = draft.workout?.exercises ?? [];

  const setWorkout = (patch: Partial<NonNullable<NoteDraft['workout']>>) =>
    onChange({ workout: { exercises: [], ...draft.workout, ...patch } });
  const setExercise = (i: number, patch: Partial<ExerciseEntry>) =>
    setWorkout({ exercises: exercises.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const measures = draft.measurements ?? [];
  const setMeasure = (i: number, patch: Partial<Measurement>) =>
    onChange({ measurements: measures.map((m, j) => (j === i ? { ...m, ...patch } : m)) });

  const toggleSensation = (id: string) => {
    const on = draft.sensations.includes(id);
    const sensations = on ? draft.sensations.filter((s) => s !== id) : [...draft.sensations, id];
    const patch: Partial<NoteDraft> = { sensations };
    // nudge the feeling the first time a sensation with a clear polarity is chosen
    if (!on && draft.feeling === 0) {
      const p = SENSATION_BY_ID.get(id)?.polarity ?? 0;
      if (p !== 0) patch.feeling = p * 2;
    }
    onChange(patch);
  };

  const num = (v: string) => (v === '' ? undefined : Number(v));

  return (
    <div className="editor">
      <div className="grid two" style={{ gap: 10 }}>
        <div className="field">
          <label htmlFor="note-date">When</label>
          <input
            id="note-date"
            className="input"
            type="datetime-local"
            value={toLocalInput(draft.date)}
            onChange={(e) => onChange({ date: fromLocalInput(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="note-title">Title</label>
          <input
            id="note-title"
            className="input"
            placeholder="e.g. Squat day, Lower back tight"
            value={draft.title}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </div>
      </div>

      <div className="field">
        <span className="label">Type</span>
        <div className="chips">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={`chip ${draft.category === c.id ? 'on' : ''}`}
              title={c.hint}
              onClick={() => {
                onChange({ category: c.id });
                if (c.id === 'workout') setShowWorkout(true);
              }}
            >
              <span style={{ color: c.color }}>{c.icon}</span> {c.label}
            </button>
          ))}
        </div>
      </div>

      <FeelingPicker value={draft.feeling} onChange={(feeling) => onChange({ feeling })} />

      <div className="field">
        <span className="label">Sensations</span>
        <div className="chips">
          {SENSATIONS.map((s) => (
            <button key={s.id} className={`chip ${draft.sensations.includes(s.id) ? 'on' : ''}`} onClick={() => toggleSensation(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <div className="row between">
          <span className="label">Intensity</span>
          <div className="row" style={{ gap: 8 }}>
            {draft.intensity !== undefined && <strong className="mono">{draft.intensity}/10</strong>}
            <Check
              on={draft.intensity !== undefined}
              onChange={(on) => onChange({ intensity: on ? 5 : undefined })}
              label="Rate intensity"
            />
          </div>
        </div>
        {draft.intensity !== undefined && (
          <input type="range" min={0} max={10} step={1} value={draft.intensity} onChange={(e) => onChange({ intensity: Number(e.target.value) })} aria-label="Intensity 0 to 10" />
        )}
      </div>

      <div className="field">
        <span className="label">Where</span>
        {atlas && (
          <div className="hint">
            <Icon name="pin" size={13} /> Tap the body to add {draft.locations.length ? 'more locations' : 'a location'}. Change layers to reach bones, nerves or organs.
          </div>
        )}
        <LocationList ids={draft.locations} onRemove={(i) => onChange({ locations: draft.locations.filter((_, j) => j !== i) })} />
        <StructurePicker
          exclude={draft.locations.filter((l) => !l.point).map((l) => l.structureId)}
          onPick={(id) => onChange({ locations: [...draft.locations, { structureId: id }] })}
        />
        {!draft.locations.length && <span className="muted small">No location = a whole-body note (energy, sleep, mood…).</span>}
      </div>

      <div className="field">
        <label htmlFor="note-body">Notes</label>
        <textarea
          id="note-body"
          className="input"
          rows={4}
          placeholder="What happened? What made it better or worse?"
          value={draft.body}
          onChange={(e) => onChange({ body: e.target.value })}
        />
      </div>

      <div className="field">
        <span className="label">Tags</span>
        <TagInput value={draft.tags} onChange={(tags) => onChange({ tags })} suggestions={tagCounts} />
        <span className="muted small">Notes that share a tag are linked together across the journal and insights.</span>
      </div>

      <details className="disclosure" open={showWorkout} onToggle={(e) => setShowWorkout((e.target as HTMLDetailsElement).open)}>
        <summary>Workout details</summary>
        <div className="col">
          <div className="grid two" style={{ gap: 10 }}>
            <div className="field">
              <label>Duration (min)</label>
              <input className="input" type="number" min={0} inputMode="numeric" value={draft.workout?.durationMin ?? ''} onChange={(e) => setWorkout({ durationMin: num(e.target.value) })} />
            </div>
            <div className="field">
              <label>Effort (RPE 1–10)</label>
              <input className="input" type="number" min={1} max={10} inputMode="numeric" value={draft.workout?.rpe ?? ''} onChange={(e) => setWorkout({ rpe: num(e.target.value) })} />
            </div>
          </div>
          {exercises.length > 0 && (
            <div className="col" style={{ gap: 6 }}>
              <div className="ex-row ex-head">
                <span>Exercise</span>
                <span>Sets</span>
                <span>Reps</span>
                <span>Load</span>
                <span />
              </div>
              {exercises.map((ex, i) => (
                <div className="ex-row" key={i}>
                  <input className="input" placeholder="Back squat" value={ex.name} onChange={(e) => setExercise(i, { name: e.target.value })} />
                  <input className="input" type="number" inputMode="numeric" value={ex.sets ?? ''} onChange={(e) => setExercise(i, { sets: num(e.target.value) })} aria-label="Sets" />
                  <input className="input" type="number" inputMode="numeric" value={ex.reps ?? ''} onChange={(e) => setExercise(i, { reps: num(e.target.value) })} aria-label="Reps" />
                  <div className="row" style={{ gap: 2 }}>
                    <input className="input" type="number" inputMode="decimal" value={ex.load ?? ''} onChange={(e) => setExercise(i, { load: num(e.target.value) })} aria-label="Load" />
                  </div>
                  <button className="btn ghost icon small" onClick={() => setWorkout({ exercises: exercises.filter((_, j) => j !== i) })} aria-label="Remove exercise">
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
              <div className="row small muted">
                Load unit:
                <div className="seg">
                  {(['kg', 'lb'] as const).map((u) => (
                    <button key={u} className={(exercises[0]?.unit ?? 'kg') === u ? 'on' : ''} onClick={() => setWorkout({ exercises: exercises.map((e) => ({ ...e, unit: u })) })}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <button className="btn small" onClick={() => setWorkout({ exercises: [...exercises, { name: '', unit: exercises[0]?.unit ?? 'kg' }] })}>
            <Icon name="plus" /> Add exercise
          </button>
        </div>
      </details>

      <details className="disclosure" open={showMeasures} onToggle={(e) => setShowMeasures((e.target as HTMLDetailsElement).open)}>
        <summary>Measurements</summary>
        <div className="col">
          {measures.map((m, i) => (
            <div className="row" key={i} style={{ gap: 6 }}>
              <input className="input grow" placeholder="Label" value={m.label} onChange={(e) => setMeasure(i, { label: e.target.value })} />
              <input className="input" style={{ width: 90 }} type="number" inputMode="decimal" value={Number.isFinite(m.value) ? m.value : ''} onChange={(e) => setMeasure(i, { value: Number(e.target.value) })} aria-label="Value" />
              <input className="input" style={{ width: 70 }} placeholder="unit" value={m.unit ?? ''} onChange={(e) => setMeasure(i, { unit: e.target.value })} aria-label="Unit" />
              <button className="btn ghost icon small" onClick={() => onChange({ measurements: measures.filter((_, j) => j !== i) })} aria-label="Remove measurement">
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          <div className="chips">
            {MEASURE_PRESETS.filter((p) => !measures.some((m) => m.label === p.label)).map((p) => (
              <button key={p.label} className="chip" onClick={() => onChange({ measurements: [...measures, { ...p }] })}>
                + {p.label}
              </button>
            ))}
            <button className="chip" onClick={() => onChange({ measurements: [...measures, { label: '', value: 0 }] })}>
              + Custom
            </button>
          </div>
        </div>
      </details>

      <div className="field">
        <span className="label">Linked notes</span>
        {linked.length > 0 && (
          <div className="loc-list">
            {linked.map((n) => (
              <div className="loc-item" key={n.id}>
                <span className="feel-dot" style={{ background: feelingColor(n.feeling) }} />
                <span className="grow ellipsis">{n.title || 'Untitled note'}</span>
                <span className="muted tiny">{formatShort(n.date)}</span>
                <button className="btn ghost icon small" onClick={() => onChange({ links: draft.links.filter((l) => l !== n.id) })} aria-label="Unlink">
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <NoteLinkPicker notes={notes} exclude={[...(draft.id ? [draft.id] : []), ...draft.links]} onPick={(id) => onChange({ links: [...draft.links, id] })} />
      </div>

      <div className="row between">
        <div className="row">
          <Check on={!!draft.private} onChange={(v) => onChange({ private: v })} label="Private" />
          <span className="small dim">Private — leave out of coach reports</span>
        </div>
      </div>

      <div className="row wrap" style={{ position: 'sticky', bottom: 0, background: 'var(--bg-2)', padding: '10px 0 2px', borderTop: '1px solid var(--line)' }}>
        <button className="btn primary" onClick={onSave} disabled={saving}>
          <Icon name="check" /> {draft.id ? 'Save changes' : 'Save note'}
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <div className="grow" />
        {onDelete && (
          <ConfirmButton onConfirm={onDelete}>
            <Icon name="trash" /> Delete
          </ConfirmButton>
        )}
      </div>
    </div>
  );
}

export function locationSummary(n: { structureIds: string[] }): string {
  if (!n.structureIds.length) return 'Whole body';
  const names = n.structureIds.map((s) => STRUCTURE_BY_ID.get(s)?.name ?? s);
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
}
