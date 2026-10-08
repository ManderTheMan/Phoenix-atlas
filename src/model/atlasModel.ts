// Loads the anatomical atlas one layer at a time (public/atlas/<layer>.bin) and
// turns each layer into a single merged three.js geometry. Every vertex carries
// the index of the structure it belongs to (aStruct), so one draw call can show,
// hide and colour hundreds of structures, and picking maps a hit back to its
// structure.
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Triangle, Vector3, type Intersection } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { decodeLayer } from '../anatomy/atlasFile';
import { LAYERS, type LayerId } from '../anatomy/types';
import type { Vec3 } from '../db/db';
import { deformPositions, vertexWeights, type BodyShape } from './bodyShape';

export interface LayerModel {
  layer: LayerId;
  /** Structure ids in the order of their vertex ranges. */
  ids: string[];
  /** Per structure: [vertexStart, vertexCount]. */
  ranges: [number, number][];
  indexOf: Map<string, number>;
  /** position, normal, aStruct (structure index) and aColor (anatomical colour, sRGB). */
  geometry: BufferGeometry;
  /** Reference-body positions and normals. Notes store points in this space. */
  base: Float32Array;
  baseNormals: Float32Array;
  /** Key of the body shape the geometry currently shows (null = reference body). */
  shapeKey: string | null;
}

export const LAYER_IDS: LayerId[] = LAYERS.map((l) => l.id);

const cache = new Map<LayerId, Promise<LayerModel>>();
const bvhs = new WeakMap<LayerModel, MeshBVH>();

function hexBytes(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function buildLayerModel(buf: Uint8Array): LayerModel {
  const { header, positions, indices, materials } = decodeLayer(buf);
  const nv = header.vertexCount;
  const struct = new Float32Array(nv);
  header.ranges.forEach(([v0, vc], i) => struct.fill(i, v0, v0 + vc));
  const palette = header.materials.map(hexBytes);
  const color = new Uint8Array(nv * 3);
  for (let v = 0; v < nv; v++) color.set(palette[materials[v]], v * 3);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions.slice(), 3));
  g.setAttribute('aStruct', new BufferAttribute(struct, 1));
  g.setAttribute('aColor', new BufferAttribute(color, 3, true));
  g.setIndex(new BufferAttribute(nv < 65536 ? new Uint16Array(indices) : indices, 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  const ids = header.ids;
  return {
    layer: header.layer as LayerId,
    ids,
    ranges: header.ranges.map(([v0, vc]) => [v0, vc]),
    indexOf: new Map(ids.map((id, i) => [id, i])),
    geometry: g,
    base: positions,
    baseNormals: (g.getAttribute('normal').array as Float32Array).slice(),
    shapeKey: null,
  };
}

/** Shows a layer fitted to a body shape (null = the reference body). Returns true if it changed. */
export function applyShape(m: LayerModel, shape: BodyShape | null): boolean {
  const key = shape?.key ?? null;
  if (m.shapeKey === key) return false;
  const g = m.geometry;
  const pos = g.getAttribute('position') as BufferAttribute;
  const nrm = g.getAttribute('normal') as BufferAttribute;
  if (shape) {
    const struct = g.getAttribute('aStruct');
    deformPositions(shape, m.layer, m.base, vertexWeights(m.base, (v) => m.ids[struct.getX(v)]), pos.array as Float32Array);
    pos.needsUpdate = true;
    g.computeVertexNormals();
  } else {
    (pos.array as Float32Array).set(m.base);
    (nrm.array as Float32Array).set(m.baseNormals);
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  bvhs.get(m)?.refit();
  m.shapeKey = key;
  return true;
}

export function loadLayer(layer: LayerId): Promise<LayerModel> {
  let p = cache.get(layer);
  if (!p) {
    p = (async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}atlas/${layer}.bin`);
      if (!res.ok) throw new Error(`Could not load the ${layer} layer (${res.status})`);
      return buildLayerModel(new Uint8Array(await res.arrayBuffer()));
    })();
    cache.set(layer, p);
    p.catch(() => cache.delete(layer));
  }
  return p;
}

export function loadLayers(layers: LayerId[]): Promise<LayerModel[]> {
  return Promise.all(layers.map(loadLayer));
}

/** Bounding volume hierarchy for fast picking (built on first use). */
export function layerBVH(m: LayerModel): MeshBVH {
  let b = bvhs.get(m);
  if (!b) {
    b = new MeshBVH(m.geometry, { targetLeafSize: 12 });
    bvhs.set(m, b);
  }
  return b;
}

export interface LayerHit {
  layer: LayerId;
  index: number;
  structureId: string;
  distance: number;
  point: Vector3;
  /** Surface normal, turned to face the ray origin. */
  normal: Vector3;
  /** The same point and normal on the reference body (what notes store). */
  refPoint: Vector3;
  refNormal: Vector3;
}

const _n = new Vector3();
const _tri = new Triangle();
const _bary = new Vector3();
const _a = new Vector3(), _b = new Vector3(), _c = new Vector3();

/** Maps a hit on the (possibly fitted) mesh back onto the reference body. */
function toReference(m: LayerModel, h: Intersection, normal: Vector3): { refPoint: Vector3; refNormal: Vector3 } {
  const f = h.face!;
  if (m.shapeKey === null) return { refPoint: h.point.clone(), refNormal: normal.clone() };
  const pos = m.geometry.getAttribute('position');
  _tri.set(_a.fromBufferAttribute(pos, f.a), _b.fromBufferAttribute(pos, f.b), _c.fromBufferAttribute(pos, f.c));
  _tri.getBarycoord(h.point, _bary);
  const b = m.base;
  const ra = new Vector3(b[f.a * 3], b[f.a * 3 + 1], b[f.a * 3 + 2]);
  const rb = new Vector3(b[f.b * 3], b[f.b * 3 + 1], b[f.b * 3 + 2]);
  const rc = new Vector3(b[f.c * 3], b[f.c * 3 + 1], b[f.c * 3 + 2]);
  const refPoint = ra.clone().multiplyScalar(_bary.x).addScaledVector(rb, _bary.y).addScaledVector(rc, _bary.z);
  const refNormal = new Vector3().subVectors(rb, ra).cross(new Vector3().subVectors(rc, ra)).normalize();
  // keep the side of the surface that was hit
  const geomNormal = new Vector3().subVectors(_b, _a).cross(new Vector3().subVectors(_c, _a));
  if (geomNormal.dot(normal) < 0) refNormal.negate();
  return { refPoint, refNormal };
}

/** Nearest hit on a layer, skipping structures for which `visible` returns false. */
export function raycastLayer(m: LayerModel, ray: Ray, visible: (index: number) => boolean, far = Infinity): LayerHit | null {
  const hits = layerBVH(m).raycast(ray, DoubleSide, 0, far) as Intersection[];
  const aStruct = m.geometry.getAttribute('aStruct');
  let best: LayerHit | null = null;
  for (const h of hits) {
    if (!h.face || (best && h.distance >= best.distance)) continue;
    const index = aStruct.getX(h.face.a);
    if (!visible(index)) continue;
    _n.copy(h.face.normal);
    if (_n.dot(ray.direction) > 0) _n.negate();
    best = { layer: m.layer, index, structureId: m.ids[index], distance: h.distance, point: h.point.clone(), normal: _n.clone(), ...toReference(m, h, _n) };
  }
  return best;
}

// The helpers below work on the reference body, where notes keep their points.

/** Centre of a structure's vertices. */
export function structureCentroid(m: LayerModel, index: number): Vector3 {
  const [v0, vc] = m.ranges[index];
  const p = m.base;
  const c = new Vector3();
  for (let v = v0; v < v0 + vc; v++) (c.x += p[v * 3]), (c.y += p[v * 3 + 1]), (c.z += p[v * 3 + 2]);
  return c.divideScalar(Math.max(1, vc));
}

// Some structures (the skin regions in particular) are thin closed shells, so the
// nearest vertex can sit on the inner face. Among the vertices within a few
// millimetres of the nearest one, prefer the one facing the same way as `hint`
// (by default: away from the body's long axis).
const SHELL = 0.006;

function nearestVertex(m: LayerModel, v0: number, v1: number, point: Vec3, hint?: Vec3): number {
  const p = m.base;
  const n = m.baseNormals;
  const d2 = (v: number) => (p[v * 3] - point[0]) ** 2 + (p[v * 3 + 1] - point[1]) ** 2 + (p[v * 3 + 2] - point[2]) ** 2;
  let d0 = Infinity;
  for (let v = v0; v < v1; v++) d0 = Math.min(d0, d2(v));
  const reach = (Math.sqrt(d0) + SHELL) ** 2;
  const h = new Vector3(...(hint ?? [point[0], 0, point[2] - 0.05]));
  if (h.lengthSq() < 1e-8) h.set(0, 0, 1);
  h.normalize();
  let best = v0, bestScore = -Infinity;
  for (let v = v0; v < v1; v++) {
    const d = d2(v);
    if (d > reach) continue;
    const score = n[v * 3] * h.x + n[v * 3 + 1] * h.y + n[v * 3 + 2] * h.z - Math.sqrt(d) * 20;
    if (score > bestScore) (bestScore = score), (best = v);
  }
  return best;
}

/** Snap a point onto a structure (outer surface first). */
export function nearestOnStructure(m: LayerModel, index: number, point: Vec3, hint?: Vec3): { point: Vec3; normal: Vec3 } {
  const [v0, vc] = m.ranges[index];
  return refVertex(m, nearestVertex(m, v0, v0 + vc, point, hint));
}

/** Nearest surface point anywhere on a layer (used to find the skin region under a point). */
export function nearestOnLayer(m: LayerModel, point: Vec3, hint?: Vec3): { index: number; point: Vec3; normal: Vec3 } {
  const v = nearestVertex(m, 0, m.base.length / 3, point, hint);
  return { index: m.geometry.getAttribute('aStruct').getX(v), ...refVertex(m, v) };
}

/** A point on a structure that faces a direction (for demo data and list picks). */
export function pointFacing(m: LayerModel, index: number, dir: Vec3, bias = 0): { point: Vec3; normal: Vec3 } {
  const [v0, vc] = m.ranges[index];
  const p = m.base;
  const c = structureCentroid(m, index);
  let best = v0, bestScore = -Infinity;
  for (let v = v0; v < v0 + vc; v++) {
    const x = p[v * 3] - c.x, y = p[v * 3 + 1] - c.y, z = p[v * 3 + 2] - c.z;
    const score = x * dir[0] + y * dir[1] + z * dir[2] - Math.abs(y) * 0.6 + y * bias;
    if (score > bestScore) (bestScore = score), (best = v);
  }
  return refVertex(m, best);
}

function refVertex(m: LayerModel, v: number): { point: Vec3; normal: Vec3 } {
  const p = m.base, n = m.baseNormals;
  // the build orients every mesh so that its normals face outwards
  return { point: [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]], normal: [n[v * 3], n[v * 3 + 1], n[v * 3 + 2]] };
}
