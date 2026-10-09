// Guessing which movement pattern a clip shows, from how the tracked joints
// move: which angles change and by how much, where the hands are, whether the
// body is upright, folded or lying, and whether the legs alternate. Clear,
// common lifts are recognised; anything else is left for you to label. The
// guess is only a suggestion until you confirm it.
import type { PatternId } from '../movement/patterns';
import { detectReps, jointAngle, landmark, nearSide, smooth, type JointId, type PoseFrame, type PoseTrack, type SeriesPoint, type Side } from './analysis';

export interface Features {
  /** Share of frames with a person tracked. */
  seen: number;
  /** Range of each angle on the side nearer the camera (degrees, 10th to 90th percentile). */
  knee: number;
  hip: number;
  elbow: number;
  /** Torso tilt from vertical, typical and range (degrees). */
  lean: number;
  leanRange: number;
  /** Movement of the hips, in trunk lengths. */
  hipUpDown: number;
  hipAcross: number;
  /** Share of frames with the wrist above the nose, and whether it never drops below the shoulder. */
  overhead: number;
  handsAlwaysUp: boolean;
  /** Feet apart front to back, in trunk lengths (a split stance, seen side-on). */
  stance: number;
  /** Correlation of the two knees' angles: strongly negative when the legs alternate (walking, running). */
  legsAlternate: number;
  /** Shoulder width over trunk length (small side-on). */
  frontness: number;
  reps: number;
}

export interface PatternGuess {
  pattern: PatternId | null;
  confidence: number;
  why: string;
  features?: Features;
}

const pct = (v: number[], p: number) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
};
const range = (v: number[]) => pct(v, 0.9) - pct(v, 0.1);
const median = (v: number[]) => pct(v, 0.5);
const values = (s: SeriesPoint[]) => s.map((p) => p.v).filter((v): v is number => v !== null);

function series(track: PoseTrack, joint: JointId, side: Side): SeriesPoint[] {
  return smooth(track.frames.map((f) => ({ t: f.t, v: jointAngle(f, joint, side, track.width, track.height) })));
}

function mid(f: PoseFrame, a: string, b: string, min = 0.4): { x: number; y: number } | null {
  const p = landmark(f, a as never), q = landmark(f, b as never);
  if (!p || !q || p.v < min || q.v < min) return null;
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
}

function correlation(a: (number | null)[], b: (number | null)[]): number {
  const pairs = a.map((x, i) => [x, b[i]] as const).filter((p): p is readonly [number, number] => p[0] !== null && p[1] !== null);
  if (pairs.length < 8) return 0;
  const ma = pairs.reduce((s, p) => s + p[0], 0) / pairs.length, mb = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let sab = 0, saa = 0, sbb = 0;
  for (const [x, y] of pairs) {
    sab += (x - ma) * (y - mb);
    saa += (x - ma) ** 2;
    sbb += (y - mb) ** 2;
  }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}

export function features(track: PoseTrack): Features {
  const { width: w, height: h } = track;
  const frames = track.frames.filter((f) => f.lm);
  const side = nearSide(track);
  const knee = series(track, 'knee', side), hip = series(track, 'hip', side), elbow = series(track, 'elbow', side), lean = series(track, 'torsoLean', side);
  const trunk: number[] = [], hipX: number[] = [], hipY: number[] = [], wristUp: number[] = [], stance: number[] = [], front: number[] = [];
  let overhead = 0, counted = 0;
  for (const f of frames) {
    const sh = mid(f, 'left_shoulder', 'right_shoulder'), hp = mid(f, 'left_hip', 'right_hip');
    if (!sh || !hp) continue;
    const t = Math.hypot((sh.x - hp.x) * w, (sh.y - hp.y) * h);
    if (t <= 0) continue;
    trunk.push(t);
    hipX.push(hp.x * w);
    hipY.push(hp.y * h);
    const wr = landmark(f, `${side}_wrist`), nose = landmark(f, 'nose'), s = landmark(f, `${side}_shoulder`);
    if (wr && wr.v > 0.4 && s) {
      counted++;
      if (nose && wr.y < nose.y) overhead++;
      wristUp.push(((s.y - wr.y) * h) / t);
    }
    const la = landmark(f, 'left_ankle'), ra = landmark(f, 'right_ankle');
    if (la && ra && la.v > 0.4 && ra.v > 0.4) stance.push((Math.abs(la.x - ra.x) * w) / t);
    const ls = landmark(f, 'left_shoulder'), rs = landmark(f, 'right_shoulder');
    if (ls && rs) front.push((Math.hypot((ls.x - rs.x) * w, (ls.y - rs.y) * h)) / t);
  }
  const T = median(trunk) || 1;
  const kneeL = series(track, 'knee', 'left').map((p) => p.v), kneeR = series(track, 'knee', 'right').map((p) => p.v);
  const primary: Record<string, SeriesPoint[]> = { knee, hip, elbow };
  let reps = 0;
  for (const s of Object.values(primary)) reps = Math.max(reps, detectReps(s).length);
  return {
    seen: track.frames.length ? frames.length / track.frames.length : 0,
    knee: range(values(knee)),
    hip: range(values(hip)),
    elbow: range(values(elbow)),
    lean: median(values(lean)),
    leanRange: range(values(lean)),
    hipUpDown: range(hipY) / T,
    hipAcross: range(hipX) / T,
    overhead: counted ? overhead / counted : 0,
    handsAlwaysUp: wristUp.length > 5 && pct(wristUp, 0.1) > 0.25,
    stance: median(stance),
    legsAlternate: correlation(kneeL, kneeR),
    frontness: median(front),
    reps,
  };
}

const clamp = (x: number, lo = 0.3, hi = 0.95) => Math.max(lo, Math.min(hi, x));

/** The pattern the joints' movement suggests, or null when it isn't clear. */
export function guessPattern(track: PoseTrack): PatternGuess {
  const f = features(track);
  const fail = (why: string): PatternGuess => ({ pattern: null, confidence: 0, why, features: f });
  if (f.seen < 0.4 || track.frames.filter((x) => x.lm).length < 10) return fail('The person was tracked in too few frames to tell.');
  const repBonus = f.reps >= 2 ? 0.1 : 0;
  const sideOn = f.frontness < 0.5 ? 0.05 : -0.1;
  const guess = (pattern: PatternId, confidence: number, why: string): PatternGuess => ({ pattern, confidence: clamp(confidence + repBonus), why, features: f });

  // lying or in a plank: pressing away from the floor or a bench
  if (f.lean > 60) {
    if (f.elbow >= 40) return guess('pushH', 0.65 + (f.elbow - 40) / 200, 'The body is horizontal and the elbows bend and straighten: a bench press or push-up.');
    return fail('The body is horizontal but the arms barely move.');
  }
  // hands stay overhead while the elbows work: pull-up or pulldown
  if (f.handsAlwaysUp && f.elbow >= 40 && f.knee < 40) return guess('pullV', 0.7, 'The hands stay above the head while the elbows bend: a pull-up or pulldown.');
  // hands travel from the shoulders to overhead
  if (f.overhead > 0.15 && f.overhead < 0.92 && f.elbow >= 50 && f.knee < 35) return guess('pushV', 0.65 + (f.elbow - 50) / 300, 'The hands go from the shoulders to overhead: an overhead press.');
  // legs taking turns, or travelling across the frame
  if ((f.legsAlternate < -0.4 && f.knee > 25) || f.hipAcross > 2) return guess('gait', 0.6 + Math.min(0.2, -f.legsAlternate / 4), 'The legs alternate: walking or running.');
  if (f.knee >= 35 || f.hip >= 35) {
    if (f.stance > 1.1 && f.knee >= 35) return guess('lunge', 0.6 + sideOn, 'One foot in front of the other while the knees bend: a lunge or split squat.');
    const ratio = f.knee / Math.max(1, f.hip);
    if (ratio >= 0.55 && f.knee >= 40) return guess('squat', 0.6 + Math.min(0.2, (ratio - 0.55) / 2) + sideOn, 'Knees and hips bend together: a squat.');
    if (f.hip >= 35 && ratio < 0.55) return guess('hinge', 0.6 + Math.min(0.2, (0.55 - ratio) / 2) + sideOn, 'The hips fold while the knees stay fairly straight: a deadlift, RDL or swing.');
  }
  // folded forward, pulling with the arms while the legs hold still
  if (f.lean >= 25 && f.lean <= 70 && f.elbow >= 40 && f.knee < 25 && f.hip < 30) return guess('pullH', 0.6, 'Bent forward with the arms pulling: a row.');
  return fail('The movement didn’t match a pattern clearly.');
}

/** Patterns logged in workouts on the same day as the clip. */
export function loggedThatDay(date: number, exercises: { date: number; pattern?: PatternId }[]): PatternId[] {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const end = start + 86_400_000;
  return [...new Set(exercises.filter((e) => e.pattern && e.date >= start && e.date < end).map((e) => e.pattern!))];
}

export interface Suggestion {
  pattern: PatternId | null;
  confidence: number;
  from: 'movement' | 'log' | 'both' | null;
  why: string;
  /** Other patterns logged that day, offered as quick choices. */
  options: PatternId[];
}

/** The movement guess, weighed against what you logged that day. */
export function suggest(move: PatternGuess, logged: PatternId[]): Suggestion {
  if (move.pattern && logged.includes(move.pattern))
    return { pattern: move.pattern, confidence: Math.max(0.9, move.confidence), from: 'both', why: `${move.why} You also logged it that day.`, options: logged };
  if (logged.length === 1 && !move.pattern) return { pattern: logged[0], confidence: 0.75, from: 'log', why: 'The only movement you logged that day.', options: logged };
  if (logged.length === 1 && move.pattern)
    // the two disagree: keep the movement's reading but trust it less
    return { pattern: move.pattern, confidence: Math.min(move.confidence, 0.55), from: 'movement', why: `${move.why} (You logged something else that day.)`, options: logged };
  return { pattern: move.pattern, confidence: move.confidence, from: move.pattern ? 'movement' : null, why: move.why, options: logged };
}
