// Your proportions against everyone else's, and the same lift done by a
// different build. Ratios are read from the fitted body (joint centres), and
// placed against a population table: built-in approximate spreads, or exact
// ANSUR II figures made by scripts/ansur-proportions.py and loaded in Profile.
// The explorer changes your build at the same height (legs against torso, thigh
// against shin, arm length) and runs the lift's model for both.
import { bodyDims, REFERENCE, type BodyDims, type ShapeInput, type ShapeKey } from '../model/bodyShape';
import { relativeDemand, stickingPoint, sweep } from './activation';
import { G, type JointId, type ModelInput, type ModelResult } from './biomech';
import type { PatternDef } from './patterns';
import { jointAngles } from './strength';

export type RatioId = 'legs' | 'thighShin' | 'ape';

export interface RatioDef {
  label: string;
  what: string;
  low: string;
  high: string;
  of: (d: BodyDims) => number;
}

const armLen = (d: BodyDims) => d.upperArm + d.forearm + d.hand;

export const RATIOS: Record<RatioId, RatioDef> = {
  legs: {
    label: 'Legs : height',
    what: 'Hip joint height as a share of your height. The rest is torso, neck and head.',
    low: 'long torso, short legs',
    high: 'long legs, short torso',
    of: (d) => (d.height - d.headNeck - d.torso) / d.height,
  },
  thighShin: {
    label: 'Thigh : shin',
    what: 'Thigh length over lower-leg length.',
    low: 'short thighs for your shins',
    high: 'long thighs for your shins',
    of: (d) => d.thigh / d.shank,
  },
  ape: {
    label: 'Arm span : height',
    what: 'Fingertip to fingertip, arms out, over your height (the “ape index”).',
    low: 'short arms',
    high: 'long arms',
    of: (d) => (d.shoulderWidth + 2 * armLen(d)) / d.height,
  },
};
export const RATIO_IDS = Object.keys(RATIOS) as RatioId[];

/** Percentile levels the population tables give (as fractions). */
export const QS = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99];
const Z = [-2.326, -1.645, -1.2816, -0.6745, 0, 0.6745, 1.2816, 1.645, 2.326];

/**
 * For each ratio and sex, the ratio at each of the QS levels, relative to the
 * men's median. Relative figures, because tape landmarks (in the survey) and
 * joint centres (in the model) give different absolute ratios but much the same
 * spread; the reference body stands in for the median man.
 */
export interface PopulationTable {
  source: string;
  approx: boolean;
  ratios: Record<RatioId, { male: number[]; female: number[] }>;
}

const normal = (cv: number, shift = 0) => Z.map((z) => Math.round((1 + shift + z * cv) * 10000) / 10000);

/**
 * Approximate spreads, for until exact figures are loaded: adult hip height
 * varies by about 2.6% of stature, thigh against shin by about 4%, arm span
 * against height by about 2%; women's arm span runs about 1.6% shorter for
 * their height, and their legs a little shorter.
 */
export const BUILT_IN: PopulationTable = {
  source: 'approximate spreads for adults (load ANSUR II figures for exact ones)',
  approx: true,
  ratios: {
    legs: { male: normal(0.026), female: normal(0.026, -0.004) },
    thighShin: { male: normal(0.04), female: normal(0.04) },
    ape: { male: normal(0.021), female: normal(0.021, -0.016) },
  },
};

/** Checks a table loaded from a file: every ratio, both sexes, nine rising positive numbers. */
export function validTable(x: unknown): x is PopulationTable {
  if (!x || typeof x !== 'object') return false;
  const t = x as PopulationTable;
  if (typeof t.source !== 'string' || !t.ratios || typeof t.ratios !== 'object') return false;
  return RATIO_IDS.every((id) =>
    (['male', 'female'] as const).every((s) => {
      const q = t.ratios[id]?.[s];
      return Array.isArray(q) && q.length === QS.length && q.every((v, i) => typeof v === 'number' && Number.isFinite(v) && v > 0.5 && v < 1.5 && (i === 0 || v >= q[i - 1]));
    }),
  );
}

const REF_DIMS = bodyDims({});
export const refRatio = (id: RatioId) => RATIOS[id].of(REF_DIMS);

type Sex = 'male' | 'female' | string | undefined;
const table = (t: PopulationTable, id: RatioId, sex: Sex) => (sex === 'female' ? t.ratios[id].female : t.ratios[id].male);

/** Where a body's ratio sits in the population, as a percentile (1–99; beyond the table's ends it's clamped). */
export function percentileOf(t: PopulationTable, id: RatioId, d: BodyDims, sex: Sex): number {
  const rel = RATIOS[id].of(d) / refRatio(id);
  const q = table(t, id, sex);
  if (rel <= q[0]) return 1;
  if (rel >= q[q.length - 1]) return 99;
  for (let i = 1; i < q.length; i++)
    if (rel <= q[i]) {
      const f = q[i] === q[i - 1] ? 0.5 : (rel - q[i - 1]) / (q[i] - q[i - 1]);
      return (QS[i - 1] + f * (QS[i] - QS[i - 1])) * 100;
    }
  return 99;
}

/** The ratio at a percentile (1–99). */
export function ratioAt(t: PopulationTable, id: RatioId, pct: number, sex: Sex): number {
  const p = Math.min(0.99, Math.max(0.01, pct / 100));
  const q = table(t, id, sex);
  for (let i = 1; i < QS.length; i++)
    if (p <= QS[i]) {
      const f = (p - QS[i - 1]) / (QS[i] - QS[i - 1]);
      return (q[i - 1] + f * (q[i] - q[i - 1])) * refRatio(id);
    }
  return q[q.length - 1] * refRatio(id);
}

export function describePercentile(p: number): string {
  if (p <= 3) return 'among the lowest few in 100';
  if (p >= 97) return 'among the highest few in 100';
  const n = Math.round(p);
  if (n >= 40 && n <= 60) return 'about average';
  return n < 50 ? `lower than ${100 - n} in 100 people` : `higher than ${n} in 100 people`;
}

// ---------------------------------------------------------------- another build

/** Tape-measure length over joint-centre length, per segment, on the reference body. */
const TAPE: Partial<Record<keyof BodyDims, number>> = {
  thigh: REFERENCE.thigh / 100 / REF_DIMS.thigh,
  shank: REFERENCE.shank / 100 / REF_DIMS.shank,
  upperArm: REFERENCE.upperArm / 100 / REF_DIMS.upperArm,
  forearm: REFERENCE.forearm / 100 / REF_DIMS.forearm,
  hand: REFERENCE.hand / 100 / REF_DIMS.hand,
  foot: REFERENCE.foot / 100 / REF_DIMS.foot,
  shoulderWidth: REFERENCE.shoulderWidth / 100 / REF_DIMS.shoulderWidth,
};
const LENGTHS = ['thigh', 'shank', 'upperArm', 'forearm', 'hand', 'foot', 'shoulderWidth'] as const;

/** Measurements (cm) that give these body dimensions: every length spelled out, so changing one doesn't move the others. */
function tapeFor(d: BodyDims, base: ShapeInput): ShapeInput {
  const out: ShapeInput = { ...base, height: d.height * 100 };
  delete out.armSpan;
  for (const k of LENGTHS) out[k as ShapeKey] = d[k] * TAPE[k]! * 100;
  return out;
}

/**
 * Your measurements changed to reach the given ratios at the same height: the
 * thigh:shin split at the same leg length, then leg length against torso, then
 * arm length. Returns the measurements (for the 3D model too) and the body they make.
 */
export function withRatios(input: ShapeInput, target: Partial<Record<RatioId, number>>): { input: ShapeInput; dims: BodyDims } {
  let d = bodyDims(input);
  let cur = tapeFor(d, input);
  // the body fit has its own small couplings (and limits), so correct twice
  for (let pass = 0; pass < 3; pass++) {
    const want: BodyDims = { ...d };
    if (target.thighShin) {
      const s = want.thigh + want.shank;
      want.thigh = (s * target.thighShin) / (1 + target.thighShin);
      want.shank = s / (1 + target.thighShin);
    }
    if (target.legs) {
      const gap = target.legs - RATIOS.legs.of(d);
      const k = 1 + (gap * d.height) / (want.thigh + want.shank);
      want.thigh *= k;
      want.shank *= k;
    }
    if (target.ape) {
      const k = (target.ape * d.height - want.shoulderWidth) / 2 / armLen(want);
      want.upperArm *= k;
      want.forearm *= k;
      want.hand *= k;
    }
    cur = tapeFor(want, input);
    const next = bodyDims(cur);
    const off = RATIO_IDS.some((id) => target[id] && Math.abs(RATIOS[id].of(next) - target[id]!) > 0.002);
    d = next; // the next pass aims from where this one landed
    if (!off) break;
  }
  return { input: cur, dims: d };
}

// ---------------------------------------------------------------- the lift for each build

export interface LiftMetrics {
  /** Most the trunk leans from vertical through the lift, degrees. */
  trunkLean?: number;
  /** How far the bar moves (the body, in a pull-up), m. */
  travel: number;
  /** Work against gravity per rep on the load (the body, in a pull-up), J. */
  work: number;
  /** Each joint's highest demand through the lift, as a share of typical strength at its angle. */
  peaks: Partial<Record<JointId, number>>;
  labels: Partial<Record<JointId, string>>;
  sticking: { joint: JointId; label: string; phase: number; rel: number } | null;
  warnings: string[];
}

const sideOf = (r: ModelResult) => r.views.find((v) => v.name === 'Side') ?? r.views[0];

export function liftMetrics(p: PatternDef, inp: Omit<ModelInput, 'phase'>): LiftMetrics {
  const pts = sweep(p, inp, 24);
  const bodyMoves = p.id === 'pullV';
  const ys: number[] = [];
  let lean: number | undefined;
  const peaks: Partial<Record<JointId, number>> = {};
  const labels: Partial<Record<JointId, string>> = {};
  const warnings = new Set<string>();
  for (const { result: r } of pts) {
    const v = sideOf(r);
    const y = bodyMoves ? v.points.shoulder?.[1] : (v.bar?.at[1] ?? v.dumbbells?.[0]?.[1] ?? v.points.hand?.[1]);
    if (y !== undefined) ys.push(y);
    if (p.id !== 'pushH') {
      const a = jointAngles(v).lumbar;
      if (a !== undefined) lean = Math.max(lean ?? 0, a);
    }
    for (const j of r.joints) {
      if (Math.abs(j.demand) < 4) continue; // held by the joint, not the muscles
      peaks[j.id] = Math.max(peaks[j.id] ?? 0, relativeDemand(j, inp.mass, j.demand >= 0 ? 1 : -1));
      labels[j.id] = j.label;
    }
    r.warnings.forEach((w) => warnings.add(w));
  }
  const travel = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  const st = stickingPoint(pts, inp.mass);
  return {
    trunkLean: lean,
    travel,
    work: (bodyMoves ? inp.mass + inp.load : inp.load) * G * travel,
    peaks,
    labels,
    sticking: st ? { joint: st.joint.id, label: st.joint.label, phase: st.phase, rel: st.rel } : null,
    warnings: [...warnings],
  };
}
