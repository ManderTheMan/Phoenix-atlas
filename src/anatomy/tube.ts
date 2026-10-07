// Variable-radius tubes along smooth curves (nerves, ribs, intestines, vessels).
import { CatmullRomCurve3, Vector3 } from 'three';
import type { MeshData } from './mc';
import type { V3 } from './sdf';

export interface TubeOptions {
  radius: number | ((t: number) => number);
  tubular?: number; // segments along the curve
  radial?: number; // segments around
  closed?: boolean;
  tension?: number;
}

export function tube(points: V3[], opts: TubeOptions): MeshData {
  const curve = new CatmullRomCurve3(
    points.map((p) => new Vector3(p[0], p[1], p[2])),
    false,
    'catmullrom',
    opts.tension ?? 0.5,
  );
  const tubular = opts.tubular ?? Math.max(16, Math.round(curve.getLength() / 0.006));
  const radial = opts.radial ?? 8;
  const frames = curve.computeFrenetFrames(tubular, false);
  const rad = typeof opts.radius === 'number' ? () => opts.radius as number : opts.radius;

  const ringCount = tubular + 1;
  const nv = ringCount * radial + 2;
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const idx: number[] = [];
  const P = new Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, P);
    const r = rad(t);
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const s = Math.sin(a), c = -Math.cos(a);
      const nx = c * N.x + s * B.x, ny = c * N.y + s * B.y, nz = c * N.z + s * B.z;
      const v = (i * radial + j) * 3;
      pos[v] = P.x + r * nx; pos[v + 1] = P.y + r * ny; pos[v + 2] = P.z + r * nz;
      nor[v] = nx; nor[v + 1] = ny; nor[v + 2] = nz;
    }
  }
  for (let i = 0; i < tubular; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = (i + 1) * radial + j;
      const c = (i + 1) * radial + ((j + 1) % radial);
      const d = i * radial + ((j + 1) % radial);
      idx.push(a, b, d, b, c, d);
    }
  // end caps
  const startC = ringCount * radial, endC = startC + 1;
  const p0 = curve.getPointAt(0), p1 = curve.getPointAt(1);
  const t0 = curve.getTangentAt(0), t1 = curve.getTangentAt(1);
  pos.set([p0.x, p0.y, p0.z], startC * 3);
  pos.set([p1.x, p1.y, p1.z], endC * 3);
  nor.set([-t0.x, -t0.y, -t0.z], startC * 3);
  nor.set([t1.x, t1.y, t1.z], endC * 3);
  for (let j = 0; j < radial; j++) {
    idx.push(startC, j, (j + 1) % radial);
    const o = tubular * radial;
    idx.push(endC, o + ((j + 1) % radial), o + j);
  }
  return { positions: pos, normals: nor, indices: new Uint32Array(idx) };
}

/** Concatenate meshes into one. */
export function mergeMeshes(meshes: MeshData[]): MeshData {
  let nv = 0, ni = 0;
  for (const m of meshes) { nv += m.positions.length; ni += m.indices.length; }
  const positions = new Float32Array(nv);
  const normals = new Float32Array(nv);
  const indices = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const m of meshes) {
    positions.set(m.positions, vo);
    normals.set(m.normals, vo);
    const base = vo / 3;
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + base;
    vo += m.positions.length;
    io += m.indices.length;
  }
  return { positions, normals, indices };
}

/** Mirror a mesh across the sagittal plane (x -> -x), fixing winding. */
export function mirrorMesh(m: MeshData): MeshData {
  const positions = new Float32Array(m.positions);
  const normals = new Float32Array(m.normals);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = -positions[i];
    normals[i] = -normals[i];
  }
  const indices = new Uint32Array(m.indices.length);
  for (let i = 0; i < indices.length; i += 3) {
    indices[i] = m.indices[i];
    indices[i + 1] = m.indices[i + 2];
    indices[i + 2] = m.indices[i + 1];
  }
  return { positions, normals, indices };
}
