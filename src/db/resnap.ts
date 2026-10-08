// Moves tap points saved on the first body model onto the anatomical atlas:
// each point snaps to the nearest vertex of its (mapped) structure. Skin points
// find the skin region under them instead, since the atlas has finer regions.
import { STRUCTURE_BY_ID } from '../anatomy/catalog';
import type { LayerId } from '../anatomy/types';
import { loadLayers, nearestOnLayer, nearestOnStructure } from '../model/atlasModel';
import { db } from './db';

let running: Promise<number> | null = null;

export function resnapLegacyPoints(): Promise<number> {
  running ??= (async () => {
    const notes = await db.notes.filter((n) => n.locations.some((l) => l.legacyPoint)).toArray();
    if (!notes.length) return 0;
    const layers = new Set<LayerId>();
    for (const n of notes)
      for (const l of n.locations) {
        const layer = l.legacyPoint && STRUCTURE_BY_ID.get(l.structureId)?.layer;
        if (layer) layers.add(layer);
      }
    const models = new Map((await loadLayers([...layers])).map((m) => [m.layer, m]));
    for (const n of notes) {
      n.locations = n.locations.map((l) => {
        if (!l.legacyPoint || !l.point) return l;
        const { legacyPoint: _, ...rest } = l;
        const layer = STRUCTURE_BY_ID.get(l.structureId)?.layer;
        const m = layer && models.get(layer);
        if (!m) return rest;
        if (layer === 'skin') {
          const hit = nearestOnLayer(m, l.point, l.normal);
          return { structureId: m.ids[hit.index], point: hit.point, normal: hit.normal };
        }
        const index = m.indexOf.get(l.structureId);
        return index === undefined ? rest : { ...rest, ...nearestOnStructure(m, index, l.point, l.normal) };
      });
      n.structureIds = [...new Set(n.locations.map((l) => l.structureId))];
    }
    await db.notes.bulkPut(notes);
    return notes.length;
  })().finally(() => {
    running = null;
  });
  return running;
}
