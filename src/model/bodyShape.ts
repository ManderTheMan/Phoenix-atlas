// Fits the atlas body to someone's own measurements. The reference body is
// described by a simple skeleton (joint centres measured from the model, see
// scripts/build-landmarks.ts). Height scales the whole body; segment lengths
// move the joints; girths scale the soft tissue around each segment's axis.
// Every vertex follows the segments near it (up to three, blended by
// distance), and each structure may only follow the segments it can belong to,
// so a hand resting against the thigh doesn't drag the thigh along with it.
import landmarks from '../anatomy/landmarks.json';
import { STRUCTURE_BY_ID } from '../anatomy/catalog';
import type { LayerId } from '../anatomy/types';

export type V3 = [number, number, number];

const LM = landmarks as unknown as {
  joints: Record<string, V3>;
  /** Joint-centre lengths. */
  lengths: Record<string, number>;
  /** Lengths between the bony landmarks people measure. */
  measures: Record<string, number>;
  girths: Record<string, { y: number; cm: number }>;
  levels: Record<string, number>;
};

/** Measurements in centimetres (all optional). */
export interface ShapeInput {
  height?: number;
  shoulderWidth?: number;
  armSpan?: number;
  upperArm?: number;
  forearm?: number;
  hand?: number;
  thigh?: number;
  shank?: number;
  foot?: number;
  neck?: number;
  chest?: number;
  waist?: number;
  hips?: number;
  armL?: number;
  armR?: number;
  forearmL?: number;
  forearmR?: number;
  thighL?: number;
  thighR?: number;
  calfL?: number;
  calfR?: number;
}

export type ShapeKey = keyof ShapeInput;

/** The reference body's own measurements (tape-measure landmarks), in centimetres. */
export const REFERENCE: Record<ShapeKey, number> = {
  height: LM.measures.height * 100,
  shoulderWidth: LM.measures.shoulderWidth * 100,
  armSpan: LM.measures.armSpan * 100,
  upperArm: LM.measures.upperArm * 100,
  forearm: LM.measures.forearm * 100,
  hand: LM.measures.hand * 100,
  thigh: LM.measures.thigh * 100,
  shank: LM.measures.shank * 100,
  foot: LM.measures.foot * 100,
  neck: LM.girths.neck.cm,
  chest: LM.girths.chest.cm,
  waist: LM.girths.waist.cm,
  hips: LM.girths.hips.cm,
  armL: LM.girths.upperArm_l.cm,
  armR: LM.girths.upperArm_r.cm,
  forearmL: LM.girths.forearm_l.cm,
  forearmR: LM.girths.forearm_r.cm,
  thighL: LM.girths.thigh_l.cm,
  thighR: LM.girths.thigh_r.cm,
  calfL: LM.girths.calf_l.cm,
  calfR: LM.girths.calf_r.cm,
};

/** Body dimensions in metres, used by the movement models. */
export interface BodyDims {
  height: number;
  thigh: number;
  shank: number;
  foot: number;
  ankleHeight: number;
  /** Hip joint to shoulder joint. */
  torso: number;
  /** Shoulder joint to the top of the head. */
  headNeck: number;
  upperArm: number;
  forearm: number;
  hand: number;
  shoulderWidth: number;
  hipWidth: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---------------------------------------------------------------- segments

const SIDES = ['l', 'r'] as const;
type Side = (typeof SIDES)[number];

/** Segment list: [name, from joint, to joint]. */
const SEGMENTS: [string, string, string][] = [
  ['torso', 'pelvis', 'neck'],
  ['head', 'neck', 'head_top'],
  ...SIDES.flatMap((s): [string, string, string][] => [
    [`thigh_${s}`, `hip_${s}`, `knee_${s}`],
    [`shank_${s}`, `knee_${s}`, `ankle_${s}`],
    [`foot_${s}`, `ankle_${s}`, `toe_${s}`],
    [`upper_${s}`, `shoulder_${s}`, `elbow_${s}`],
    [`fore_${s}`, `elbow_${s}`, `wrist_${s}`],
    [`hand_${s}`, `wrist_${s}`, `fingertip_${s}`],
  ]),
];
const SEG = Object.fromEntries(SEGMENTS.map(([n], i) => [n, i])) as Record<string, number>;
const sideSeg = (s: Side, n: string) => SEG[`${n}_${s}`];

// Which segments a structure may follow. Limbs only follow their own limb (so
// a hand resting on the thigh doesn't move with the leg); everything else
// follows the torso and head, and the upper arm and thigh near the joints that
// attach them. The trunk rule depends only on position, so neighbouring
// structures (e.g. adjacent skin regions) always move together.
type BodyPart = 'trunk' | 'arm' | 'leg';

const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function candidates(part: BodyPart, s: Side, p: V3): [number, number][] {
  const t = SEG.torso;
  if (part === 'arm') return [t, sideSeg(s, 'upper'), sideSeg(s, 'fore'), sideSeg(s, 'hand')].map((i) => [i, 1]);
  if (part === 'leg') return [t, sideSeg(s, 'thigh'), sideSeg(s, 'shank'), sideSeg(s, 'foot')].map((i) => [i, 1]);
  // both sides are candidates (distance decides), so the midline never splits
  const out: [number, number][] = [
    [t, 1],
    [SEG.head, 1],
  ];
  for (const sd of SIDES) {
    const sh = LM.joints[`shoulder_${sd}`][1], hip = LM.joints[`hip_${sd}`][1];
    // the shoulder region follows the arm; the side of the chest and waist don't
    out.push([sideSeg(sd, 'upper'), smooth(sh - 0.17, sh - 0.06, p[1])]);
    // buttocks and groin follow the thigh; the belly doesn't
    out.push([sideSeg(sd, 'thigh'), 1 - smooth(hip, hip + 0.12, p[1])]);
  }
  return out;
}

const UPPER =
  /upper limb|of arm|forearm|antebrach|brachial region|brachii|brachialis|brachioradialis|cubital|elbow|carp|metacarp|of hand|digits of hand|palm|finger_of_hand|pollicis|indicis|radi(us|al|o)|uln(a|ar)|humer|anconeus|supinator|pronator|bicipital|wrist|cephalic|basilic|median_(nerve|vein)|musculocutaneous|radial_foveola|nail_plate_[lr]$|perionyx_[lr]$|thenar|lumbrical.*hand|interosse.*hand|dorsal_digital.*ulnar/;
const LOWER =
  /lower limb|thigh|femor|femur|patell|knee|popliteal|tibi|fibul|crural|of leg|leg region|gastrocnemius|soleus|plantar|ankle|talocrural|tars|talus|talo|calcane|navicular|cuboid|cuneiform|of foot|digits of foot|hallu|digitorum_(longus|brevis)|sole|heel|malleol|saphenous|sural|genicular|dorsalis_pedis|sciatic|adductor_(longus|brevis|magnus|minimus)|gracilis|sartorius|pectineus|vastus|biceps_femoris|semitendinosus|semimembranosus|iliotibial|tensor_fasciae|menisc|cruciate|nail_plate_foot|perionyx_foot/;
// structures whose names match a limb word but sit on the trunk
const TRUNK_EXCEPTIONS = /brachial_plexus|brachiocephalic|femoral_triangle|inguinal|deltoid|axillar|subclavi|pudendal/;

const partCache = new Map<string, BodyPart>();

/** Which part of the body a structure belongs to (decides the segments it follows). */
export function bodyPartOf(id: string): BodyPart {
  let p = partCache.get(id);
  if (p) return p;
  const def = STRUCTURE_BY_ID.get(id);
  const hay = `${id} ${def?.group ?? ''} ${def?.name ?? ''}`.toLowerCase();
  p = TRUNK_EXCEPTIONS.test(hay) ? 'trunk' : UPPER.test(hay) ? 'arm' : LOWER.test(hay) ? 'leg' : 'trunk';
  partCache.set(id, p);
  return p;
}

// ---------------------------------------------------------------- vertex weights

const EPS2 = 0.02 * 0.02;

function segDist(p: V3, a: V3, b: V3): number {
  const ab = sub(b, a);
  const t = clamp(dot(sub(p, a), ab) / dot(ab, ab), 0, 1);
  return len(sub(p, add(a, mul(ab, t))));
}

/** Up to three segments a point follows, with weights summing to 1. */
export function weightsFor(p: V3, part: BodyPart): [number, number][] {
  const s: Side = p[0] >= 0 ? 'l' : 'r';
  const cand = candidates(part, s, p)
    .filter(([, f]) => f > 0)
    .map(([i, f]): [number, number] => {
      const [, a, b] = SEGMENTS[i];
      const d = segDist(p, LM.joints[a], LM.joints[b]);
      return [i, f / (d * d + EPS2) ** 2];
    });
  cand.sort((x, y) => y[1] - x[1]);
  const top = cand.slice(0, 3);
  const sum = top.reduce((t, [, w]) => t + w, 0);
  return top.map(([i, w]) => [i, w / sum]);
}

// ---------------------------------------------------------------- the fitted body

interface SegXf {
  a: V3;
  u: V3;
  L: number;
  a2: V3;
  u2: V3;
  k: number;
  /** Rotation taking u to u2 (row-major 3×3). */
  R: number[];
  /** Girth factor along the segment: [t/L, factor] control points. */
  girth: [number, number][];
}

export interface BodyShape {
  key: string;
  /** Overall scale from height. */
  scale: number;
  /** Fitted joint positions (same names as the reference landmarks). */
  joints: Record<string, V3>;
  dims: BodyDims;
  /** Fitted position of a reference-space point. */
  deformPoint(p: V3, structureId?: string): V3;
  /** Fitted direction of a reference-space normal at a point. */
  deformNormal(p: V3, n: V3, structureId?: string): V3;
  /** Fitted position of a reference point with precomputed segment weights. */
  deformAt(p: V3, weights: [number, number][], girthExponent: number): V3;
  segs: SegXf[];
}

function rotation(u: V3, v: V3): number[] {
  const c = dot(u, v);
  const ax = cross(u, v);
  const s2 = dot(ax, ax);
  if (s2 < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const k = (1 - c) / s2;
  const [x, y, z] = ax;
  return [1 - k * (y * y + z * z), -z + k * x * y, y + k * x * z, z + k * x * y, 1 - k * (x * x + z * z), -x + k * y * z, -y + k * x * z, x + k * y * z, 1 - k * (x * x + y * y)];
}
const rot = (R: number[], v: V3): V3 => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];

function interp(ctrl: [number, number][], t: number): number {
  if (t <= ctrl[0][0]) return ctrl[0][1];
  for (let i = 1; i < ctrl.length; i++)
    if (t <= ctrl[i][0]) {
      const [t0, g0] = ctrl[i - 1], [t1, g1] = ctrl[i];
      return g0 + ((g1 - g0) * (t - t0)) / (t1 - t0 || 1);
    }
  return ctrl[ctrl.length - 1][1];
}

/** Bones barely change with girth; soft tissue follows it fully. */
const GIRTH_EXPONENT: Partial<Record<LayerId, number>> = { skeletal: 0.3 };

function hasAny(input: ShapeInput): boolean {
  return Object.values(input).some((v) => typeof v === 'number' && v > 0);
}

/** Body dimensions for the movement models (reference proportions scaled by height when not measured). */
export function bodyDims(input: ShapeInput = {}): BodyDims {
  const shape = computeBodyShape(input);
  if (shape) return shape.dims;
  const L = LM.lengths;
  return {
    height: L.height,
    thigh: L.thigh,
    shank: L.shank,
    foot: L.foot,
    ankleHeight: L.ankleHeight,
    torso: L.torso,
    headNeck: L.height - LM.joints.neck[1],
    upperArm: L.upperArm,
    forearm: L.forearm,
    hand: L.hand,
    shoulderWidth: L.shoulderWidth,
    hipWidth: L.hipWidth,
  };
}

const cache = new Map<string, BodyShape | null>();

export function shapeKey(input: ShapeInput): string {
  return JSON.stringify(
    Object.keys(REFERENCE)
      .map((k) => input[k as ShapeKey])
      .map((v) => (typeof v === 'number' && v > 0 ? Math.round(v * 10) / 10 : 0)),
  );
}

/** The fitted body for a set of measurements, or null when nothing is measured. */
export function computeBodyShape(input: ShapeInput): BodyShape | null {
  if (!hasAny(input)) return null;
  const key = shapeKey(input);
  if (cache.has(key)) return cache.get(key)!;
  const shape = build(input, key);
  cache.set(key, shape);
  return shape;
}

function build(input: ShapeInput, key: string): BodyShape {
  const R = REFERENCE;
  const J = LM.joints;
  const s = clamp((input.height ?? R.height) / R.height, 0.7, 1.35);
  const B = (n: string) => mul(J[n], s);
  // length ratios relative to the height-scaled reference
  const ratio = (k: ShapeKey, lo = 0.75, hi = 1.3) => clamp(input[k] ? input[k]! / (R[k] * s) : 1, lo, hi);
  let kUpper = ratio('upperArm'), kFore = ratio('forearm'), kHand = ratio('hand');
  if (input.armSpan && !input.upperArm && !input.forearm) {
    // wingspan scales the whole arm when the parts aren't measured
    // span ≈ shoulder width + 2 × (shoulder joint to fingertip)
    const sw = input.shoulderWidth ?? R.shoulderWidth * s;
    const armRef = (LM.lengths.upperArm + LM.lengths.forearm + LM.lengths.hand) * 100 * s;
    const k = clamp((input.armSpan - sw) / 2 / armRef, 0.8, 1.25);
    kUpper = kFore = k;
    if (!input.hand) kHand = k;
  }
  const kThigh = ratio('thigh'), kShank = ratio('shank'), kFoot = ratio('foot');
  // girth ratios
  const g = (k: ShapeKey) => clamp(input[k] ? input[k]! / (R[k] * s) : 1, 0.6, 1.8);
  const gNeck = g('neck'), gChest = g('chest'), gWaist = g('waist'), gHips = g('hips');
  const gArm = { l: g('armL'), r: g('armR') }, gFore = { l: g('forearmL'), r: g('forearmR') };
  const gThigh = { l: g('thighL'), r: g('thighR') }, gCalf = { l: g('calfL'), r: g('calfR') };

  // ---- fitted skeleton
  const j: Record<string, V3> = {};
  const wHip = 1 + (gHips - 1) * 0.6;
  for (const sd of SIDES) {
    const dx = B(`hip_${sd}`)[0] * (wHip - 1);
    j[`ankle_${sd}`] = add(B(`ankle_${sd}`), [dx, 0, 0]);
    j[`knee_${sd}`] = add(j[`ankle_${sd}`], mul(sub(B(`knee_${sd}`), B(`ankle_${sd}`)), kShank));
    j[`hip_${sd}`] = add(j[`knee_${sd}`], mul(sub(B(`hip_${sd}`), B(`knee_${sd}`)), kThigh));
    j[`toe_${sd}`] = add(j[`ankle_${sd}`], mul(sub(B(`toe_${sd}`), B(`ankle_${sd}`)), kFoot));
    j[`heel_${sd}`] = add(j[`ankle_${sd}`], mul(sub(B(`heel_${sd}`), B(`ankle_${sd}`)), kFoot));
  }
  j.pelvis = mul(add(j.hip_l, j.hip_r), 0.5);
  const torsoB = B('neck')[1] - B('pelvis')[1];
  const headB = B('head_top')[1] - B('neck')[1];
  const targetH = (input.height ?? R.height) / 100;
  const fTorso = clamp((targetH - j.pelvis[1] - headB) / torsoB, 0.8, 1.25);
  j.neck = add(j.pelvis, mul(sub(B('neck'), B('pelvis')), fTorso));
  j.head_top = add(j.neck, sub(B('head_top'), B('neck')));
  // shoulders move out with a broader chest (or a measured shoulder width)
  const wSh = input.shoulderWidth ? clamp(input.shoulderWidth / (R.shoulderWidth * s), 0.8, 1.3) : 1 + (gChest - 1) * 0.85;
  for (const sd of SIDES) {
    const off = sub(B(`shoulder_${sd}`), B('neck'));
    j[`shoulder_${sd}`] = add(j.neck, [off[0] * wSh, off[1] * fTorso, off[2]]);
    const armOff = (gArm[sd] - 1) * 0.045 * s;
    j[`shoulder_${sd}`][0] += (sd === 'l' ? 1 : -1) * armOff;
    let e = add(j[`shoulder_${sd}`], mul(sub(B(`elbow_${sd}`), B(`shoulder_${sd}`)), kUpper));
    let w = add(e, mul(sub(B(`wrist_${sd}`), B(`elbow_${sd}`)), kFore));
    let t = add(w, mul(sub(B(`fingertip_${sd}`), B(`wrist_${sd}`)), kHand));
    // swing the arm out a little if wider hips would push into the hand
    const need = (gHips - 1) * 0.17 * s + (gThigh[sd] - 1) * 0.07 * s - (j[`shoulder_${sd}`][0] - B(`shoulder_${sd}`)[0]) * (sd === 'l' ? 1 : -1);
    if (need > 0) {
      const sh = j[`shoulder_${sd}`];
      const ang = (sd === 'l' ? 1 : -1) * Math.atan(need / Math.max(0.3, sh[1] - w[1]));
      const c = Math.cos(ang), sn = Math.sin(ang);
      const swing = (p: V3): V3 => {
        const d = sub(p, sh);
        return add(sh, [d[0] * c - d[1] * sn, d[0] * sn + d[1] * c, d[2]]);
      };
      e = swing(e);
      w = swing(w);
      t = swing(t);
    }
    j[`elbow_${sd}`] = e;
    j[`wrist_${sd}`] = w;
    j[`fingertip_${sd}`] = t;
  }

  // ---- segment transforms
  const tOf = (seg: string, y: number) => {
    const [, a, b] = SEGMENTS[SEG[seg]];
    return (y * s - B(a)[1]) / (B(b)[1] - B(a)[1]);
  };
  const girthCtrl: Record<string, [number, number][]> = {
    torso: [
      [tOf('torso', LM.girths.hips.y), gHips],
      [tOf('torso', LM.girths.waist.y), gWaist],
      [tOf('torso', LM.girths.chest.y), gChest],
      [1, (gChest + gNeck) / 2],
    ],
    head: [
      [0, (gChest + gNeck) / 2],
      [tOf('head', LM.girths.neck.y), gNeck],
      [tOf('head', LM.girths.neck.y) + 0.12, 1],
      [1, 1],
    ],
  };
  for (const sd of SIDES) {
    const knee = (gThigh[sd] + gCalf[sd]) / 2, elbow = (gArm[sd] + gFore[sd]) / 2;
    girthCtrl[`thigh_${sd}`] = [[0, (gHips + gThigh[sd]) / 2], [0.5, gThigh[sd]], [1, knee]];
    girthCtrl[`shank_${sd}`] = [[0, knee], [clamp((J[`knee_${sd}`][1] - LM.girths[`calf_${sd}`].y) / (J[`knee_${sd}`][1] - J[`ankle_${sd}`][1]), 0.1, 0.6), gCalf[sd]], [1, 1 + (gCalf[sd] - 1) * 0.35]];
    girthCtrl[`foot_${sd}`] = [[0, 1]];
    girthCtrl[`upper_${sd}`] = [[0, (1 + gArm[sd]) / 2], [0.5, gArm[sd]], [1, elbow]];
    girthCtrl[`fore_${sd}`] = [[0, elbow], [0.3, gFore[sd]], [1, 1 + (gFore[sd] - 1) * 0.35]];
    girthCtrl[`hand_${sd}`] = [[0, 1]];
  }
  const segs: SegXf[] = SEGMENTS.map(([name, a, b]) => {
    const A = B(a), Bb = B(b);
    const A2 = j[a], B2 = j[b];
    const L = len(sub(Bb, A)), L2 = len(sub(B2, A2));
    const u = mul(sub(Bb, A), 1 / L), u2 = mul(sub(B2, A2), 1 / L2);
    return { a: A, u, L, a2: A2, u2, k: L2 / L, R: rotation(u, u2), girth: girthCtrl[name] };
  });

  const xf = (i: number, p: V3, exp: number): V3 => {
    const sg = segs[i];
    const d = sub(p, sg.a);
    const t = dot(d, sg.u);
    const r = sub(d, mul(sg.u, t));
    const gf = interp(sg.girth, t / sg.L) ** exp;
    return add(add(sg.a2, mul(sg.u2, t * sg.k)), mul(rot(sg.R, r), gf));
  };

  const deformAt = (pRef: V3, w: [number, number][], exp: number): V3 => {
    const p = mul(pRef, s);
    const out: V3 = [0, 0, 0];
    for (const [i, wt] of w) {
      const q = xf(i, p, exp);
      out[0] += q[0] * wt;
      out[1] += q[1] * wt;
      out[2] += q[2] * wt;
    }
    return out;
  };

  const deformPoint = (p: V3, id?: string) => deformAt(p, weightsFor(p, id ? bodyPartOf(id) : 'trunk'), 1);

  // every reference landmark, fitted
  const joints: Record<string, V3> = {};
  for (const [n, p] of Object.entries(J)) joints[n] = j[n] ?? deformPoint(p);

  const dist = (a: string, b: string) => (len(sub(j[`${a}_l`], j[`${b}_l`])) + len(sub(j[`${a}_r`], j[`${b}_r`]))) / 2;
  const dims: BodyDims = {
    height: j.head_top[1],
    thigh: dist('hip', 'knee'),
    shank: dist('knee', 'ankle'),
    foot: (len(sub(j.toe_l, j.heel_l)) + len(sub(j.toe_r, j.heel_r))) / 2,
    ankleHeight: (j.ankle_l[1] + j.ankle_r[1]) / 2,
    torso: j.neck[1] - j.pelvis[1],
    headNeck: j.head_top[1] - j.neck[1],
    upperArm: dist('shoulder', 'elbow'),
    forearm: dist('elbow', 'wrist'),
    hand: dist('wrist', 'fingertip'),
    shoulderWidth: joints.acromion_l[0] - joints.acromion_r[0],
    hipWidth: j.hip_l[0] - j.hip_r[0],
  };

  return {
    key,
    scale: s,
    joints,
    dims,
    segs,
    deformPoint,
    deformNormal(p, n, id) {
      const a = deformPoint(p, id), b = deformPoint(add(p, mul(n, 0.01)), id);
      const d = sub(b, a);
      const l = len(d) || 1;
      return mul(d, 1 / l);
    },
    deformAt,
  };
}

// ---------------------------------------------------------------- whole layers

interface LayerWeights {
  seg: Uint8Array;
  w: Float32Array;
}
const layerWeights = new WeakMap<Float32Array, LayerWeights>();

/** Per-vertex segment weights for a layer (computed once from the reference positions). */
export function vertexWeights(base: Float32Array, structOf: (v: number) => string): LayerWeights {
  let lw = layerWeights.get(base);
  if (lw) return lw;
  const n = base.length / 3;
  lw = { seg: new Uint8Array(n * 3), w: new Float32Array(n * 3) };
  let lastId = '', part: BodyPart = 'trunk';
  for (let v = 0; v < n; v++) {
    const id = structOf(v);
    if (id !== lastId) (part = bodyPartOf(id)), (lastId = id);
    const ws = weightsFor([base[v * 3], base[v * 3 + 1], base[v * 3 + 2]], part);
    for (let k = 0; k < 3; k++) {
      lw.seg[v * 3 + k] = ws[k]?.[0] ?? 0;
      lw.w[v * 3 + k] = ws[k]?.[1] ?? 0;
    }
  }
  layerWeights.set(base, lw);
  return lw;
}

/** Writes the fitted positions of a whole layer into `out`. */
export function deformPositions(shape: BodyShape, layer: LayerId, base: Float32Array, weights: LayerWeights, out: Float32Array): void {
  const exp = GIRTH_EXPONENT[layer] ?? 1;
  const n = base.length / 3;
  const w: [number, number][] = [
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  const p: V3 = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    for (let k = 0; k < 3; k++) {
      w[k][0] = weights.seg[v * 3 + k];
      w[k][1] = weights.w[v * 3 + k];
    }
    p[0] = base[v * 3];
    p[1] = base[v * 3 + 1];
    p[2] = base[v * 3 + 2];
    const q = shape.deformAt(p, w, exp);
    out[v * 3] = q[0];
    out[v * 3 + 1] = q[1];
    out[v * 3 + 2] = q[2];
  }
}
