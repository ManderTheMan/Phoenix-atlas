import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { deleteNote, emptyDraft, followUpDraft, relatedNotes, saveNote, threadOf } from './notes';

beforeEach(async () => {
  await db.notes.clear();
});

describe('notes', () => {
  it('normalises tags, derives structure ids and keeps links symmetric', async () => {
    const a = await saveNote(emptyDraft({ title: 'A', tags: ['#Left Knee', 'running', 'running'], locations: [{ structureId: 'patella-l' }, { structureId: 'patella-l' }] }));
    expect(a.tags).toEqual(['left-knee', 'running']);
    expect(a.structureIds).toEqual(['patella-l']);
    const b = await saveNote(emptyDraft({ title: 'B', links: [a.id] }));
    expect((await db.notes.get(a.id))!.links).toEqual([b.id]);
    await saveNote({ ...b, links: [] });
    expect((await db.notes.get(a.id))!.links).toEqual([]);
  });

  it('builds follow-up threads and finds related notes by tag', async () => {
    const first = await saveNote(emptyDraft({ title: 'Knee', feeling: -4, tags: ['knee'], date: 1000 }));
    const second = await saveNote({ ...followUpDraft(first), feeling: -1, date: 2000 });
    const third = await saveNote({ ...followUpDraft(second), feeling: 2, date: 3000 });
    const other = await saveNote(emptyDraft({ title: 'Run', tags: ['knee', 'running'], date: 2500 }));
    const all = await db.notes.toArray();
    expect(threadOf(third, all).map((n) => n.feeling)).toEqual([-4, -1, 2]);
    expect(second.links).toContain(first.id);
    const rel = relatedNotes(first, all);
    expect(rel[0].note.id).toBe(second.id); // explicit link first
    expect(rel.some((r) => r.note.id === other.id && r.shared.includes('knee'))).toBe(true);
    await deleteNote(second.id);
    const after = await db.notes.get(third.id);
    expect(after!.followUpOf).toBe(first.id); // thread re-joined around the deleted note
    expect((await db.notes.get(first.id))!.links).not.toContain(second.id);
  });
});
