import { describe, expect, it } from 'vitest';
import type { PoseFrame, PoseTrack } from './analysis';
import { LM } from './analysis';
import { guessPattern, loggedThatDay, suggest } from './classify';

// Stick figures seen side-on in a 1000 × 1000 frame, facing right, y down.
type P = [number, number];
const L = { shin: 250, thigh: 250, trunk: 280, upper: 170, fore: 150, head: 110 };
const rad = (d: number) => (d * Math.PI) / 180;
const add = (a: P, len: number, deg: number, up = true): P => [a[0] + len * Math.sin(rad(deg)), a[1] + (up ? -1 : 1) * len * Math.cos(rad(deg))];
const phase = (t: number, period = 3) => (1 - Math.cos((2 * Math.PI * t) / period)) / 2;

interface Body {
  shoulder: P;
  elbow: P;
  wrist: P;
  hip: P;
  knee: P;
  ankle: P;
  farHip?: P;
  farKnee?: P;
  farAnkle?: P;
}

function frame(t: number, b: Body): PoseFrame {
  const lm = new Array(99).fill(0);
  const put = (name: string, p: P, v: number) => {
    const i = LM[name as keyof typeof LM] * 3;
    lm[i] = p[0] / 1000;
    lm[i + 1] = p[1] / 1000;
    lm[i + 2] = v;
  };
  const off = (p: P): P => [p[0] + 8, p[1] - 4];
  // head above the shoulder, along the trunk
  const dx = b.shoulder[0] - b.hip[0], dy = b.shoulder[1] - b.hip[1], n = Math.hypot(dx, dy) || 1;
  const nose: P = [b.shoulder[0] + (dx / n) * L.head + 15, b.shoulder[1] + (dy / n) * L.head];
  for (const k of ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear', 'mouth_left', 'mouth_right']) put(k, nose, 0.9);
  put('left_shoulder', b.shoulder, 0.95);
  put('right_shoulder', off(b.shoulder), 0.6);
  put('left_elbow', b.elbow, 0.95);
  put('right_elbow', off(b.elbow), 0.6);
  put('left_wrist', b.wrist, 0.95);
  put('right_wrist', off(b.wrist), 0.6);
  put('left_hip', b.hip, 0.95);
  put('right_hip', b.farHip ?? off(b.hip), 0.6);
  put('left_knee', b.knee, 0.95);
  put('right_knee', b.farKnee ?? off(b.knee), b.farKnee ? 0.9 : 0.6);
  put('left_ankle', b.ankle, 0.95);
  put('right_ankle', b.farAnkle ?? off(b.ankle), b.farAnkle ? 0.9 : 0.6);
  for (const [s, a] of [['left', b.ankle], ['right', b.farAnkle ?? off(b.ankle)]] as const) {
    put(`${s}_heel`, [a[0] - 30, a[1] + 10], 0.9);
    put(`${s}_foot_index`, [a[0] + 60, a[1] + 10], 0.9);
  }
  return { t, lm, people: 1 };
}

function track(fn: (t: number) => Body, seconds = 6): PoseTrack {
  const frames: PoseFrame[] = [];
  for (let i = 0; i < seconds * 15; i++) frames.push(frame(Math.round((i / 15) * 1000) / 1000, fn(i / 15)));
  return { id: 't', model: 'test', createdAt: 0, width: 1000, height: 1000, fps: 15, frames };
}

/** Legs from the ankle up (shin and thigh tilt from vertical), then the trunk and arms. */
function standing(shinDeg: number, thighBackDeg: number, leanDeg: number, upperDeg: number, foreDeg: number, ankle: P = [520, 920]): Body {
  const knee = add(ankle, L.shin, shinDeg);
  const hip = add(knee, L.thigh, -thighBackDeg);
  const shoulder = add(hip, L.trunk, leanDeg);
  const elbow = add(shoulder, L.upper, upperDeg, false);
  const wrist = add(elbow, L.fore, foreDeg, false);
  return { shoulder, elbow, wrist, hip, knee, ankle };
}

/** Knee position for a two-segment leg between hip and ankle, the knee bending towards +x. */
function ik(hip: P, ankle: P, forward = 1): P {
  const d = Math.min(L.thigh + L.shin - 1e-6, Math.hypot(ankle[0] - hip[0], ankle[1] - hip[1]));
  const a = Math.acos((L.thigh ** 2 + d ** 2 - L.shin ** 2) / (2 * L.thigh * d));
  const base = Math.atan2(ankle[1] - hip[1], ankle[0] - hip[0]);
  const ang = base - forward * a;
  return [hip[0] + L.thigh * Math.cos(ang), hip[1] + L.thigh * Math.sin(ang)];
}

const cases: Record<string, PoseTrack> = {
  squat: track((t) => {
    const p = phase(t);
    return standing(35 * p, 75 * p, 5 + 35 * p, 60, -30);
  }),
  hinge: track((t) => {
    const p = phase(t);
    return standing(8 * p, 12 * p, 5 + 75 * p, 75 * p, 75 * p);
  }),
  pushV: track((t) => {
    const p = phase(t);
    return standing(0, 0, 2, 30 + 150 * p, 180, [520, 920]);
  }),
  pullV: track((t) => {
    const e = 170 - 100 * phase(t); // elbow angle
    const wrist: P = [520, 80];
    const d = Math.sqrt(L.upper ** 2 + L.fore ** 2 - 2 * L.upper * L.fore * Math.cos(rad(e)));
    const shoulder: P = [520, 80 + d];
    const elbow: P = [520 + Math.sqrt(Math.max(0, L.upper ** 2 - (d / 2) ** 2)), 80 + d / 2];
    const hip: P = [520, shoulder[1] + L.trunk];
    const knee: P = [525, hip[1] + L.thigh];
    return { shoulder, elbow, wrist, hip, knee, ankle: [525, knee[1] + L.shin] };
  }),
  pushH: track((t) => {
    const e = 170 - 90 * phase(t);
    const floor = 900, wx = 300;
    const hS = Math.sqrt(L.upper ** 2 + L.fore ** 2 - 2 * L.upper * L.fore * Math.cos(rad(e)));
    const shoulder: P = [wx, floor - hS];
    const len = L.trunk + L.thigh + L.shin;
    const ankle: P = [wx + Math.sqrt(len ** 2 - hS ** 2), floor];
    const along = (k: number): P => [shoulder[0] + (ankle[0] - shoulder[0]) * k, shoulder[1] + (ankle[1] - shoulder[1]) * k];
    const elbow: P = [wx + Math.sqrt(Math.max(0, L.upper ** 2 - (hS / 2) ** 2)), floor - hS / 2];
    return { shoulder, elbow, wrist: [wx, floor], hip: along(L.trunk / len), knee: along((L.trunk + L.thigh) / len), ankle };
  }),
  pullH: track((t) => {
    const p = phase(t);
    return standing(10, 20, 50, -70 * p, 20 * p);
  }),
  lunge: track((t) => {
    const drop = 170 * phase(t);
    const front: P = [700, 920], back: P = [250, 920];
    const hip: P = [480, 920 - Math.sqrt((L.thigh + L.shin) ** 2 - 225 ** 2) + 10 + drop];
    const shoulder = add(hip, L.trunk, 3);
    const elbow = add(shoulder, L.upper, 0, false);
    return { shoulder, elbow, wrist: add(elbow, L.fore, 0, false), hip, knee: ik(hip, front), ankle: front, farHip: hip, farKnee: ik(hip, back), farAnkle: back };
  }),
  gait: track((t) => {
    const w = 2 * Math.PI * 1.2 * t;
    const hip: P = [150 + 120 * t, 420];
    const leg = (ph: number) => {
      const phi = 25 * Math.sin(w + ph), kappa = 45 * Math.max(0, Math.sin(w + ph + 0.6));
      const knee = add(hip, L.thigh, phi, false);
      return { knee, ankle: add(knee, L.shin, phi - kappa, false) };
    };
    const a = leg(0), b = leg(Math.PI);
    const shoulder = add(hip, L.trunk, 5);
    const elbow = add(shoulder, L.upper, 10 * Math.sin(w + Math.PI), false);
    return { shoulder, elbow, wrist: add(elbow, L.fore, 20, false), hip, knee: a.knee, ankle: a.ankle, farHip: hip, farKnee: b.knee, farAnkle: b.ankle };
  }),
  still: track(() => standing(0, 0, 3, 5, 5)),
};

describe('guessing the pattern from the joints', () => {
  for (const [name, expected] of Object.entries({ squat: 'squat', hinge: 'hinge', pushV: 'pushV', pullV: 'pullV', pushH: 'pushH', pullH: 'pullH', lunge: 'lunge', gait: 'gait' })) {
    it(`recognises ${name}`, () => {
      const g = guessPattern(cases[name]);
      expect(g.pattern, `${g.why} ${JSON.stringify(g.features)}`).toBe(expected);
      expect(g.confidence).toBeGreaterThan(0.5);
    });
  }

  it('leaves standing still unlabelled', () => {
    expect(guessPattern(cases.still).pattern).toBeNull();
  });

  it('says so when the person was barely tracked', () => {
    const t = cases.squat;
    const sparse = { ...t, frames: t.frames.map((f, i) => (i % 4 ? { ...f, lm: null } : f)) };
    expect(guessPattern(sparse).pattern).toBeNull();
  });
});

describe('weighing in the training log', () => {
  const day = new Date(2019, 2, 12, 18, 0).getTime();
  const log = [
    { date: new Date(2019, 2, 12, 9, 0).getTime(), pattern: 'squat' as const },
    { date: new Date(2019, 2, 12, 9, 30).getTime(), pattern: 'hinge' as const },
    { date: new Date(2019, 2, 13, 9, 0).getTime(), pattern: 'pushH' as const },
  ];

  it('finds what was logged that day', () => {
    expect(loggedThatDay(day, log).sort()).toEqual(['hinge', 'squat']);
  });

  it('agreement makes a confident suggestion; disagreement a cautious one', () => {
    const move = { pattern: 'squat' as const, confidence: 0.7, why: 'Knees and hips bend together.' };
    expect(suggest(move, ['squat', 'hinge'])).toMatchObject({ pattern: 'squat', from: 'both' });
    expect(suggest(move, ['squat', 'hinge']).confidence).toBeGreaterThanOrEqual(0.9);
    expect(suggest(move, ['pushH']).confidence).toBeLessThanOrEqual(0.55);
    expect(suggest({ pattern: null, confidence: 0, why: '' }, ['pushH'])).toMatchObject({ pattern: 'pushH', from: 'log' });
    expect(suggest({ pattern: null, confidence: 0, why: '' }, ['squat', 'hinge'])).toMatchObject({ pattern: null, options: ['squat', 'hinge'] });
  });
});
