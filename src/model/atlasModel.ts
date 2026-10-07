// Loads the generated anatomy meshes (public/atlas-model.bin) once and turns
// them into three.js geometries shared by the viewer and report snapshots.
import { BufferAttribute, BufferGeometry } from 'three';
import { decodeModel } from '../anatomy/modelFile';
import type { StructureMesh } from '../anatomy/types';

export interface AtlasModel {
  geometries: Map<string, BufferGeometry>;
  hitGeometries: Map<string, BufferGeometry>;
  skinRegions: Uint8Array | null;
  meshes: StructureMesh[];
}

let promise: Promise<AtlasModel> | null = null;

function toGeometry(positions: Float32Array, indices: Uint32Array, normals?: Float32Array): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  if (normals) g.setAttribute('normal', new BufferAttribute(normals, 3));
  const maxIndex = positions.length / 3;
  g.setIndex(new BufferAttribute(maxIndex < 65536 ? new Uint16Array(indices) : indices, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function loadAtlasModel(): Promise<AtlasModel> {
  if (promise) return promise;
  promise = (async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}atlas-model.bin`);
    if (!res.ok) throw new Error(`Could not load the body model (${res.status})`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const meshes = decodeModel(buf);
    const geometries = new Map<string, BufferGeometry>();
    const hitGeometries = new Map<string, BufferGeometry>();
    let skinRegions: Uint8Array | null = null;
    for (const m of meshes) {
      geometries.set(m.id, toGeometry(m.positions, m.indices, m.normals));
      if (m.hitPositions && m.hitIndices) hitGeometries.set(m.id, toGeometry(m.hitPositions, m.hitIndices));
      if (m.id === 'skin' && m.regions) skinRegions = m.regions;
    }
    return { geometries, hitGeometries, skinRegions, meshes };
  })();
  promise.catch(() => {
    promise = null;
  });
  return promise;
}
