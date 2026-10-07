// Generates every mesh in the atlas. Runs at build time (scripts/build-model.ts).
import { boneParts } from './bones';
import { meshFromGrid, sampleShape, type Grid } from './mc';
import { muscleParts } from './muscles';
import { nerveParts } from './nerves';
import { organParts } from './organs';
import { skinShape, surfaceRegionIndex } from './skin';
import type { StructureMesh } from './types';

export const SKIN_STEP = 0.004;

export function buildModel(log: (msg: string) => void = () => {}): StructureMesh[] {
  const t0 = performance.now();
  const skin = skinShape();
  let grid: Grid | null = null;
  const getGrid = () => (grid ??= sampleShape(skin, skin.box, SKIN_STEP, 0.05));
  const out: StructureMesh[] = [];

  const skinMesh = meshFromGrid(getGrid(), 2);
  const regions = new Uint8Array(skinMesh.positions.length / 3);
  for (let v = 0; v < regions.length; v++) {
    regions[v] = surfaceRegionIndex(skinMesh.positions[v * 3], skinMesh.positions[v * 3 + 1], skinMesh.positions[v * 3 + 2]);
  }
  out.push({ id: 'skin', ...skinMesh, regions });
  log(`skin ${(performance.now() - t0).toFixed(0)}ms`);

  const groups: [string, { def: { id: string }; make: () => Omit<StructureMesh, 'id'> }[]][] = [
    ['muscles', muscleParts(getGrid)],
    ['bones', boneParts()],
    ['organs', organParts()],
    ['nerves', nerveParts()],
  ];
  for (const [name, parts] of groups) {
    const t = performance.now();
    for (const p of parts) out.push({ id: p.def.id, ...p.make() });
    log(`${name} ${(performance.now() - t).toFixed(0)}ms`);
  }
  return out;
}
