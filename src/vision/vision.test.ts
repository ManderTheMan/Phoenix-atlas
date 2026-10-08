import { describe, expect, it } from 'vitest';
import type { MediaItem, MediaMark } from '../db/db';
import { markValue } from '../media/media';
import { agreement, angleSeries, detectReps, jointAngle, landmarksAt, LM, marksFromPose, meanAbsError, nearSide, smooth, summarizeReps, type PoseFrame, type PoseTrack } from './analysis';
import { bodyHeightShare, frontness, qualityChecks, qualitySummary, viewFromFrontness } from './quality';

const W = 1000, H = 1000;
type Pts = Partial<Record<keyof typeof LM, [number, number, number?]>>;
/** A frame with the given landmarks (x, y as fractions, visibility default 0.95); the rest unseen. */
function frame(t: number, pts: Pts): PoseFrame {
  const lm = new Array(99).fill(0);
  for (const [name, [x, y, v]] of Object.entries(pts)) {
    const i = LM[name as keyof typeof LM] * 3;
    lm[i] = x;
    lm[i + 1] = y;
    lm[i + 2] = v ?? 0.95;
  }
  return { t, lm, people: 1 };
}

/** A side-on squatter (left side to camera) with a given knee angle. */
function squatter(t: number, knee: number): PoseFrame {
  const ankle: [number, number] = [0.5, 0.9];
  const shin = 0.22, thigh = 0.23;
  const shinTilt = (180 - knee) / 2;
  const kneeP: [number, number] = [ankle[0] + shin * Math.sin((shinTilt * Math.PI) / 180), ankle[1] - shin * Math.cos((shinTilt * Math.PI) / 180)];
  const thighDir = shinTilt + (180 - knee);
  const hip: [number, number] = [kneeP[0] - thigh * Math.sin(((thighDir - 2 * shinTilt) * Math.PI) / 180), kneeP[1] - thigh * Math.cos(((thighDir - 2 * shinTilt) * Math.PI) / 180)];
  return frame(t, {
    nose: [hip[0] + 0.05, hip[1] - 0.35],
    left_eye: [hip[0] + 0.06, hip[1] - 0.36],
    left_shoulder: [hip[0] + 0.03, hip[1] - 0.28],
    right_shoulder: [hip[0] + 0.035, hip[1] - 0.28, 0.4],
    left_hip: hip,
    right_hip: [hip[0] + 0.005, hip[1], 0.4],
    left_knee: kneeP,
    right_knee: [kneeP[0] + 0.005, kneeP[1], 0.4],
    left_ankle: ankle,
    right_ankle: [ankle[0], ankle[1], 0.4],
    left_heel: [ankle[0] - 0.03, ankle[1] + 0.02],
    left_foot_index: [ankle[0] + 0.1, ankle[1] + 0.03],
  });
}

const track = (frames: PoseFrame[], extra: Partial<PoseTrack> = {}): PoseTrack => ({ id: 'x', model: 'test', createdAt: 0, width: W, height: H, fps: 15, frames, ...extra });

describe('joint angles from landmarks', () => {
  it('measures angles and leans in the picture', () => {
    const f = frame(0, { left_hip: [0.5, 0.3], left_knee: [0.5, 0.5], left_ankle: [0.7, 0.5], left_shoulder: [0.6, 0.1] });
    expect(jointAngle(f, 'knee', 'left', W, H)).toBeCloseTo(90, 5);
    expect(jointAngle(f, 'torsoLean', 'left', W, H)).toBeCloseTo((Math.atan2(0.1, 0.2) * 180) / Math.PI, 5);
    // unseen joints give no angle
    expect(jointAngle(f, 'knee', 'right', W, H)).toBeNull();
    expect(jointAngle({ t: 0, lm: null }, 'knee', 'left', W, H)).toBeNull();
  });

  it('picks the side nearer the camera', () => {
    expect(nearSide(track([squatter(0, 120)]))).toBe('left');
  });

  it('reads the synthetic squatter’s knee back', () => {
    for (const k of [170, 120, 70]) expect(jointAngle(squatter(0, k), 'knee', 'left', W, H)).toBeCloseTo(k, 4);
  });
});

describe('reps', () => {
  // three reps: 170° → 70° → 170°, 2 s each, after 0.5 s standing
  const knee = (t: number) => (t < 0.5 || t > 6.5 ? 170 : 120 + 50 * Math.cos((2 * Math.PI * (t - 0.5)) / 2));
  const frames = Array.from({ length: 105 }, (_, i) => squatter(i / 15, knee(i / 15)));

  it('finds each rep, its bottom and tempo', () => {
    const reps = detectReps(smooth(angleSeries(track(frames), 'knee', 'left')));
    expect(reps.length).toBe(3);
    reps.forEach((r, i) => {
      expect(r.bottom).toBeCloseTo(1.5 + 2 * i, 0);
      expect(r.min).toBeLessThan(75);
      expect(r.rom).toBeGreaterThan(90);
      expect(r.down).toBeGreaterThan(0.6);
    });
    const s = summarizeReps(track(frames), 'squat');
    expect(s.joint).toBe('knee');
    expect(s.sdMin!).toBeLessThan(3);
  });

  it('ignores small wobbles', () => {
    const wobble = Array.from({ length: 60 }, (_, i) => squatter(i / 15, 165 + 5 * Math.sin(i)));
    expect(detectReps(smooth(angleSeries(track(wobble), 'knee', 'left')))).toEqual([]);
  });

  it('bridges short tracking gaps', () => {
    const s = smooth([{ t: 0, v: 100 }, { t: 0.07, v: null }, { t: 0.13, v: 120 }], 1);
    expect(s[1].v).toBeCloseTo(100 + (20 * 0.07) / 0.13, 5);
    expect(smooth([{ t: 0, v: 100 }, { t: 0.5, v: null }, { t: 1, v: 120 }], 1)[1].v).toBeNull();
  });

  it('blends landmarks between analysed frames', () => {
    const tr = track([squatter(0, 170), squatter(1, 70)]);
    const mid = landmarksAt(tr, 0.5)!;
    const a = tr.frames[0].lm!, b = tr.frames[1].lm!;
    const k = LM.left_knee * 3;
    expect(mid[k]).toBeCloseTo((a[k] + b[k]) / 2, 6);
  });
});

describe('tracker vs hand marks', () => {
  it('turns tracked joints into marks and compares them with hand-drawn ones', () => {
    const f = squatter(1.5, 80);
    let n = 0;
    const auto = marksFromPose(f, 'left', ['knee', 'torsoLean'], () => `m${n++}`);
    expect(auto.map((m) => m.label)).toEqual(['Knee', 'Torso lean']);
    expect(auto.every((m) => m.source === 'pose')).toBe(true);
    const item = { width: W, height: H } as MediaItem;
    expect(markValue(auto[0], W, H)!.value).toBeCloseTo(80, 1);
    // a hand mark 4° off at the same moment
    const hand: MediaMark = { ...auto[0], id: 'h', source: undefined, points: auto[0].points.map((p, i) => (i === 2 ? [p[0] + 0.01, p[1]] : p)) as [number, number][] };
    const a = agreement([hand, ...auto], track([f]), (m) => markValue(m, item.width, item.height)?.value ?? null);
    expect(a.length).toBe(1);
    expect(Math.abs(a[0].diff)).toBeGreaterThan(0.5);
    expect(meanAbsError(a)).toBeCloseTo(Math.abs(a[0].diff), 6);
  });
});

describe('capture quality', () => {
  const item = (over: Partial<MediaItem> = {}) => ({ kind: 'video', purpose: 'form', width: 1080, height: 1920, duration: 12, camera: 'side', pattern: 'squat', ...over }) as MediaItem;

  it('recognises side-on and front-on views', () => {
    const side = squatter(0, 170);
    expect(viewFromFrontness(frontness(side, W, H)!)).toBe('side');
    const front = frame(0, { left_shoulder: [0.6, 0.3], right_shoulder: [0.4, 0.3], left_hip: [0.57, 0.55], right_hip: [0.43, 0.55] });
    expect(viewFromFrontness(frontness(front, W, H)!)).toBe('front');
  });

  it('measures how much of the frame the body fills', () => {
    expect(bodyHeightShare(squatter(0, 175))!).toBeGreaterThan(0.5);
  });

  it('passes a well-framed clip and explains what to fix in a poor one', () => {
    const good = qualityChecks(item(), track(Array.from({ length: 30 }, (_, i) => squatter(i / 15, 170 - i)), { sourceFps: 60, image: { luma: 0.5, contrast: 0.2, sharpness: 150 } }));
    expect(good.filter((c) => c.status === 'fail' || c.status === 'warn').map((c) => c.id)).toEqual([]);
    expect(qualitySummary(good).status).toBe('pass');

    // feet cut off, low resolution, wrong angle tag, a dark frame
    const cropped = Array.from({ length: 30 }, (_, i) => {
      const f = squatter(i / 15, 170);
      for (const n of ['left_ankle', 'left_heel', 'left_foot_index'] as const) f.lm![LM[n] * 3 + 1] = 1.02;
      return f;
    });
    const bad = qualityChecks(item({ width: 640, height: 360, camera: 'front' }), track(cropped, { sourceFps: 20, image: { luma: 0.1, contrast: 0.05, sharpness: 10 } }));
    const status = Object.fromEntries(bad.map((c) => [c.id, c.status]));
    expect(status.resolution).toBe('fail');
    expect(status.fps).toBe('fail');
    expect(status.framing).toBe('fail');
    expect(status.view).toBe('warn');
    expect(status.light).toBe('warn');
    expect(bad.find((c) => c.id === 'framing')!.fix).toMatch(/further away/);
    expect(qualitySummary(bad).status).toBe('fail');
  });

  it('says joints need finding before most checks', () => {
    const c = qualityChecks(item(), null);
    expect(c.find((x) => x.id === 'pose')!.status).toBe('info');
  });
});
