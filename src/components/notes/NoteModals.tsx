// Note detail and (outside the Atlas page) the note editor, as modals.
import { useState } from 'react';
import { deleteNote, saveNote } from '../../db/notes';
import { useNotes } from '../../hooks/useData';
import { useUI } from '../../state/ui';
import { Modal } from '../common';
import NoteDetail from './NoteDetail';
import NoteEditor from './NoteEditor';

export default function NoteModals() {
  const ui = useUI();
  const notes = useNotes();
  const [saving, setSaving] = useState(false);
  const open = ui.openNoteId ? notes.find((n) => n.id === ui.openNoteId) : undefined;

  return (
    <>
      {open && (
        <Modal title={open.title || 'Note'} onClose={() => ui.openNote(null)}>
          <NoteDetail note={open} notes={notes} />
        </Modal>
      )}
      {ui.draft && ui.route !== 'atlas' && (
        <Modal title={ui.draft.followUpOf ? 'Follow-up' : ui.draft.id ? 'Edit note' : 'New note'} onClose={() => ui.setDraft(null)}>
          <NoteEditor
            draft={ui.draft}
            notes={notes}
            saving={saving}
            onChange={ui.updateDraft}
            onCancel={() => ui.setDraft(null)}
            onSave={async () => {
              if (!ui.draft) return;
              setSaving(true);
              try {
                await saveNote(ui.draft);
                ui.setDraft(null);
                ui.showToast('Note saved');
              } finally {
                setSaving(false);
              }
            }}
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
        </Modal>
      )}
    </>
  );
}
