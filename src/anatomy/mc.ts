// Marching cubes over a sampled signed distance field, producing indexed meshes.
import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';
import type { Box, Shape } from './sdf';

export interface Grid {
  nx: number;
  ny: number;
  nz: number;
  ox: number;
  oy: number;
  oz: number;
  step: number;
  data: Float32Array;
}

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export function makeGrid(box: Box, step: number, pad = 2): Grid {
  const ox = box.min[0] - pad * step;
  const oy = box.min[1] - pad * step;
  const oz = box.min[2] - pad * step;
  const nx = Math.ceil((box.max[0] - box.min[0]) / step) + 2 * pad + 1;
  const ny = Math.ceil((box.max[1] - box.min[1]) / step) + 2 * pad + 1;
  const nz = Math.ceil((box.max[2] - box.min[2]) / step) + 2 * pad + 1;
  return { nx, ny, nz, ox, oy, oz, step, data: new Float32Array(nx * ny * nz) };
}

/**
 * Sample a shape onto a grid. A coarse pre-pass skips points far from the
 * surface (beyond `band` metres get a conservative signed estimate), and the
 * finest level is only evaluated exactly right next to the surface — elsewhere
 * it is trilinearly interpolated. This keeps whole-body sampling fast.
 */
export function sampleShape(shape: Shape, box: Box, step: number, band = step * 3): Grid {
  const mid = sampleBand(shape, box, step * 2, Math.max(band, step * 6));
  const nx = (mid.nx - 1) * 2 + 1, ny = (mid.ny - 1) * 2 + 1, nz = (mid.nz - 1) * 2 + 1;
  const g: Grid = { nx, ny, nz, ox: mid.ox, oy: mid.oy, oz: mid.oz, step, data: new Float32Array(nx * ny * nz) };
  const near = step * 3;
  const md = mid.data, mnx = mid.nx, mnxy = mid.nx * mid.ny;
  let idx = 0;
  for (let k = 0; k < nz; k++) {
    const k0 = k >> 1, kz = k & 1;
    for (let j = 0; j < ny; j++) {
      const j0 = j >> 1, jy = j & 1;
      for (let i = 0; i < nx; i++, idx++) {
        const i0 = i >> 1, ix = i & 1;
        const b = i0 + mnx * j0 + mnxy * k0;
        let v: number;
        if (!ix && !jy && !kz) v = md[b];
        else {
          // average of the 2/4/8 surrounding mid-level samples
          let sum = 0, n = 0;
          for (let dz = 0; dz <= kz; dz++)
            for (let dy = 0; dy <= jy; dy++)
              for (let dx = 0; dx <= ix; dx++) { sum += md[b + dx + mnx * dy + mnxy * dz]; n++; }
          v = sum / n;
        }
        if (Math.abs(v) < near) v = shape.d(g.ox + i * step, g.oy + j * step, g.oz + k * step);
        g.data[idx] = v;
      }
    }
  }
  return g;
}

function sampleBand(shape: Shape, box: Box, step: number, band: number): Grid {
  const g = makeGrid(box, step, 3);
  const { nx, ny, nz, ox, oy, oz, data } = g;
  const C = 4;
  const cnx = Math.ceil((nx - 1) / C) + 1;
  const cny = Math.ceil((ny - 1) / C) + 1;
  const cnz = Math.ceil((nz - 1) / C) + 1;
  const cs = step * C;
  const coarse = new Float32Array(cnx * cny * cnz);
  for (let k = 0; k < cnz; k++)
    for (let j = 0; j < cny; j++)
      for (let i = 0; i < cnx; i++)
        coarse[i + cnx * (j + cny * k)] = shape.d(ox + i * cs, oy + j * cs, oz + k * cs);

  const halfDiag = cs * Math.sqrt(3) * 0.5;
  const safety = 1.5; // approximate SDFs (ellipsoids, smooth unions) are not exactly 1-Lipschitz
  for (let ck = 0; ck < cnz - 1; ck++)
    for (let cj = 0; cj < cny - 1; cj++)
      for (let ci = 0; ci < cnx - 1; ci++) {
        let minAbs = Infinity;
        let pos = 0, neg = 0;
        for (let c = 0; c < 8; c++) {
          const v = coarse[(ci + (c & 1)) + cnx * ((cj + ((c >> 1) & 1)) + cny * (ck + ((c >> 2) & 1)))];
          if (v >= 0) pos++;
          else neg++;
          const a = Math.abs(v);
          if (a < minAbs) minAbs = a;
        }
        const far = (pos === 8 || neg === 8) && minAbs - halfDiag * safety > band;
        const est = (pos === 8 ? 1 : -1) * Math.max(minAbs - halfDiag * safety, band);
        const i0 = ci * C, j0 = cj * C, k0 = ck * C;
        const i1 = Math.min(i0 + C, nx - 1), j1 = Math.min(j0 + C, ny - 1), k1 = Math.min(k0 + C, nz - 1);
        for (let k = k0; k <= k1; k++)
          for (let j = j0; j <= j1; j++) {
            let idx = i0 + nx * (j + ny * k);
            for (let i = i0; i <= i1; i++, idx++) {
              if (far) data[idx] = est;
              else data[idx] = shape.d(ox + i * step, oy + j * step, oz + k * step);
            }
          }
      }
  return g;
}

/** Sample an arbitrary field function on a grid aligned with `base` but cropped to `box`. */
export function sampleFn(
  box: Box,
  step: number,
  fn: (x: number, y: number, z: number, i: number, j: number, k: number) => number,
  base?: Grid,
): Grid {
  let g: Grid;
  if (base) {
    // Align to the base grid so values can be looked up by index.
    const i0 = Math.max(0, Math.floor((box.min[0] - base.ox) / base.step) - 2);
    const j0 = Math.max(0, Math.floor((box.min[1] - base.oy) / base.step) - 2);
    const k0 = Math.max(0, Math.floor((box.min[2] - base.oz) / base.step) - 2);
    const i1 = Math.min(base.nx - 1, Math.ceil((box.max[0] - base.ox) / base.step) + 2);
    const j1 = Math.min(base.ny - 1, Math.ceil((box.max[1] - base.oy) / base.step) + 2);
    const k1 = Math.min(base.nz - 1, Math.ceil((box.max[2] - base.oz) / base.step) + 2);
    const nx = Math.max(2, i1 - i0 + 1), ny = Math.max(2, j1 - j0 + 1), nz = Math.max(2, k1 - k0 + 1);
    g = {
      nx, ny, nz,
      ox: base.ox + i0 * base.step,
      oy: base.oy + j0 * base.step,
      oz: base.oz + k0 * base.step,
      step: base.step,
      data: new Float32Array(nx * ny * nz),
    };
    let idx = 0;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++, idx++)
          g.data[idx] = fn(g.ox + i * step, g.oy + j * step, g.oz + k * step, i + i0, j + j0, k + k0);
  } else {
    g = makeGrid(box, step);
    let idx = 0;
    for (let k = 0; k < g.nz; k++)
      for (let j = 0; j < g.ny; j++)
        for (let i = 0; i < g.nx; i++, idx++)
          g.data[idx] = fn(g.ox + i * step, g.oy + j * step, g.oz + k * step, i, j, k);
  }
  // Force the outer boundary to "outside" so meshes are always closed.
  closeBoundary(g);
  return g;
}

function closeBoundary(g: Grid) {
  const { nx, ny, nz, data } = g;
  const out = g.step;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) {
          const idx = i + nx * (j + ny * k);
          if (data[idx] < out) data[idx] = out;
        }
      }
}

/** Trilinear lookup into a grid (world coordinates). Returns `outside` beyond the grid. */
export function gridLookup(g: Grid, x: number, y: number, z: number, outside = 1): number {
  const fx = (x - g.ox) / g.step, fy = (y - g.oy) / g.step, fz = (z - g.oz) / g.step;
  if (fx < 0 || fy < 0 || fz < 0 || fx >= g.nx - 1 || fy >= g.ny - 1 || fz >= g.nz - 1) return outside;
  const i = fx | 0, j = fy | 0, k = fz | 0;
  const tx = fx - i, ty = fy - j, tz = fz - k;
  const nx = g.nx, nxy = g.nx * g.ny, d = g.data;
  const b = i + nx * j + nxy * k;
  const c00 = d[b] * (1 - tx) + d[b + 1] * tx;
  const c10 = d[b + nx] * (1 - tx) + d[b + nx + 1] * tx;
  const c01 = d[b + nxy] * (1 - tx) + d[b + nxy + 1] * tx;
  const c11 = d[b + nxy + nx] * (1 - tx) + d[b + nxy + nx + 1] * tx;
  return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
}

/** Polygonise the zero level set (negative = inside). */
export function polygonize(g: Grid, iso = 0): { positions: Float32Array; indices: Uint32Array } {
  const { nx, ny, nz, ox, oy, oz, step, data } = g;
  const slice = nx * ny;
  let xA = new Int32Array(slice).fill(-1), yA = new Int32Array(slice).fill(-1);
  let xB = new Int32Array(slice).fill(-1), yB = new Int32Array(slice).fill(-1);
  const zE = new Int32Array(slice);
  const pos: number[] = [];
  const idx: number[] = [];
  const ev = new Int32Array(12);

  const vert = (ax: number, ay: number, az: number, va: number, bx: number, by: number, bz: number, vb: number) => {
    const t = Math.abs(vb - va) < 1e-12 ? 0.5 : (iso - va) / (vb - va);
    pos.push(ox + (ax + (bx - ax) * t) * step, oy + (ay + (by - ay) * t) * step, oz + (az + (bz - az) * t) * step);
    return pos.length / 3 - 1;
  };

  for (let k = 0; k < nz - 1; k++) {
    // slide slice caches
    const tx = xA, ty = yA;
    xA = xB; yA = yB; xB = tx; yB = ty;
    if (k === 0) { xA.fill(-1); yA.fill(-1); }
    xB.fill(-1); yB.fill(-1); zE.fill(-1);
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const q = i + nx * (j + ny * k);
        const v0 = data[q], v1 = data[q + 1], v2 = data[q + 1 + nx], v3 = data[q + nx];
        const v4 = data[q + slice], v5 = data[q + 1 + slice], v6 = data[q + 1 + nx + slice], v7 = data[q + nx + slice];
        let ci = 0;
        if (v0 < iso) ci |= 1;
        if (v1 < iso) ci |= 2;
        if (v2 < iso) ci |= 4;
        if (v3 < iso) ci |= 8;
        if (v4 < iso) ci |= 16;
        if (v5 < iso) ci |= 32;
        if (v6 < iso) ci |= 64;
        if (v7 < iso) ci |= 128;
        const bits = edgeTable[ci];
        if (bits === 0) continue;
        const s = i + nx * j;
        if (bits & 1) { if (xA[s] < 0) xA[s] = vert(i, j, k, v0, i + 1, j, k, v1); ev[0] = xA[s]; }
        if (bits & 2) { const t = s + 1; if (yA[t] < 0) yA[t] = vert(i + 1, j, k, v1, i + 1, j + 1, k, v2); ev[1] = yA[t]; }
        if (bits & 4) { const t = s + nx; if (xA[t] < 0) xA[t] = vert(i, j + 1, k, v3, i + 1, j + 1, k, v2); ev[2] = xA[t]; }
        if (bits & 8) { if (yA[s] < 0) yA[s] = vert(i, j, k, v0, i, j + 1, k, v3); ev[3] = yA[s]; }
        if (bits & 16) { if (xB[s] < 0) xB[s] = vert(i, j, k + 1, v4, i + 1, j, k + 1, v5); ev[4] = xB[s]; }
        if (bits & 32) { const t = s + 1; if (yB[t] < 0) yB[t] = vert(i + 1, j, k + 1, v5, i + 1, j + 1, k + 1, v6); ev[5] = yB[t]; }
        if (bits & 64) { const t = s + nx; if (xB[t] < 0) xB[t] = vert(i, j + 1, k + 1, v7, i + 1, j + 1, k + 1, v6); ev[6] = xB[t]; }
        if (bits & 128) { if (yB[s] < 0) yB[s] = vert(i, j, k + 1, v4, i, j + 1, k + 1, v7); ev[7] = yB[s]; }
        if (bits & 256) { if (zE[s] < 0) zE[s] = vert(i, j, k, v0, i, j, k + 1, v4); ev[8] = zE[s]; }
        if (bits & 512) { const t = s + 1; if (zE[t] < 0) zE[t] = vert(i + 1, j, k, v1, i + 1, j, k + 1, v5); ev[9] = zE[t]; }
        if (bits & 1024) { const t = s + 1 + nx; if (zE[t] < 0) zE[t] = vert(i + 1, j + 1, k, v2, i + 1, j + 1, k + 1, v6); ev[10] = zE[t]; }
        if (bits & 2048) { const t = s + nx; if (zE[t] < 0) zE[t] = vert(i, j + 1, k, v3, i, j + 1, k + 1, v7); ev[11] = zE[t]; }
        const o = ci * 16;
        for (let n = 0; triTable[o + n] !== -1; n += 3) {
          // Winding chosen so faces point outward for negative-inside fields.
          idx.push(ev[triTable[o + n]], ev[triTable[o + n + 2]], ev[triTable[o + n + 1]]);
        }
      }
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

export function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const abx = positions[b] - positions[a], aby = positions[b + 1] - positions[a + 1], abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a], acy = positions[c + 1] - positions[a + 1], acz = positions[c + 2] - positions[a + 2];
    const fx = aby * acz - abz * acy, fy = abz * acx - abx * acz, fz = abx * acy - aby * acx;
    n[a] += fx; n[a + 1] += fy; n[a + 2] += fz;
    n[b] += fx; n[b + 1] += fy; n[b + 2] += fz;
    n[c] += fx; n[c + 1] += fy; n[c + 2] += fz;
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

/** Taubin smoothing (shrink-free Laplacian) to soften the voxel look. */
export function smoothMesh(positions: Float32Array, indices: Uint32Array, iterations = 2): void {
  const nv = positions.length / 3;
  // Build adjacency (CSR)
  const deg = new Uint32Array(nv);
  for (let t = 0; t < indices.length; t += 3) {
    deg[indices[t]] += 2; deg[indices[t + 1]] += 2; deg[indices[t + 2]] += 2;
  }
  const start = new Uint32Array(nv + 1);
  for (let i = 0; i < nv; i++) start[i + 1] = start[i] + deg[i];
  const adj = new Uint32Array(start[nv]);
  const fill = start.slice(0, nv);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    adj[fill[a]++] = b; adj[fill[a]++] = c;
    adj[fill[b]++] = a; adj[fill[b]++] = c;
    adj[fill[c]++] = a; adj[fill[c]++] = b;
  }
  const tmp = new Float32Array(positions.length);
  const pass = (lambda: number) => {
    for (let v = 0; v < nv; v++) {
      const s = start[v], e = start[v + 1];
      if (e === s) { tmp[v * 3] = positions[v * 3]; tmp[v * 3 + 1] = positions[v * 3 + 1]; tmp[v * 3 + 2] = positions[v * 3 + 2]; continue; }
      let ax = 0, ay = 0, az = 0;
      for (let q = s; q < e; q++) {
        const u = adj[q] * 3;
        ax += positions[u]; ay += positions[u + 1]; az += positions[u + 2];
      }
      const inv = 1 / (e - s);
      const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
      tmp[v * 3] = px + lambda * (ax * inv - px);
      tmp[v * 3 + 1] = py + lambda * (ay * inv - py);
      tmp[v * 3 + 2] = pz + lambda * (az * inv - pz);
    }
    positions.set(tmp);
  };
  for (let it = 0; it < iterations; it++) {
    pass(0.5);
    pass(-0.53);
  }
}

export function meshFromGrid(g: Grid, smoothIterations = 2): MeshData {
  const { positions, indices } = polygonize(g);
  if (smoothIterations > 0 && indices.length) smoothMesh(positions, indices, smoothIterations);
  return { positions, normals: computeNormals(positions, indices), indices };
}

export function meshFromShape(shape: Shape, step: number, smoothIterations = 2): MeshData {
  const g = sampleShape(shape, shape.box, step);
  return meshFromGrid(g, smoothIterations);
}
