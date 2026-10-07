// Signed distance field toolkit used to generate the anatomy meshes.
// Distances are in metres, negative inside. Shapes carry a bounding box so
// unions can skip far-away primitives cheaply.

export type V3 = [number, number, number];

export interface Box {
  min: V3;
  max: V3;
}

export interface Shape {
  d(x: number, y: number, z: number): number;
  box: Box;
}

const EMPTY_BOX: Box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };

export function boxUnion(a: Box, b: Box): Box {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

export function boxExpand(b: Box, m: number): Box {
  return {
    min: [b.min[0] - m, b.min[1] - m, b.min[2] - m],
    max: [b.max[0] + m, b.max[1] + m, b.max[2] + m],
  };
}

export function boxIntersect(a: Box, b: Box): Box {
  return {
    min: [Math.max(a.min[0], b.min[0]), Math.max(a.min[1], b.min[1]), Math.max(a.min[2], b.min[2])],
    max: [Math.min(a.max[0], b.max[0]), Math.min(a.max[1], b.max[1]), Math.min(a.max[2], b.max[2])],
  };
}

/** Distance from a point to an axis-aligned box (0 inside). Lower bound for any shape inside the box. */
export function boxDist(b: Box, x: number, y: number, z: number): number {
  return Math.sqrt(boxDist2(b, x, y, z));
}

/** Squared distance from a point to an axis-aligned box. */
export function boxDist2(b: Box, x: number, y: number, z: number): number {
  const mn = b.min, mx = b.max;
  const dx = x < mn[0] ? mn[0] - x : x > mx[0] ? x - mx[0] : 0;
  const dy = y < mn[1] ? mn[1] - y : y > mx[1] ? y - mx[1] : 0;
  const dz = z < mn[2] ? mn[2] - z : z > mx[2] ? z - mx[2] : 0;
  return dx * dx + dy * dy + dz * dz;
}

// ---------------------------------------------------------------- vectors

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3): number => Math.sqrt(dot(a, a));
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp3 = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const mirror = (a: V3): V3 => [-a[0], a[1], a[2]];

export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------- frames

/** Orthonormal frame given a primary axis; returns rows [u, v, w] with w = axis. */
export function frameFromAxis(axis: V3, hint: V3 = [0, 0, 1]): [V3, V3, V3] {
  const w = norm(axis);
  let h = hint;
  if (Math.abs(dot(w, norm(h))) > 0.95) h = [1, 0, 0];
  const u = norm(cross(h, w));
  const v = cross(w, u);
  return [u, v, w];
}

/** Rotation matrix rows from Euler angles (radians), applied X then Y then Z. */
export function eulerRows(rx: number, ry: number, rz: number): [V3, V3, V3] {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Rz * Ry * Rx ; we need its transpose rows to go world->local.
  const m: [V3, V3, V3] = [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
  // columns of m are local axes expressed in world; rows of transpose = columns of m
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

// ---------------------------------------------------------------- primitives

export function sphere(c: V3, r: number): Shape {
  const [cx, cy, cz] = c;
  return {
    d: (x, y, z) => Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) - r,
    box: { min: [cx - r, cy - r, cz - r], max: [cx + r, cy + r, cz + r] },
  };
}

/**
 * Ellipsoid with radii r. `rows` optionally rotates it: rows are the local
 * axes (unit vectors in world space) that the radii apply to.
 */
export function ellipsoid(c: V3, r: V3, rows?: [V3, V3, V3]): Shape {
  const [cx, cy, cz] = c;
  const [a, b, e] = r;
  const R = rows ?? [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const [u, v, w] = R;
  const ext = (i: number) =>
    Math.sqrt((u[i] * a) ** 2 + (v[i] * b) ** 2 + (w[i] * e) ** 2);
  const ex = ext(0), ey = ext(1), ez = ext(2);
  const ia = 1 / a, ib = 1 / b, ie = 1 / e;
  const ia2 = ia * ia, ib2 = ib * ib, ie2 = ie * ie;
  const [u0, u1, u2] = u, [v0, v1, v2] = v, [w0, w1, w2] = w;
  const minR = Math.min(a, b, e);
  return {
    d: (x, y, z) => {
      const px = x - cx, py = y - cy, pz = z - cz;
      const lx = px * u0 + py * u1 + pz * u2;
      const ly = px * v0 + py * v1 + pz * v2;
      const lz = px * w0 + py * w1 + pz * w2;
      const qx = lx * ia, qy = ly * ib, qz = lz * ie;
      const k0 = Math.sqrt(qx * qx + qy * qy + qz * qz);
      const rx = lx * ia2, ry = ly * ib2, rz = lz * ie2;
      const k1 = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (k1 === 0) return -minR;
      return (k0 * (k0 - 1)) / k1;
    },
    box: { min: [cx - ex, cy - ey, cz - ez], max: [cx + ex, cy + ey, cz + ez] },
  };
}

/** Ellipsoid whose long axis (radius `rl`) runs from a to b, with cross radii r1 (along `side`) and r2. */
export function ellipsoidBetween(a: V3, b: V3, r1: number, r2: number, side: V3 = [1, 0, 0]): Shape {
  const c = lerp3(a, b, 0.5);
  const axis = sub(b, a);
  const rl = len(axis) / 2;
  const w = norm(axis);
  let s = sub(side, scale(w, dot(side, w)));
  if (len(s) < 1e-6) s = frameFromAxis(w)[0];
  const u = norm(s);
  const v = cross(w, u);
  return ellipsoid(c, [r1, r2, rl], [u, v, w]);
}

/** Round cone (capsule with different end radii) from a (radius r1) to b (radius r2). Exact SDF. */
export function roundCone(a: V3, b: V3, r1: number, r2: number): Shape {
  const ba = sub(b, a);
  const l2 = dot(ba, ba);
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const [ax, ay, az] = a;
  const [bx, by, bz] = ba;
  const box = boxUnion(
    { min: [a[0] - r1, a[1] - r1, a[2] - r1], max: [a[0] + r1, a[1] + r1, a[2] + r1] },
    { min: [b[0] - r2, b[1] - r2, b[2] - r2], max: [b[0] + r2, b[1] + r2, b[2] + r2] },
  );
  return {
    d: (x, y, z) => {
      const px = x - ax, py = y - ay, pz = z - az;
      const yv = px * bx + py * by + pz * bz;
      const zv = yv - l2;
      const qx = px * l2 - bx * yv, qy = py * l2 - by * yv, qz = pz * l2 - bz * yv;
      const x2 = qx * qx + qy * qy + qz * qz;
      const y2 = yv * yv * l2;
      const z2 = zv * zv * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
      if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
      return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - r1;
    },
    box,
  };
}

export function capsule(a: V3, b: V3, r: number): Shape {
  return roundCone(a, b, r, r);
}

/** Chain of round cones through points with per-point radii, smoothly blended. */
export function chain(points: V3[], radii: number[] | number, k = 0): Shape {
  const parts: Shape[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const r1 = typeof radii === 'number' ? radii : radii[i];
    const r2 = typeof radii === 'number' ? radii : radii[i + 1];
    parts.push(roundCone(points[i], points[i + 1], r1, r2));
  }
  return union(parts, k);
}

/** Thick rounded triangle (plate) — used for flat bones like the scapula and ilium. */
export function triPlate(a: V3, b: V3, c: V3, thickness: number): Shape {
  const ba = sub(b, a), cb = sub(c, b), ac = sub(a, c);
  const nor = cross(ba, ac);
  const box = boxExpand(boxUnion(boxUnion(pointBox(a), pointBox(b)), pointBox(c)), thickness);
  const d2seg = (p: V3, o: V3, e: V3) => {
    const po = sub(p, o);
    const h = clamp(dot(e, po) / dot(e, e), 0, 1);
    const q = sub(scale(e, h), po);
    return dot(q, q);
  };
  return {
    d: (x, y, z) => {
      const p: V3 = [x, y, z];
      const pa = sub(p, a), pb = sub(p, b), pc = sub(p, c);
      const s =
        Math.sign(dot(cross(ba, nor), pa)) +
        Math.sign(dot(cross(cb, nor), pb)) +
        Math.sign(dot(cross(ac, nor), pc));
      let dd: number;
      if (s < 2) {
        dd = Math.min(d2seg(p, a, ba), d2seg(p, b, cb), d2seg(p, c, ac));
      } else {
        const t = dot(nor, pa);
        dd = (t * t) / dot(nor, nor);
      }
      return Math.sqrt(dd) - thickness;
    },
    box,
  };
}

function pointBox(p: V3): Box {
  return { min: [p[0], p[1], p[2]], max: [p[0], p[1], p[2]] };
}

/** Infinite half-space: inside where dot(p - o, n) < 0. Box must be provided by the caller's intersection. */
export function halfSpace(o: V3, n: V3): Shape {
  const nn = norm(n);
  return {
    d: (x, y, z) => (x - o[0]) * nn[0] + (y - o[1]) * nn[1] + (z - o[2]) * nn[2],
    box: { min: [-Infinity, -Infinity, -Infinity], max: [Infinity, Infinity, Infinity] },
  };
}

// ---------------------------------------------------------------- combinators

/** Smooth union with optional per-shape blend radius. Skips shapes whose box is too far to matter. */
export function union(shapes: Shape[], k: number | number[] = 0): Shape {
  if (shapes.length === 1 && (typeof k === 'number' || k.length <= 1)) return shapes[0];
  const ks = shapes.map((_, i) => (typeof k === 'number' ? k : k[i] ?? 0));
  let box = EMPTY_BOX;
  for (const s of shapes) box = boxUnion(box, s.box);
  const n = shapes.length;
  return {
    d: (x, y, z) => {
      let d = Infinity;
      for (let i = 0; i < n; i++) {
        const s = shapes[i];
        const ki = ks[i];
        if (d !== Infinity) {
          const lim = d + ki;
          if (lim < 0 || boxDist2(s.box, x, y, z) > lim * lim) continue;
        }
        const di = s.d(x, y, z);
        d = d === Infinity ? di : smin(d, di, ki);
      }
      return d;
    },
    box,
  };
}

/** a minus b, smoothed by k. */
export function subtract(a: Shape, b: Shape, k = 0): Shape {
  return {
    d: (x, y, z) => {
      const da = a.d(x, y, z);
      if (boxDist(b.box, x, y, z) > Math.abs(da) + k) return da;
      return smax(da, -b.d(x, y, z), k);
    },
    box: a.box,
  };
}

export function intersect(a: Shape, b: Shape, k = 0): Shape {
  return {
    d: (x, y, z) => smax(a.d(x, y, z), b.d(x, y, z), k),
    box: boxIntersect(a.box, b.box),
  };
}

/** Hollow shell of thickness t around a shape's surface. */
export function shell(a: Shape, t: number): Shape {
  return {
    d: (x, y, z) => Math.abs(a.d(x, y, z)) - t,
    box: boxExpand(a.box, t),
  };
}

/** Add a displacement (e.g. noise) to a shape's distance. Amplitude bounds the box growth. */
export function displace(a: Shape, amp: number, f: (x: number, y: number, z: number) => number): Shape {
  return {
    d: (x, y, z) => a.d(x, y, z) + f(x, y, z),
    box: boxExpand(a.box, amp),
  };
}

export function mirrorShape(a: Shape): Shape {
  return {
    d: (x, y, z) => a.d(-x, y, z),
    box: { min: [-a.box.max[0], a.box.min[1], a.box.min[2]], max: [-a.box.min[0], a.box.max[1], a.box.max[2]] },
  };
}
