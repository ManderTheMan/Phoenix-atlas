// Quasi-static biomechanics for the movement patterns. Each model poses a
// stick figure from your segment lengths at a point in the movement (phase 0
// = start, 1 = end of the range), then works out how far each joint sits from
// the line of the load (its moment arm) and the torque the muscles crossing
// that joint must produce to hold the position.
//
// Simplifications, all standard for this kind of estimate: movements are slow
// (no inertia), segments are rigid with masses and centres of mass from
// Winter's anthropometric tables, and both sides share bilateral loads evenly.
// The numbers are estimates of joint demand, not measurements of muscle activity.
import landmarks from '../anatomy/landmarks.json';
import type { BodyDims } from '../model/bodyShape';

export type P2 = [number, number];
type P3 = [number, number, number];

export const G = 9.81;
const deg = Math.PI / 180;

export type JointId = 'ankle' | 'knee' | 'hip' | 'lumbar' | 'shoulder' | 'elbow' | 'hipFrontal' | 'spineLateral' | 'spineAxial';

export interface JointResult {
  id: JointId;
  label: string;
  /** Torque the muscles must supply, N·m. Positive → `positive` muscles; negative → `negative` muscles. */
  demand: number;
  positive: string;
  negative: string;
  /** Moment arm of the main external load about the joint, metres. */
  arm: number;
  /** Demand is per leg / per arm. */
  perSide: boolean;
  /** View the joint is drawn in, its position, and where the perpendicular meets the load line. */
  view: number;
  at: P2;
  foot?: P2;
}

export interface Force2 {
  at: P2;
  /** Unit direction. */
  dir: P2;
  newtons: number;
  label: string;
}

export interface DiagramView {
  name: 'Side' | 'Front' | 'Top';
  points: Record<string, P2>;
  bones: [string, string][];
  forces: Force2[];
  floor?: number;
  bench?: [P2, P2];
  bar?: { at: P2; r: number };
  dumbbells?: P2[];
  com?: P2;
  base?: [number, number];
  overhead?: [P2, P2];
  anchor?: P2;
  /** Draw the figure as seen from this side (affects labels only). */
  facing?: 'right' | 'left';
}

export interface ModelInput {
  phase: number;
  dims: BodyDims;
  /** Body mass, kg. */
  mass: number;
  /** External load, kg (bar, dumbbells, band tension…). */
  load: number;
  options: Record<string, string>;
}

export interface ModelResult {
  views: DiagramView[];
  joints: JointResult[];
  warnings: string[];
}

// ---------------------------------------------------------------- body segments

/** Winter (2009): mass fractions and centre-of-mass positions from the proximal end. */
export const SEG = {
  foot: { m: 0.0145, com: 0.5 },
  shank: { m: 0.0465, com: 0.433 },
  thigh: { m: 0.1, com: 0.433 },
  trunk: { m: 0.497, com: 0.5 },
  /** Thorax + abdomen: the part of the trunk above L5–S1 (Dempster). */
  upperTrunk: { m: 0.355, com: 0.55 },
  headNeck: { m: 0.081, com: 0.5 },
  upperArm: { m: 0.028, com: 0.436 },
  forearm: { m: 0.016, com: 0.43 },
  hand: { m: 0.006, com: 0.506 },
};

const LMJ = (landmarks as unknown as { joints: Record<string, P3>; lengths: Record<string, number> }).joints;
const LML = (landmarks as unknown as { lengths: Record<string, number> }).lengths;
/** Heel and toe positions relative to the ankle, as fractions of foot length. */
const HEEL_BACK = (LMJ.ankle_l[2] - LMJ.heel_l[2]) / LML.foot;
const TOE_FRONT = (LMJ.toe_l[2] - LMJ.ankle_l[2]) / LML.foot;
/** Lumbosacral joint along the hip→shoulder line, as a fraction of that length. */
const L5_FRAC = (LMJ.l5s1[1] - LMJ.pelvis[1]) / (LMJ.neck[1] - LMJ.pelvis[1]);
/** L5–S1 sits behind the hip→shoulder line. */
const L5_BACK = LMJ.pelvis[2] - LMJ.l5s1[2];

const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const mul = (a: P2, k: number): P2 => [a[0] * k, a[1] * k];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp2 = (a: P2, b: P2, t: number): P2 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const dir = (angleFromVertical: number): P2 => [Math.sin(angleFromVertical), Math.cos(angleFromVertical)];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));

/** x of the centre of mass of point masses. */
function comX(items: { m: number; at: P2 }[]): number {
  let mx = 0, m = 0;
  for (const it of items) (mx += it.m * it.at[0]), (m += it.m);
  return m ? mx / m : 0;
}
function com(items: { m: number; at: P2 }[]): P2 {
  let x = 0, y = 0, m = 0;
  for (const it of items) (x += it.m * it.at[0]), (y += it.m * it.at[1]), (m += it.m);
  return m ? [x / m, y / m] : [0, 0];
}
/** Σ m·g·(x − x0): positive when the masses are in front of x0. */
function gravMoment(items: { m: number; at: P2 }[], x0: number): number {
  let s = 0;
  for (const it of items) s += it.m * G * (it.at[0] - x0);
  return s;
}

/** Bisection on a monotonic function; returns the x where f(x) ≈ 0 (clamped to the range). */
function solve(f: (x: number) => number, lo: number, hi: number): { x: number; ok: boolean } {
  let flo = f(lo);
  const fhi = f(hi);
  if (flo === 0) return { x: lo, ok: true };
  if (Math.sign(flo) === Math.sign(fhi)) return { x: Math.abs(flo) < Math.abs(fhi) ? lo : hi, ok: false };
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.sign(fm) === Math.sign(flo)) (lo = mid), (flo = fm);
    else hi = mid;
  }
  return { x: (lo + hi) / 2, ok: true };
}

function footGeom(d: BodyDims) {
  const heel = -HEEL_BACK * d.foot, toe = TOE_FRONT * d.foot;
  return { heel, toe, mid: (heel + toe) / 2 };
}

/** Perpendicular from a joint onto a vertical line at x. */
const vfoot = (j: P2, x: number): P2 => [x, j[1]];

// ---------------------------------------------------------------- squat

/** Where the load sits relative to the hip→shoulder line: along it (from the hip), and in front of it. */
const SQUAT_LOAD: Record<string, { along: number; front: number; knees: number; label: string }> = {
  // knees: how far the knees travel forward relative to hip flexion (shin angle ÷ thigh angle)
  highbar: { along: 0.06, front: -0.055, knees: 0.44, label: 'Bar on the upper traps' },
  lowbar: { along: -0.03, front: -0.075, knees: 0.34, label: 'Bar across the rear delts' },
  front: { along: 0.02, front: 0.075, knees: 0.52, label: 'Bar in the front rack' },
  goblet: { along: -0.13, front: 0.15, knees: 0.5, label: 'Weight held at the chest' },
};
const SQUAT_DEPTH: Record<string, number> = { half: 62, parallel: 96, deep: 118 };

interface StandingPose {
  A: P2;
  K: P2;
  H: P2;
  S: P2;
  L: P2;
  head: P2;
  u: P2;
  n: P2;
}

function standingPose(d: BodyDims, phiS: number, phiT: number, phiB: number): StandingPose {
  const A: P2 = [0, d.ankleHeight];
  const K = add(A, mul(dir(phiS), d.shank));
  const H = add(K, mul([-Math.sin(phiT), Math.cos(phiT)], d.thigh));
  const u = dir(phiB);
  const n: P2 = [Math.cos(phiB), -Math.sin(phiB)];
  const S = add(H, mul(u, d.torso));
  const L = add(add(H, mul(u, L5_FRAC * d.torso)), mul(n, -L5_BACK));
  const head = add(S, mul(u, d.headNeck * 0.62));
  return { A, K, H, S, L, head, u, n };
}

/** Segment masses as point masses (both legs together). */
function bodyItems(p: StandingPose, d: BodyDims, mass: number, armsAt: P2) {
  const sh = mass * SEG.shank.m * 2, th = mass * SEG.thigh.m * 2;
  return {
    shanks: { m: sh, at: lerp2(p.K, p.A, SEG.shank.com) },
    thighs: { m: th, at: lerp2(p.H, p.K, SEG.thigh.com) },
    trunk: { m: mass * SEG.trunk.m, at: lerp2(p.H, p.S, SEG.trunk.com) },
    upperTrunk: { m: mass * SEG.upperTrunk.m, at: lerp2(p.L, p.S, SEG.upperTrunk.com) },
    head: { m: mass * SEG.headNeck.m, at: add(p.S, mul(p.u, d.headNeck * SEG.headNeck.com)) },
    arms: { m: mass * 2 * (SEG.upperArm.m + SEG.forearm.m + SEG.hand.m), at: armsAt },
  };
}

function lowerBodyJoints(p: StandingPose, items: ReturnType<typeof bodyItems>, load: { m: number; at: P2 }, loadX: number, legShare = 0.5, kneeFlex = 90 * deg): JointResult[] {
  const aboveHip = [items.trunk, items.head, items.arms, load];
  // a straight knee is held by the joint itself, not the hamstrings
  const locked = (m: number) => (m < 0 ? m * clamp(kneeFlex / (12 * deg), 0, 1) : m);
  const aboveKnee = [items.thighs, ...aboveHip];
  const aboveAnkle = [items.shanks, ...aboveKnee];
  const aboveL5 = [items.upperTrunk, items.head, items.arms, load];
  return [
    { id: 'ankle', label: 'Ankle', demand: legShare * gravMoment(aboveAnkle, p.A[0]), positive: 'Calves (plantarflexors)', negative: 'Shin muscles (dorsiflexors)', arm: loadX - p.A[0], perSide: true, view: 0, at: p.A, foot: vfoot(p.A, loadX) },
    { id: 'knee', label: 'Knee', demand: locked(-legShare * gravMoment(aboveKnee, p.K[0])), positive: 'Quadriceps (knee extensors)', negative: 'Hamstrings (knee flexors)', arm: p.K[0] - loadX, perSide: true, view: 0, at: p.K, foot: vfoot(p.K, loadX) },
    { id: 'hip', label: 'Hip', demand: legShare * gravMoment(aboveHip, p.H[0]), positive: 'Glutes & hamstrings (hip extensors)', negative: 'Hip flexors', arm: loadX - p.H[0], perSide: true, view: 0, at: p.H, foot: vfoot(p.H, loadX) },
    { id: 'lumbar', label: 'Lower back', demand: gravMoment(aboveL5, p.L[0]), positive: 'Spinal erectors (extensors)', negative: 'Abdominals (flexors)', arm: loadX - p.L[0], perSide: false, view: 0, at: p.L, foot: vfoot(p.L, loadX) },
  ];
}

function standingView(p: StandingPose, d: BodyDims, extras: Partial<DiagramView>): DiagramView {
  const f = footGeom(d);
  const pts: Record<string, P2> = { toe: [f.toe, 0], heel: [f.heel, 0], ankle: p.A, knee: p.K, hip: p.H, lumbar: p.L, shoulder: p.S, head: p.head };
  return {
    name: 'Side',
    points: { ...pts, ...(extras.points ?? {}) },
    bones: [['heel', 'toe'], ['heel', 'ankle'], ['ankle', 'toe'], ['ankle', 'knee'], ['knee', 'hip'], ['hip', 'shoulder'], ['shoulder', 'head'], ...(extras.bones ?? [])],
    forces: extras.forces ?? [],
    floor: 0,
    base: [f.heel, f.toe],
    facing: 'right',
    ...Object.fromEntries(Object.entries(extras).filter(([k]) => !['points', 'bones', 'forces'].includes(k))),
  };
}

function squat(inp: ModelInput): ModelResult {
  const { dims: d, mass, load, options: o } = inp;
  const ld = SQUAT_LOAD[o.variant] ?? SQUAT_LOAD.highbar;
  const depth = (SQUAT_DEPTH[o.depth] ?? SQUAT_DEPTH.parallel) * deg;
  const dorsi = (Number(o.ankle) || 38) * deg;
  const t = ease(inp.phase);
  const phiT = depth * t;
  const phiS = Math.min(dorsi, ld.knees * phiT);
  const f = footGeom(d);
  const pose = (phiB: number) => {
    const p = standingPose(d, phiS, phiT, phiB);
    const bar = add(add(p.H, mul(p.u, d.torso + ld.along)), mul(p.n, ld.front));
    const items = bodyItems(p, d, mass, lerp2(p.S, bar, 0.5));
    return { p, bar, items };
  };
  const balance = (phiB: number) => {
    const { bar, items } = pose(phiB);
    return comX([...Object.values(items).filter((i) => i !== items.upperTrunk), { m: load, at: bar }]) - f.mid;
  };
  const sol = solve(balance, -15 * deg, 85 * deg);
  const { p, bar, items } = pose(sol.x);
  const loadItem = { m: load, at: bar };
  const joints = lowerBodyJoints(p, items, loadItem, bar[0], 0.5, phiS + phiT);
  const all = [...Object.values(items).filter((i) => i !== items.upperTrunk), loadItem];
  const warnings: string[] = [];
  if (!sol.ok) warnings.push('You can’t stay balanced over mid-foot in this position: more ankle mobility or a more upright load position would help.');
  const isBar = o.variant !== 'goblet';
  return {
    views: [
      standingView(p, d, {
        points: { hand: lerp2(p.S, bar, 0.9), elbow: add(lerp2(p.S, bar, 0.5), mul(p.n, isBar ? -0.12 : 0.06)) },
        bones: [['shoulder', 'elbow'], ['elbow', 'hand']],
        bar: isBar ? { at: bar, r: load > 20 ? 0.225 : 0.13 } : undefined,
        dumbbells: isBar ? undefined : [bar],
        forces: [{ at: bar, dir: [0, -1], newtons: load * G, label: `${Math.round(load)} kg` }],
        com: com(all),
      }),
    ],
    joints,
    warnings,
  };
}

// ---------------------------------------------------------------- hinge

function hinge(inp: ModelInput): ModelResult {
  const { dims: d, mass, load, options: o } = inp;
  const rdl = o.variant === 'rdl';
  const t = inp.phase;
  const f = footGeom(d);
  const armLen = d.upperArm + d.forearm + d.hand * 0.5;
  const phiS = rdl ? lerp(3, 11, Math.min(1, t * 3)) * deg : lerp(1, 17, t) * deg;
  // pose for a thigh angle: torso angle from balance, arms hanging straight down
  const poseFor = (phiT: number) => {
    const at = (phiB: number) => {
      const p = standingPose(d, phiS, phiT, phiB);
      const bar: P2 = [p.S[0], p.S[1] - armLen];
      const items = bodyItems(p, d, mass, lerp2(p.S, bar, 0.5));
      return { p, bar, items };
    };
    const sol = solve((phiB) => {
      const { bar, items } = at(phiB);
      return comX([...Object.values(items).filter((i) => i !== items.upperTrunk), { m: load, at: bar }]) - f.mid;
    }, -10 * deg, 95 * deg);
    return { ...at(sol.x), ok: sol.ok, phiB: sol.x };
  };
  const top = poseFor(0);
  const bottomTarget = rdl ? top.p.K[1] - 0.06 : 0.225;
  const target = lerp(top.bar[1], bottomTarget, ease(t));
  const solT = solve((phiT) => poseFor(phiT).bar[1] - target, 0, 115 * deg);
  const { p, bar, items, ok } = poseFor(solT.x);
  const loadItem = { m: load, at: bar };
  const joints = lowerBodyJoints(p, items, loadItem, bar[0], 0.5, phiS + solT.x);
  const warnings: string[] = [];
  if (!ok || !solT.ok) warnings.push(rdl ? 'Your proportions won’t reach this depth with soft knees.' : 'Your proportions can’t reach the floor in this setup.');
  const all = [...Object.values(items).filter((i) => i !== items.upperTrunk), loadItem];
  return {
    views: [
      standingView(p, d, {
        points: { hand: bar },
        bones: [['shoulder', 'hand']],
        bar: { at: bar, r: load > 20 ? 0.225 : 0.13 },
        forces: [{ at: bar, dir: [0, -1], newtons: load * G, label: `${Math.round(load)} kg` }],
        com: com(all),
      }),
    ],
    joints,
    warnings,
  };
}

// ---------------------------------------------------------------- split squat / lunge

function lunge(inp: ModelInput): ModelResult {
  const { dims: d, mass, load, options: o } = inp;
  const hipBias = o.variant === 'hip';
  const t = ease(inp.phase);
  const share = 0.8; // the front leg carries most of the weight
  const phiT = 88 * deg * t;
  const phiS = (hipBias ? 6 : 26) * deg * t;
  const phiB = (hipBias ? 28 : 6) * deg * t + 3 * deg;
  const p = standingPose(d, phiS, phiT, phiB);
  const f = footGeom(d);
  const armLen = d.upperArm + d.forearm + d.hand * 0.5;
  const hand: P2 = [p.S[0], p.S[1] - armLen];
  const items = bodyItems(p, d, mass, lerp2(p.S, hand, 0.5));
  // rear leg: knee drops behind the hip
  const rearKnee: P2 = [p.H[0] - Math.sin(phiT * 0.35 + 8 * deg) * d.thigh * 0.95, Math.max(0.06, p.H[1] - d.thigh * Math.cos(phiT * 0.35 + 8 * deg))];
  const rearAnkle: P2 = [rearKnee[0] - d.shank * 0.9, Math.max(0.07, rearKnee[1] - 0.12)];
  const loadItem = { m: load, at: hand };
  // the front foot carries most of the weight; its ground force points at the
  // centre of mass of everything it holds up (the usual two-support assumption)
  const held = [items.trunk, items.head, items.arms, loadItem, { m: mass * SEG.thigh.m, at: lerp2(p.H, p.K, SEG.thigh.com) }];
  const c = com(held);
  const cop: P2 = [f.mid, 0];
  const Wv = (held.reduce((t, it) => t + it.m, 0) + mass * (SEG.shank.m + SEG.foot.m)) * G * share;
  const Fx = (Wv * (c[0] - cop[0])) / Math.max(0.2, c[1] - cop[1]);
  const mag = Math.hypot(Fx, Wv);
  const u2: P2 = [Fx / mag, Wv / mag];
  const m2 = (j: P2) => (cop[0] - j[0]) * Wv - (cop[1] - j[1]) * Fx;
  const along = (j: P2): P2 => add(cop, mul(u2, (j[0] - cop[0]) * u2[0] + (j[1] - cop[1]) * u2[1]));
  const aboveL5 = [items.upperTrunk, items.head, items.arms, loadItem];
  const kneeFlex = phiS + phiT;
  const kneeM = -m2(p.K);
  const joints: JointResult[] = [
    { id: 'ankle', label: 'Front ankle', demand: m2(p.A), positive: 'Calves (plantarflexors)', negative: 'Shin muscles (dorsiflexors)', arm: m2(p.A) / mag, perSide: true, view: 0, at: p.A, foot: along(p.A) },
    { id: 'knee', label: 'Front knee', demand: kneeM < 0 ? kneeM * clamp(kneeFlex / (12 * deg), 0, 1) : kneeM, positive: 'Quadriceps (knee extensors)', negative: 'Hamstrings (knee flexors)', arm: -m2(p.K) / mag, perSide: true, view: 0, at: p.K, foot: along(p.K) },
    { id: 'hip', label: 'Front hip', demand: m2(p.H), positive: 'Glutes & hamstrings (hip extensors)', negative: 'Hip flexors', arm: m2(p.H) / mag, perSide: true, view: 0, at: p.H, foot: along(p.H) },
    { id: 'lumbar', label: 'Lower back', demand: gravMoment(aboveL5, p.L[0]), positive: 'Spinal erectors (extensors)', negative: 'Abdominals (flexors)', arm: hand[0] - p.L[0], perSide: false, view: 0, at: p.L, foot: vfoot(p.L, hand[0]) },
  ];
  return {
    views: [
      standingView(p, d, {
        points: { hand, rearKnee, rearAnkle, rearToe: [rearAnkle[0] + 0.05, 0] },
        bones: [['shoulder', 'hand'], ['hip', 'rearKnee'], ['rearKnee', 'rearAnkle'], ['rearAnkle', 'rearToe']],
        dumbbells: load > 0 ? [hand] : undefined,
        forces: [{ at: cop, dir: u2, newtons: mag, label: 'Front foot' }],
        com: c,
      }),
    ],
    joints,
    warnings: [],
  };
}

// ---------------------------------------------------------------- arm chains (3D)

type V3 = P3;
const v3 = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: V3) => Math.hypot(a[0], a[1], a[2]),
  norm: (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};

/** Two-link inverse kinematics: the elbow on its circle, as close as possible to a preferred direction. */
function elbowIK(S: V3, H: V3, Lu: number, Lf: number, pref: V3): { E: V3; H: V3; reached: boolean } {
  let D = v3.sub(H, S);
  let dist = v3.len(D);
  let reached = true;
  const max = (Lu + Lf) * 0.999;
  if (dist > max) {
    D = v3.mul(D, max / dist);
    H = v3.add(S, D);
    dist = max;
    reached = false;
  }
  const n = v3.norm(D);
  const a = (Lu * Lu - Lf * Lf + dist * dist) / (2 * dist);
  const r = Math.sqrt(Math.max(0, Lu * Lu - a * a));
  let e = v3.sub(pref, v3.mul(n, v3.dot(pref, n)));
  if (v3.len(e) < 1e-6) e = [0, -1, 0];
  e = v3.norm(e);
  return { E: v3.add(v3.add(S, v3.mul(n, a)), v3.mul(e, r)), H, reached };
}

/** Shoulder and elbow demand for a force applied at the hand (per arm). */
function armMoments(S: V3, E: V3, H: V3, F: V3) {
  const Ms = v3.cross(v3.sub(H, S), F);
  const a = v3.sub(S, E), b = v3.sub(H, E);
  const ne = v3.norm(v3.cross(a, b));
  // a nearly straight arm has no defined flexion axis; the joint itself takes the load
  const flex = Math.PI - Math.acos(clamp(v3.dot(a, b) / (v3.len(a) * v3.len(b) || 1), -1, 1));
  const Me = v3.dot(v3.cross(b, F), ne) * clamp(flex / (20 * deg), 0, 1);
  const fmag = v3.len(F) || 1;
  return {
    shoulder: v3.len(Ms),
    shoulderArm: v3.len(Ms) / fmag,
    // positive = the force straightens the elbow → flexors work; negative → extensors work
    elbow: Me,
    elbowArm: Math.abs(Me) / fmag,
  };
}

const side = (p: V3): P2 => [p[0], p[1]];
const front = (p: V3): P2 => [p[2], p[1]];

function gripHalf(d: BodyDims, grip: string): number {
  const k = grip === 'narrow' ? 0.5 : grip === 'wide' ? 0.95 : 0.72;
  return d.shoulderWidth * k;
}
const shoulderHalf = (d: BodyDims) => d.shoulderWidth * 0.485;

// ---------------------------------------------------------------- bench press / push-up

function bench(inp: ModelInput): ModelResult {
  const { dims: d, mass, options: o } = inp;
  const pushup = o.variant === 'pushup';
  const load = pushup ? mass * 0.69 : inp.load; // hands carry ~2/3 of body weight in a push-up
  const t = ease(inp.phase);
  const sh = shoulderHalf(d), gh = gripHalf(d, o.grip);
  const Lu = d.upperArm, Lf = d.forearm + d.hand * 0.25; // the bar sits in the heel of the hand
  const S: V3 = [0, 0, sh];
  const w = gh - sh;
  const reachY = Math.sqrt(Math.max(0.01, (Lu + Lf) ** 2 * 0.985 - w * w));
  const touchX = o.touch === 'high' ? 0.035 : o.touch === 'low' ? 0.11 : 0.075;
  const chest = 0.085 * (d.height / 1.75);
  const Ht: V3 = [lerp(0.0, touchX, Math.pow(t, 0.85)), lerp(reachY, chest, t), gh];
  const flare = (o.elbows === 'flared' ? 75 : 45) * deg;
  const pref: V3 = v3.norm([Math.cos(flare) * 0.8, -1, Math.sin(flare) * 0.8]);
  const { E, H } = elbowIK(S, Ht, Lu, Lf, pref);
  const F: V3 = [0, (-load / 2) * G, 0];
  const m = armMoments(S, E, H, F);
  const torsoEnd: P2 = [d.torso, 0];
  const views: DiagramView[] = [
    {
      name: 'Side',
      points: { shoulder: side(S), elbow: side(E), hand: side(H), hip: torsoEnd, head: [-d.headNeck * 0.6, 0.02] },
      bones: [['head', 'shoulder'], ['shoulder', 'hip'], ['shoulder', 'elbow'], ['elbow', 'hand']],
      forces: [{ at: side(H), dir: [0, -1], newtons: (load / 2) * G, label: `${Math.round(load / 2)} kg per arm` }],
      bench: pushup ? undefined : [[-0.25, -0.09], [d.torso + 0.1, -0.09]],
      floor: pushup ? -0.35 : undefined,
      bar: pushup ? undefined : { at: side(H), r: 0 },
      facing: 'right',
    },
    {
      name: 'Front',
      points: { shoulder: front(S), shoulderR: [-sh, 0], elbow: front(E), elbowR: [-E[2], E[1]], hand: front(H), handR: [-H[2], H[1]] },
      bones: [['shoulderR', 'shoulder'], ['shoulder', 'elbow'], ['elbow', 'hand'], ['shoulderR', 'elbowR'], ['elbowR', 'handR'], ['hand', 'handR']],
      forces: [],
    },
  ];
  return {
    views,
    joints: [
      { id: 'shoulder', label: 'Shoulder', demand: m.shoulder, positive: 'Pecs & front delts', negative: '', arm: m.shoulderArm, perSide: true, view: 0, at: side(S), foot: [H[0], S[1]] },
      { id: 'elbow', label: 'Elbow', demand: -m.elbow, positive: 'Triceps (elbow extensors)', negative: 'Elbow flexors', arm: m.elbowArm, perSide: true, view: 1, at: front(E), foot: [H[2], E[1]] },
    ],
    warnings: [],
  };
}

// ---------------------------------------------------------------- overhead press

function press(inp: ModelInput): ModelResult {
  const { dims: d, mass, load, options: o } = inp;
  const t = ease(inp.phase);
  const sh = shoulderHalf(d), gh = gripHalf(d, o.grip);
  const Lu = d.upperArm, Lf = d.forearm + d.hand * 0.25;
  const standY = d.ankleHeight + d.shank + d.thigh;
  const lean = -9 * deg * (1 - t) * (o.variant === 'strict' ? 1 : 0.6);
  const hip: P2 = [0, standY];
  const u = dir(lean);
  const S2 = add(hip, mul(u, d.torso));
  const S: V3 = [S2[0], S2[1], sh];
  const w = gh - sh;
  const reach = Math.sqrt(Math.max(0.01, (Lu + Lf) ** 2 * 0.985 - w * w));
  const H0: V3 = [S[0] + 0.1, S[1] + 0.05, gh]; // bar at chin height
  const H1: V3 = [S[0] - 0.01, S[1] + reach, gh];
  const Ht: V3 = [lerp(H0[0], H1[0], t), lerp(H0[1], H1[1], t), gh];
  const pref: V3 = v3.norm([0.9, -1, 0.25]);
  const { E, H } = elbowIK(S, Ht, Lu, Lf, pref);
  const F: V3 = [0, (-load / 2) * G, 0];
  const m = armMoments(S, E, H, F);
  const f = footGeom(d);
  const L = add(add(hip, mul(u, L5_FRAC * d.torso)), [-L5_BACK, 0]);
  const upperTrunk = { m: mass * SEG.upperTrunk.m, at: lerp2(L, S2, SEG.upperTrunk.com) };
  const head = { m: mass * SEG.headNeck.m, at: add(S2, mul(u, d.headNeck * 0.5)) };
  const arms = { m: mass * 2 * (SEG.upperArm.m + SEG.forearm.m + SEG.hand.m), at: lerp2(S2, side(H), 0.45) };
  const bar = { m: load, at: side(H) };
  const lumbar = gravMoment([upperTrunk, head, arms, bar], L[0]);
  const knee: P2 = [0.01, d.ankleHeight + d.shank];
  return {
    views: [
      {
        name: 'Side',
        points: { toe: [f.toe, 0], heel: [f.heel, 0], ankle: [0, d.ankleHeight], knee, hip, lumbar: L, shoulder: S2, elbow: side(E), hand: side(H), head: add(S2, mul(u, d.headNeck * 0.62)) },
        bones: [['heel', 'toe'], ['heel', 'ankle'], ['ankle', 'toe'], ['ankle', 'knee'], ['knee', 'hip'], ['hip', 'shoulder'], ['shoulder', 'head'], ['shoulder', 'elbow'], ['elbow', 'hand']],
        forces: [{ at: side(H), dir: [0, -1], newtons: load * G, label: `${Math.round(load)} kg` }],
        floor: 0,
        base: [f.heel, f.toe],
        bar: { at: side(H), r: 0 },
        facing: 'right',
      },
      {
        name: 'Front',
        points: { shoulder: front(S), shoulderR: [-sh, S[1]], elbow: front(E), elbowR: [-E[2], E[1]], hand: front(H), handR: [-H[2], H[1]] },
        bones: [['shoulderR', 'shoulder'], ['shoulder', 'elbow'], ['elbow', 'hand'], ['shoulderR', 'elbowR'], ['elbowR', 'handR'], ['hand', 'handR']],
        forces: [],
      },
    ],
    joints: [
      { id: 'shoulder', label: 'Shoulder', demand: m.shoulder, positive: 'Delts (shoulder flexors & abductors)', negative: '', arm: m.shoulderArm, perSide: true, view: 0, at: S2, foot: [H[0], S[1]] },
      { id: 'elbow', label: 'Elbow', demand: -m.elbow, positive: 'Triceps (elbow extensors)', negative: 'Elbow flexors', arm: m.elbowArm, perSide: true, view: 1, at: front(E), foot: [H[2], E[1]] },
      { id: 'lumbar', label: 'Lower back', demand: lumbar, positive: 'Spinal erectors (extensors)', negative: 'Abdominals (resist arching)', arm: H[0] - L[0], perSide: false, view: 0, at: L, foot: vfoot(L, H[0]) },
    ],
    warnings: [],
  };
}

// ---------------------------------------------------------------- bent-over row

function row(inp: ModelInput): ModelResult {
  const { dims: d, mass, load, options: o } = inp;
  const torsoAngle = (Number(o.torso) || 45) * deg;
  const t = ease(inp.phase);
  const f = footGeom(d);
  const armLen = d.upperArm + d.forearm + d.hand * 0.5;
  const phiS = 12 * deg;
  // legs from balance with the bar hanging; then the arms pull
  const at = (phiT: number) => {
    const p = standingPose(d, phiS, phiT, torsoAngle);
    const hang: P2 = [p.S[0], p.S[1] - armLen];
    const items = bodyItems(p, d, mass, lerp2(p.S, hang, 0.5));
    return { p, hang, items };
  };
  const solT = solve((phiT) => {
    const { hang, items } = at(phiT);
    return comX([...Object.values(items).filter((i) => i !== items.upperTrunk), { m: load, at: hang }]) - f.mid;
  }, 0, 100 * deg);
  const { p, hang, items } = at(solT.x);
  const sh = shoulderHalf(d), gh = gripHalf(d, 'medium') * 0.95;
  const touch = add(add(p.S, mul(p.u, -0.2)), mul(p.n, 0.12));
  const hand2 = lerp2(hang, touch, t);
  const S: V3 = [p.S[0], p.S[1], sh];
  const Ht: V3 = [hand2[0], hand2[1], gh];
  const pref: V3 = v3.norm([-p.u[0] * 1.0, -p.u[1] * 1.0 + 0.6, 0.35]);
  const { E, H } = elbowIK(S, Ht, d.upperArm, d.forearm + d.hand * 0.4, pref);
  const F: V3 = [0, (-load / 2) * G, 0];
  const m = armMoments(S, E, H, F);
  const loadItem = { m: load, at: side(H) };
  items.arms.at = lerp2(p.S, side(H), 0.5);
  const lower = lowerBodyJoints(p, items, loadItem, H[0], 0.5, phiS + solT.x).filter((j) => j.id === 'hip' || j.id === 'lumbar');
  return {
    views: [
      standingView(p, d, {
        points: { elbow: side(E), hand: side(H) },
        bones: [['shoulder', 'elbow'], ['elbow', 'hand']],
        bar: { at: side(H), r: 0 },
        forces: [{ at: side(H), dir: [0, -1], newtons: load * G, label: `${Math.round(load)} kg` }],
      }),
    ],
    joints: [
      { id: 'shoulder', label: 'Shoulder', demand: m.shoulder, positive: 'Lats & rear delts (shoulder extensors)', negative: '', arm: m.shoulderArm, perSide: true, view: 0, at: p.S, foot: vfoot(p.S, H[0]) },
      { id: 'elbow', label: 'Elbow', demand: m.elbow, positive: 'Biceps & brachialis (elbow flexors)', negative: 'Triceps', arm: m.elbowArm, perSide: true, view: 0, at: side(E), foot: vfoot(side(E), H[0]) },
      ...lower,
    ],
    warnings: [],
  };
}

// ---------------------------------------------------------------- pull-up / pulldown

function pullup(inp: ModelInput): ModelResult {
  const { dims: d, mass, options: o } = inp;
  const pulldown = o.variant === 'pulldown';
  const armsMass = 2 * (SEG.upperArm.m + SEG.forearm.m + SEG.hand.m) * mass;
  const load = pulldown ? inp.load : mass - armsMass; // what the arms lift
  const t = ease(inp.phase);
  const grip = o.grip === 'chin' ? 'narrow' : o.grip === 'wide' ? 'wide' : 'medium';
  const sh = shoulderHalf(d), gh = gripHalf(d, grip) * (grip === 'wide' ? 1.15 : 1);
  const Lu = d.upperArm, Lf = d.forearm + d.hand * 0.4;
  const w = gh - sh;
  const hang = Math.sqrt(Math.max(0.01, (Lu + Lf) ** 2 * 0.996 - w * w));
  // the bar is fixed; the shoulders rise towards it
  const barY = 0;
  const S: V3 = [lerp(-0.03, -0.09, t), barY - lerp(hang, 0.13, t), sh];
  const Hh: V3 = [0, barY, gh];
  const pref: V3 = grip === 'narrow' ? v3.norm([0.7, -1, 0.15]) : v3.norm([0.15, -1, 0.9]);
  const { E, H } = elbowIK(S, Hh, Lu, Lf, pref);
  const F: V3 = [0, ((load / 2) * G), 0];
  const m = armMoments(S, E, H, F);
  const hip: P2 = [S[0] - 0.02, S[1] - d.torso];
  const knee: P2 = [hip[0] + (pulldown ? d.thigh : 0.05), hip[1] - (pulldown ? 0 : d.thigh)];
  const ankle: P2 = [knee[0] + (pulldown ? 0 : 0.02), knee[1] - d.shank];
  return {
    views: [
      {
        name: 'Side',
        points: { shoulder: side(S), elbow: side(E), hand: side(H), hip, knee, ankle, head: [S[0] + 0.02, S[1] + d.headNeck * 0.62] },
        bones: [['shoulder', 'elbow'], ['elbow', 'hand'], ['shoulder', 'hip'], ['hip', 'knee'], ['knee', 'ankle'], ['shoulder', 'head']],
        forces: [{ at: side(H), dir: [0, 1], newtons: (load / 2) * G, label: pulldown ? `${Math.round(load / 2)} kg per arm` : 'Body weight' }],
        overhead: [[-0.3, barY], [0.3, barY]],
        facing: 'right',
      },
      {
        name: 'Front',
        points: { shoulder: front(S), shoulderR: [-sh, S[1]], elbow: front(E), elbowR: [-E[2], E[1]], hand: front(H), handR: [-H[2], H[1]] },
        bones: [['shoulderR', 'shoulder'], ['shoulder', 'elbow'], ['elbow', 'hand'], ['shoulderR', 'elbowR'], ['elbowR', 'handR']],
        forces: [],
        overhead: [[-gh - 0.15, barY], [gh + 0.15, barY]],
      },
    ],
    joints: [
      { id: 'shoulder', label: 'Shoulder', demand: m.shoulder, positive: grip === 'narrow' ? 'Lats (shoulder extension)' : 'Lats (shoulder adduction)', negative: '', arm: m.shoulderArm, perSide: true, view: grip === 'narrow' ? 0 : 1, at: grip === 'narrow' ? side(S) : front(S), foot: grip === 'narrow' ? [H[0], S[1]] : [H[2], S[1]] },
      { id: 'elbow', label: 'Elbow', demand: m.elbow, positive: 'Biceps & brachialis (elbow flexors)', negative: 'Triceps', arm: m.elbowArm, perSide: true, view: 1, at: front(E), foot: [H[2], E[1]] },
    ],
    warnings: [],
  };
}

// ---------------------------------------------------------------- loaded carry (single-leg stance)

function carry(inp: ModelInput): ModelResult {
  const { dims: d, mass, load, options: o } = inp;
  const t = ease(inp.phase); // 0 = both feet down, 1 = standing on the left leg
  const hw = d.hipWidth / 2, sh = shoulderHalf(d);
  const hipY = d.ankleHeight + d.shank + d.thigh;
  const sway = 0.028 * t; // the body shifts over the stance foot
  const stanceHip: P2 = [hw + sway * 0.3, hipY];
  const otherHip: P2 = [-hw + sway * 0.3, hipY];
  const pelvis: P2 = [sway * 0.3, hipY];
  const L: P2 = [sway * 0.5, hipY + L5_FRAC * d.torso];
  const S: P2 = [sway, hipY + d.torso];
  const handY = hipY - 0.06;
  const handL: P2 = [sh + 0.07 + sway, handY], handR: P2 = [-sh - 0.07 + sway, handY];
  const loads: { m: number; at: P2 }[] =
    o.variant === 'farmer' ? [{ m: load / 2, at: handL }, { m: load / 2, at: handR }] : o.variant === 'suitcaseSame' ? [{ m: load, at: handL }] : o.variant === 'walk' ? [] : [{ m: load, at: handR }];
  const legMass = mass * (SEG.thigh.m + SEG.shank.m + SEG.foot.m);
  const swingLeg = { m: legMass * t, at: [-hw + sway * 0.3, hipY - 0.45 * d.thigh] as P2 }; // lifted leg hangs from the other hip
  const trunk = { m: mass * SEG.trunk.m, at: lerp2(pelvis, S, 0.5) };
  const head = { m: mass * SEG.headNeck.m, at: [S[0], S[1] + 0.12] as P2 };
  const arms = { m: mass * 2 * (SEG.upperArm.m + SEG.forearm.m + SEG.hand.m), at: [sway, S[1] - 0.25] as P2 };
  const above = [trunk, head, arms, swingLeg, ...loads];
  // in double support each hip carries half; in single support the stance hip carries it all
  const share = lerp(0.5, 1, t);
  const abductor = share * above.reduce((s, it) => s + it.m * G * (stanceHip[0] - it.at[0]), 0) * (t > 0.02 ? 1 : 0.4);
  const upper = [{ m: mass * SEG.upperTrunk.m, at: lerp2(L, S, 0.55) }, head, arms, ...loads];
  const lateral = upper.reduce((s, it) => s + it.m * G * (it.at[0] - L[0]), 0);
  const loadX = loads.length ? comX(loads) : S[0];
  return {
    views: [
      {
        name: 'Front',
        points: {
          footL: [hw + 0.03, 0], ankleL: [hw + 0.01, d.ankleHeight], kneeL: [hw, d.ankleHeight + d.shank], hipL: stanceHip,
          footR: [-hw - 0.03, 0.12 * t], ankleR: [-hw - 0.01, d.ankleHeight + 0.12 * t], kneeR: [-hw, d.ankleHeight + d.shank + 0.08 * t], hipR: otherHip,
          lumbar: L, shoulder: S, shoulderL: [sh + sway, S[1]], shoulderR: [-sh + sway, S[1]], handL, handR, head: [S[0], S[1] + d.headNeck * 0.62],
        },
        bones: [['footL', 'ankleL'], ['ankleL', 'kneeL'], ['kneeL', 'hipL'], ['footR', 'ankleR'], ['ankleR', 'kneeR'], ['kneeR', 'hipR'], ['hipL', 'hipR'], ['hipL', 'shoulderL'], ['hipR', 'shoulderR'], ['shoulderL', 'shoulderR'], ['shoulderL', 'handL'], ['shoulderR', 'handR'], ['shoulder', 'head']],
        forces: loads.map((l) => ({ at: l.at, dir: [0, -1] as P2, newtons: l.m * G, label: `${Math.round(l.m)} kg` })),
        dumbbells: loads.map((l) => l.at),
        floor: 0,
        com: com([...above, { m: legMass, at: [hw, hipY / 2] }]),
      },
    ],
    joints: [
      { id: 'hipFrontal', label: 'Standing hip', demand: abductor, positive: 'Hip abductors (glute medius)', negative: 'Hip adductors', arm: stanceHip[0] - loadX, perSide: true, view: 0, at: stanceHip, foot: vfoot(stanceHip, loadX) },
      { id: 'spineLateral', label: 'Lower back (side)', demand: Math.abs(lateral), positive: o.variant === 'farmer' || o.variant === 'walk' ? 'Obliques & quadratus lumborum' : 'Obliques & QL on the side away from the load', negative: '', arm: Math.abs(loadX - L[0]), perSide: false, view: 0, at: L, foot: vfoot(L, loadX) },
    ],
    warnings: [],
  };
}

// ---------------------------------------------------------------- anti-rotation (Pallof press)

function pallof(inp: ModelInput): ModelResult {
  const { dims: d, load } = inp;
  const t = ease(inp.phase);
  const tension = load * G;
  const reach = (d.upperArm + d.forearm + d.hand * 0.5) * 0.95;
  const x = lerp(0.16, 0.12 + reach, t);
  const sh = shoulderHalf(d);
  const hands: P2 = [x, 0];
  const spine: P2 = [-0.05, 0];
  const torque = tension * (x - spine[0]);
  const shoulderTorque = (tension / 2) * x;
  return {
    views: [
      {
        name: 'Top',
        points: { spine, shoulderL: [0, sh], shoulderR: [0, -sh], hands, elbowL: [lerp(0.08, x * 0.5, t), lerp(0.16, sh * 0.6, t)], elbowR: [lerp(0.08, x * 0.5, t), lerp(-0.16, -sh * 0.6, t)] },
        bones: [['shoulderL', 'shoulderR'], ['shoulderL', 'elbowL'], ['elbowL', 'hands'], ['shoulderR', 'elbowR'], ['elbowR', 'hands']],
        forces: [{ at: hands, dir: [0, -1], newtons: tension, label: `Band ${Math.round(load)} kg` }],
        anchor: [x, -0.9],
      },
    ],
    joints: [
      { id: 'spineAxial', label: 'Spine (rotation)', demand: torque, positive: 'Obliques & deep core (resist rotation)', negative: '', arm: x - spine[0], perSide: false, view: 0, at: spine, foot: [spine[0], 0] },
      { id: 'shoulder', label: 'Shoulders', demand: shoulderTorque, positive: 'Pecs, front delts & rotator cuff', negative: '', arm: x, perSide: true, view: 0, at: [0, -sh], foot: [x, -sh] },
    ],
    warnings: [],
  };
}

// ---------------------------------------------------------------- running stance

/** Piecewise-smooth interpolation through keyframes [(t, value)]. */
function keyframes(k: [number, number][], t: number): number {
  if (t <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++)
    if (t <= k[i][0]) {
      const [t0, v0] = k[i - 1], [t1, v1] = k[i];
      return lerp(v0, v1, ease((t - t0) / (t1 - t0)));
    }
  return k[k.length - 1][1];
}

function gait(inp: ModelInput): ModelResult {
  const { dims: d, mass } = inp;
  const p = clamp(inp.phase, 0, 1);
  const BW = mass * G;
  // ground reaction force over stance at an easy running pace (~3.5 m/s): a single
  // vertical hump of ~2.5× body weight; braking in the first half, propulsion in the second
  const Fz = BW * (0.2 + 2.3 * Math.sin(Math.PI * p));
  const Fx = -0.3 * BW * Math.sin(2 * Math.PI * p);
  // segment angles from vertical (positive = top of the segment ahead of its lower end)
  const shankA = keyframes([[0, -6], [0.4, 22], [1, 48]], p) * deg;
  const thighA = keyframes([[0, -24], [0.4, -18], [1, 28]], p) * deg;
  const lean = 7 * deg;
  const f = footGeom(d);
  // the foot is flat until heel-off, then rolls over the toes
  const heelRise = p > 0.55 ? ((p - 0.55) / 0.45) * 38 * deg : 0;
  const toePt: P2 = [f.toe * 0.9, 0];
  const restAnkle: P2 = [0, d.ankleHeight];
  const v = sub(restAnkle, toePt);
  const A: P2 = add(toePt, [v[0] * Math.cos(heelRise) + v[1] * Math.sin(heelRise), -v[0] * Math.sin(heelRise) + v[1] * Math.cos(heelRise)]);
  const heelV = sub([f.heel, 0], toePt);
  const heel: P2 = add(toePt, [heelV[0] * Math.cos(heelRise) + heelV[1] * Math.sin(heelRise), -heelV[0] * Math.sin(heelRise) + heelV[1] * Math.cos(heelRise)]);
  const K = add(A, mul(dir(shankA), d.shank));
  const H = add(K, mul(dir(thighA), d.thigh));
  const u = dir(lean);
  const S = add(H, mul(u, d.torso));
  const L = add(add(H, mul(u, L5_FRAC * d.torso)), [-L5_BACK, 0]);
  const cop: P2 = [p > 0.55 ? lerp(f.toe * 0.55, toePt[0], (p - 0.55) / 0.45) : lerp(f.heel * 0.55, f.toe * 0.55, p / 0.55), 0];
  const mag = Math.hypot(Fx, Fz);
  const u2: P2 = [Fx / mag, Fz / mag];
  // moment of the ground reaction about a joint (anticlockwise positive)
  const m2 = (j: P2) => (cop[0] - j[0]) * Fz - (cop[1] - j[1]) * Fx;
  const along = (j: P2): P2 => add(cop, mul(u2, (j[0] - cop[0]) * u2[0] + (j[1] - cop[1]) * u2[1]));
  const armOf = (j: P2) => m2(j) / mag;
  // the other leg swings through
  const swingThigh = keyframes([[0, -18], [0.5, 8], [1, 32]], p) * deg;
  const swingKnee: P2 = add(H, [Math.sin(swingThigh) * d.thigh, -Math.cos(swingThigh) * d.thigh]);
  const swingFlex = keyframes([[0, 60], [0.5, 100], [1, 75]], p) * deg;
  const swingAnkle: P2 = add(swingKnee, [Math.sin(swingThigh - swingFlex) * d.shank, -Math.cos(swingThigh - swingFlex) * d.shank]);
  return {
    views: [
      {
        name: 'Side',
        points: { ankle: A, knee: K, hip: H, lumbar: L, shoulder: S, head: add(S, mul(u, d.headNeck * 0.62)), heel, toe: toePt, swingKnee, swingAnkle },
        bones: [['heel', 'toe'], ['heel', 'ankle'], ['ankle', 'toe'], ['ankle', 'knee'], ['knee', 'hip'], ['hip', 'shoulder'], ['shoulder', 'head'], ['hip', 'swingKnee'], ['swingKnee', 'swingAnkle']],
        forces: [{ at: cop, dir: u2, newtons: mag, label: `${(mag / BW).toFixed(1)}× body weight` }],
        floor: 0,
        facing: 'right',
      },
    ],
    joints: [
      { id: 'ankle', label: 'Ankle', demand: m2(A), positive: 'Calves (plantarflexors)', negative: 'Shin muscles (dorsiflexors)', arm: armOf(A), perSide: true, view: 0, at: A, foot: along(A) },
      { id: 'knee', label: 'Knee', demand: -m2(K), positive: 'Quadriceps (knee extensors)', negative: 'Hamstrings (knee flexors)', arm: -armOf(K), perSide: true, view: 0, at: K, foot: along(K) },
      { id: 'hip', label: 'Hip', demand: m2(H), positive: 'Glutes & hamstrings (hip extensors)', negative: 'Hip flexors', arm: armOf(H), perSide: true, view: 0, at: H, foot: along(H) },
    ],
    warnings: [],
  };
}

export const MODELS = { squat, hinge, lunge, bench, press, row, pullup, carry, pallof, gait };
export type ModelId = keyof typeof MODELS;

export function runModel(id: ModelId, inp: ModelInput): ModelResult {
  return MODELS[id]({ ...inp, phase: clamp(inp.phase, 0, 1) });
}
