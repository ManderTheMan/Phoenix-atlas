// How fast each rep was lifted, from the joint track alone. This is what bar
// speed trackers measure: the speed of the bar (here, the body point that moves
// with it) while lifting. Comparing the reps of a set shows fatigue: the bar
// slows as the set nears failure, which is what the RPE estimate (src/training/rpe.ts)
// is built on.
//
// Distances in the picture become metres through your own limb lengths: the
// thigh, shin, upper arm and forearm lie close to the picture plane when you're
// filmed side-on, so their length in pixels against their real length gives the
// scale. Time comes from the track's timestamps (corrected for slow motion).
import type { MediaItem } from '../db/db';
import type { BodyDims } from '../model/bodyShape';
import { angleSeries, landmark, nearSide, smooth, type JointId, type LandmarkName, type PoseTrack, type SeriesPoint, type Side } from './analysis';

/** The body point that moves with the bar, per pattern. */
export const BAR_POINT: Record<string, 'shoulder' | 'wrist'> = {
  squat: 'shoulder', // the bar sits on the upper back
  lunge: 'shoulder',
  hinge: 'wrist', // the bar hangs from the hands
  pushH: 'wrist',
  pushV: 'wrist',
  pullH: 'wrist',
  pullV: 'shoulder', // the body rises to the bar
  carry: 'wrist',
};

/** The joint whose angle shows the lifting phase, and whether lifting opens it (squat, press) or closes it (pull). */
export const LIFT_JOINT: Record<string, { joint: JointId; lift: 'opens' | 'closes'; minRom: number }> = {
  squat: { joint: 'knee', lift: 'opens', minRom: 25 },
  lunge: { joint: 'knee', lift: 'opens', minRom: 25 },
  hinge: { joint: 'hip', lift: 'opens', minRom: 25 },
  pushH: { joint: 'elbow', lift: 'opens', minRom: 25 },
  pushV: { joint: 'elbow', lift: 'opens', minRom: 25 },
  pullH: { joint: 'elbow', lift: 'closes', minRom: 25 },
  pullV: { joint: 'elbow', lift: 'closes', minRom: 25 },
};

/** Real seconds per second of an archive clip: slow motion stored stretched out runs slower than real time (null when by how much isn't known). */
export function timeScaleOf(m: MediaItem): number | null {
  const o = m.original;
  if (!o?.slowmo) return 1;
  return o.captureFps && o.fps ? o.fps / o.captureFps : null;
}

export const hasVelocity = (pattern: string | undefined): boolean => !!pattern && pattern in LIFT_JOINT;

export interface RepVelocity {
  /** Start and end of the lifting part (s, real time). */
  t0: number;
  t1: number;
  /** Mean and peak speed of the bar point while lifting, m/s. */
  mean: number;
  peak: number;
  /** How far it rose, m. */
  rom: number;
}

export interface SetVelocity {
  point: 'shoulder' | 'wrist';
  side: Side;
  /** Metres per pixel, and the limbs it was measured from. */
  scale: number;
  scaleFrom: string[];
  /** Height (m) the limb lengths came from. */
  height: number;
  /** Real seconds per second of video (below 1 for slow motion). */
  timeScale: number;
  reps: RepVelocity[];
  /** Fastest, first and last rep's mean speed (m/s). */
  best?: number;
  first?: number;
  last?: number;
  /** Speed lost from the fastest rep to the last, as a share of the fastest (0–1). */
  loss?: number;
  /** The last rep's lifting time over the fastest rep's. */
  slowdown?: number;
}

const LIMBS: { name: keyof BodyDims; a: string; b: string }[] = [
  { name: 'thigh', a: 'hip', b: 'knee' },
  { name: 'shank', a: 'knee', b: 'ankle' },
  { name: 'upperArm', a: 'shoulder', b: 'elbow' },
  { name: 'forearm', a: 'elbow', b: 'wrist' },
];

const quantile = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};

/**
 * Metres per pixel from limb lengths. A limb turned towards the camera looks
 * shorter, never longer, so the longest it usually appears (85th percentile)
 * is taken as its true length; the limbs' estimates are combined by median.
 */
export function pixelScale(track: PoseTrack, dims: BodyDims, side: Side = nearSide(track)): { scale: number; from: string[] } | null {
  const est: number[] = [];
  const from: string[] = [];
  for (const limb of LIMBS) {
    const px: number[] = [];
    for (const f of track.frames) {
      const a = landmark(f, `${side}_${limb.a}` as LandmarkName), b = landmark(f, `${side}_${limb.b}` as LandmarkName);
      if (!a || !b || a.v < 0.6 || b.v < 0.6) continue;
      const d = Math.hypot((a.x - b.x) * track.width, (a.y - b.y) * track.height);
      if (d > 2) px.push(d);
    }
    if (px.length < 5) continue;
    est.push((dims[limb.name] as number) / quantile(px, 0.85));
    from.push(limb.name);
  }
  if (!est.length) return null;
  return { scale: quantile(est, 0.5), from };
}

/** The bar point's height (m, upwards) over time, short gaps filled and lightly smoothed. */
function barHeight(track: PoseTrack, point: 'shoulder' | 'wrist', side: Side, scale: number): SeriesPoint[] {
  const raw = track.frames.map((f) => {
    const p = landmark(f, `${side}_${point}` as LandmarkName);
    return { t: f.t, v: p && p.v >= 0.5 ? (1 - p.y) * track.height * scale : null };
  });
  return smooth(raw, 3, 0.3);
}

/** Alternating turning points of a series, each at least `min` from the last (endpoints included). */
export function turningPoints(series: SeriesPoint[], min: number): { t: number; v: number; kind: 'low' | 'high' }[] {
  const pts = series.filter((p) => p.v !== null) as { t: number; v: number }[];
  if (pts.length < 3) return [];
  const out: { t: number; v: number; kind: 'low' | 'high' }[] = [];
  let lo = pts[0], hi = pts[0];
  let trend: 'up' | 'down' | null = null;
  for (const p of pts.slice(1)) {
    if (trend !== 'down' && p.v > hi.v) hi = p;
    if (trend !== 'up' && p.v < lo.v) lo = p;
    if (trend === null) {
      if (hi.v - lo.v >= min) {
        trend = hi.t > lo.t ? 'up' : 'down';
        out.push(trend === 'up' ? { ...lo, kind: 'low' } : { ...hi, kind: 'high' });
      }
      continue;
    }
    if (trend === 'up') {
      if (p.v > hi.v) hi = p;
      else if (hi.v - p.v >= min) {
        out.push({ ...hi, kind: 'high' });
        trend = 'down';
        lo = p;
      }
    } else {
      if (p.v < lo.v) lo = p;
      else if (p.v - lo.v >= min) {
        out.push({ ...lo, kind: 'low' });
        trend = 'up';
        hi = p;
      }
    }
  }
  if (trend === 'up') out.push({ ...hi, kind: 'high' });
  else if (trend === 'down') out.push({ ...lo, kind: 'low' });
  return out;
}

/** Linear interpolation of a series at time t (null outside it or across a gap). */
function at(series: SeriesPoint[], t: number): number | null {
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1], b = series[i];
    if (b.t < t) continue;
    if (a.v === null || b.v === null) return a.v ?? b.v;
    return a.v + ((b.v - a.v) * (t - a.t)) / Math.max(1e-6, b.t - a.t);
  }
  return null;
}

/**
 * The lifting phases of a set, from the pattern's joint angle: each rise (or
 * fall, for pulls) of at least the minimum range, trimmed to between 5% and 95%
 * of it so the pauses at the bottom and at lockout don't count as lifting.
 */
export function liftPhases(track: PoseTrack, pattern: string, side: Side = nearSide(track)): { t0: number; t1: number }[] {
  const def = LIFT_JOINT[pattern];
  if (!def) return [];
  const ang = smooth(angleSeries(track, def.joint, side));
  const turns = turningPoints(ang, def.minRom);
  const phases: { t0: number; t1: number }[] = [];
  for (let i = 1; i < turns.length; i++) {
    const a = turns[i - 1], b = turns[i];
    const lifting = def.lift === 'opens' ? a.kind === 'low' && b.kind === 'high' : a.kind === 'high' && b.kind === 'low';
    if (!lifting) continue;
    const ph = travel(ang, a, b);
    if (ph) phases.push(ph);
  }
  return phases;
}

/** The movement from one turning point to the next, trimmed to between 5% and 95% of the way (both interpolated between frames). */
export function travel(ang: SeriesPoint[], a: { t: number; v: number }, b: { t: number; v: number }): { t0: number; t1: number } | null {
  const span = b.v - a.v;
  if (!span) return null;
  const pts = ang.filter((p) => p.v !== null && p.t >= a.t && p.t <= b.t) as { t: number; v: number }[];
  const frac = (v: number) => (v - a.v) / span;
  // first time past 95%, then the last time under 5% before it
  const i1 = pts.findIndex((p) => frac(p.v) >= 0.95);
  if (i1 < 1) return null;
  let i0 = 0;
  for (let i = 0; i < i1; i++) if (frac(pts[i].v) <= 0.05) i0 = i;
  const cross = (p: { t: number; v: number }, q: { t: number; v: number }, f: number) => {
    const fp = frac(p.v), fq = frac(q.v);
    return fq === fp ? q.t : p.t + ((f - fp) / (fq - fp)) * (q.t - p.t);
  };
  const t0 = i0 + 1 <= i1 && frac(pts[i0].v) <= 0.05 ? cross(pts[i0], pts[i0 + 1], 0.05) : pts[i0].t;
  const t1 = cross(pts[i1 - 1], pts[i1], 0.95);
  return t1 > t0 ? { t0, t1 } : null;
}

/** Each rep's lifting speed and the set's fatigue: speed lost and slowdown from the fastest rep to the last. */
export function setVelocity(track: PoseTrack, pattern: string, dims: BodyDims, opts: { timeScale?: number } = {}): SetVelocity | null {
  if (!hasVelocity(pattern) || track.frames.length < 5) return null;
  const side = nearSide(track);
  const sc = pixelScale(track, dims, side);
  if (!sc) return null;
  const point = BAR_POINT[pattern] ?? 'wrist';
  const k = opts.timeScale ?? 1;
  const bar = barHeight(track, point, side, sc.scale);
  const reps: RepVelocity[] = [];
  for (const ph of liftPhases(track, pattern, side)) {
    const y0 = at(bar, ph.t0), y1 = at(bar, ph.t1);
    if (y0 === null || y1 === null) continue;
    const dur = (ph.t1 - ph.t0) * k;
    const rom = Math.abs(y1 - y0);
    if (dur <= 0 || rom < 0.05) continue; // under 5 cm: not a rep's worth of travel
    let peak = 0;
    const inside = bar.filter((p) => p.v !== null && p.t >= ph.t0 && p.t <= ph.t1) as { t: number; v: number }[];
    for (let i = 1; i < inside.length; i++) peak = Math.max(peak, Math.abs(inside[i].v - inside[i - 1].v) / ((inside[i].t - inside[i - 1].t) * k));
    const mean = rom / dur;
    reps.push({ t0: ph.t0 * k, t1: ph.t1 * k, mean, peak: Math.max(peak, mean), rom });
  }
  const out: SetVelocity = { point, side, scale: sc.scale, scaleFrom: sc.from, height: dims.height, timeScale: k, reps };
  if (reps.length) {
    const means = reps.map((r) => r.mean);
    const best = Math.max(...means);
    const bi = means.indexOf(best);
    out.best = best;
    out.first = means[0];
    out.last = means[means.length - 1];
    out.loss = Math.max(0, (best - out.last) / best);
    const durOf = (r: RepVelocity) => r.t1 - r.t0;
    out.slowdown = durOf(reps[reps.length - 1]) / durOf(reps[bi]);
  }
  return out;
}

/** The compact record kept on a media item (MediaItem.velocity), so lists and the RPE model needn't load tracks. */
export interface VelocitySummary {
  pattern: string;
  /** Mean lifting speed per rep, m/s. */
  v: number[];
  /** Peak speed per rep, m/s. */
  peak: number[];
  /** Travel per rep, m. */
  rom: number[];
  /** Lifting time per rep, s. */
  dur: number[];
  /** Height (m) the scale was based on, to rescale if it changes. */
  h: number;
  point: 'shoulder' | 'wrist';
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function velocitySummary(track: PoseTrack, pattern: string, dims: BodyDims, opts: { timeScale?: number } = {}): VelocitySummary | null {
  const s = setVelocity(track, pattern, dims, opts);
  if (!s || !s.reps.length) return null;
  return {
    pattern,
    v: s.reps.map((r) => r3(r.mean)),
    peak: s.reps.map((r) => r3(r.peak)),
    rom: s.reps.map((r) => r3(r.rom)),
    dur: s.reps.map((r) => r3(r.t1 - r.t0)),
    h: dims.height,
    point: s.point,
  };
}

/** Speeds rescaled to your current height (the scale is proportional to limb lengths). */
export function rescaled(v: VelocitySummary, height: number): VelocitySummary {
  const k = height / v.h;
  if (Math.abs(k - 1) < 1e-6) return v;
  return { ...v, v: v.v.map((x) => r3(x * k)), peak: v.peak.map((x) => r3(x * k)), rom: v.rom.map((x) => r3(x * k)), h: height };
}

/** Fatigue numbers from a summary: fastest, first and last rep, speed lost (0–1) and slowdown. */
export function fatigue(v: VelocitySummary): { best: number; first: number; last: number; loss: number; slowdown: number; reps: number } {
  const best = Math.max(...v.v);
  const bi = v.v.indexOf(best);
  const last = v.v[v.v.length - 1];
  return { best, first: v.v[0], last, loss: Math.max(0, (best - last) / best), slowdown: v.dur[v.dur.length - 1] / v.dur[bi], reps: v.v.length };
}
