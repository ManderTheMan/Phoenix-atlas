// Shared anatomical landmarks. Units are metres; the body stands on y = 0,
// faces +z, and the person's LEFT side is +x. Left-side landmarks are given;
// the right side is mirrored.
import { add, cross, norm, scale, sub, type V3 } from './sdf';

export const HEIGHT = 1.78;

// Arm (left) joint centres
export const SHOULDER: V3 = [0.185, 1.405, -0.02];
export const ELBOW: V3 = [0.258, 1.125, -0.022];
export const WRIST: V3 = [0.322, 0.878, 0.012];

// Leg (left) joint centres
export const HIP: V3 = [0.087, 0.925, 0.0];
export const KNEE: V3 = [0.1, 0.495, -0.002];
export const ANKLE: V3 = [0.1, 0.075, -0.015];

/** Hand frame: d = toward fingertips, l = toward thumb (lateral), n = palm normal (anterior). */
export function handFrame(): { o: V3; d: V3; l: V3; n: V3 } {
  const d = norm(sub(WRIST, ELBOW));
  const x: V3 = [1, 0, 0];
  const l = norm(sub(x, scale(d, d[0])));
  const n = norm(cross(d, l));
  return { o: WRIST, d, l, n };
}

/** Point in hand coordinates (along fingers, toward thumb, toward palm side). */
export function handPt(a: number, b: number, c: number): V3 {
  const f = handFrame();
  return add(add(add(f.o, scale(f.d, a)), scale(f.l, b)), scale(f.n, c));
}

export interface Finger {
  name: string;
  base: V3; // metacarpal base
  knuckle: V3;
  joints: V3[]; // PIP, DIP, tip
}

export function fingers(): Finger[] {
  const spec = [
    { name: 'index', off: 0.022, lens: [0.04, 0.025, 0.019] },
    { name: 'middle', off: 0.006, lens: [0.045, 0.028, 0.02] },
    { name: 'ring', off: -0.01, lens: [0.042, 0.026, 0.019] },
    { name: 'little', off: -0.025, lens: [0.033, 0.02, 0.017] },
  ];
  const f = handFrame();
  return spec.map((s) => {
    const base = handPt(0.022, s.off * 0.75, 0.0);
    const knuckle = handPt(s.name === 'little' ? 0.082 : s.name === 'index' ? 0.088 : 0.092, s.off, 0.002);
    const joints: V3[] = [];
    let p = knuckle;
    // gentle flexion toward the palm
    const flex = [0.12, 0.22, 0.3];
    let dir = f.d;
    s.lens.forEach((L, i) => {
      dir = norm(add(scale(dir, Math.cos(flex[i])), scale(f.n, Math.sin(flex[i]))));
      // fan fingers slightly apart
      const fan = scale(f.l, s.off * 0.6);
      p = add(add(p, scale(dir, L)), scale(fan, L / 0.04 * 0.25));
      joints.push(p);
    });
    return { name: s.name, base, knuckle, joints };
  });
}

export function thumb(): { base: V3; joints: V3[] } {
  const f = handFrame();
  const base = handPt(0.012, 0.02, 0.006);
  const dir1 = norm(add(add(scale(f.d, 0.62), scale(f.l, 0.55)), scale(f.n, 0.55)));
  const m = add(base, scale(dir1, 0.042));
  const dir2 = norm(add(add(scale(f.d, 0.75), scale(f.l, 0.25)), scale(f.n, 0.6)));
  const p1 = add(m, scale(dir2, 0.031));
  const dir3 = norm(add(add(scale(f.d, 0.8), scale(f.l, 0.05)), scale(f.n, 0.6)));
  const tip = add(p1, scale(dir3, 0.024));
  return { base, joints: [m, p1, tip] };
}

// Foot (left)
export interface Toe {
  base: V3;
  head: V3;
  joints: V3[];
  r: number;
}

export function toes(): Toe[] {
  const out: Toe[] = [];
  for (let t = 0; t < 5; t++) {
    const x = 0.083 + t * 0.0105 + (t === 0 ? -0.004 : 0);
    const base: V3 = [0.088 + t * 0.008, 0.042 - t * 0.003, 0.05 - t * 0.004];
    const head: V3 = [x, 0.016, 0.135 - t * 0.008 - (t > 0 ? 0.004 : 0)];
    const lens = t === 0 ? [0.03, 0.024] : [0.022 - t * 0.002, 0.012, 0.01];
    const joints: V3[] = [];
    let p = head;
    for (const L of lens) {
      p = add(p, [0.0015 * (t - 1), -0.001, L]);
      joints.push(p);
    }
    out.push({ base, head, joints, r: t === 0 ? 0.0075 : 0.0048 - t * 0.0003 });
  }
  return out;
}

// --------------------------------------------------------------- spine

/** Antero-posterior position (z) of the vertebral body centres as a function of height. */
const SPINE_CTRL: [number, number][] = [
  [1.6, -0.012],
  [1.48, -0.03],
  [1.4, -0.046],
  [1.3, -0.056],
  [1.2, -0.05],
  [1.13, -0.04],
  [1.06, -0.03],
  [1.0, -0.031],
  [0.97, -0.042],
];

export function spineZ(y: number): number {
  const c = SPINE_CTRL;
  if (y >= c[0][0]) return c[0][1];
  for (let i = 0; i < c.length - 1; i++) {
    const [y0, z0] = c[i];
    const [y1, z1] = c[i + 1];
    if (y <= y0 && y >= y1) {
      const t = (y0 - y) / (y0 - y1);
      // Catmull-Rom through neighbours for a smooth S-curve
      const zm1 = i > 0 ? c[i - 1][1] : z0;
      const z2 = i + 2 < c.length ? c[i + 2][1] : z1;
      const t2 = t * t, t3 = t2 * t;
      return 0.5 * (2 * z0 + (-zm1 + z1) * t + (2 * zm1 - 5 * z0 + 4 * z1 - z2) * t2 + (-zm1 + 3 * z0 - 3 * z1 + z2) * t3);
    }
  }
  return c[c.length - 1][1];
}

export interface Vertebra {
  id: string;
  name: string;
  region: 'cervical' | 'thoracic' | 'lumbar';
  c: V3; // body centre
  r: number; // body radius
  h: number; // half height
}

export function vertebrae(): Vertebra[] {
  const out: Vertebra[] = [];
  for (let i = 0; i < 7; i++) {
    const y = 1.585 - i * 0.0182;
    out.push({ id: `c${i + 1}`, name: `C${i + 1} vertebra`, region: 'cervical', c: [0, y, spineZ(y)], r: 0.0085 + i * 0.0004, h: 0.0062 });
  }
  for (let i = 0; i < 12; i++) {
    const y = 1.456 - i * 0.0264;
    out.push({ id: `t${i + 1}`, name: `T${i + 1} vertebra`, region: 'thoracic', c: [0, y, spineZ(y)], r: 0.011 + i * 0.00045, h: 0.009 + i * 0.0002 });
  }
  for (let i = 0; i < 5; i++) {
    const y = 1.137 - i * 0.0335;
    out.push({ id: `l${i + 1}`, name: `L${i + 1} vertebra`, region: 'lumbar', c: [0, y, spineZ(y)], r: 0.0175 + i * 0.0005, h: 0.0115 });
  }
  return out;
}

/** Centre line of the vertebral canal (where the spinal cord runs). */
export function canalPoint(y: number): V3 {
  const back = y > 1.48 ? 0.017 : y > 1.15 ? 0.022 : 0.026;
  return [0, y, spineZ(y) - back];
}

// --------------------------------------------------------------- ribs

export interface RibSpec {
  n: number;
  yBack: number;
  a: number; // half width
  b: number; // half depth
  z0: number; // ellipse centre z
  thetaEnd: number; // where the rib (incl. cartilage) ends, 0 = back, PI = front midline
  yFront: number;
  sag: number;
}

export function ribSpecs(): RibSpec[] {
  const A = [0.052, 0.078, 0.098, 0.112, 0.121, 0.127, 0.13, 0.13, 0.127, 0.121, 0.112, 0.1];
  const B = [0.046, 0.058, 0.068, 0.075, 0.08, 0.083, 0.084, 0.084, 0.083, 0.08, 0.075, 0.07];
  const yF = [1.43, 1.405, 1.378, 1.352, 1.325, 1.297, 1.268, 1.22, 1.18, 1.15, 1.13, 1.12];
  const tE = [0.93, 0.94, 0.94, 0.94, 0.94, 0.93, 0.92, 0.8, 0.74, 0.68, 0.5, 0.4];
  const sag = [0.004, 0.01, 0.016, 0.022, 0.028, 0.034, 0.04, 0.042, 0.04, 0.035, 0.02, 0.012];
  return A.map((a, i) => {
    const yBack = 1.456 - i * 0.0264;
    return { n: i + 1, yBack, a, b: B[i], z0: -0.006 + (i < 2 ? 0.01 : 0), thetaEnd: tE[i] * Math.PI, yFront: yF[i], sag: sag[i] };
  });
}

export function ribPoint(s: RibSpec, theta: number): V3 {
  const t = theta / Math.PI;
  const y = s.yBack + (s.yFront - s.yBack) * t - s.sag * Math.sin(theta);
  return [s.a * Math.sin(theta), y, s.z0 - s.b * Math.cos(theta)];
}

/** Points along a left rib from the costovertebral joint to its anterior end. */
export function ribPath(s: RibSpec, segments = 24): V3[] {
  const zs = spineZ(s.yBack);
  const pts: V3[] = [[0.012, s.yBack + 0.003, zs - 0.004]];
  const theta0 = Math.asin(Math.min(0.9, 0.034 / s.a));
  for (let i = 0; i <= segments; i++) {
    const th = theta0 + ((s.thetaEnd - theta0) * i) / segments;
    pts.push(ribPoint(s, th));
  }
  return pts;
}

export const STERNUM_TOP: V3 = [0, 1.432, 0.064];
export const STERNUM_BOTTOM: V3 = [0, 1.258, 0.08];
