import { describe, expect, it } from 'vitest';
import { bodyDims } from '../model/bodyShape';
import { cleanBar, LM, plateAtTime, type PoseFrame, type PoseTrack } from './analysis';
import { fatigue, liftPhases, pixelScale, rescaled, setVelocity, trackScale, turningPoints, velocitySummary } from './velocity';

const W = 1000, H = 1000;
const PX = 400; // pixels per metre in these synthetic clips
const dims = bodyDims({}); // the reference body, metres
const deg = Math.PI / 180;

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
const track = (frames: PoseFrame[]): PoseTrack => ({ id: 'x', model: 'test', createdAt: 0, width: W, height: H, fps: 15, frames });

/** Side-on squatter (left side to camera) at a knee angle; positions in pixels, y down. */
function squatPose(knee: number) {
  const a = ((180 - knee) / 2) * deg; // shin tips forward, thigh back by the same
  const ankle: [number, number] = [500, 900];
  const kneeP: [number, number] = [ankle[0] + dims.shank * PX * Math.sin(a), ankle[1] - dims.shank * PX * Math.cos(a)];
  const hip: [number, number] = [kneeP[0] - dims.thigh * PX * Math.sin(a), kneeP[1] - dims.thigh * PX * Math.cos(a)];
  const lean = (15 + (180 - knee) * 0.2) * deg;
  const shoulder: [number, number] = [hip[0] + dims.torso * PX * Math.sin(lean), hip[1] - dims.torso * PX * Math.cos(lean)];
  return { left_ankle: ankle, left_knee: kneeP, left_hip: hip, left_shoulder: shoulder, left_heel: [ankle[0] - 30, ankle[1] + 10], left_foot_index: [ankle[0] + 90, ankle[1] + 12] } as Pts;
}
const shoulderHeight = (knee: number) => (H - squatPose(knee).left_shoulder![1]) / PX;

/** A set of squats: each rep holds at the top, goes down in 1 s, pauses, and comes up in its own time (knee angle linear in time). */
function squatSet(ups: number[], fps = 15) {
  const top = 175, bottom = 70;
  const segs: { dur: number; from: number; to: number }[] = [];
  for (const up of ups) segs.push({ dur: 0.4, from: top, to: top }, { dur: 1, from: top, to: bottom }, { dur: 0.2, from: bottom, to: bottom }, { dur: up, from: bottom, to: top });
  segs.push({ dur: 0.5, from: top, to: top });
  const total = segs.reduce((s, x) => s + x.dur, 0);
  const frames: PoseFrame[] = [];
  for (let i = 0; i * (1 / fps) <= total; i++) {
    const t = i / fps;
    let acc = 0, knee = top;
    for (const s of segs) {
      if (t <= acc + s.dur) {
        knee = s.from + ((s.to - s.from) * (t - acc)) / s.dur;
        break;
      }
      acc += s.dur;
    }
    frames.push(frame(t, squatPose(knee)));
  }
  // the true mean speed of each rep between 5% and 95% of its knee travel
  const truth = ups.map((up) => {
    const k0 = bottom + 0.05 * (top - bottom), k1 = bottom + 0.95 * (top - bottom);
    return (shoulderHeight(k1) - shoulderHeight(k0)) / (0.9 * up);
  });
  return { track: track(frames), truth };
}

describe('rep speed from the joint track', () => {
  it('measures the scale from limb lengths', () => {
    const { track: t } = squatSet([1]);
    const sc = pixelScale(t, dims)!;
    expect(sc.scale).toBeCloseTo(1 / PX, 6);
    expect(sc.from).toEqual(['thigh', 'shank']);
  });

  it('finds each lifting phase and its speed, and the set’s slowdown', () => {
    const ups = [0.8, 0.9, 1.1, 1.4];
    const { track: t, truth } = squatSet(ups);
    expect(liftPhases(t, 'squat')).toHaveLength(4);
    const s = setVelocity(t, 'squat', dims)!;
    expect(s.point).toBe('shoulder');
    expect(s.reps).toHaveLength(4);
    s.reps.forEach((r, i) => expect(r.mean).toBeCloseTo(truth[i], 1));
    for (let i = 0; i < 4; i++) expect(Math.abs(s.reps[i].mean - truth[i]) / truth[i]).toBeLessThan(0.08);
    expect(s.loss!).toBeCloseTo(1 - 0.8 / 1.4, 1);
    expect(s.slowdown!).toBeGreaterThan(1.5);
    expect(s.reps[0].peak).toBeGreaterThanOrEqual(s.reps[0].mean);
  });

  it('corrects for slow motion and rescales to a new height', () => {
    const { track: t } = squatSet([1, 1]);
    const normal = setVelocity(t, 'squat', dims)!;
    const slow = setVelocity(t, 'squat', dims, { timeScale: 0.25 })!; // filmed at 4× slow motion
    expect(slow.reps[0].mean).toBeCloseTo(normal.reps[0].mean * 4, 5);
    const v = velocitySummary(t, 'squat', dims)!;
    const taller = rescaled(v, dims.height * 1.1);
    expect(taller.v[0]).toBeCloseTo(v.v[0] * 1.1, 2);
    expect(fatigue(v).reps).toBe(2);
  });

  it('times pulls by the elbow closing', () => {
    // pull-ups: the wrists hold the bar; the elbow closes from 170° to 50° as the body rises
    const pose = (elbow: number): Pts => {
      const wrist: [number, number] = [500, 200];
      const el: [number, number] = [wrist[0], wrist[1] + dims.forearm * PX];
      const phi = (180 - elbow) * deg;
      const sh: [number, number] = [el[0] + dims.upperArm * PX * Math.sin(phi), el[1] + dims.upperArm * PX * Math.cos(phi)];
      return { left_wrist: wrist, left_elbow: el, left_shoulder: sh, left_hip: [sh[0], sh[1] + 200] };
    };
    const frames: PoseFrame[] = [];
    const reps = [1, 1.6];
    let t = 0;
    const push = (e: number) => {
      frames.push(frame(t, pose(e)));
      t += 1 / 15;
    };
    for (const up of reps) {
      for (let i = 0; i < 6; i++) push(170);
      for (let i = 0; i <= up * 15; i++) push(170 - (120 * i) / (up * 15));
      for (let i = 0; i < 4; i++) push(50);
      for (let i = 0; i <= 15; i++) push(50 + (120 * i) / 15);
    }
    for (let i = 0; i < 6; i++) push(170);
    const s = setVelocity(track(frames), 'pullV', dims)!;
    expect(s.reps).toHaveLength(2);
    expect(s.reps[1].mean).toBeLessThan(s.reps[0].mean);
    expect(s.loss!).toBeGreaterThan(0.3);
  });

  it('finds turning points, including a set that starts at the bottom', () => {
    const series = [40, 60, 90, 130, 170, 172, 170, 130, 80, 45, 44, 60, 120, 171].map((v, i) => ({ t: i / 10, v }));
    expect(turningPoints(series, 25).map((p) => p.kind)).toEqual(['low', 'high', 'low', 'high']);
    expect(turningPoints([{ t: 0, v: 1 }, { t: 1, v: 2 }, { t: 2, v: 1 }], 25)).toEqual([]);
  });

  it('gives nothing for movements without a lifting phase or without a scale', () => {
    const { track: t } = squatSet([1]);
    expect(setVelocity(t, 'carry', dims)).toBeNull();
    expect(setVelocity({ ...t, frames: t.frames.map((f) => ({ ...f, lm: null })) }, 'squat', dims)).toBeNull();
  });

  it('uses the plate, when the archive tool followed one, as the bar and the scale', () => {
    const { track: t } = squatSet([1, 1.4]);
    // the plate's size says 25% more pixels per metre than the limbs do, to show which scale is used
    const platePx = 0.225 * PX * 1.25;
    const bar = {
      diameter: 0.45,
      r: platePx / W,
      t: t.frames.map((f) => f.t),
      x: t.frames.map((f) => (f.lm![LM.left_shoulder * 3] * W - 20) / W),
      y: t.frames.map((f) => (f.lm![LM.left_shoulder * 3 + 1] * H + 10) / H),
      found: 1,
    };
    const withPlate = { ...t, bar: cleanBar(bar)! };
    expect(trackScale(withPlate, dims)!.from).toEqual(['plate']);
    const body = setVelocity(t, 'squat', dims)!;
    const plate = setVelocity(withPlate, 'squat', dims)!;
    expect(plate.point).toBe('plate');
    expect(plate.scale).toBeCloseTo(1 / (PX * 1.25), 8);
    // the plate moves with the shoulders here, so speeds differ only by the scale
    plate.reps.forEach((r, i) => expect(r.mean).toBeCloseTo(body.reps[i].mean / 1.25, 2));
    // plate speeds don't change with your height
    const v = velocitySummary(withPlate, 'squat', dims)!;
    expect(rescaled(v, dims.height * 1.1).v).toEqual(v.v);
    expect(plateAtTime(withPlate, t.frames[5].t)!.r).toBeCloseTo(bar.r, 6);
    expect(plateAtTime({ ...t, bar: { ...withPlate.bar!, t: withPlate.bar!.t.map((x) => x + 5) } }, 0)).toBeNull();
  });

  it('checks plate data from a file', () => {
    const ok = { diameter: 0.45, r: 0.05, t: [0, 1, 2, 3, 4], x: [0.5, 0.5, 0.5, 0.5, 0.5], y: [0.4, 0.5, 0.6, 0.5, 0.4] };
    expect(cleanBar(ok)).toEqual(ok);
    expect(cleanBar({ ...ok, x: [0.5] })).toBeUndefined();
    expect(cleanBar({ ...ok, r: 2 })).toBeUndefined();
    expect(cleanBar({ ...ok, y: [0.4, 0.5, 'x', 0.5, 0.4] })).toBeUndefined();
    expect(cleanBar(null)).toBeUndefined();
  });
});
