// Note operations: save with derived fields, bidirectional links, follow-ups.
import { normalizeTag } from '../lib/feeling';
import { db, uid, type Note } from './db';

export type NoteDraft = Omit<Note, 'id' | 'createdAt' | 'updatedAt' | 'structureIds'> & { id?: string };

export function emptyDraft(partial: Partial<NoteDraft> = {}): NoteDraft {
  return {
    date: Date.now(),
    title: '',
    body: '',
    category: 'symptom',
    feeling: 0,
    sensations: [],
    tags: [],
    locations: [],
    links: [],
    ...partial,
  };
}

function cleanNote(d: NoteDraft, existing?: Note): Note {
  const now = Date.now();
  const tags = [...new Set(d.tags.map(normalizeTag).filter(Boolean))];
  const locations = d.locations.filter((l, i, arr) =>
    // keep distinct pins; collapse exact duplicates
    arr.findIndex((o) => o.structureId === l.structureId && JSON.stringify(o.point) === JSON.stringify(l.point)) === i,
  );
  const note: Note = {
    ...d,
    id: d.id ?? uid(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    title: d.title.trim(),
    body: d.body,
    feeling: Math.max(-5, Math.min(5, Math.round(d.feeling * 2) / 2)),
    tags,
    locations,
    structureIds: [...new Set(locations.map((l) => l.structureId))],
    links: [...new Set(d.links)].filter((id) => id !== d.id),
  };
  if (note.workout && !note.workout.exercises.length && !note.workout.durationMin && !note.workout.rpe) delete note.workout;
  if (note.measurements && !note.measurements.length) delete note.measurements;
  return note;
}

/** Create or update a note, keeping explicit links symmetric. */
export async function saveNote(draft: NoteDraft): Promise<Note> {
  return db.transaction('rw', db.notes, async () => {
    const existing = draft.id ? await db.notes.get(draft.id) : undefined;
    const note = cleanNote(draft, existing);
    if (note.followUpOf && !note.links.includes(note.followUpOf)) note.links.push(note.followUpOf);
    await db.notes.put(note);
    const before = new Set(existing?.links ?? []);
    const after = new Set(note.links);
    for (const id of after) {
      if (before.has(id)) continue;
      const other = await db.notes.get(id);
      if (other && !other.links.includes(note.id)) await db.notes.update(id, { links: [...other.links, note.id] });
    }
    for (const id of before) {
      if (after.has(id)) continue;
      const other = await db.notes.get(id);
      if (other) await db.notes.update(id, { links: other.links.filter((l) => l !== note.id) });
    }
    return note;
  });
}

export async function deleteNote(id: string): Promise<void> {
  await db.transaction('rw', db.notes, db.activities, async () => {
    const n = await db.notes.get(id);
    if (!n) return;
    for (const l of n.links) {
      const other = await db.notes.get(l);
      if (other) await db.notes.update(l, { links: other.links.filter((x) => x !== id) });
    }
    const children = await db.notes.where('followUpOf').equals(id).toArray();
    for (const c of children) await db.notes.update(c.id, { followUpOf: n.followUpOf });
    await db.notes.delete(id);
    await db.activities.where('start').above(0).modify((a) => {
      if (a.noteId === id) delete a.noteId;
    });
  });
}

/** A new draft that continues tracking the same issue: same places and tags, linked back. */
export function followUpDraft(n: Note): NoteDraft {
  return emptyDraft({
    title: n.title ? `${n.title.replace(/^Follow-up: /, '')}` : '',
    category: n.category,
    feeling: n.feeling,
    sensations: [...n.sensations],
    tags: [...n.tags],
    locations: n.locations.map((l) => ({ ...l })),
    links: [n.id],
    followUpOf: n.id,
  });
}

/** Walk the follow-up chain both ways from a note; returns notes sorted by date. */
export function threadOf(note: Note, all: Note[]): Note[] {
  const byId = new Map(all.map((n) => [n.id, n]));
  let root = note;
  const seen = new Set<string>([note.id]);
  while (root.followUpOf && byId.has(root.followUpOf) && !seen.has(root.followUpOf)) {
    root = byId.get(root.followUpOf)!;
    seen.add(root.id);
  }
  const children = new Map<string, Note[]>();
  for (const n of all) if (n.followUpOf) children.set(n.followUpOf, [...(children.get(n.followUpOf) ?? []), n]);
  const out: Note[] = [];
  const stack = [root];
  const visited = new Set<string>();
  while (stack.length) {
    const n = stack.pop()!;
    if (visited.has(n.id)) continue;
    visited.add(n.id);
    out.push(n);
    stack.push(...(children.get(n.id) ?? []));
  }
  return out.sort((a, b) => a.date - b.date);
}

/** Notes related to `note`: explicit links first, then by number of shared tags. */
export function relatedNotes(note: Note, all: Note[]): { note: Note; shared: string[]; linked: boolean }[] {
  const tags = new Set(note.tags);
  const out: { note: Note; shared: string[]; linked: boolean }[] = [];
  for (const n of all) {
    if (n.id === note.id) continue;
    const linked = note.links.includes(n.id) || n.links.includes(note.id);
    const shared = n.tags.filter((t) => tags.has(t));
    if (linked || shared.length) out.push({ note: n, shared, linked });
  }
  return out.sort((a, b) => Number(b.linked) - Number(a.linked) || b.shared.length - a.shared.length || b.note.date - a.note.date);
}

export async function allTags(): Promise<{ tag: string; count: number }[]> {
  const counts = new Map<string, number>();
  await db.notes.each((n) => n.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
}
