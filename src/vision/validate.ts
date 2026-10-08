// Tests the pose tracker against a squat whose joint angles are known: the 3D
// body is posed and filmed side-on (see media/synthetic.ts), the tracker runs on
// every frame, and its angles are compared with the true ones. This is the
// "check your instrument before you trust it" step of building a dataset.
import { openStudio, squatDuration, squatReps, truthAngles, type SquatSpec } from '../media/synthetic';
import { detectReps, jointAngle, nearSide, smooth, type JointId, type PoseFrame } from './analysis';
import { loadPose } from './runner';

export interface JointError {
  joint: JointId;
  /** Mean absolute error and the largest error, in degrees. */
  mae: number;
  max: number;
  /** Mean signed error (positive: the tracker reads larger angles than the truth). */
  bias: number;
  frames: number;
}

export interface TrackerTest {
  spec: SquatSpec;
  frames: number;
  /** Share of frames where a person was found. */
  found: number;
  joints: JointError[];
  /** Error at the deepest point of each rep. */
  bottom: { joint: JointId; error: number }[];
  reps: { truth: number; found: number; timingError: number | null };
  /** Per frame: time, true and tracked knee angle (for a chart). */
  series: { t: number; truth: number; tracked: number | null }[];
  ms: number;
}

const JOINTS = ['knee', 'hip', 'torsoLean', 'shinAngle'] as const satisfies readonly JointId[];

export async function testTracker(spec: SquatSpec = { depth: 'parallel', ankle: '38', reps: 2, rep: 2.4, stand: 0.6 }, fps = 10, onProgress?: (done: number, total: number) => void): Promise<TrackerTest> {
  const t0 = performance.now();
  const pose = await loadPose();
  const studio = await openStudio(540, 960);
  const total = Math.floor(squatDuration(spec) * fps);
  const errs = new Map<JointId, number[]>(JOINTS.map((j) => [j, [] as number[]]));
  const series: TrackerTest['series'] = [];
  const frames: PoseFrame[] = [];
  const truthAt = new Map<number, Record<string, number>>();
  const truthOf = (i: number, j: JointId) => truthAt.get(i)![j] ?? NaN;
  let found = 0;
  try {
    for (let i = 0; i < total; i++) {
      const t = i / fps;
      const tr = studio.frame(spec, t);
      const truth = truthAngles(tr, studio.width, studio.height);
      truthAt.set(i, truth);
      const r = pose.image.detect(studio.canvas);
      const lm = r.landmarks[0];
      const f: PoseFrame = { t, lm: lm ? lm.flatMap((p) => [p.x, p.y, p.visibility ?? 0]) : null };
      frames.push(f);
      if (lm) found++;
      for (const j of JOINTS) {
        const v = jointAngle(f, j, 'left', studio.width, studio.height);
        if (v !== null) errs.get(j)!.push(v - truth[j]);
      }
      series.push({ t, truth: truth.knee, tracked: jointAngle(f, 'knee', 'left', studio.width, studio.height) });
      onProgress?.(i + 1, total);
      if (i % 3 === 2) await new Promise((res) => setTimeout(res, 0));
    }
  } finally {
    studio.dispose();
  }
  const joints = JOINTS.map((joint) => {
    const e = errs.get(joint)!;
    return {
      joint,
      mae: e.length ? e.reduce((s, x) => s + Math.abs(x), 0) / e.length : NaN,
      max: e.length ? Math.max(...e.map(Math.abs)) : NaN,
      bias: e.length ? e.reduce((s, x) => s + x, 0) / e.length : NaN,
      frames: e.length,
    };
  });
  const trueReps = squatReps(spec);
  const side = nearSide({ id: '', model: '', createdAt: 0, width: studio.width, height: studio.height, fps, frames });
  const knee = smooth(frames.map((f) => ({ t: f.t, v: jointAngle(f, 'knee', side, studio.width, studio.height) })));
  const reps = detectReps(knee);
  const timing = reps.length === trueReps.length ? reps.reduce((s, r, i) => s + Math.abs(r.bottom - trueReps[i].bottom), 0) / reps.length : null;
  const bottom: TrackerTest['bottom'] = [];
  for (const rep of trueReps) {
    const i = Math.round(rep.bottom * fps);
    const f = frames[i];
    if (!f) continue;
    for (const j of ['knee', 'hip'] as JointId[]) {
      const v = jointAngle(f, j, 'left', studio.width, studio.height);
      if (v !== null) bottom.push({ joint: j, error: v - truthOf(i, j) });
    }
  }
  return { spec, frames: total, found: found / total, joints, bottom, reps: { truth: trueReps.length, found: reps.length, timingError: timing }, series, ms: performance.now() - t0 };
}
