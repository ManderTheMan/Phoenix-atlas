// Smoothing over part of a surface, at build time. Used by scripts/build-atlas.ts to
// give the reference body a smooth, mannequin-like groin in place of the external
// genitalia.
//
// The surface is seen from one direction as a height map: a grid of rays, each
// recording the nearest surface it meets. Where that is the part being replaced,
// the height is unknown and is filled in as a harmonic (soap-film) surface from the
// heights around it, which keeps the patch smooth and joined to its surroundings.

type V3 = [number, number, number];

export interface Surface {
  positions: number[];
  indices: number[];
}

export interface View {
  /** Unit direction towards the viewer; heights are measured along it. */
  toward: V3;
  /** Unit direction across the view (perpendicular to `toward`). */
  across: V3;
  /** Grid spacing (metres) and extent, in view coordinates. */
  cell: number;
  u: [number, number];
  v: [number, number];
}

export const NONE = 0, KNOWN = 1, HOLE = 2;

export interface HeightField {
  view: View;
  up: V3;
  nu: number;
  nv: number;
  /** Height at each node (row-major, u fastest). */
  h: Float64Array;
  state: Uint8Array;
  /** Height of the nearest thing inside the body along each ray (-Infinity where none). */
  inner: Float64Array;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** What each triangle given to `heightField` is. */
export const SURFACE = 0, REPLACED = 1, INTERIOR = 2;

/**
 * Heights of the nearest surface along a grid of rays. `tris` holds 9 numbers per
 * triangle and `kind` says what each one is: part of the surface that stays, part
 * that is replaced, or something inside the body (never drawn, only used to tell
 * the opening into the body from the gaps around it).
 *
 * A ray that meets the replaced part first is looked at again without it. If it
 * then meets the inside of the body first, it looks through the opening the
 * replaced part leaves: the patch has to cover it. If it meets other surface (the
 * part only overhung it), that surface stands; if nothing, it looked through a gap.
 */
export function heightField(view: View, tris: ArrayLike<number>, kind: ArrayLike<number>): HeightField {
  const up = cross(view.toward, view.across);
  const nu = Math.round((view.u[1] - view.u[0]) / view.cell) + 1;
  const nv = Math.round((view.v[1] - view.v[0]) / view.cell) + 1;
  // nearest hit of each kind
  const near = [SURFACE, REPLACED, INTERIOR].map(() => new Float64Array(nu * nv).fill(-Infinity));
  const n = tris.length / 9;
  for (let t = 0; t < n; t++) {
    const best = near[kind[t]];
    const q: number[][] = [];
    for (let k = 0; k < 3; k++) {
      const p: V3 = [tris[t * 9 + k * 3], tris[t * 9 + k * 3 + 1], tris[t * 9 + k * 3 + 2]];
      q.push([(dot(p, view.across) - view.u[0]) / view.cell, (dot(p, up) - view.v[0]) / view.cell, dot(p, view.toward)]);
    }
    const [a, b, c] = q;
    const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(det) < 1e-12) continue;
    const i0 = Math.max(0, Math.ceil(Math.min(a[0], b[0], c[0]))), i1 = Math.min(nu - 1, Math.floor(Math.max(a[0], b[0], c[0])));
    const j0 = Math.max(0, Math.ceil(Math.min(a[1], b[1], c[1]))), j1 = Math.min(nv - 1, Math.floor(Math.max(a[1], b[1], c[1])));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const wb = ((i - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (j - a[1])) / det;
        const wc = ((b[0] - a[0]) * (j - a[1]) - (i - a[0]) * (b[1] - a[1])) / det;
        if (wb < -1e-9 || wc < -1e-9 || wb + wc > 1 + 1e-9) continue;
        const z = a[2] + wb * (b[2] - a[2]) + wc * (c[2] - a[2]);
        const k = j * nu + i;
        if (z > best[k]) best[k] = z;
      }
  }
  const [hS, hR, inner] = near;
  const h = new Float64Array(nu * nv);
  const state = new Uint8Array(nu * nv);
  for (let k = 0; k < h.length; k++) {
    if (hS[k] > -Infinity && hS[k] >= hR[k]) (state[k] = KNOWN), (h[k] = hS[k]);
    else if (hR[k] > -Infinity) {
      if (inner[k] > hS[k]) state[k] = HOLE;
      else if (hS[k] > -Infinity) (state[k] = KNOWN), (h[k] = hS[k]);
    }
  }
  return { view, up, nu, nv, h, state, inner };
}

/** Solves Laplace's equation (plus a constant `source`, for a dome) over the hole, holding the known heights. */
function relax(f: HeightField, x: Float64Array, source: number, iterations: number) {
  const { nu, nv, state } = f;
  const nodes: number[] = [];
  const nbrs: number[][] = [];
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const k = j * nu + i;
      if (state[k] !== HOLE) continue;
      const nb: number[] = [];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < nu && jj < nv && state[jj * nu + ii] !== NONE) nb.push(jj * nu + ii);
      }
      if (nb.length) (nodes.push(k), nbrs.push(nb));
    }
  const omega = 1.9;
  for (let it = 0; it < iterations; it++)
    for (let n = 0; n < nodes.length; n++) {
      const nb = nbrs[n];
      let s = source;
      for (const kk of nb) s += x[kk];
      const k = nodes[n];
      x[k] += omega * (s / nb.length - x[k]);
    }
}

export interface FillOptions {
  /**
   * Follow what lies beneath (muscle, fascia, bone), at the depth the surrounding
   * surface sits above it, rather than spanning the hole with a flat film.
   */
  follow?: boolean;
  /** Passes of smoothing over the followed shape. */
  smooth?: number;
  /** Raise the middle by up to this much (metres), for a gentle dome rather than a taut film. */
  bulge?: number;
  iterations?: number;
}

/**
 * Fills the hole: a guide shape (flat, or what lies beneath at the usual depth) is
 * bent by a harmonic correction so it meets the heights around the hole exactly.
 */
export function fill(f: HeightField, o: FillOptions = {}) {
  const { nu, nv, h, state, inner } = f;
  const iterations = o.iterations ?? 2000;
  const guide = new Float64Array(h.length);
  let depth = 0;
  if (o.follow) {
    // how far the surface sits above what lies beneath, close around the hole
    const near = new Uint8Array(h.length);
    for (let k = 0; k < h.length; k++) if (state[k] === HOLE) near[k] = 1;
    for (let pass = 0; pass < 10; pass++) {
      const next = near.slice();
      for (let j = 0; j < nv; j++)
        for (let i = 0; i < nu; i++)
          if (near[j * nu + i])
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const ii = i + di, jj = j + dj;
              if (ii >= 0 && jj >= 0 && ii < nu && jj < nv) next[jj * nu + ii] = 1;
            }
      near.set(next);
    }
    const gaps: number[] = [];
    for (let k = 0; k < h.length; k++) if (near[k] && state[k] === KNOWN && inner[k] > -Infinity && h[k] - inner[k] > 0 && h[k] - inner[k] < 0.03) gaps.push(h[k] - inner[k]);
    gaps.sort((a, b) => a - b);
    depth = gaps.length ? gaps[gaps.length >> 1] : 0;
    for (let k = 0; k < h.length; k++) if (state[k] === HOLE) guide[k] = inner[k] + depth;
    // smooth the guide over the hole (its edge held), so the skin drapes rather than clings
    const smooth = o.smooth ?? 30;
    for (let pass = 0; pass < smooth; pass++) {
      const next = guide.slice();
      for (let j = 0; j < nv; j++)
        for (let i = 0; i < nu; i++) {
          const k = j * nu + i;
          if (state[k] !== HOLE) continue;
          let s = guide[k], m = 1;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= nu || jj >= nv || state[jj * nu + ii] !== HOLE) continue;
            s += guide[jj * nu + ii];
            m++;
          }
          next[k] = s / m;
        }
      guide.set(next);
    }
  }
  if (o.bulge) {
    const dome = new Float64Array(h.length);
    relax(f, dome, 1, iterations);
    let top = 0;
    for (const d of dome) top = Math.max(top, d);
    if (top > 0) for (let k = 0; k < h.length; k++) if (state[k] === HOLE) guide[k] += (o.bulge * dome[k]) / top;
  }
  // the guide where it meets the known heights (beyond the hole it is the hole's edge value)
  const x = new Float64Array(h.length);
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const k = j * nu + i;
      if (state[k] !== KNOWN) continue;
      let g = o.follow && inner[k] > -Infinity ? inner[k] + depth : NaN;
      if (Number.isNaN(g)) {
        // no guide beneath this node: use the nearest hole node's guide
        let s = 0, m = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < nu && jj < nv && state[jj * nu + ii] === HOLE) (s += guide[jj * nu + ii]), m++;
        }
        g = m ? s / m : h[k];
      }
      x[k] = h[k] - g;
    }
  relax(f, x, 0, iterations);
  for (let k = 0; k < h.length; k++) if (state[k] === HOLE) h[k] = guide[k] + x[k];
}

/**
 * Fills the hole, then lets go of any surrounding height that pulls the patch by more
 * than `jump` metres (a ray that grazed a steep surface or looked down a gap past
 * the hole's edge) and fills again, until the patch meets its surroundings evenly.
 */
export function fillEvenly(f: HeightField, o: FillOptions & { jump?: number; grow?: number } = {}) {
  const { nu, nv, h, state } = f;
  const jump = o.jump ?? 0.005;
  // reach a few cells past the edge, where the surface around the hole has stopped
  // curling into it, so the patch starts from its natural lie
  for (let pass = 0; pass < (o.grow ?? 0); pass++) {
    const next = state.slice();
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const k = j * nu + i;
        if (state[k] !== KNOWN) continue;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < nu && jj < nv && state[jj * nu + ii] === HOLE) {
            next[k] = HOLE;
            break;
          }
        }
      }
    state.set(next);
  }
  const known = h.slice();
  for (let round = 0; round < 6; round++) {
    for (let k = 0; k < h.length; k++) if (state[k] === KNOWN) h[k] = known[k];
    fill(f, o);
    let dropped = 0;
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const k = j * nu + i;
        if (state[k] !== KNOWN) continue;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nu || jj >= nv) continue;
          const kk = jj * nu + ii;
          if (state[kk] === HOLE && Math.abs(h[k] - h[kk]) > jump) {
            state[k] = NONE;
            dropped++;
            break;
          }
        }
      }
    if (!dropped) return;
  }
}

/** Whether node k is part of the patch: in the hole, or a known node beside it. */
function inPatch(f: HeightField, i: number, j: number) {
  const { nu, nv, state } = f;
  if (i < 0 || j < 0 || i >= nu || j >= nv) return false;
  const s = state[j * nu + i];
  if (s === HOLE) return true;
  if (s !== KNOWN) return false;
  for (let dj = -1; dj <= 1; dj++)
    for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < nu && jj < nv && state[jj * nu + ii] === HOLE) return true;
    }
  return false;
}

/**
 * The filled hole as a mesh facing the viewer, with a one-cell skirt over the
 * surrounding surface sunk by `inset` so that surface stays on top where they overlap.
 */
export function patch(f: HeightField, inset = 0.001): Surface {
  const { nu, nv, h, state, view, up } = f;
  const index = new Int32Array(nu * nv).fill(-1);
  const positions: number[] = [];
  const vertex = (i: number, j: number) => {
    const k = j * nu + i;
    if (index[k] < 0) {
      index[k] = positions.length / 3;
      const u = view.u[0] + i * view.cell, v = view.v[0] + j * view.cell;
      const w = h[k] - (state[k] === HOLE ? 0 : inset);
      for (let a = 0; a < 3; a++) positions.push(u * view.across[a] + v * up[a] + w * view.toward[a]);
    }
    return index[k];
  };
  const indices: number[] = [];
  for (let j = 0; j < nv - 1; j++)
    for (let i = 0; i < nu - 1; i++) {
      const corners = [
        [i, j],
        [i + 1, j],
        [i + 1, j + 1],
        [i, j + 1],
      ];
      if (!corners.every(([a, b]) => inPatch(f, a, b))) continue;
      if (!corners.some(([a, b]) => state[b * nu + a] === HOLE)) continue;
      const [p00, p10, p11, p01] = corners.map(([a, b]) => vertex(a, b));
      // counter-clockwise seen from the viewer, so the patch faces outwards
      indices.push(p00, p10, p11, p00, p11, p01);
    }
  return { positions, indices };
}

/** Whether a point lies in front of the filled hole (outside the smoothed surface) by more than `margin`. */
export function inFront(f: HeightField, p: V3, margin = 0.0005): boolean {
  const { nu, nv, h, state, view, up } = f;
  const x = (dot(p, view.across) - view.u[0]) / view.cell, y = (dot(p, up) - view.v[0]) / view.cell;
  const i = Math.floor(x), j = Math.floor(y);
  if (i < 0 || j < 0 || i >= nu - 1 || j >= nv - 1) return false;
  const ks = [j * nu + i, j * nu + i + 1, (j + 1) * nu + i, (j + 1) * nu + i + 1];
  if (!ks.some((k) => state[k] === HOLE) || ks.some((k) => state[k] === NONE)) return false;
  const fx = x - i, fy = y - j;
  const z = (h[ks[0]] * (1 - fx) + h[ks[1]] * fx) * (1 - fy) + (h[ks[2]] * (1 - fx) + h[ks[3]] * fx) * fy;
  return dot(p, view.toward) > z + margin;
}

/** Splits a surface into the triangles left (x ≥ 0) and right (x < 0) of the midline. */
export function splitByX(s: Surface): [Surface, Surface] {
  const parts: [Surface, Surface] = [
    { positions: [], indices: [] },
    { positions: [], indices: [] },
  ];
  const maps = [new Map<number, number>(), new Map<number, number>()];
  for (let t = 0; t < s.indices.length; t += 3) {
    const ids = [s.indices[t], s.indices[t + 1], s.indices[t + 2]];
    const cx = (s.positions[ids[0] * 3] + s.positions[ids[1] * 3] + s.positions[ids[2] * 3]) / 3;
    const side = cx >= 0 ? 0 : 1;
    for (const i of ids) {
      let j = maps[side].get(i);
      if (j === undefined) {
        j = parts[side].positions.length / 3;
        maps[side].set(i, j);
        parts[side].positions.push(s.positions[i * 3], s.positions[i * 3 + 1], s.positions[i * 3 + 2]);
      }
      parts[side].indices.push(j);
    }
  }
  return parts;
}

/**
 * Covers the opening left by the replaced part, seen from each view in turn: every
 * patch joins the surface for the views after it, so a later view only fills what
 * the earlier ones could not see.
 */
export function cover(tris: ArrayLike<number>, kind: ArrayLike<number>, views: View[], o: FillOptions & { jump?: number; grow?: number } = {}) {
  const T = Array.from(tris), K = Array.from(kind);
  const surface: Surface = { positions: [], indices: [] };
  const fields: HeightField[] = [];
  for (const view of views) {
    const f = heightField(view, T, K);
    if (!f.state.some((s) => s === HOLE)) continue;
    fillEvenly(f, o);
    const p = patch(f);
    const base = surface.positions.length / 3;
    surface.positions.push(...p.positions);
    for (const i of p.indices) surface.indices.push(i + base);
    for (const i of p.indices) T.push(p.positions[i * 3], p.positions[i * 3 + 1], p.positions[i * 3 + 2]);
    for (let t = 0; t < p.indices.length / 3; t++) K.push(SURFACE);
    fields.push(f);
  }
  return { surface, fields };
}
