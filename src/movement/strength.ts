// How strong a joint's muscles are at a given angle. Muscles are strongest
// partway through their range (where muscle length and leverage combine best)
// and weaker at either end, so the same torque is harder at some angles than
// others: that, with the changing leverage, is what makes a sticking point.
//
// Each curve is a cosine around the angle of peak strength with a floor, the
// shape used by Anderson, Madigan & Nussbaum (2007) for the lower limb, with
// peaks and widths set to match typical published torque-angle curves. They are
// shapes for a typical lifter, scaled to you by your maxes (see personalScale).
import type { DiagramView, JointId, JointResult, ModelResult } from './biomech';

/** Which muscles are working at a joint, which sets the curve. */
export type StrengthKind =
  | 'kneeExt'
  | 'kneeFlex'
  | 'hipExt'
  | 'hipFlex'
  | 'plantar'
  | 'dorsi'
  | 'backExt'
  | 'backFlex'
  | 'elbowExt'
  | 'elbowFlex'
  | 'shoulderFlex'
  | 'shoulderExt'
  | 'flat';

/** Angle of peak strength (degrees, in the joint's own measure below), and how fast strength falls off either side. */
export const CURVES: Record<Exclude<StrengthKind, 'flat'>, { peak: number; c: number; angle: string }> = {
  kneeExt: { peak: 65, c: 0.87, angle: 'knee bend' }, // quads: strongest around 60–70° of bend, about half at full extension
  kneeFlex: { peak: 30, c: 0.6, angle: 'knee bend' },
  hipExt: { peak: 85, c: 0.71, angle: 'hip bend' }, // glutes and hamstrings: strongest deep, half at standing
  hipFlex: { peak: 20, c: 0.6, angle: 'hip bend' },
  plantar: { peak: 15, c: 1.33, angle: 'shin tilt' }, // calves: strongest with the shin forward (stretched)
  dorsi: { peak: -10, c: 1, angle: 'shin tilt' },
  backExt: { peak: 60, c: 0.61, angle: 'trunk lean' }, // erectors: stronger when bent over
  backFlex: { peak: 0, c: 0.5, angle: 'trunk lean' },
  elbowExt: { peak: 90, c: 0.63, angle: 'elbow bend' }, // triceps: weakest near lockout and fully bent
  elbowFlex: { peak: 90, c: 0.59, angle: 'elbow bend' },
  shoulderFlex: { peak: 20, c: 0.46, angle: 'arm raise' }, // front delts and pecs: weaker overhead
  shoulderExt: { peak: 110, c: 0.545, angle: 'arm raise' }, // lats: strongest with the arm raised, weakest by the side
};

const FLOOR = 0.35;
/** The flat typical maxima (CAPACITY) are mid-range values; the peak sits a little above them. */
export const PEAK_FACTOR = 1 / 0.85;
const deg = Math.PI / 180;

/** Strength at an angle as a share of the joint's peak (0.35–1). */
export function strengthShare(kind: StrengthKind, angle: number | undefined): number {
  if (kind === 'flat' || angle === undefined) return 1 / PEAK_FACTOR; // no curve: the mid-range value
  const { peak, c } = CURVES[kind];
  return Math.max(FLOOR, Math.cos(c * (angle - peak) * deg));
}

/** The muscles working at a joint (those for the given direction, or the demand's), from the model's label for them. */
export function kindOf(j: JointResult, sign: 1 | -1 = j.demand >= 0 ? 1 : -1): StrengthKind {
  const label = (sign > 0 ? j.positive : j.negative).toLowerCase();
  switch (j.id) {
    case 'knee':
      return /flex|hamstring/.test(label) ? 'kneeFlex' : 'kneeExt';
    case 'hip':
      return /flexor/.test(label) && !/extens/.test(label) ? 'hipFlex' : 'hipExt';
    case 'ankle':
      return /dorsi|shin/.test(label) ? 'dorsi' : 'plantar';
    case 'lumbar':
      return /abdominal|flexor/.test(label) && !/erector/.test(label) ? 'backFlex' : 'backExt';
    case 'elbow':
      return /biceps|flexor/.test(label) && !/triceps|extens/.test(label) ? 'elbowFlex' : 'elbowExt';
    case 'shoulder':
      return /lats|extens|adduct|rear delt/.test(label) ? 'shoulderExt' : 'shoulderFlex';
    default:
      return 'flat';
  }
}

type P2 = [number, number];
const angleAt = (a: P2, b: P2, c: P2) => {
  const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]];
  const nu = Math.hypot(u[0], u[1]), nv = Math.hypot(v[0], v[1]);
  if (!nu || !nv) return undefined;
  return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (nu * nv)))) / deg;
};

/**
 * Joint angles from a model's side view, each in the measure its curve uses:
 * knee, hip and elbow bend (0 = straight); shin tilt forward of vertical; trunk
 * lean from vertical; arm raise (0 = arm by the side, 90 = forwards, 180 = overhead).
 */
export function jointAngles(view: DiagramView): Partial<Record<JointId, number>> {
  const p = view.points;
  const out: Partial<Record<JointId, number>> = {};
  const bend = (a?: P2, b?: P2, c?: P2) => (a && b && c ? (angleAt(a, b, c) === undefined ? undefined : 180 - angleAt(a, b, c)!) : undefined);
  out.knee = bend(p.hip, p.knee, p.ankle);
  out.hip = bend(p.shoulder, p.hip, p.knee);
  out.elbow = bend(p.shoulder, p.elbow, p.hand);
  if (p.ankle && p.knee) out.ankle = Math.atan2(p.knee[0] - p.ankle[0], p.knee[1] - p.ankle[1]) / deg;
  if (p.hip && p.shoulder) out.lumbar = Math.atan2(Math.abs(p.shoulder[0] - p.hip[0]), Math.abs(p.shoulder[1] - p.hip[1])) / deg;
  if (p.hip && p.shoulder && p.elbow) out.shoulder = angleAt(p.hip, p.shoulder, p.elbow);
  for (const k of Object.keys(out) as JointId[]) if (out[k] === undefined || Number.isNaN(out[k])) delete out[k];
  return out;
}

/** Fills in each joint's angle from the model's side view. */
export function withAngles(r: ModelResult): ModelResult {
  const side = r.views.find((v) => v.name === 'Side');
  if (!side) return r;
  const a = jointAngles(side);
  return { ...r, joints: r.joints.map((j) => (a[j.id] !== undefined ? { ...j, angle: a[j.id] } : j)) };
}
