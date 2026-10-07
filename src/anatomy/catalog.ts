// Every tappable structure in the atlas, grouped by layer.
import { boneParts } from './bones';
import { muscleParts } from './muscles';
import { nerveParts } from './nerves';
import { organParts } from './organs';
import { SURFACE_REGIONS } from './skin';
import type { LayerId, StructureDef } from './types';

const noGrid = () => {
  throw new Error('catalog only');
};

export const STRUCTURES: StructureDef[] = [
  ...SURFACE_REGIONS,
  ...muscleParts(noGrid).map((p) => p.def),
  ...boneParts().map((p) => p.def),
  ...nerveParts().map((p) => p.def),
  ...organParts().map((p) => p.def),
];

export const STRUCTURE_BY_ID: Map<string, StructureDef> = new Map(STRUCTURES.map((s) => [s.id, s]));

export function structureName(id: string): string {
  return STRUCTURE_BY_ID.get(id)?.name ?? id;
}

export function structuresInLayer(layer: LayerId): StructureDef[] {
  return STRUCTURES.filter((s) => s.layer === layer);
}

/** Simple fuzzy search over names and groups. */
export function searchStructures(q: string, limit = 30): StructureDef[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return STRUCTURES.filter((s) => {
    const hay = `${s.name} ${s.group} ${s.layer}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  }).slice(0, limit);
}
