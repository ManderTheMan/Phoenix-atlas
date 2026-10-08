import { useEffect, useMemo, useState } from 'react';
import { STRUCTURE_BY_ID } from '../anatomy/catalog';
import { computeBodyColors } from '../analysis/colors';
import { notesInWindow } from '../analysis/status';
import Icon from '../components/Icon';
import NoteCard from '../components/notes/NoteCard';
import NoteEditor from '../components/notes/NoteEditor';
import BodyViewer, { GHOST_OPACITY, structureShown, type Pin } from '../components/viewer/BodyViewer';
import LayerPanel from '../components/viewer/LayerPanel';
import StructurePanel from '../components/viewer/StructurePanel';
import TimeBar from '../components/viewer/TimeBar';
import { emptyDraft, saveNote, deleteNote } from '../db/notes';
import { useNotesLoaded } from '../hooks/useData';
import { feelingColor, formatFeeling } from '../lib/feeling';
import { useUI, type Selection } from '../state/ui';

export default function AtlasPage() {
  const ui = useUI();
  const { notes, loaded } = useNotesLoaded();
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<'collapsed' | 'open' | 'full'>('collapsed');
  const at = ui.atDate ?? Date.now();

  const { statuses, colors } = useMemo(
    () => computeBodyColors(notes, { at: ui.atDate ?? undefined, windowDays: ui.windowDays, mode: ui.colorMode }),
    [notes, ui.atDate, ui.windowDays, ui.colorMode],
  );

  const windowNotes = useMemo(() => notesInWindow(notes, { at, windowDays: ui.windowDays }), [notes, at, ui.windowDays]);

  const pins: Pin[] = useMemo(() => {
    if (!ui.showPins) return [];
    const out: Pin[] = [];
    for (const n of windowNotes)
      for (const l of n.locations) if (l.point) out.push({ id: n.id, structureId: l.structureId, point: l.point, normal: l.normal, feeling: n.feeling });
    return out;
  }, [windowNotes, ui.showPins]);

  const highlight = useMemo(() => new Set(ui.draft?.locations.map((l) => l.structureId) ?? []), [ui.draft]);

  // open the sheet on phones when something needs attention
  useEffect(() => {
    if (ui.draft || ui.selection) setSheet('open');
  }, [ui.draft, ui.selection]);

  const onPick = (sel: Selection) => {
    if (ui.draft) {
      const exists = ui.draft.locations.some((l) => l.structureId === sel.structureId && !l.point);
      const locations = exists
        ? ui.draft.locations.map((l) => (l.structureId === sel.structureId && !l.point ? { ...l, point: sel.point, normal: sel.normal } : l))
        : [...ui.draft.locations, { structureId: sel.structureId, point: sel.point, normal: sel.normal }];
      ui.updateDraft({ locations });
      ui.set({ selection: sel });
      ui.showToast(`Added ${STRUCTURE_BY_ID.get(sel.structureId)?.name ?? 'location'}`);
      return;
    }
    ui.set({ selection: sel });
  };

  const save = async () => {
    if (!ui.draft) return;
    setSaving(true);
    try {
      const n = await saveNote(ui.draft);
      ui.setDraft(null);
      ui.set({ atDate: null });
      ui.showToast('Note saved');
      if (n.locations[0]) ui.set({ selection: n.locations[0] });
    } finally {
      setSaving(false);
    }
  };

  const hotspots = useMemo(
    () =>
      [...statuses.values()]
        .filter((s) => STRUCTURE_BY_ID.has(s.structureId))
        .sort((a, b) => a.score - b.score)
        .slice(0, 6),
    [statuses],
  );

  let side;
  if (ui.draft) {
    side = (
      <div className="side-section">
        <div className="side-head">
          <div className="side-title">
            <span className="crumb">{ui.draft.followUpOf ? 'Follow-up' : ui.draft.id ? 'Edit note' : 'New note'}</span>
            <h2>{ui.draft.id ? 'Edit note' : 'How does it feel?'}</h2>
          </div>
        </div>
        <NoteEditor
          draft={ui.draft}
          notes={notes}
          atlas
          saving={saving}
          onChange={ui.updateDraft}
          onSave={save}
          onCancel={() => ui.setDraft(null)}
          onDelete={
            ui.draft.id
              ? async () => {
                  await deleteNote(ui.draft!.id!);
                  ui.setDraft(null);
                  ui.showToast('Note deleted');
                }
              : undefined
          }
        />
      </div>
    );
  } else if (ui.selection) {
    side = <StructurePanel selection={ui.selection} notes={notes} status={statuses.get(ui.selection.structureId)} />;
  } else {
    side = (
      <>
        <div className="side-section">
          <div className="side-title">
            <span className="crumb">Phoenix Atlas</span>
            <h2>Tap the body to log how it feels</h2>
          </div>
          <p className="dim small">
            Pick a spot on any layer — skin, muscles, bones, nerves, vessels or organs — then rate it from −5 to +5. Colours on the body show how each
            part has felt recently; scrub the timeline to watch it change.
          </p>
          <div className="row wrap">
            <button className="btn primary" onClick={() => ui.setDraft(emptyDraft({ category: 'workout', feeling: 2 }))}>
              <Icon name="dumbbell" /> Log workout
            </button>
            <button className="btn" onClick={() => ui.setDraft(emptyDraft({ category: 'energy' }))}>
              <Icon name="sparkle" /> Energy / general
            </button>
          </div>
        </div>
        {hotspots.length > 0 && (
          <div className="side-section">
            <div className="row between">
              <h4>Needs attention</h4>
              <span className="tiny muted">{ui.windowDays ? `last ${ui.windowDays} days` : 'all time'}</span>
            </div>
            <div className="col" style={{ gap: 4 }}>
              {hotspots.map((h) => (
                <button
                  key={h.structureId}
                  className="row"
                  style={{ background: 'none', border: 0, padding: '6px 2px', cursor: 'pointer', textAlign: 'left' }}
                  onClick={() => {
                    const def = STRUCTURE_BY_ID.get(h.structureId)!;
                    if (!ui.layers[def.layer].visible || ui.layers[def.layer].opacity < GHOST_OPACITY) ui.setLayer(def.layer, { visible: true, opacity: 1 });
                    if (!structureShown(def.id, ui.showDeep)) ui.set({ showDeep: false });
                    const n = notes.find((x) => x.structureIds.includes(h.structureId));
                    const loc = n?.locations.find((l) => l.structureId === h.structureId);
                    ui.set({ selection: loc ?? { structureId: h.structureId } });
                  }}
                >
                  <span className="feel-dot" style={{ background: feelingColor(h.score) }} />
                  <span className="grow ellipsis">{STRUCTURE_BY_ID.get(h.structureId)?.name}</span>
                  <span className="mono small">{formatFeeling(h.score)}</span>
                  <span className="muted tiny">{h.count}×</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="side-section">
          <div className="row between">
            <h4>Recent notes</h4>
            <button className="btn ghost small" onClick={() => ui.setRoute('journal')}>
              Journal <Icon name="arrowRight" size={14} />
            </button>
          </div>
          {loaded && notes.length === 0 ? (
            <p className="dim small">
              No notes yet. Tap a muscle, joint or organ to create your first one — or load demo data from Settings to explore.
            </p>
          ) : (
            <div className="note-list">
              {notes.slice(0, 8).map((n) => (
                <NoteCard key={n.id} note={n} onOpen={ui.openNote} compact />
              ))}
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="atlas">
      <div className="atlas-stage">
        <BodyViewer
          layers={ui.layers}
          showDeep={ui.showDeep}
          colorMode={ui.colorMode}
          colors={colors}
          selection={ui.selection}
          pins={pins}
          onPick={onPick}
          onPinClick={(id) => ui.openNote(id)}
          viewRequest={ui.viewRequest}
          highlight={highlight}
        />
        <LayerPanel />
        <div className="overlay view-buttons" role="group" aria-label="Camera view">
          {(['front', 'back', 'left', 'right'] as const).map((v) => (
            <button key={v} onClick={() => ui.requestView(v)}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <TimeBar notes={notes} />
      </div>
      <aside className={`side ${sheet === 'collapsed' ? 'collapsed' : sheet === 'full' ? 'full' : ''}`}>
        <button
          className="sheet-handle"
          aria-label={sheet === 'collapsed' ? 'Expand panel' : 'Collapse panel'}
          onClick={() => setSheet((s) => (s === 'collapsed' ? 'open' : 'collapsed'))}
        />
        {side}
      </aside>
    </div>
  );
}
