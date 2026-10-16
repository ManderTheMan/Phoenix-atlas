import { describe, expect, it } from 'vitest';
import type { MediaItem } from '../db/db';
import { bodyDims } from '../model/bodyShape';
import { LM, type PoseFrame, type PoseTrack } from './analysis';
import { barPaths, fmtMarker, formNotes, formSummary, repWindows, rescaledForm, setForm, usualForm } from './form';

const W = 1000, H = 1000;
const PX = 400; // pixels per metre in these synthetic clips
const dims = bodyDims({});
const deg = Math.PI / 180;
const FPS = 30;

type Pts = Partial<Record<keyof typeof LM, [number, number]>>;
function frame(t: number, pts: Pts): PoseFrame {
  const lm = new Array(99).fill(0);
  for (const [name, [x, y]] of Object.entries(pts)) {
    const i = LM[name as keyof typeof LM] * 3;
    lm[i] = x / W;
    lm[i + 1] = y / H;
    lm[i + 2] = 0.95;
  }
  return { t, lm, people: 1 };
}
const track = (frames: PoseFrame[]): PoseTrack => ({ id: 'x', model: 'test', createdAt: 0, width: W, height: H, fps: FPS, frames });
const at = (p: [number, number], len: number, ang: number): [number, number] => [p[0] + len * PX * Math.sin(ang), p[1] - len * PX * Math.cos(ang)];

/** A clip from segments: each moves a parameter linearly from one value to another over its duration (rep is the rep it belongs to). */
function clip(segs: { dur: number; from: number; to: number; rep: number }[], pose: (v: number, rep: number) => Pts): PoseTrack {
  const total = segs.reduce((s, x) => s + x.dur, 0);
  const frames: PoseFrame[] = [];
  for (let i = 0; i / FPS <= total; i++) {
    const t = i / FPS;
    let acc = 0, v = segs[segs.length - 1].to, rep = segs[segs.length - 1].rep;
    for (const s of segs) {
      if (t <= acc + s.dur) {
        v = s.from + ((s.to - s.from) * (t - acc)) / s.dur;
        rep = s.rep;
        break;
      }
      acc += s.dur;
    }
    frames.push(frame(t, pose(v, rep)));
  }
  return track(frames);
}

/** Side-on squatter facing +x: shin and thigh tip by the same angle; the trunk leans more as the knees bend, plus any extra per rep. */
function squatPose(knee: number, extraLean = 0): Pts {
  const a = ((180 - knee) / 2) * deg;
  const ankle: [number, number] = [500, 900];
  const kneeP = at(ankle, dims.shank, a);
  const hip = at(kneeP, dims.thigh, -a);
  const lean = (15 + (180 - knee) * 0.2 + extraLean) * deg;
  const shoulder = at(hip, dims.torso, lean);
  return { left_ankle: ankle, left_knee: kneeP, left_hip: hip, left_shoulder: shoulder, left_heel: [470, 910], left_foot_index: [590, 912] };
}
const squats = (n: number, lean: (rep: number) => number, bottom = 70) => {
  const segs = [];
  for (let r = 0; r < n; r++) segs.push({ dur: 0.4, from: 175, to: 175, rep: r }, { dur: 1, from: 175, to: bottom, rep: r }, { dur: 0.2, from: bottom, to: bottom, rep: r }, { dur: 1, from: bottom, to: 175, rep: r });
  segs.push({ dur: 0.4, from: 175, to: 175, rep: n - 1 });
  return clip(segs, (k, r) => squatPose(k, lean(r)));
};

describe('form markers per rep', () => {
  it('measures a squat’s depth, trunk, shin, hip height and tempo', () => {
    const t = squats(3, () => 0);
    expect(repWindows(t, 'squat')).toHaveLength(3);
    const reps = setForm(t, 'squat', dims);
    expect(reps).toHaveLength(3);
    const a = 55 * deg; // (180 − 70) / 2
    for (const r of reps) {
      expect(r.depth).toBeCloseTo(70, 0);
      expect(r.shin).toBeCloseTo(55, 0);
      expect(r.trunkLean).toBeCloseTo(15 + 110 * 0.2, 0);
      expect(r.hipBelowKnee!).toBeCloseTo(-dims.thigh * Math.cos(a) * 100, 0); // above parallel by this much
      expect(r.down!).toBeCloseTo(0.9, 1); // 5–95% of the travel
      expect(r.up!).toBeCloseTo(0.9, 1);
    }
    // the bar (shoulders) relative to the middle of the foot: worked out from the geometry over the lifting phase
    let far = 0;
    for (let k = 70 + 0.05 * 105; k <= 70 + 0.95 * 105; k += 0.5) {
      const off = squatPose(k).left_shoulder![0] - 530;
      if (Math.abs(off) > Math.abs(far)) far = off;
    }
    expect(reps[0].barDrift!).toBeCloseTo((far / PX) * 100, 0);
  });

  it('flags form breaking down through a set and against your usual', () => {
    const t = squats(4, (r) => [0, 0, 4, 9][r]);
    const reps = setForm(t, 'squat', dims);
    expect(reps.map((r) => Math.round(r.trunkLean!))).toEqual([37, 37, 41, 46]);
    const notes = formNotes('squat', reps);
    const lean = notes.find((n) => n.marker === 'trunkLean')!;
    expect(lean.tone).toBe('warn');
    expect(lean.text).toContain('37° in the first rep, 46° by the last');
    // shallower than usual
    const vsUsual = formNotes('squat', reps, { depth: 60 });
    expect(vsUsual.find((n) => n.marker === 'depth')).toMatchObject({ tone: 'warn' });
    // nothing to say about a steady set at your usual
    expect(formNotes('squat', setForm(squats(4, () => 0), 'squat', dims), { depth: 70 })).toEqual([]);
  });

  it('reads hips shooting up in a deadlift and the lockout', () => {
    // facing +x: shin angle a, thigh th behind the knee, trunk tr forward of the hip, arms hanging
    const pose = (shin: number, th: number, tr: number): Pts => {
      const ankle: [number, number] = [500, 900];
      const knee = at(ankle, dims.shank, shin * deg);
      const hip = at(knee, dims.thigh, -th * deg);
      const sh = at(hip, dims.torso, tr * deg);
      const el: [number, number] = [sh[0], sh[1] + dims.upperArm * PX];
      return { left_ankle: ankle, left_knee: knee, left_hip: hip, left_shoulder: sh, left_elbow: el, left_wrist: [el[0], el[1] + dims.forearm * PX], left_heel: [470, 910], left_foot_index: [590, 912] };
    };
    const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
    // p: 0 floor → 1 lockout. Good: everything straightens together. Bad: knees straighten first (hips rise, trunk tips further over).
    const good = (p: number) => pose(lerp(15, 0, p), lerp(70, 0, p), lerp(55, 0, p));
    const bad = (p: number) => (p < 0.4 ? pose(lerp(15, 2, p / 0.4), lerp(70, 15, p / 0.4), lerp(55, 62, p / 0.4)) : pose(lerp(2, 0, (p - 0.4) / 0.6), lerp(15, 0, (p - 0.4) / 0.6), lerp(62, 6, (p - 0.4) / 0.6)));
    const pulls = (f: (p: number) => Pts) => clip([0, 1].flatMap((r) => [{ dur: 0.4, from: 0, to: 0, rep: r }, { dur: 1.2, from: 0, to: 1, rep: r }, { dur: 0.4, from: 1, to: 1, rep: r }, { dur: 1, from: 1, to: 0, rep: r }]), (p) => f(p));
    const g = setForm(pulls(good), 'hinge', dims), b = setForm(pulls(bad), 'hinge', dims);
    expect(g).toHaveLength(2);
    expect(g[0].hipsFirst!).toBeLessThan(1.2);
    expect(b[0].hipsFirst!).toBeGreaterThan(g[0].hipsFirst! + 0.5);
    expect(g[0].lockout!).toBeGreaterThan(178);
    expect(b[0].lockout!).toBeCloseTo(174, 0); // trunk 6° short of upright
    expect(g[0].backAngle!).toBeGreaterThan(45);
    expect(Math.abs(g[0].barDrift!)).toBeLessThan(40);
  });

  it('measures swing and the top of a pull-up, timed by the elbow closing', () => {
    // hanging from a bar at (500, 100); the hips swing forward and back by `swing` px per rep
    const pose = (elbow: number, swing: number): Pts => {
      const wrist: [number, number] = [500, 100];
      const el: [number, number] = [wrist[0], wrist[1] + dims.forearm * PX];
      const phi = (180 - elbow) * deg;
      const sh: [number, number] = [el[0] + dims.upperArm * PX * Math.sin(phi), el[1] + dims.upperArm * PX * Math.cos(phi)];
      const s = swing * Math.sin(((170 - elbow) / 120) * Math.PI);
      return { left_wrist: wrist, left_elbow: el, left_shoulder: sh, left_hip: [sh[0] + s, sh[1] + dims.torso * PX], left_knee: [sh[0] + s, sh[1] + (dims.torso + dims.thigh) * PX] };
    };
    const swings = [0, 40];
    const t = clip([0, 1].flatMap((r) => [{ dur: 0.4, from: 170, to: 170, rep: r }, { dur: 1, from: 170, to: 50, rep: r }, { dur: 0.2, from: 50, to: 50, rep: r }, { dur: 1, from: 50, to: 170, rep: r }]), (e, r) => pose(e, swings[r]));
    const reps = setForm(t, 'pullV', dims);
    expect(reps).toHaveLength(2);
    expect(reps[0].topElbow).toBeCloseTo(50, 0);
    expect(reps[0].swing ?? 0).toBeLessThan(1);
    expect(reps[1].swing!).toBeCloseTo((40 / PX) * 100, 0);
    expect(reps[0].up!).toBeCloseTo(0.9, 1);
    expect(reps[0].down!).toBeCloseTo(0.9, 1);
  });

  it('keeps a compact summary, rescales it, and finds your usual', () => {
    const t = squats(3, () => 0);
    const f = formSummary(t, 'squat', dims, { timeScale: 0.5 })!;
    expect(f.reps).toHaveLength(3);
    expect(f.reps[0].up).toBeCloseTo(0.45, 1); // slow motion: half the time in real life
    const taller = rescaledForm(f, f.h * 1.1);
    expect(taller.reps[0].hipBelowKnee!).toBeCloseTo(f.reps[0].hipBelowKnee! * 1.1, 0);
    expect(taller.reps[0].depth).toBe(f.reps[0].depth);
    const item = (date: number, depth: number, variant?: string) => ({ id: String(date), date, pattern: 'squat', variant, form: { pattern: 'squat', h: f.h, reps: [{ depth }, { depth: depth + 2 }] } }) as unknown as MediaItem;
    const items = [item(1, 70), item(2, 80), item(3, 90, 'front'), item(10, 50)];
    expect(usualForm(items, 'squat', undefined, 5)).toEqual({ depth: 76 });
    expect(usualForm(items, 'squat', 'front', 5)).toBeUndefined(); // one clip isn't a usual
    expect(fmtMarker('barDrift', 3.4)).toBe('+3 cm');
    expect(fmtMarker('hipsFirst', 1.26)).toBe('1.3×');
  });

  it('traces the bar path from the middle of the foot', () => {
    const p = barPaths(squats(2, () => 0), 'squat', dims)!;
    expect(p.point).toBe('shoulder');
    expect(p.ref).toBe('midfoot');
    expect(p.reps).toHaveLength(2);
    const ys = p.reps[0].map((q) => q.y);
    // standing shoulder height above the heel line, in cm
    const top = ((910 - squatPose(175).left_shoulder![1]) / PX) * 100;
    expect(Math.max(...ys)).toBeCloseTo(top, 0);
  });

  it('follows the plate instead of the shoulders when there is one', () => {
    const t = squats(2, () => 0);
    const sh = t.frames.map((f) => [f.lm![LM.left_shoulder * 3], f.lm![LM.left_shoulder * 3 + 1]]);
    const withPlate: PoseTrack = { ...t, bar: { diameter: 0.45, r: (0.225 * PX) / W, t: t.frames.map((f) => f.t), x: sh.map((p) => p[0] - 0.01), y: sh.map((p) => p[1]) } };
    const p = barPaths(withPlate, 'squat', dims)!;
    expect(p.point).toBe('plate');
    // 1% of the frame behind the shoulders: 10 px, 2.5 cm
    const body = setForm(t, 'squat', dims)[0].barDrift!, plate = setForm(withPlate, 'squat', dims)[0].barDrift!;
    expect(plate - body).toBeCloseTo(-2.5, 0);
    expect(formSummary(withPlate, 'squat', dims)!.plate).toBe(true);
  });
});
