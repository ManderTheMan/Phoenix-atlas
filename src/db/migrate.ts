// Brings notes saved with the first (procedural) body model up to date with
// the anatomical atlas: structure ids are mapped to their closest atlas
// structure, and tap points are flagged so they can be moved onto the new
// surface once its geometry has loaded (see resnap.ts).
import { isLegacyId, legacyToAtlas } from '../anatomy/legacy';
import type { Note } from './db';

/** Maps legacy structure ids in place. Returns true when the note changed. */
export function migrateNoteIds(note: Note): boolean {
  let changed = false;
  for (const l of note.locations ?? []) {
    if (!isLegacyId(l.structureId)) continue;
    const id = legacyToAtlas(l.structureId);
    if (!id) continue;
    l.structureId = id;
    if (l.point) l.legacyPoint = true;
    changed = true;
  }
  if (changed || (note.structureIds ?? []).some(isLegacyId)) {
    note.structureIds = [...new Set((note.locations ?? []).map((l) => l.structureId))];
    changed = true;
  }
  return changed;
}
