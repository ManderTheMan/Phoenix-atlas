// How hard a set was (RPE, or reps in reserve: RIR = 10 − RPE), estimated two
// ways and learned from the RPE you enter:
//
// - From the load: your estimated one-rep max (e1RM) for the lift says how many
//   reps the weight allowed (Epley: 1RM = load × (1 + reps / 30)); the reps you
//   did leave the rest in reserve.
// - From the video: a set slows down as it nears failure. The last rep's speed
//   and the speed lost since the fastest rep map to reps in reserve, through a
//   small linear model per movement that starts from typical bar-speed figures
//   and is refitted to your own sets each time you enter an RPE (Bayesian, so
//   a few sets move it a little and many sets move it a lot).
//
// The two are combined by how accurate each has been for you so far. Everything
// is replayed in date order, so each set is first predicted, then learned from:
// the errors along the way show how the estimate improves with use.
import type { MediaItem, Note } from '../db/db';
import { startOfDay } from '../lib/dates';
import { fatigue, rescaled } from '../vision/velocity';
import { classifyExercise, PATTERN_BY_ID, type PatternId } from './patterns';

const DAY = 86_400_000;
const LB = 0.45359237;

export interface SetSpeed {
  best: number;
  last: number;
  loss: number;
  slowdown: number;
  reps: number;
}

/** One set: what was lifted, how it moved on video, and how hard it felt (when you said). */
export interface SetObservation {
  id: string;
  date: number;
  /** Key for the lift's max, from the exercise name ("back squat"). */
  lift: string;
  name: string;
  pattern?: PatternId;
  /** kg */
  load?: number;
  reps?: number;
  /** Your RPE for the set (the last set, for logged exercises). */
  rpe?: number;
  speed?: SetSpeed;
  mediaId?: string;
  noteId?: string;
}

export const liftKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const kg = (load: number | undefined, unit: 'kg' | 'lb' | undefined) => (load === undefined ? undefined : unit === 'lb' ? load * LB : load);
const validRpe = (r: number | undefined) => (typeof r === 'number' && r >= 1 && r <= 10 ? r : undefined);

/** The sets in your log and your clips. A clip and a logged exercise on the same day, same movement and load are the same set. */
export function observations(notes: Note[], media: MediaItem[], height: number): SetObservation[] {
  const out: SetObservation[] = [];
  for (const n of notes)
    (n.workout?.exercises ?? []).forEach((ex, i) => {
      const load = kg(ex.load, ex.unit);
      const rpe = validRpe(ex.rpe);
      if (!load && !rpe) return;
      out.push({ id: `${n.id}:${i}`, date: n.date, lift: liftKey(ex.name), name: ex.name, pattern: classifyExercise(ex.name)?.pattern, load, reps: ex.reps, rpe, noteId: n.id });
    });
  const byDay = new Map<number, SetObservation[]>();
  for (const o of out) byDay.set(startOfDay(o.date), [...(byDay.get(startOfDay(o.date)) ?? []), o]);
  const used = new Set<string>();
  for (const m of media) {
    if (m.kind !== 'video' || !m.pattern || m.owner) continue;
    const pattern = m.pattern as PatternId;
    const v = m.velocity && m.velocity.pattern === m.pattern && m.velocity.v.length ? rescaled(m.velocity, height) : undefined;
    const rpe = validRpe(m.rpe);
    if (!v && !rpe) continue;
    const speed = v ? fatigue(v) : undefined;
    const reps = m.reps ?? speed?.reps ?? m.tracked?.reps;
    const match = (byDay.get(startOfDay(m.date)) ?? []).find(
      (o) => !used.has(o.id) && o.pattern === pattern && (o.load === undefined || m.load === undefined || Math.abs(o.load - m.load) <= 2.5),
    );
    if (match) {
      used.add(match.id);
      match.speed = speed;
      match.mediaId = m.id;
      match.rpe = rpe ?? match.rpe;
      match.load ??= m.load;
      match.reps ??= reps;
      continue;
    }
    const def = PATTERN_BY_ID.get(pattern);
    const name = def?.variants.find((x) => x.value === m.variant)?.label ?? def?.name ?? pattern;
    out.push({ id: `media:${m.id}`, date: m.date, lift: liftKey(name), name, pattern, load: m.load, reps, rpe, speed, mediaId: m.id });
  }
  return out.sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- the load side

/** Reps possible at a share of the max (Epley, inverted). */
export const maxRepsAt = (load: number, e1rm: number) => 30 * (e1rm / load - 1);
/** Max from a set: the reps done plus those left in reserve. */
export const e1rmFrom = (load: number, reps: number, rir = 0) => load * (1 + (reps + rir) / 30);
/** RPE from the load against a max (10 − reps in reserve). */
export const rpeFromLoad = (load: number, reps: number, e1rm: number) => 10 - (maxRepsAt(load, e1rm) - reps);

interface MaxPoint {
  date: number;
  value: number;
  /** From a set with an RPE (true), or only a lower bound from a set without one. */
  exact: boolean;
}

export interface MaxEstimate {
  value: number;
  /** Only lower bounds so far (no set with an RPE), or the latest exact one is old. */
  rough: boolean;
  from: number;
}

/**
 * The lift's max at a date. From sets with an RPE in the last four months,
 * weighted to the newest (half-life 6 weeks): when they span a few weeks, a
 * weighted straight-line fit follows a lifter who is getting stronger (or
 * weaker) rather than lagging behind, carried forward at most a month; otherwise
 * their weighted average. Never below a recent all-out lower bound.
 */
export function maxAt(points: MaxPoint[], date: number): MaxEstimate | null {
  const recent: { age: number; value: number; w: number }[] = [];
  let newest = 0, lb = 0;
  for (const p of points) {
    if (p.date >= date) continue;
    const age = (date - p.date) / DAY;
    if (p.exact && age <= 120) {
      recent.push({ age, value: p.value, w: 0.5 ** (age / 42) });
      newest = Math.max(newest, p.date);
    }
    if (!p.exact && age <= 60) lb = Math.max(lb, p.value);
  }
  if (!recent.length) return lb ? { value: lb * 1.05, rough: true, from: 0 } : null; // sets usually stop a rep or two short
  const ws = recent.reduce((s, r) => s + r.w, 0);
  const meanAge = recent.reduce((s, r) => s + r.w * r.age, 0) / ws;
  const meanV = recent.reduce((s, r) => s + r.w * r.value, 0) / ws;
  let value = meanV;
  const spread = Math.max(...recent.map((r) => r.age)) - Math.min(...recent.map((r) => r.age));
  if (recent.length >= 3 && spread >= 14) {
    const sxx = recent.reduce((s, r) => s + r.w * (r.age - meanAge) ** 2, 0);
    const sxy = recent.reduce((s, r) => s + r.w * (r.age - meanAge) * (r.value - meanV), 0);
    // change per day of age (so per day back in time): the max today is the mean carried forward
    const perDay = sxy / sxx;
    const ahead = Math.min(meanAge, meanAge - Math.min(...recent.map((r) => r.age)) + 30);
    value = meanV - perDay * ahead;
  }
  return { value: Math.max(value, lb), rough: (date - newest) / DAY > 60, from: recent.length };
}

// ---------------------------------------------------------------- the speed side

/** Typical figures per movement: speed at failure (m/s), speed per rep in reserve near failure, and the speed lost by failure (0–1). */
const SPEED_PRIOR: Partial<Record<PatternId, { mvt: number; perRep: number; lossAtFailure: number }>> = {
  squat: { mvt: 0.3, perRep: 0.065, lossAtFailure: 0.45 },
  lunge: { mvt: 0.3, perRep: 0.065, lossAtFailure: 0.45 },
  hinge: { mvt: 0.18, perRep: 0.05, lossAtFailure: 0.35 },
  pushH: { mvt: 0.17, perRep: 0.045, lossAtFailure: 0.5 },
  pushV: { mvt: 0.19, perRep: 0.05, lossAtFailure: 0.45 },
  pullH: { mvt: 0.4, perRep: 0.07, lossAtFailure: 0.4 },
  pullV: { mvt: 0.25, perRep: 0.06, lossAtFailure: 0.45 },
};

export interface SpeedModel {
  /** RIR = mu · [1, last rep speed, speed lost]. */
  mu: number[];
  sigma: number[][];
  /** Sets you've rated that it learned from. */
  n: number;
}

/** The starting model: half from the last rep's speed above failure speed, half from the share of speed lost. */
export function priorSpeedModel(pattern: PatternId): SpeedModel | null {
  const p = SPEED_PRIOR[pattern];
  if (!p) return null;
  const rirAtNoLoss = 5;
  const a = 0.5 * (-p.mvt / p.perRep) + 0.5 * rirAtNoLoss;
  const b = 0.5 / p.perRep;
  const c = -0.5 * (rirAtNoLoss / p.lossAtFailure);
  return { mu: [a, b, c], sigma: [[1.5 ** 2, 0, 0], [0, (0.3 * b) ** 2, 0], [0, 0, (0.4 * c) ** 2]], n: 0 };
}

const features = (s: SetSpeed) => [1, s.last, s.reps > 1 ? s.loss : 0];
const dotv = (a: number[], b: number[]) => a.reduce((t, x, i) => t + x * b[i], 0);
const matv = (m: number[][], v: number[]) => m.map((row) => dotv(row, v));

export function speedPredict(m: SpeedModel, s: SetSpeed, noise2: number): { rir: number; var: number } {
  const x = features(s);
  return { rir: dotv(m.mu, x), var: noise2 + dotv(x, matv(m.sigma, x)) };
}

/** Bayesian update with one rated set (rank-one, so no matrix inverse). */
export function speedLearn(m: SpeedModel, s: SetSpeed, rir: number, noise2: number): SpeedModel {
  const x = features(s);
  const sx = matv(m.sigma, x);
  const denom = noise2 + dotv(x, sx);
  const err = rir - dotv(m.mu, x);
  return {
    mu: m.mu.map((v, i) => v + (sx[i] * err) / denom),
    sigma: m.sigma.map((row, i) => row.map((v, j) => v - (sx[i] * sx[j]) / denom)),
    n: m.n + 1,
  };
}

/** Speed at failure (m/s) the model implies, having lost the movement's typical share of speed by then (for its starting figures; once it has learned, see speedAtFailure). */
export function failureSpeed(m: SpeedModel, pattern: PatternId): number | null {
  const p = SPEED_PRIOR[pattern];
  if (!p || m.mu[1] <= 0) return null;
  return -(m.mu[0] + m.mu[2] * p.lossAtFailure) / m.mu[1];
}

// ---------------------------------------------------------------- combined

export interface RpePart {
  rpe: number;
  sd: number;
}

export interface RpeEstimate extends RpePart {
  fromLoad?: RpePart & { e1rm: number; rough: boolean };
  fromSpeed?: RpePart & { learnedFrom: number };
}

/** Running accuracy of one estimate (RIR units), starting from a typical ±1.5 worth three sets. */
class Spread {
  private sum2 = 1.5 ** 2 * 3;
  private n = 3;
  add(err: number) {
    this.sum2 += err * err;
    this.n++;
  }
  get var() {
    return this.sum2 / this.n;
  }
}

const clampRpe = (r: number) => Math.max(5, Math.min(10, r));

export interface HistoryPoint {
  id: string;
  date: number;
  name: string;
  /** What you said. */
  rpe: number;
  /** What it would have guessed before you said (combined, and each side when available). */
  guess?: number;
  load?: number;
  speed?: number;
}

export interface RpeLearner {
  estimate: (o: Pick<SetObservation, 'date' | 'lift' | 'pattern' | 'load' | 'reps' | 'speed'>) => RpeEstimate | null;
  maxAt: (lift: string, date?: number) => MaxEstimate | null;
  maxes: Map<string, MaxPoint[]>;
  speedModels: Map<PatternId, SpeedModel>;
  history: HistoryPoint[];
  /** Typical error (RPE) of each estimate so far. */
  spread: { load: number; speed: number };
}

/** Replays every set in date order: predict, then learn from your RPE when you gave one. */
export function learnRpe(obs: SetObservation[]): RpeLearner {
  const maxes = new Map<string, MaxPoint[]>();
  const speedModels = new Map<PatternId, SpeedModel>();
  const loadSpread = new Spread(), speedSpread = new Spread();
  /** How far off the load side has been for each lift (reps in reserve: you said − it guessed). */
  const loadBias = new Map<string, { sum: number; n: number }>();
  const biasOf = (lift: string) => {
    const b = loadBias.get(lift);
    return b ? b.sum / (b.n + 3) : 0; // shrunk towards none until there are a few sets
  };
  const history: HistoryPoint[] = [];

  const modelFor = (p: PatternId | undefined) => {
    if (!p) return null;
    let m = speedModels.get(p);
    if (!m) {
      const prior = priorSpeedModel(p);
      if (!prior) return null;
      speedModels.set(p, (m = prior));
    }
    return m;
  };

  const estimate: RpeLearner['estimate'] = (o) => {
    let fromLoad: RpeEstimate['fromLoad'], fromSpeed: RpeEstimate['fromSpeed'];
    let loadRir: { rir: number; var: number } | null = null, speedRir: { rir: number; var: number } | null = null;
    if (o.load && o.reps) {
      const mx = maxAt(maxes.get(o.lift) ?? [], o.date);
      if (mx) {
        const rir = maxRepsAt(o.load, mx.value) - o.reps + biasOf(o.lift);
        loadRir = { rir, var: loadSpread.var + (mx.rough ? 1 : 0) };
        fromLoad = { rpe: clampRpe(10 - rir), sd: Math.sqrt(loadRir.var), e1rm: mx.value, rough: mx.rough };
      }
    }
    const m = o.speed ? modelFor(o.pattern) : null;
    if (m && o.speed) {
      speedRir = speedPredict(m, o.speed, speedSpread.var);
      fromSpeed = { rpe: clampRpe(10 - speedRir.rir), sd: Math.sqrt(speedRir.var), learnedFrom: m.n };
    }
    if (!loadRir && !speedRir) return null;
    const parts = [loadRir, speedRir].filter((p): p is { rir: number; var: number } => !!p);
    const w = parts.map((p) => 1 / p.var);
    const rir = parts.reduce((s, p, i) => s + p.rir * w[i], 0) / w.reduce((a, b) => a + b, 0);
    return { rpe: clampRpe(10 - rir), sd: Math.sqrt(1 / w.reduce((a, b) => a + b, 0)), fromLoad, fromSpeed };
  };

  for (const o of obs) {
    if (o.rpe !== undefined) {
      const guess = estimate(o);
      if (guess) {
        history.push({ id: o.id, date: o.date, name: o.name, rpe: o.rpe, guess: guess.rpe, load: guess.fromLoad?.rpe, speed: guess.fromSpeed?.rpe });
        if (guess.fromLoad) {
          loadSpread.add(guess.fromLoad.rpe - o.rpe);
          const b = loadBias.get(o.lift) ?? { sum: 0, n: 0 };
          loadBias.set(o.lift, { sum: b.sum + (guess.fromLoad.rpe - o.rpe), n: b.n + 1 });
        }
        if (guess.fromSpeed) speedSpread.add(guess.fromSpeed.rpe - o.rpe);
      } else history.push({ id: o.id, date: o.date, name: o.name, rpe: o.rpe });
      const m = o.speed ? modelFor(o.pattern) : null;
      if (m && o.speed && o.pattern) speedModels.set(o.pattern, speedLearn(m, o.speed, 10 - o.rpe, speedSpread.var));
    }
    // what the set says about the lift's max
    if (o.load && o.reps) {
      const list = maxes.get(o.lift) ?? [];
      list.push(o.rpe !== undefined ? { date: o.date, value: e1rmFrom(o.load, o.reps, 10 - o.rpe), exact: true } : { date: o.date, value: e1rmFrom(o.load, o.reps), exact: false });
      maxes.set(o.lift, list);
    }
  }
  return {
    estimate,
    maxAt: (lift, date = Date.now() + 1) => maxAt(maxes.get(lift) ?? [], date),
    maxes,
    speedModels,
    history,
    spread: { load: Math.sqrt(loadSpread.var), speed: Math.sqrt(speedSpread.var) },
  };
}

/** Average miss (RPE) over each run of `window` rated sets: how the estimate has improved with use. */
export function accuracyOverTime(history: HistoryPoint[], window = 8): { date: number; error: number; sets: number }[] {
  const guessed = history.filter((h) => h.guess !== undefined);
  const out: { date: number; error: number; sets: number }[] = [];
  for (let i = window - 1; i < guessed.length; i++) {
    const run = guessed.slice(i - window + 1, i + 1);
    out.push({ date: guessed[i].date, error: run.reduce((s, h) => s + Math.abs(h.guess! - h.rpe), 0) / run.length, sets: i + 1 });
  }
  return out;
}

/**
 * Your max from bar speed alone: the first rep's speed falls in a straight line as
 * the load rises, so a few clips at different loads (recent, same lift) extend to
 * the load you could lift at failure speed. Needs three loads spread over 15%.
 */
export function maxFromSpeed(obs: SetObservation[], lift: string, mvt: number, at = Date.now()): { e1rm: number; points: number } | null {
  const pts = obs.filter((o) => o.lift === lift && o.load && o.speed && o.date <= at && at - o.date <= 120 * DAY).map((o) => ({ x: o.load!, y: o.speed!.best }));
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p.x);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if ((Math.max(...xs) - Math.min(...xs)) / mean < 0.15) return null;
  const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const sxx = pts.reduce((a, p) => a + (p.x - mean) ** 2, 0), sxy = pts.reduce((a, p) => a + (p.x - mean) * (p.y - my), 0);
  const slope = sxy / sxx;
  if (slope >= 0) return null; // heavier wasn't slower: not enough to go on
  const e1rm = mean + (mvt - my) / slope;
  return e1rm > Math.max(...xs) * 0.9 ? { e1rm, points: pts.length } : null;
}

/**
 * Your own speed at failure for a movement: the last rep's speed against reps in
 * reserve across the sets you rated, extended to zero reps in reserve. Needs four
 * rated sets spread over at least two RPE points.
 */
export function speedAtFailure(obs: SetObservation[], pattern: PatternId): { speed: number; perRep: number; sets: number } | null {
  const pts = obs.filter((o) => o.pattern === pattern && o.rpe !== undefined && o.speed).map((o) => ({ x: 10 - o.rpe!, y: o.speed!.last }));
  if (pts.length < 4) return null;
  const xs = pts.map((p) => p.x);
  if (Math.max(...xs) - Math.min(...xs) < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0), sxy = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
  const perRep = sxy / sxx;
  if (perRep <= 0) return null;
  return { speed: my - perRep * mx, perRep, sets: pts.length };
}
