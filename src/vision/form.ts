// What each rep looked like, in the numbers a coach watches for that lift:
// depth, trunk angle, how far the bar strays from over the middle of the foot,
// hips rising first in a deadlift, lean-back in a press, swing in a pull-up.
// Measured per rep from the joint track, then compared across the set (does
// form change as fatigue sets in?) and against your own earlier clips.
import type { MediaItem } from '../db/db';
import type { BodyDims } from '../model/bodyShape';
import { angleSeries, jointAngle, landmark, nearSide, smooth, type LandmarkName, type PoseFrame, type PoseTrack, type Side } from './analysis';
import { BAR_POINT, LIFT_JOINT, pixelScale, travel, turningPoints } from './velocity';

export type FormMarkerId =
  | 'depth'
  | 'hipBelowKnee'
  | 'trunkLean'
  | 'shin'
  | 'barDrift'
  | 'backAngle'
  | 'hipsFirst'
  | 'lockout'
  | 'barTravel'
  | 'pause'
  | 'leanBack'
  | 'topElbow'
  | 'swing'
  | 'torsoMove'
  | 'down'
  | 'up';

export interface FormMarkerDef {
  label: string;
  unit: '°' | 'cm' | 's' | '×';
  what: string;
  /** Which way is worse, for flagging a change across the set or from your usual ('either': worth a mention, not a warning). */
  worse: 'higher' | 'lower' | 'either';
  /** How big a change is worth a mention. */
  notable: number;
}

export const FORM_MARKERS: Record<FormMarkerId, FormMarkerDef> = {
  depth: { label: 'Knee at the bottom', unit: '°', what: 'Smallest knee angle (180° is straight): lower is deeper.', worse: 'higher', notable: 6 },
  hipBelowKnee: { label: 'Hip below knee', unit: 'cm', what: 'How far the hip ends up below the knee at the bottom (negative: above it, so above parallel).', worse: 'lower', notable: 3 },
  trunkLean: { label: 'Trunk lean', unit: '°', what: 'Trunk from vertical: at the bottom of a squat or lunge, on average through a row.', worse: 'higher', notable: 5 },
  shin: { label: 'Shin angle at the bottom', unit: '°', what: 'Shin from vertical: how far the knees travel forward.', worse: 'either', notable: 5 },
  barDrift: { label: 'Bar off mid-foot', unit: 'cm', what: 'Furthest the bar gets in front of (+) or behind (−) the middle of the foot while lifting.', worse: 'either', notable: 3 },
  backAngle: { label: 'Back angle off the floor', unit: '°', what: 'Trunk from vertical as the bar leaves the floor.', worse: 'either', notable: 5 },
  hipsFirst: { label: 'Hips vs shoulders rising', unit: '×', what: 'Early in the pull, how much faster the hips rise than the shoulders (1: together; well above 1: the hips shoot up first).', worse: 'higher', notable: 0.3 },
  lockout: { label: 'Hip at lockout', unit: '°', what: 'Hip angle at the top: near 180° is fully locked out.', worse: 'lower', notable: 5 },
  barTravel: { label: 'Bar path to lockout', unit: 'cm', what: 'How far the bar moves towards the head (+) or feet (−) from the chest to lockout.', worse: 'either', notable: 3 },
  pause: { label: 'Pause at the bottom', unit: 's', what: 'Time spent near the bottom.', worse: 'either', notable: 0.3 },
  leanBack: { label: 'Lean back', unit: '°', what: 'Most the trunk leans back while pressing.', worse: 'higher', notable: 4 },
  topElbow: { label: 'Elbow at the top', unit: '°', what: 'Smallest elbow angle at the top of the pull: lower is a fuller pull.', worse: 'higher', notable: 8 },
  swing: { label: 'Hip swing', unit: 'cm', what: 'How far the hips swing forward and back of the shoulders during the rep (kipping).', worse: 'higher', notable: 4 },
  torsoMove: { label: 'Torso movement', unit: '°', what: 'How much the trunk angle changes during the rep (body English).', worse: 'higher', notable: 5 },
  down: { label: 'Time down', unit: 's', what: 'Lowering time, pauses at either end left out.', worse: 'either', notable: 0.4 },
  up: { label: 'Time up', unit: 's', what: 'Lifting time, pauses at either end left out.', worse: 'higher', notable: 0.3 },
};

/** The markers that matter for each pattern, in display order. */
export const MARKERS_FOR: Record<string, FormMarkerId[]> = {
  squat: ['depth', 'hipBelowKnee', 'trunkLean', 'shin', 'barDrift', 'down', 'up'],
  lunge: ['depth', 'trunkLean', 'shin', 'down', 'up'],
  hinge: ['backAngle', 'hipsFirst', 'barDrift', 'lockout', 'down', 'up'],
  pushH: ['barTravel', 'pause', 'down', 'up'],
  pushV: ['barDrift', 'leanBack', 'down', 'up'],
  pullV: ['topElbow', 'swing', 'up', 'down'],
  pullH: ['trunkLean', 'torsoMove', 'up', 'down'],
};

export const hasForm = (pattern: string | undefined): boolean => !!pattern && pattern in MARKERS_FOR;

export type RepForm = Partial<Record<FormMarkerId, number>>;

type Span = { t0: number; t1: number };
export interface RepWindow {
  /** From the turn before to the turn after (the high points for a squat or press; the hangs for a pull-up). */
  t0: number;
  t1: number;
  /** The turning point: the bottom of a squat or press, the top of a pull. */
  turn: number;
  up: Span;
  down: Span | null;
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const frameAt = (track: PoseTrack, t: number): PoseFrame | null => {
  let best: PoseFrame | null = null, d = Infinity;
  for (const f of track.frames) if (Math.abs(f.t - t) < d) (d = Math.abs(f.t - t)), (best = f);
  return best;
};

/** The reps of a set: each around a low point of the pattern's joint angle (bottom of a squat or press, top of a pull), with its lowering and lifting phases. */
export function repWindows(track: PoseTrack, pattern: string, side: Side = nearSide(track)): RepWindow[] {
  const def = LIFT_JOINT[pattern];
  if (!def) return [];
  const ang = smooth(angleSeries(track, def.joint, side));
  const turns = turningPoints(ang, def.minRom);
  const out: RepWindow[] = [];
  turns.forEach((tp, i) => {
    if (tp.kind !== 'low') return;
    const prev = turns[i - 1], next = turns[i + 1];
    const into = prev ? travel(ang, prev, tp) : null, outOf = next ? travel(ang, tp, next) : null;
    const opens = def.lift === 'opens';
    // a rep needs its lifting phase; a lone half at the clip's edge isn't one
    const up = opens ? outOf : into;
    if (!up) return;
    out.push({ t0: prev?.t ?? tp.t, turn: tp.t, t1: next?.t ?? tp.t, up, down: opens ? into : outOf });
  });
  return out;
}

/** The middle of the foot (x, pixels) and which way the lifter faces (+1: towards +x), from heel and toe. */
function footFrame(track: PoseTrack, side: Side): { mid: number; facing: 1 | -1 } | null {
  const mids: number[] = [], dirs: number[] = [];
  for (const f of track.frames) {
    const heel = landmark(f, `${side}_heel`), toe = landmark(f, `${side}_foot_index`);
    if (!heel || !toe || heel.v < 0.5 || toe.v < 0.5) continue;
    mids.push(((heel.x + toe.x) / 2) * track.width);
    dirs.push(toe.x - heel.x);
  }
  if (mids.length < 3) return null;
  return { mid: median(mids), facing: median(dirs) >= 0 ? 1 : -1 };
}

/** Which way the head is along x (+1: towards +x), from hip to shoulder: for lifts done lying down. */
function headward(track: PoseTrack, side: Side): 1 | -1 | null {
  const d: number[] = [];
  for (const f of track.frames) {
    const h = landmark(f, `${side}_hip`), s = landmark(f, `${side}_shoulder`);
    if (h && s && h.v >= 0.5 && s.v >= 0.5) d.push(s.x - h.x);
  }
  return d.length ? (median(d) >= 0 ? 1 : -1) : null;
}

/** Each rep's form markers for the pattern. Distances need your limb lengths (for the scale) and are left out without one; times are in real seconds (timeScale for slow motion). */
export function setForm(track: PoseTrack, pattern: string, dims: BodyDims, opts: { timeScale?: number } = {}): RepForm[] {
  const ids = MARKERS_FOR[pattern];
  if (!ids || track.frames.length < 5) return [];
  const want = new Set(ids);
  const side = nearSide(track);
  const k = opts.timeScale ?? 1;
  const sc = pixelScale(track, dims, side)?.scale;
  const cm = (px: number) => (sc ? px * sc * 100 : undefined);
  const foot = footFrame(track, side);
  const W = track.width, H = track.height;
  const P = (f: PoseFrame | null, n: string) => {
    const p = f ? landmark(f, `${side}_${n}` as LandmarkName) : null;
    return p && p.v >= 0.5 ? { x: p.x * W, y: p.y * H } : null;
  };
  const angle = (f: PoseFrame | null, j: Parameters<typeof jointAngle>[1]) => (f ? jointAngle(f, j, side, W, H) : null);
  const framesIn = (a: number, b: number) => track.frames.filter((f) => f.t >= a - 1e-6 && f.t <= b + 1e-6);
  const bar = BAR_POINT[pattern] ?? 'wrist';

  return repWindows(track, pattern, side).map((w) => {
    const r: Partial<Record<FormMarkerId, number | null | undefined>> = {};
    const turn = frameAt(track, w.turn);
    const lift = w.up;
    if (want.has('down') && w.down) r.down = (w.down.t1 - w.down.t0) * k;
    if (want.has('up')) r.up = (lift.t1 - lift.t0) * k;
    if (want.has('depth')) r.depth = angle(turn, 'knee');
    if (want.has('shin')) r.shin = angle(turn, 'shinAngle');
    if (want.has('trunkLean') && pattern !== 'pullH') r.trunkLean = angle(turn, 'torsoLean');
    if (want.has('hipBelowKnee')) {
      const hip = P(turn, 'hip'), knee = P(turn, 'knee');
      if (hip && knee) r.hipBelowKnee = cm(hip.y - knee.y);
    }
    if (want.has('barDrift') && foot) {
      let far = 0, seen = false;
      for (const f of framesIn(lift.t0, lift.t1)) {
        const b = P(f, bar);
        if (!b) continue;
        seen = true;
        const off = (b.x - foot.mid) * foot.facing;
        if (Math.abs(off) > Math.abs(far)) far = off;
      }
      if (seen) r.barDrift = cm(far);
    }
    if (want.has('backAngle')) r.backAngle = angle(frameAt(track, lift.t0), 'torsoLean');
    if (want.has('hipsFirst')) {
      // the first 40% of the pull's time: the hip's rise against the shoulder's
      const a = frameAt(track, lift.t0), b = frameAt(track, lift.t0 + 0.4 * (lift.t1 - lift.t0));
      const h0 = P(a, 'hip'), h1 = P(b, 'hip'), s0 = P(a, 'shoulder'), s1 = P(b, 'shoulder');
      if (h0 && h1 && s0 && s1 && s0.y - s1.y > 0.005 * H) r.hipsFirst = (h0.y - h1.y) / (s0.y - s1.y);
    }
    if (want.has('lockout')) {
      const top = framesIn(lift.t1, w.t1 + 0.3).map((f) => angle(f, 'hip')).filter((v): v is number => v !== null);
      if (top.length) r.lockout = Math.max(...top);
    }
    if (want.has('barTravel')) {
      const head = headward(track, side);
      const a = P(frameAt(track, lift.t0), 'wrist'), b = P(frameAt(track, lift.t1), 'wrist');
      if (a && b && head) r.barTravel = cm((b.x - a.x) * head);
    }
    if (want.has('pause')) {
      const pts = framesIn(w.t0, w.t1)
        .map((f) => ({ t: f.t, v: angle(f, 'elbow') }))
        .filter((p): p is { t: number; v: number } => p.v !== null);
      if (pts.length > 2) {
        const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
        const near = pts.filter((p) => p.v <= lo + 0.08 * (hi - lo));
        r.pause = near.length ? (near[near.length - 1].t - near[0].t) * k : 0;
      }
    }
    if (want.has('leanBack') && foot) {
      let most = 0;
      for (const f of framesIn(lift.t0, lift.t1)) {
        const h = P(f, 'hip'), s = P(f, 'shoulder');
        if (h && s) most = Math.max(most, (Math.atan2((h.x - s.x) * foot.facing, h.y - s.y) * 180) / Math.PI);
      }
      r.leanBack = most;
    }
    if (want.has('topElbow')) r.topElbow = angle(turn, 'elbow');
    if (want.has('swing')) {
      // the hips against the shoulders, so the body's own arc under the bar (and a moving camera) don't count
      const xs = framesIn(w.t0, w.t1)
        .map((f) => {
          const h = P(f, 'hip'), s = P(f, 'shoulder');
          return h && s ? h.x - s.x : undefined;
        })
        .filter((x): x is number => x !== undefined);
      if (xs.length > 2) r.swing = cm(Math.max(...xs) - Math.min(...xs));
    }
    if (pattern === 'pullH') {
      const leans = framesIn(w.t0, w.t1).map((f) => angle(f, 'torsoLean')).filter((v): v is number => v !== null);
      if (leans.length) {
        r.trunkLean = leans.reduce((a, b) => a + b, 0) / leans.length;
        r.torsoMove = Math.max(...leans) - Math.min(...leans);
      }
    }
    const out: RepForm = {};
    for (const [key, v] of Object.entries(r)) if (typeof v === 'number' && Number.isFinite(v)) out[key as FormMarkerId] = v;
    return out;
  });
}

/**
 * Where the bar went each rep, in cm (y: up from the floor). Standing lifts: x forwards (the way you face) from the
 * middle of the foot. Bench: x towards the feet from the shoulder, with the head to the left.
 */
export function barPaths(track: PoseTrack, pattern: string, dims: BodyDims): { point: 'shoulder' | 'wrist'; reps: { x: number; y: number }[][]; ref: 'midfoot' | 'shoulder' | null } | null {
  if (!hasForm(pattern)) return null;
  const side = nearSide(track);
  const sc = pixelScale(track, dims, side)?.scale;
  if (!sc) return null;
  const foot = footFrame(track, side);
  const point = BAR_POINT[pattern] ?? 'wrist';
  let groundY = 0;
  for (const f of track.frames) {
    const p = landmark(f, `${side}_heel`) ?? landmark(f, `${side}_ankle`);
    if (p && p.v >= 0.5) groundY = Math.max(groundY, p.y * track.height);
  }
  // lying down (bench): the head to the left and the shoulder as the reference; standing: facing right, from mid-foot
  const lying = pattern === 'pushH';
  const facing = lying ? -(headward(track, side) ?? 1) : (foot?.facing ?? headward(track, side) ?? 1);
  const shoulders = track.frames.map((f) => landmark(f, `${side}_shoulder`)).filter((p) => p && p.v >= 0.5).map((p) => p!.x * track.width);
  const ref = lying ? (shoulders.length ? median(shoulders) : undefined) : foot?.mid;
  const reps = repWindows(track, pattern, side).map((w) => {
    const pts: { x: number; y: number }[] = [];
    for (const f of track.frames) {
      if (f.t < w.t0 || f.t > w.t1) continue;
      const p = landmark(f, `${side}_${point}`);
      if (p && p.v >= 0.5) pts.push({ x: p.x * track.width, y: p.y * track.height });
    }
    const ox = ref ?? pts[0]?.x ?? 0;
    return pts.map((p) => ({ x: (p.x - ox) * facing * sc * 100, y: (groundY - p.y) * sc * 100 }));
  });
  return { point, reps: reps.filter((r) => r.length > 1), ref: ref === undefined ? null : lying ? 'shoulder' : 'midfoot' };
}

/** The compact record kept on a media item (MediaItem.form). */
export interface FormSummary {
  pattern: string;
  reps: RepForm[];
  /** Height (m) distances were scaled from. */
  h: number;
}

const round = (v: number, unit: FormMarkerDef['unit']) => (unit === 's' || unit === '×' ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10);

export function formSummary(track: PoseTrack, pattern: string, dims: BodyDims, opts: { timeScale?: number } = {}): FormSummary | null {
  const reps = setForm(track, pattern, dims, opts);
  if (!reps.length) return null;
  return {
    pattern,
    reps: reps.map((r) => {
      const o: RepForm = {};
      for (const [key, v] of Object.entries(r)) o[key as FormMarkerId] = round(v, FORM_MARKERS[key as FormMarkerId].unit);
      return o;
    }),
    h: dims.height,
  };
}

/** Distances rescaled to your current height (the scale is proportional to limb lengths). */
export function rescaledForm(f: FormSummary, height: number): FormSummary {
  const k = height / f.h;
  if (Math.abs(k - 1) < 1e-6) return f;
  return {
    ...f,
    h: height,
    reps: f.reps.map((r) => {
      const o: RepForm = { ...r };
      for (const key of Object.keys(o) as FormMarkerId[]) if (FORM_MARKERS[key].unit === 'cm') o[key] = round(o[key]! * k, 'cm');
      return o;
    }),
  };
}

export function fmtMarker(id: FormMarkerId, v: number): string {
  const u = FORM_MARKERS[id].unit;
  if (u === 's') return `${v.toFixed(1)} s`;
  if (u === '×') return `${v.toFixed(1)}×`;
  const n = Math.round(v);
  return u === 'cm' ? `${n > 0 && (id === 'barDrift' || id === 'barTravel') ? '+' : ''}${n} cm` : `${n}°`;
}

export interface FormNote {
  marker: FormMarkerId;
  tone: 'warn' | 'info';
  text: string;
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const isWorse = (def: FormMarkerDef, d: number) => (def.worse === 'higher' ? d > 0 : def.worse === 'lower' ? d < 0 : false);

/** How form changed from the first reps to the last, and against your usual for this lift. */
export function formNotes(pattern: string, reps: RepForm[], usual?: RepForm): FormNote[] {
  const notes: FormNote[] = [];
  for (const id of MARKERS_FOR[pattern] ?? []) {
    const def = FORM_MARKERS[id];
    const vals = reps.map((r) => r[id]).filter((v): v is number => v !== undefined);
    // across the set: the first third against the last (tempo shows in the speed panel already)
    if (vals.length >= 3 && id !== 'up' && id !== 'down') {
      const n = Math.max(1, Math.floor(vals.length / 3));
      const early = mean(vals.slice(0, n)), late = mean(vals.slice(-n));
      const d = late - early;
      if (Math.abs(d) >= def.notable)
        notes.push({ marker: id, tone: isWorse(def, d) ? 'warn' : 'info', text: `${def.label}: ${fmtMarker(id, early)} in the first rep${n > 1 ? 's' : ''}, ${fmtMarker(id, late)} by the last.` });
    }
    const u = usual?.[id];
    if (u !== undefined && vals.length) {
      const m = mean(vals);
      const d = m - u;
      if (Math.abs(d) >= def.notable * 1.5) notes.push({ marker: id, tone: isWorse(def, d) ? 'warn' : 'info', text: `${def.label}: ${fmtMarker(id, m)} this set, ${fmtMarker(id, u)} usually.` });
    }
  }
  return notes;
}

/** Your usual form for a lift: each marker's median over your earlier clips of the same lift and variant (needs two). */
export function usualForm(items: MediaItem[], pattern: string, variant: string | undefined, before: number, height?: number): RepForm | undefined {
  const clips = items.filter((m) => m.form && m.form.pattern === pattern && m.pattern === pattern && (m.variant ?? '') === (variant ?? '') && m.date < before && m.form.reps.length);
  if (clips.length < 2) return undefined;
  const forms = clips.map((m) => (height ? rescaledForm(m.form!, height) : m.form!));
  const out: RepForm = {};
  for (const id of MARKERS_FOR[pattern] ?? []) {
    const per = forms.map((f) => median(f.reps.map((r) => r[id]).filter((v): v is number => v !== undefined))).filter((v) => Number.isFinite(v));
    if (per.length >= 2) out[id] = median(per);
  }
  return Object.keys(out).length ? out : undefined;
}
