// Turning pose landmarks into the numbers a coach looks at: joint angles over
// time, where each rep starts and bottoms out, depth and tempo. Pure functions
// so they can be tested without a browser. Angles are measured in the picture
// (2D), like the angles you draw by hand, so they are only comparable between
// clips filmed from the same side-on position.
import type { MediaMark } from '../db/db';

/** MediaPipe Pose's 33 landmarks, in model order. */
export const LANDMARKS = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer', 'right_eye_inner', 'right_eye', 'right_eye_outer', 'left_ear', 'right_ear', 'mouth_left', 'mouth_right',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist', 'left_pinky', 'right_pinky', 'left_index', 'right_index', 'left_thumb', 'right_thumb',
  'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle', 'left_heel', 'right_heel', 'left_foot_index', 'right_foot_index',
] as const;
export type LandmarkName = (typeof LANDMARKS)[number];
export const LM = Object.fromEntries(LANDMARKS.map((n, i) => [n, i])) as Record<LandmarkName, number>;

/** Lines drawn between landmarks for the skeleton overlay. */
export const BONES: [LandmarkName, LandmarkName][] = [
  ['left_shoulder', 'right_shoulder'], ['left_hip', 'right_hip'],
  ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
  ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'], ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
  ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'], ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
  ['left_ankle', 'left_heel'], ['left_heel', 'left_foot_index'], ['left_ankle', 'left_foot_index'],
  ['right_ankle', 'right_heel'], ['right_heel', 'right_foot_index'], ['right_ankle', 'right_foot_index'],
  ['left_ear', 'left_eye'], ['right_ear', 'right_eye'], ['left_eye', 'nose'], ['right_eye', 'nose'],
];

/** One sampled frame: 33 × [x, y, visibility], x and y as fractions of the frame. */
export interface PoseFrame {
  t: number;
  lm: number[] | null;
  /** 33 × [x, y, z] in metres around the hips (the model's 3D guess). */
  world?: number[] | null;
  /** People found in the frame. */
  people?: number;
}

export interface ImageStats {
  /** Mean brightness 0–1. */
  luma: number;
  /** Brightness spread (standard deviation) 0–1. */
  contrast: number;
  /** Variance of the Laplacian on a 256-pixel-wide copy: higher is sharper. */
  sharpness: number;
  /** Mean brightness inside the person's outline box, when found. */
  subjectLuma?: number;
}

export interface PoseTrack {
  /** The media item's id. */
  id: string;
  model: string;
  createdAt: number;
  width: number;
  height: number;
  /** Frames analysed per second (1 frame for photos). */
  fps: number;
  /** The video's own frame rate, when it could be measured. */
  sourceFps?: number;
  frames: PoseFrame[];
  image?: ImageStats;
}

export type Side = 'left' | 'right';
export type P2 = [number, number];

const VIS = 0.5;

export function landmark(f: PoseFrame, name: LandmarkName): { x: number; y: number; v: number } | null {
  if (!f.lm) return null;
  const i = LM[name] * 3;
  return { x: f.lm[i], y: f.lm[i + 1], v: f.lm[i + 2] };
}

/** The body side nearer the camera: the one whose leg and trunk landmarks are seen best. */
export function nearSide(track: PoseTrack): Side {
  let l = 0, r = 0;
  for (const f of track.frames)
    for (const n of ['shoulder', 'hip', 'knee', 'ankle'] as const) {
      l += landmark(f, `left_${n}`)?.v ?? 0;
      r += landmark(f, `right_${n}`)?.v ?? 0;
    }
  return l >= r ? 'left' : 'right';
}

export type JointId = 'knee' | 'hip' | 'ankle' | 'elbow' | 'shoulder' | 'torsoLean' | 'shinAngle';

/** What each measurement is made of. Angles take three landmarks (the middle one is the joint); leans take two and are measured from vertical. */
export const JOINTS: Record<JointId, { label: string; type: 'angle' | 'line'; parts: string[]; what: string }> = {
  knee: { label: 'Knee', type: 'angle', parts: ['hip', 'knee', 'ankle'], what: 'Angle between thigh and shin. Smaller is deeper.' },
  hip: { label: 'Hip', type: 'angle', parts: ['shoulder', 'hip', 'knee'], what: 'Angle between trunk and thigh. Smaller is more folded.' },
  ankle: { label: 'Ankle', type: 'angle', parts: ['knee', 'ankle', 'foot_index'], what: 'Angle between shin and foot. Smaller means more ankle bend.' },
  elbow: { label: 'Elbow', type: 'angle', parts: ['shoulder', 'elbow', 'wrist'], what: 'Angle between upper arm and forearm.' },
  shoulder: { label: 'Shoulder', type: 'angle', parts: ['hip', 'shoulder', 'elbow'], what: 'Angle between trunk and upper arm.' },
  torsoLean: { label: 'Torso lean', type: 'line', parts: ['hip', 'shoulder'], what: 'How far the trunk tips from vertical.' },
  shinAngle: { label: 'Shin angle', type: 'line', parts: ['ankle', 'knee'], what: 'How far the shin tips from vertical.' },
};

/** The angle a joint makes in one frame (degrees, in the picture's real proportions), or null if a landmark isn't seen. */
export function jointAngle(f: PoseFrame, joint: JointId, side: Side, w: number, h: number, minVis = VIS): number | null {
  const def = JOINTS[joint];
  const pts: P2[] = [];
  for (const part of def.parts) {
    const p = landmark(f, `${side}_${part}` as LandmarkName);
    if (!p || p.v < minVis) return null;
    pts.push([p.x * w, p.y * h]);
  }
  if (def.type === 'line') {
    const [a, b] = pts;
    const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
    return dx || dy ? (Math.atan2(dx, dy) * 180) / Math.PI : null;
  }
  const [a, b, c] = pts;
  const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]];
  const nu = Math.hypot(u[0], u[1]), nv = Math.hypot(v[0], v[1]);
  if (!nu || !nv) return null;
  return (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (nu * nv)))) * 180) / Math.PI;
}

export interface SeriesPoint {
  t: number;
  v: number | null;
}

export function angleSeries(track: PoseTrack, joint: JointId, side: Side = nearSide(track)): SeriesPoint[] {
  return track.frames.map((f) => ({ t: f.t, v: jointAngle(f, joint, side, track.width, track.height) }));
}

/** Fills short gaps by straight lines (up to `maxGap` seconds), then smooths with a centred moving average. */
export function smooth(series: SeriesPoint[], window = 5, maxGap = 0.35): SeriesPoint[] {
  const filled = series.map((p) => ({ ...p }));
  let last = -1;
  for (let i = 0; i < filled.length; i++) {
    if (filled[i].v === null) continue;
    if (last >= 0 && i - last > 1 && filled[i].t - filled[last].t <= maxGap) {
      const a = filled[last], b = filled[i];
      for (let k = last + 1; k < i; k++) filled[k].v = a.v! + ((b.v! - a.v!) * (filled[k].t - a.t)) / (b.t - a.t);
    }
    last = i;
  }
  const half = Math.floor(window / 2);
  return filled.map((p, i) => {
    if (p.v === null) return p;
    let s = 0, n = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(filled.length - 1, i + half); k++)
      if (filled[k].v !== null) {
        s += filled[k].v!;
        n++;
      }
    return { t: p.t, v: s / n };
  });
}

/** The value of a series at time t (nearest sample within `tol` seconds). */
export function valueAt(series: SeriesPoint[], t: number, tol = 0.2): number | null {
  let best: SeriesPoint | null = null;
  for (const p of series) if (p.v !== null && (!best || Math.abs(p.t - t) < Math.abs(best.t - t))) best = p;
  return best && Math.abs(best.t - t) <= tol ? best.v : null;
}

export interface Rep {
  /** Start, deepest point (end of range) and finish, in seconds. */
  start: number;
  bottom: number;
  end: number;
  /** The joint angle at the deepest point. */
  min: number;
  /** Range of motion in degrees. */
  rom: number;
  /** Seconds into the end of range, and back out. */
  down: number;
  up: number;
}

/**
 * Reps from a joint angle that closes and opens again (e.g. the knee in a
 * squat): each clear dip of at least `minRom` degrees, at least `minGap`
 * seconds after the previous one, is a rep; it starts and ends at the highest
 * points either side of the dip.
 */
export function detectReps(series: SeriesPoint[], minRom = 25, minGap = 0.6): Rep[] {
  const pts = series.filter((p) => p.v !== null) as { t: number; v: number }[];
  if (pts.length < 5) return [];
  // local minima, keeping the lowest of any two closer than minGap
  const mins: number[] = [];
  for (let i = 1; i < pts.length - 1; i++)
    if (pts[i].v <= pts[i - 1].v && pts[i].v < pts[i + 1].v) {
      const prev = mins[mins.length - 1];
      if (prev !== undefined && pts[i].t - pts[prev].t < minGap) {
        if (pts[i].v < pts[prev].v) mins[mins.length - 1] = i;
      } else mins.push(i);
    }
  const reps: Rep[] = [];
  for (let k = 0; k < mins.length; k++) {
    const m = mins[k];
    const lo = k > 0 ? mins[k - 1] : 0;
    const hi = k < mins.length - 1 ? mins[k + 1] : pts.length - 1;
    let s = m, e = m;
    for (let i = m; i >= lo; i--) if (pts[i].v > pts[s].v) s = i;
    for (let i = m; i <= hi; i++) if (pts[i].v > pts[e].v) e = i;
    const top = Math.min(pts[s].v, pts[e].v);
    const rom = top - pts[m].v;
    if (rom < minRom) continue;
    reps.push({ start: pts[s].t, bottom: pts[m].t, end: pts[e].t, min: pts[m].v, rom: Math.max(pts[s].v, pts[e].v) - pts[m].v, down: pts[m].t - pts[s].t, up: pts[e].t - pts[m].t });
  }
  // neighbouring reps share their boundary peak
  for (let i = 1; i < reps.length; i++) if (reps[i].start < reps[i - 1].end) reps[i].start = reps[i - 1].end = (reps[i].start + reps[i - 1].end) / 2;
  return reps;
}

/** The joint that best shows the reps of each movement pattern. */
export const PRIMARY_JOINT: Record<string, JointId> = {
  squat: 'knee',
  lunge: 'knee',
  hinge: 'hip',
  pushH: 'elbow',
  pushV: 'elbow',
  pullH: 'elbow',
  pullV: 'elbow',
  gait: 'knee',
};

export interface RepSummary {
  joint: JointId;
  side: Side;
  reps: Rep[];
  /** Mean and spread of the deepest angle across reps. */
  meanMin?: number;
  sdMin?: number;
  meanDown?: number;
  meanUp?: number;
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
};

export function summarizeReps(track: PoseTrack, pattern?: string): RepSummary {
  const side = nearSide(track);
  const joint = (pattern && PRIMARY_JOINT[pattern]) || 'knee';
  const reps = detectReps(smooth(angleSeries(track, joint, side)));
  const out: RepSummary = { joint, side, reps };
  if (reps.length) {
    out.meanMin = mean(reps.map((r) => r.min));
    out.sdMin = sd(reps.map((r) => r.min));
    out.meanDown = mean(reps.map((r) => r.down));
    out.meanUp = mean(reps.map((r) => r.up));
  }
  return out;
}

const r1 = (x: number | undefined) => (x === undefined ? undefined : Math.round(x * 10) / 10);

/** The compact summary stored on a media item (MediaItem.tracked). */
export function trackSummary(track: PoseTrack, pattern: string): { pattern: string; joint: string; reps: number; deepest?: number; spread?: number; down?: number; up?: number } {
  const s = summarizeReps(track, pattern);
  return { pattern, joint: s.joint, reps: s.reps.length, deepest: r1(s.meanMin), spread: r1(s.sdMin), down: r1(s.meanDown), up: r1(s.meanUp) };
}

/** The frame nearest to a time. */
export function frameAt(track: PoseTrack, t: number): PoseFrame | null {
  let best: PoseFrame | null = null;
  for (const f of track.frames) if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
  return best;
}

/** Landmarks between two analysed frames, blended, for a smooth overlay while a video plays. */
export function landmarksAt(track: PoseTrack, t: number): number[] | null {
  const fs = track.frames;
  if (!fs.length) return null;
  let i = fs.findIndex((f) => f.t >= t);
  if (i < 0) return fs[fs.length - 1].lm;
  if (i === 0) return fs[0].lm;
  const a = fs[i - 1], b = fs[i];
  if (!a.lm || !b.lm) return (t - a.t < b.t - t ? a.lm : b.lm) ?? a.lm ?? b.lm;
  const k = (t - a.t) / (b.t - a.t || 1);
  return a.lm.map((v, j) => (j % 3 === 2 ? Math.min(v, b.lm![j]) : v + (b.lm![j] - v) * k));
}

/** Measurements at one moment, as marks you can keep and adjust (named like hand-drawn ones so they chart together). */
export function marksFromPose(f: PoseFrame, side: Side, joints: JointId[], uid: () => string): MediaMark[] {
  const out: MediaMark[] = [];
  for (const j of joints) {
    const def = JOINTS[j];
    const pts: [number, number][] = [];
    for (const part of def.parts) {
      const p = landmark(f, `${side}_${part}` as LandmarkName);
      if (!p || p.v < VIS) break;
      pts.push([Math.round(p.x * 1e4) / 1e4, Math.round(p.y * 1e4) / 1e4]);
    }
    if (pts.length !== def.parts.length) continue;
    out.push({ id: uid(), type: def.type, points: pts, t: Math.round(f.t * 1000) / 1000, label: def.label, source: 'pose' });
  }
  return out;
}

/** The joints worth measuring at the end of range for each pattern. */
export const KEY_JOINTS: Record<string, JointId[]> = {
  squat: ['knee', 'hip', 'torsoLean', 'shinAngle'],
  lunge: ['knee', 'hip', 'torsoLean'],
  hinge: ['hip', 'knee', 'torsoLean'],
  pushH: ['elbow', 'shoulder'],
  pushV: ['elbow', 'shoulder', 'torsoLean'],
  pullH: ['elbow', 'shoulder', 'torsoLean'],
  pullV: ['elbow', 'shoulder'],
  gait: ['knee', 'hip', 'shinAngle'],
};

const LABEL_TO_JOINT = new Map(Object.entries(JOINTS).map(([id, d]) => [d.label.toLowerCase(), id as JointId]));

export interface Agreement {
  markId: string;
  label: string;
  t: number;
  manual: number;
  auto: number;
  diff: number;
}

/**
 * How the tracker's angles compare with the ones you drew by hand (for marks
 * named like a tracked joint, at the time they were drawn). This is how you
 * check the tracker before trusting it on your own videos.
 */
export function agreement(marks: MediaMark[], track: PoseTrack, manualValue: (m: MediaMark) => number | null): Agreement[] {
  const side = nearSide(track);
  const out: Agreement[] = [];
  for (const m of marks) {
    if (m.source === 'pose' || m.type === 'path') continue;
    const j = LABEL_TO_JOINT.get((m.label ?? '').toLowerCase());
    if (!j || JOINTS[j].type !== m.type) continue;
    const f = frameAt(track, m.t ?? 0);
    if (!f || Math.abs(f.t - (m.t ?? 0)) > 0.1) continue;
    const auto = jointAngle(f, j, side, track.width, track.height);
    const manual = manualValue(m);
    if (auto === null || manual === null) continue;
    out.push({ markId: m.id, label: JOINTS[j].label, t: f.t, manual, auto, diff: auto - manual });
  }
  return out;
}

/** Mean absolute difference, the usual single number for agreement. */
export function meanAbsError(a: Agreement[]): number | null {
  return a.length ? mean(a.map((x) => Math.abs(x.diff))) : null;
}
