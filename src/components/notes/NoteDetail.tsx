import { useMemo } from 'react';
import { STRUCTURE_BY_ID } from '../../anatomy/catalog';
import { LAYER_BY_ID } from '../../anatomy/types';
import type { Note } from '../../db/db';
import { deleteNote, followUpDraft, relatedNotes, threadOf } from '../../db/notes';
import { formatDateTime, formatShort } from '../../lib/dates';
import { SENSATION_BY_ID, feelingColor, formatFeeling } from '../../lib/feeling';
import { useMedia } from '../../media/media';
import { useMediaUI } from '../../media/mediaUI';
import { useUI } from '../../state/ui';
import MediaThumb from '../media/MediaThumb';
import LineChart from '../charts/LineChart';
import { CategoryLabel, ConfirmButton, FeelBadge } from '../common';
import Icon from '../Icon';
import NoteCard from './NoteCard';

export default function NoteDetail({ note, notes }: { note: Note; notes: Note[] }) {
  const ui = useUI();
  const thread = useMemo(() => threadOf(note, notes), [note, notes]);
  const media = useMedia();
  const mui = useMediaUI();
  const attached = media.filter((m) => m.noteId === note.id);
  const related = useMemo(() => relatedNotes(note, notes).filter((r) => !thread.some((t) => t.id === r.note.id)).slice(0, 12), [note, notes, thread]);

  const edit = () => {
    ui.openNote(null);
    ui.setDraft({ ...note });
    if (ui.route === 'atlas' && note.locations[0]) ui.set({ selection: note.locations[0] });
  };
  const followUp = () => {
    ui.openNote(null);
    ui.setDraft(followUpDraft(note));
  };
  const showOnBody = () => {
    ui.openNote(null);
    ui.setRoute('atlas');
    const loc = note.locations[0];
    if (loc) {
      ui.set({ selection: loc, atDate: null });
      const def = STRUCTURE_BY_ID.get(loc.structureId);
      if (def && !ui.layers[def.layer].visible) ui.setLayer(def.layer, { visible: true, opacity: 1 });
    }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <CategoryLabel id={note.category} />
        <span className="muted">·</span>
        <span className="dim">{formatDateTime(note.date)}</span>
        <FeelBadge value={note.feeling} />
        {note.intensity !== undefined && <span className="chip">Intensity {note.intensity}/10</span>}
        {note.private && (
          <span className="chip">
            <Icon name="lock" size={12} /> Private
          </span>
        )}
        {note.source && note.source !== 'manual' && <span className="chip">From {note.source}</span>}
      </div>

      {note.sensations.length > 0 && (
        <div className="chips">
          {note.sensations.map((s) => (
            <span key={s} className="chip">
              {SENSATION_BY_ID.get(s)?.label ?? s}
            </span>
          ))}
        </div>
      )}

      {note.body && <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{note.body}</p>}

      {attached.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <h4>Photos &amp; videos</h4>
          <div className="thumb-row">
            {attached.map((m) => (
              <MediaThumb key={m.id} item={m} onClick={() => mui.openViewer(m.id, attached.map((x) => x.id))} />
            ))}
          </div>
        </div>
      )}

      <div className="col" style={{ gap: 6 }}>
        <h4>Where</h4>
        {note.locations.length === 0 ? (
          <span className="dim">Whole body</span>
        ) : (
          <div className="chips">
            {[...new Set(note.structureIds)].map((id) => {
              const def = STRUCTURE_BY_ID.get(id);
              return (
                <button key={id} className="chip" onClick={() => ui.showJournal({ structureId: id })} title="Show all notes for this body part">
                  <span className="feel-dot" style={{ background: def ? LAYER_BY_ID[def.layer].anatomyColor : '#999', width: 8, height: 8 }} />
                  {def?.name ?? id}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {note.workout && (
        <div className="col" style={{ gap: 6 }}>
          <h4>Workout</h4>
          <div className="row wrap small dim">
            {note.workout.durationMin ? <span>{note.workout.durationMin} min</span> : null}
            {note.workout.rpe ? <span>RPE {note.workout.rpe}</span> : null}
          </div>
          {note.workout.exercises.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Exercise</th>
                  <th className="num">Sets</th>
                  <th className="num">Reps</th>
                  <th className="num">Load</th>
                </tr>
              </thead>
              <tbody>
                {note.workout.exercises.map((e, i) => (
                  <tr key={i}>
                    <td>{e.name || '—'}</td>
                    <td className="num">{e.sets ?? '—'}</td>
                    <td className="num">{e.reps ?? '—'}</td>
                    <td className="num">{e.load !== undefined ? `${e.load} ${e.unit ?? 'kg'}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {note.measurements && note.measurements.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <h4>Measurements</h4>
          <div className="chips">
            {note.measurements.map((m, i) => (
              <span key={i} className="chip">
                {m.label}: <strong style={{ color: 'var(--text)' }}>{m.value}</strong>
                {m.unit}
              </span>
            ))}
          </div>
        </div>
      )}

      {note.tags.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <h4>Tags</h4>
          <div className="chips">
            {note.tags.map((t) => (
              <button key={t} className="chip tag" onClick={() => ui.showJournal({ tag: t })} title="Show all notes with this tag">
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {thread.length > 1 && (
        <div className="card" style={{ padding: 12 }}>
          <div className="card-head" style={{ marginBottom: 6 }}>
            <h3>Progress over time</h3>
            <span className="muted small">
              {thread.length} entries · {formatFeeling(thread[0].feeling)} → {formatFeeling(thread[thread.length - 1].feeling)}
            </span>
          </div>
          <LineChart
            ariaLabel="Feeling across the follow-up thread"
            height={130}
            yDomain={[-5, 5]}
            yTicks={[-5, 0, 5]}
            zeroLine
            formatY={(y) => formatFeeling(y)}
            series={[
              {
                id: 'thread',
                label: 'Feeling',
                color: '#8a94a8',
                points: thread.map((n) => ({ x: n.date, y: n.feeling, color: feelingColor(n.feeling), id: n.id })),
              },
            ]}
            onPointClick={(p) => p.id && ui.openNote(p.id)}
          />
          <div className="note-list" style={{ marginTop: 8 }}>
            {thread.map((n) => (
              <button
                key={n.id}
                className="row small"
                style={{ background: 'none', border: 0, padding: '4px 0', cursor: 'pointer', textAlign: 'left', fontWeight: n.id === note.id ? 700 : 400 }}
                onClick={() => ui.openNote(n.id)}
              >
                <span className="feel-dot" style={{ background: feelingColor(n.feeling) }} />
                <span className="muted nowrap">{formatShort(n.date)}</span>
                <span className="ellipsis">{n.title || n.body.slice(0, 60) || 'Untitled'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="row wrap">
        <button className="btn primary" onClick={followUp} title="Log how this feels now — keeps the same places and tags, linked to this note">
          <Icon name="repeat" /> Add follow-up
        </button>
        <button className="btn" onClick={edit}>
          <Icon name="edit" /> Edit
        </button>
        {note.locations.length > 0 && (
          <button className="btn" onClick={showOnBody}>
            <Icon name="body" /> Show on body
          </button>
        )}
        <div className="grow" />
        <ConfirmButton
          onConfirm={async () => {
            await deleteNote(note.id);
            ui.openNote(null);
            ui.showToast('Note deleted');
          }}
        >
          <Icon name="trash" /> Delete
        </ConfirmButton>
      </div>

      {related.length > 0 && (
        <div className="col" style={{ gap: 8 }}>
          <h4>Linked & related</h4>
          <div className="note-list">
            {related.map((r) => (
              <div key={r.note.id} className="col" style={{ gap: 3 }}>
                <span className="tiny muted">
                  {r.linked ? 'Linked' : ''}
                  {r.linked && r.shared.length ? ' · ' : ''}
                  {r.shared.length ? `Shares #${r.shared.join(' #')}` : ''}
                </span>
                <NoteCard note={r.note} onOpen={ui.openNote} compact />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
