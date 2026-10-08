// Builds the anatomical model from the Z-Anatomy / BodyParts3D data release
// (CC BY-SA 4.0): selects structures for each app layer, merges and simplifies
// their meshes, classifies superficial vs deep muscles, and writes
//   public/atlas/<layer>.bin   (geometry, see src/anatomy/atlasFile.ts)
//   src/anatomy/catalog.json   (names, groups, sides, Latin names)
// Run `npm run anatomy:fetch` first to download the data release.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { createHash } from 'node:crypto';
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeLayer } from '../src/anatomy/atlasFile';
import { meshFromShape } from '../src/anatomy/mc';
import { displace, ellipsoid, intersect, subtract, union, type Shape } from '../src/anatomy/sdf';
import type { LayerId } from '../src/anatomy/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '1.1.0';
const DATA = process.env.ANATOMY_DATA ?? join(root, '.cache', 'anatomy', 'package', 'releases', VERSION);
const QUALITY = (process.env.ANATOMY_QUALITY ?? 'economy') as 'economy' | 'standard';

// ------------------------------------------------------------------ manifest

interface MStruct {
  id: string;
  parent: string | null;
  system: string;
  kind: 'system' | 'group' | 'structure';
  side?: 'left' | 'right';
  meshes?: number[];
  gap?: unknown;
}
interface Manifest {
  structures: MStruct[];
  chunks: { id: string; system: string; files: Record<string, { path: string; sha256: string }> }[];
  materials: { key: string; kind: string; color: string }[];
  bounds: { min: number[]; max: number[] };
}
type Names = { entries: Record<string, { name: string }> };

const manifest = JSON.parse(readFileSync(join(DATA, 'manifest.json'), 'utf8')) as Manifest;
const en = (JSON.parse(readFileSync(join(DATA, 'names', 'en.json'), 'utf8')) as Names).entries;
const la = (JSON.parse(readFileSync(join(DATA, 'names', 'la.json'), 'utf8')) as Names).entries;
const byId = new Map(manifest.structures.map((s) => [s.id, s]));

function ancestors(s: MStruct): MStruct[] {
  const out: MStruct[] = [];
  let p = s.parent ? byId.get(s.parent) : undefined;
  while (p) {
    out.push(p);
    p = p.parent ? byId.get(p.parent) : undefined;
  }
  return out;
}

const nameOf = (id: string) => (en[id]?.name ?? id).replace(/^\((.*)\)$/, '$1').trim();

// ------------------------------------------------------------------ selection

interface Pick {
  layer: LayerId;
  name?: string;
  group?: string;
}

const KEEP_FASCIAE =
  /^(Iliotibial tract|Plantar aponeurosis|Palmar aponeurosis|Posterior layer of thoracolumbar fascia|Epicranial aponeurosis|(Lateral|Medial) patellar retinaculum|Flexor retinaculum of wrist)$/;
const DROP_JOINT = /capsule|synovial|intercostal membrane|fat pad|frenula|membrane of larynx|thyrohyoid membrane|fibro-elastic/i;
const KIDNEY_INSIDE = /^visceral\.(renal_cortex|renal_pyramids|renal_papillae|renal_columns|hilum_of_kidney|major_calices|minor_calices)_/;

function select(s: MStruct): Pick | null {
  if (s.kind !== 'structure' || !s.meshes?.length) return null;
  const path = ancestors(s).map((a) => a.id);
  const has = (frag: string) => path.some((p) => p.includes(frag));
  const name = nameOf(s.id);
  const parent = s.parent ? byId.get(s.parent) : undefined;
  const nestedInStructure = parent?.kind === 'structure' && !!parent.meshes?.length;
  switch (s.system) {
    case 'regions':
      return has('regions.hairs') ? null : { layer: 'skin' };
    case 'muscular':
      if (has('bursae_of_') || has('tendon_sheaths_of_')) return null;
      if ((has('muscular.fasciae') || /fascia|retinaculum|septum|aponeurosis|iliotibial/i.test(name)) && !/^Tensor fasciae/.test(name)) {
        return KEEP_FASCIAE.test(name) ? { layer: 'muscular', group: 'Fasciae' } : null;
      }
      if (/\(origin\)$/.test(name)) return null;
      return { layer: 'muscular' };
    case 'skeletal':
      if (/^skeletal\.(sinus_of_|anterior_cells_|middle_cells_|posterior_cells_)/.test(s.id)) return null;
      return { layer: 'skeletal' };
    case 'joints':
      return DROP_JOINT.test(name) ? null : { layer: 'skeletal' };
    case 'cardiovascular':
      // a few source names are placeholders or garbled
      if (/^\?+x?$/.test(name)) return { layer: 'vascular', name: 'Unlabelled vessel segment' };
      if (s.id === 'cardiovascular.inferior_vein_of_left_ventricle_posterior') return { layer: 'vascular', name: 'Inferior vein of left ventricle (posterior)' };
      return has('cardiovascular.heart') ? { layer: 'organs', group: 'Heart' } : { layer: 'vascular' };
    case 'visceral':
      if (has('abdominopelvic_cavity') || has('thoracic_cavity')) return null;
      if (parent?.id === 'visceral.liver' || /taenia$|^Mucosa/.test(name) || KIDNEY_INSIDE.test(s.id)) return null;
      if (/segmental bronchus/i.test(name)) return null;
      if (/^visceral\.fibrous_capsule_of_kidney_/.test(s.id)) return { layer: 'organs', name: 'Kidney', group: 'Urinary system' };
      return { layer: 'organs' };
    case 'nervous':
      if (s.id === 'nervous.white_matter_of_spinal_cord_2') return { layer: 'nerves', name: 'Spinal cord', group: 'Spinal cord' };
      if (has('nervous.spinal_cord') || has('nervous.meninges')) return null;
      if (/ventricle|aqueduct|central canal|septum pellucidum/i.test(name)) return null;
      if (nestedInStructure && has('nervous.brainstem')) return null; // nuclei inside the brainstem
      return { layer: 'nerves' };
    case 'lymphoid':
      return { layer: 'organs' };
    default:
      return null; // insertions (attachment patches)
  }
}

function groupOf(s: MStruct): string {
  for (const a of ancestors(s)) if (a.kind === 'group') return nameOf(a.id);
  return nameOf(s.system);
}

// ------------------------------------------------------------------ geometry

await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

interface RawMesh {
  positions: number[];
  materials: number[];
  indices: number[];
}
const raw = new Map<number, RawMesh>();

for (const chunk of manifest.chunks) {
  if (chunk.system === 'insertions') continue;
  const f = chunk.files[QUALITY];
  const bytes = readFileSync(join(DATA, f.path));
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== f.sha256) throw new Error(`checksum mismatch for ${f.path}`);
  const doc = await io.readBinary(new Uint8Array(bytes));
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')!;
      const nrm = prim.getAttribute('NORMAL');
      const ids = prim.getAttribute('_ID')!;
      const idx = prim.getIndices()!;
      const n = pos.getCount();
      const meshOf = new Int32Array(n), matOf = new Int32Array(n);
      const world = new Float32Array(n * 3);
      const wn = new Float32Array(n * 3);
      const e: number[] = [];
      for (let i = 0; i < n; i++) {
        if (nrm) {
          nrm.getElement(i, e);
          // uniform scale + no rotation in this data set, so normals pass through the rotation part only
          wn[i * 3] = m[0] * e[0] + m[4] * e[1] + m[8] * e[2];
          wn[i * 3 + 1] = m[1] * e[0] + m[5] * e[1] + m[9] * e[2];
          wn[i * 3 + 2] = m[2] * e[0] + m[6] * e[1] + m[10] * e[2];
        }
        pos.getElement(i, e);
        const [x, y, z] = e;
        world[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        world[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        world[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        ids.getElement(i, e);
        meshOf[i] = e[0];
        matOf[i] = e[1];
      }
      const remap = new Map<number, Map<number, number>>();
      const ia = idx.getArray()!;
      for (let t = 0; t < ia.length; t += 3) {
        const a = ia[t];
        let b = ia[t + 1], c = ia[t + 2];
        // The source winding is inconsistent; orient each triangle by the supplied normals.
        if (nrm) {
          const e1x = world[b * 3] - world[a * 3], e1y = world[b * 3 + 1] - world[a * 3 + 1], e1z = world[b * 3 + 2] - world[a * 3 + 2];
          const e2x = world[c * 3] - world[a * 3], e2y = world[c * 3 + 1] - world[a * 3 + 1], e2z = world[c * 3 + 2] - world[a * 3 + 2];
          const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
          const nx = wn[a * 3] + wn[b * 3] + wn[c * 3], ny = wn[a * 3 + 1] + wn[b * 3 + 1] + wn[c * 3 + 1], nz = wn[a * 3 + 2] + wn[b * 3 + 2] + wn[c * 3 + 2];
          if (fx * nx + fy * ny + fz * nz < 0) {
            const tmp = b;
            b = c;
            c = tmp;
          }
        }
        const mi = meshOf[a];
        let r = raw.get(mi);
        if (!r) raw.set(mi, (r = { positions: [], materials: [], indices: [] }));
        let rm = remap.get(mi);
        if (!rm) remap.set(mi, (rm = new Map()));
        for (const v of [a, b, c]) {
          let k = rm.get(v);
          if (k === undefined) {
            k = r.positions.length / 3;
            rm.set(v, k);
            r.positions.push(world[v * 3], world[v * 3 + 1], world[v * 3 + 2]);
            r.materials.push(matOf[v]);
          }
          r.indices.push(k);
        }
      }
    }
  }
}
console.log(`decoded ${raw.size} meshes (${QUALITY})`);

interface Built {
  id: string;
  layer: LayerId;
  name: string;
  latin?: string;
  group: string;
  side?: 'L' | 'R';
  deep?: boolean;
  approx?: boolean;
  positions: Float32Array;
  indices: Uint32Array;
  materials: Uint8Array; // global material index per vertex (remapped per layer later)
}

const ERROR: Record<LayerId, number> = {
  skin: 0.0005,
  muscular: 0.0004,
  skeletal: 0.0003,
  nerves: 0.00025,
  vascular: 0.00025,
  organs: 0.0004,
};

/** Weld by position, simplify within an absolute error, drop unused vertices. */
function prepare(positions: number[], materials: number[], indices: number[], err: number) {
  const key = (i: number) => `${Math.round(positions[i * 3] * 1e5)},${Math.round(positions[i * 3 + 1] * 1e5)},${Math.round(positions[i * 3 + 2] * 1e5)}`;
  const weld = new Map<string, number>();
  const wp: number[] = [], wm: number[] = [];
  const map = new Int32Array(positions.length / 3);
  for (let i = 0; i < map.length; i++) {
    const k = key(i);
    let j = weld.get(k);
    if (j === undefined) {
      j = wp.length / 3;
      weld.set(k, j);
      wp.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      wm.push(materials[i]);
    }
    map[i] = j;
  }
  let idx = new Uint32Array(indices.length);
  let n = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = map[indices[t]], b = map[indices[t + 1]], c = map[indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    idx[n++] = a; idx[n++] = b; idx[n++] = c;
  }
  idx = idx.slice(0, n);
  const pos = new Float32Array(wp);
  if (idx.length > 300) [idx] = MeshoptSimplifier.simplify(idx, pos, 3, 0, err, ['ErrorAbsolute']);
  const remap = new Int32Array(pos.length / 3).fill(-1);
  let k = 0;
  for (const i of idx) if (remap[i] < 0) remap[i] = k++;
  const outP = new Float32Array(k * 3), outM = new Uint8Array(k);
  for (let v = 0; v < remap.length; v++) {
    const r = remap[v];
    if (r < 0) continue;
    outP.set(pos.subarray(v * 3, v * 3 + 3), r * 3);
    outM[r] = wm[v];
  }
  const outI = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) outI[i] = remap[idx[i]];
  return { positions: outP, indices: outI, materials: outM };
}

/** Signed volume of a mesh relative to its centroid (> 0 when its faces point outwards). */
function signedVolume(p: number[], idx: number[]): number {
  let cx = 0, cy = 0, cz = 0;
  const n = p.length / 3;
  for (let i = 0; i < p.length; i += 3) { cx += p[i]; cy += p[i + 1]; cz += p[i + 2]; }
  cx /= n; cy /= n; cz /= n;
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = p[a] - cx, ay = p[a + 1] - cy, az = p[a + 2] - cz;
    const bx = p[b] - cx, by = p[b + 1] - cy, bz = p[b + 2] - cz;
    const qx = p[c] - cx, qy = p[c + 1] - cy, qz = p[c + 2] - cz;
    v += ax * (by * qz - bz * qy) + ay * (bz * qx - bx * qz) + az * (bx * qy - by * qx);
  }
  return v / 6;
}

const built: Built[] = [];
const dropped: Record<string, number> = {};
for (const s of manifest.structures) {
  const pick = select(s);
  if (!pick) {
    if (s.kind === 'structure' && s.meshes?.length) dropped[s.system] = (dropped[s.system] ?? 0) + 1;
    continue;
  }
  const P: number[] = [], M: number[] = [], I: number[] = [];
  for (const mi of s.meshes!) {
    const r = raw.get(mi);
    if (!r) continue;
    const base = P.length / 3;
    for (const v of r.positions) P.push(v);
    for (const v of r.materials) M.push(v);
    // mirrored copies come inside out: flip meshes whose volume is negative so normals face outwards
    const flip = signedVolume(r.positions, r.indices) < 0;
    for (let t = 0; t < r.indices.length; t += 3) {
      I.push(r.indices[t] + base);
      I.push(r.indices[t + (flip ? 2 : 1)] + base);
      I.push(r.indices[t + (flip ? 1 : 2)] + base);
    }
  }
  if (!I.length) continue;
  const g = prepare(P, M, I, ERROR[pick.layer]);
  if (!g.indices.length) continue;
  const latin = la[s.id]?.name;
  built.push({
    id: s.id,
    layer: pick.layer,
    name: pick.name ?? nameOf(s.id),
    latin: latin && latin !== nameOf(s.id) ? latin : undefined,
    group: pick.group ?? groupOf(s),
    side: s.side === 'left' ? 'L' : s.side === 'right' ? 'R' : undefined,
    ...g,
  });
}
console.log('dropped per system', dropped);

// ------------------------------------------------------------------ muscle depth

// A muscle is "superficial" when part of it can be seen from outside the body with
// only the muscles and bones present: from sampled surface points we cast rays
// around the normal and check whether any escapes without hitting other tissue.
{
  const occluders = built.filter((b) => b.layer === 'muscular' || b.layer === 'skeletal');
  let nv = 0, ni = 0;
  for (const b of occluders) { nv += b.positions.length / 3; ni += b.indices.length; }
  const pos = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  const owner = new Int32Array(ni / 3);
  let vo = 0, io3 = 0;
  occluders.forEach((b, k) => {
    pos.set(b.positions, vo * 3);
    for (let i = 0; i < b.indices.length; i++) idx[io3 + i] = b.indices[i] + vo;
    owner.fill(k, io3 / 3, (io3 + b.indices.length) / 3);
    vo += b.positions.length / 3;
    io3 += b.indices.length;
  });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setIndex(new BufferAttribute(idx, 1));
  const bvh = new MeshBVH(geo);
  const ray = new Ray();
  const dirs: Vector3[] = [];
  const report: [string, number][] = [];
  occluders.forEach((m, k) => {
    if (m.layer !== 'muscular') return;
    const n = m.positions.length / 3;
    const nor = new Float32Array(m.positions.length);
    for (let t = 0; t < m.indices.length; t += 3) {
      const a = m.indices[t] * 3, b = m.indices[t + 1] * 3, c = m.indices[t + 2] * 3;
      const e1 = new Vector3(m.positions[b] - m.positions[a], m.positions[b + 1] - m.positions[a + 1], m.positions[b + 2] - m.positions[a + 2]);
      const e2 = new Vector3(m.positions[c] - m.positions[a], m.positions[c + 1] - m.positions[a + 1], m.positions[c + 2] - m.positions[a + 2]);
      const f = e1.cross(e2);
      for (const v of [a, b, c]) { nor[v] += f.x; nor[v + 1] += f.y; nor[v + 2] += f.z; }
    }
    const step = Math.max(1, Math.floor(n / 80));
    let exposed = 0, tested = 0;
    for (let v = 0; v < n; v += step) {
      const N = new Vector3(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
      if (N.lengthSq() === 0) continue;
      N.normalize();
      tested++;
      // normal plus 6 directions tilted 50° around it
      const T = Math.abs(N.y) < 0.9 ? new Vector3(0, 1, 0).cross(N).normalize() : new Vector3(1, 0, 0).cross(N).normalize();
      const B = N.clone().cross(T);
      // source orientation is unreliable (mirrored copies are flipped), so test both hemispheres
      let escaped = false;
      for (const sgn of [1, -1]) {
        const Ns = N.clone().multiplyScalar(sgn);
        dirs.length = 0;
        dirs.push(Ns);
        for (let j = 0; j < 6; j++) {
          const a = (j / 6) * Math.PI * 2;
          dirs.push(Ns.clone().multiplyScalar(Math.cos(0.87)).addScaledVector(T, Math.sin(0.87) * Math.cos(a)).addScaledVector(B, Math.sin(0.87) * Math.sin(a)).normalize());
        }
        const o = new Vector3(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]).addScaledVector(Ns, 0.0015);
        for (const d of dirs) {
          ray.set(o, d);
          const hit = bvh.raycastFirst(ray, DoubleSide);
          if (!hit) { escaped = true; break; }
        }
        if (escaped) break;
      }
      if (escaped) exposed++;
    }
    const frac = tested ? exposed / tested : 0;
    m.deep = frac < 0.155;
    report.push([m.id, frac]);
  });
  const probe = ['biceps_brachii', 'brachialis', 'supraspinatus', 'infraspinatus', 'rhomboid_major', 'soleus', 'vastus_intermedius', 'vastus_lateralis', 'iliacus', 'psoas_major', 'gluteus_minimus', 'gluteus_medius', 'pectoralis_minor', 'quadratus_lumborum', 'trapezius', 'latissimus', 'gluteus_maximus', 'rectus_femoris', 'transversus_abdominis', 'internal_abdominal'];
  for (const [id, f] of report) if (id.endsWith('_l') && probe.some((p) => id.includes(p))) console.log(`  exposure ${id.padEnd(48)} ${(f * 100).toFixed(0)}%`);
  console.log(`muscles: ${report.filter(([, f]) => f >= 0.155).length} superficial, ${report.filter(([, f]) => f < 0.155).length} deep`);
}

// ------------------------------------------------------------------ approximate cerebrum

// The dataset's cerebral cortex surfaces are excluded for licensing reasons, so the
// cerebral hemispheres are approximated: a gyrated shape fitted inside the cranium.
{
  const cranial = built.filter((b) => /^skeletal\.(frontal_bone|parietal_bone_[lr]|occipital_bone|temporal_bone_[lr]|sphenoid_bone)$/.test(b.id));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const b of cranial)
    for (let i = 0; i < b.positions.length; i += 3)
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], b.positions[i + a]);
        max[a] = Math.max(max[a], b.positions[i + a]);
      }
  const top = max[1];
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const halfW = (max[0] - min[0]) / 2 - 0.016;
  const halfD = (max[2] - min[2]) / 2 - 0.014;
  const ry = 0.07;
  const cy = top - 0.012 - ry;
  console.log(`cranium box x[${min[0].toFixed(3)},${max[0].toFixed(3)}] y[${min[1].toFixed(3)},${top.toFixed(3)}] z[${min[2].toFixed(3)},${max[2].toFixed(3)}]`);
  const hemi = (sign: 1 | -1): Shape => {
    const body = union(
      [
        ellipsoid([cx + sign * halfW * 0.5, cy, cz + 0.004], [halfW * 0.52, ry, halfD * 0.98]),
        ellipsoid([cx + sign * halfW * 0.55, cy - 0.04, cz + halfD * 0.12], [halfW * 0.42, 0.035, halfD * 0.62]), // temporal lobe
      ],
      0.025,
    );
    const half: Shape = { d: (x) => -sign * (x - cx) + 0.0016, box: { min: [-1, -1, -1], max: [1, 3, 1] } };
    const cut = intersect(body, half, 0.003);
    const gyri = displace(cut, 0.002, (x, y, z) => 0.0017 * Math.sin(x * 240 + Math.sin(y * 160) * 2.4) * Math.sin(y * 210 + Math.sin(z * 150) * 2.1) * Math.sin(z * 200 + x * 80));
    // keep clear of the cerebellum / tentorium
    const under: Shape = ellipsoid([cx, cy - ry - 0.005, cz - halfD * 0.62], [halfW * 0.9, 0.03, halfD * 0.45]);
    return subtract(gyri, under, 0.01);
  };
  for (const [sign, side] of [[1, 'L'], [-1, 'R']] as const) {
    const m = meshFromShape(hemi(sign), 0.0024, 1);
    const [idx] = MeshoptSimplifier.simplify(m.indices, m.positions, 3, 0, 0.0003, ['ErrorAbsolute']);
    const g = prepare(Array.from(m.positions), new Array(m.positions.length / 3).fill(255), Array.from(idx), 0.0003);
    built.push({
      id: `approx.cerebral_hemisphere_${side.toLowerCase()}`,
      layer: 'nerves',
      name: 'Cerebral hemisphere (approximate)',
      latin: 'Hemispherium cerebri',
      group: 'Cerebrum',
      side,
      approx: true,
      ...g,
    });
  }
}

// ------------------------------------------------------------------ write

const LAYER_ORDER: LayerId[] = ['skin', 'muscular', 'skeletal', 'nerves', 'vascular', 'organs'];
const outDir = join(root, 'public', 'atlas');
mkdirSync(outDir, { recursive: true });
const catalog: Record<string, unknown>[] = [];
let totalTris = 0, totalBytes = 0;
const BRAIN_COLOR = '#e8b7b0';
for (const layer of LAYER_ORDER) {
  const items = built.filter((b) => b.layer === layer).sort((a, b) => a.group.localeCompare(b.group) || a.id.localeCompare(b.id));
  const palette: string[] = [];
  const palIndex = new Map<number, number>();
  let nv = 0, ni = 0;
  for (const b of items) { nv += b.positions.length / 3; ni += b.indices.length; }
  const positions = new Float32Array(nv * 3), indices = new Uint32Array(ni), materials = new Uint8Array(nv);
  const ranges: [number, number, number, number][] = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let vo = 0, io2 = 0;
  for (const b of items) {
    const n = b.positions.length / 3;
    positions.set(b.positions, vo * 3);
    for (let i = 0; i < b.indices.length; i++) indices[io2 + i] = b.indices[i] + vo;
    for (let v = 0; v < n; v++) {
      const gm = b.materials[v];
      let p = palIndex.get(gm);
      if (p === undefined) {
        p = palette.length;
        palIndex.set(gm, p);
        palette.push(gm === 255 ? BRAIN_COLOR : manifest.materials[gm]?.color ?? '#cccccc');
      }
      materials[vo + v] = p;
    }
    for (let i = 0; i < b.positions.length; i += 3)
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], b.positions[i + a]);
        max[a] = Math.max(max[a], b.positions[i + a]);
      }
    ranges.push([vo, n, io2, b.indices.length]);
    vo += n;
    io2 += b.indices.length;
    catalog.push({
      id: b.id,
      name: b.name,
      ...(b.latin ? { latin: b.latin } : {}),
      layer,
      group: b.group,
      ...(b.side ? { side: b.side } : {}),
      ...(b.deep ? { deep: true } : {}),
      ...(b.approx ? { approx: true } : {}),
    });
  }
  if (palette.length > 255) throw new Error(`too many materials in ${layer}`);
  const bin = encodeLayer({
    header: { version: 2, layer, min, max, ids: items.map((b) => b.id), ranges, materials: palette, vertexCount: nv, indexCount: ni },
    positions,
    indices,
    materials,
  });
  writeFileSync(join(outDir, `${layer}.bin`), bin);
  totalTris += ni / 3;
  totalBytes += bin.length;
  console.log(`${layer.padEnd(9)} ${String(items.length).padStart(4)} structures ${String(ni / 3).padStart(7)} tris ${(bin.length / 1024).toFixed(0).padStart(5)} KB`);
}
writeFileSync(
  join(root, 'src', 'anatomy', 'catalog.json'),
  JSON.stringify({ source: `Z-Anatomy via @authorod/svitylo-3d-anatomy-data ${VERSION} (${QUALITY})`, structures: catalog }),
);
console.log(`total ${catalog.length} structures, ${totalTris} triangles, ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
