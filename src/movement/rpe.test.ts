import { describe, expect, it } from 'vitest';
import type { MediaItem, Note } from '../db/db';
import {
  accuracyOverTime,
  e1rmFrom,
  failureSpeed,
  learnRpe,
  liftKey,
  maxAt,
  maxFromSpeed,
  observations,
  priorSpeedModel,
  rpeFromLoad,
  speedAtFailure,
  type SetObservation,
} from './rpe';

const DAY = 86_400_000;
const t0 = new Date(2026, 0, 5, 18).getTime();

/** A repeatable pseudo-random stream. */
function rng(seed: number) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) >>> 0) / 2 ** 32);
}

describe('RPE from the load', () => {
  it('turns sets into maxes and back', () => {
    // 100 kg × 5 at RPE 8: two reps left, so the max is 100 × (1 + 7/30)
    expect(e1rmFrom(100, 5, 2)).toBeCloseTo(123.33, 2);
    expect(rpeFromLoad(110, 3, e1rmFrom(100, 5, 2))).toBeCloseTo(9.36, 1);
    expect(rpeFromLoad(100, 5, e1rmFrom(100, 5, 2))).toBeCloseTo(8, 5);
  });

  it('weights recent maxes and respects all-out lower bounds', () => {
    const pts = [
      { date: t0, value: 120, exact: true },
      { date: t0 + 84 * DAY, value: 130, exact: true },
    ];
    const m = maxAt(pts, t0 + 85 * DAY)!;
    expect(m.value).toBeGreaterThan(126); // the newer max counts four times as much
    expect(m.rough).toBe(false);
    // a recent set without an RPE only says the max is at least this much
    expect(maxAt([...pts, { date: t0 + 84 * DAY, value: 140, exact: false }], t0 + 85 * DAY)!.value).toBe(140);
    expect(maxAt([{ date: t0, value: 100, exact: false }], t0 + DAY)).toMatchObject({ value: 105, rough: true });
    expect(maxAt(pts, t0)).toBeNull(); // nothing before then
  });
});

describe('a lifter getting stronger', () => {
  it('keeps up instead of lagging behind', () => {
    // true max climbs 1.5% a week; each week a set of 5 at about RPE 8 against the true max
    const obs: SetObservation[] = [];
    for (let wk = 0; wk < 16; wk++) {
      const max = 120 * 1.015 ** wk;
      const load = Math.round(max / (1 + 7 / 30) / 2.5) * 2.5;
      const rpe = Math.round((10 - (30 * (max / load - 1) - 5)) * 2) / 2;
      obs.push({ id: `w${wk}`, date: t0 + wk * 7 * DAY, lift: 'back squat', name: 'Back squat', pattern: 'squat', load, reps: 5, rpe });
    }
    const L = learnRpe(obs);
    const late = L.history.slice(-6).map((h) => Math.abs(h.guess! - h.rpe));
    expect(Math.max(...late)).toBeLessThan(0.75);
    // its max for next week is close to the truth, not the average of the last weeks
    expect(L.maxAt('back squat', t0 + 16 * 7 * DAY)!.value).toBeGreaterThan(120 * 1.015 ** 15);
  });
});

describe('RPE from bar speed, learned from your ratings', () => {
  it('starts from typical figures', () => {
    const m = priorSpeedModel('squat')!;
    expect(failureSpeed(m, 'squat')).toBeCloseTo(0.3, 5);
    expect(priorSpeedModel('carry')).toBeNull();
  });

  it('learns your own speed at failure and gets more accurate as you rate sets', () => {
    // this lifter's squat slows to 0.22 m/s at failure, losing 0.05 m/s per rep in reserve (the typical figures say 0.30)
    const r = rng(7);
    const obs: SetObservation[] = [];
    for (let i = 0; i < 48; i++) {
      const rir = Math.round(r() * 5);
      const best = 0.55 + (r() - 0.5) * 0.06;
      const last = Math.min(best, 0.22 + 0.05 * rir + (r() - 0.5) * 0.02);
      obs.push({ id: `s${i}`, date: t0 + i * 2 * DAY, lift: 'back squat', name: 'Back squat', pattern: 'squat', rpe: 10 - rir, speed: { best, last, loss: (best - last) / best, slowdown: best / last, reps: 5 } });
    }
    const L = learnRpe(obs);
    const errs = L.history.map((h) => Math.abs(h.guess! - h.rpe));
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    expect(mean(errs.slice(-10))).toBeLessThan(mean(errs.slice(0, 10)));
    expect(mean(errs.slice(-10))).toBeLessThan(0.6);
    const m = L.speedModels.get('squat')!;
    expect(m.n).toBe(48);
    // the speed it now expects at failure has moved from the typical 0.30 m/s towards the lifter's own
    expect(failureSpeed(m, 'squat')!).toBeLessThan(0.28);
    // read straight from the rated sets, the lifter's speed at failure is close to the true 0.22 m/s
    const own = speedAtFailure(obs, 'squat')!;
    expect(own.speed).toBeCloseTo(0.22, 1);
    expect(own.perRep).toBeCloseTo(0.05, 2);
    const acc = accuracyOverTime(L.history, 8);
    expect(acc[acc.length - 1].error).toBeLessThan(acc[0].error);
    // a fresh slow set reads as hard; a fast one as easy
    const hard = L.estimate({ date: t0 + 200 * DAY, lift: 'back squat', pattern: 'squat', speed: { best: 0.55, last: 0.24, loss: 0.56, slowdown: 2, reps: 6 } })!;
    const easy = L.estimate({ date: t0 + 200 * DAY, lift: 'back squat', pattern: 'squat', speed: { best: 0.56, last: 0.45, loss: 0.2, slowdown: 1.2, reps: 3 } })!;
    expect(hard.rpe).toBeGreaterThan(9);
    expect(easy.rpe).toBeLessThan(8.5);
    expect(hard.fromSpeed!.learnedFrom).toBe(48);
  });

  it('combines both sides, trusting the combination more than either', () => {
    const obs: SetObservation[] = [
      { id: 'a', date: t0, lift: 'bench press', name: 'Bench press', pattern: 'pushH', load: 80, reps: 5, rpe: 8 },
      { id: 'b', date: t0 + 7 * DAY, lift: 'bench press', name: 'Bench press', pattern: 'pushH', load: 82.5, reps: 5, rpe: 8.5 },
    ];
    const L = learnRpe(obs);
    const e = L.estimate({ date: t0 + 14 * DAY, lift: 'bench press', pattern: 'pushH', load: 85, reps: 4, speed: { best: 0.4, last: 0.3, loss: 0.25, slowdown: 1.3, reps: 4 } })!;
    expect(e.fromLoad).toBeDefined();
    expect(e.fromSpeed).toBeDefined();
    expect(e.sd).toBeLessThan(Math.min(e.fromLoad!.sd, e.fromSpeed!.sd));
    expect(e.rpe).toBeGreaterThanOrEqual(Math.min(e.fromLoad!.rpe, e.fromSpeed!.rpe) - 1e-9);
    expect(e.rpe).toBeLessThanOrEqual(Math.max(e.fromLoad!.rpe, e.fromSpeed!.rpe) + 1e-9);
    // the first rated set had nothing to go on; the second was predicted from the first's max
    expect(L.history[0].guess).toBeUndefined();
    expect(L.history[1].load).toBeDefined();
    expect(L.estimate({ date: t0, lift: 'unknown', load: 50, reps: 5 })).toBeNull();
  });

  it('finds your max from bar speed at a few loads', () => {
    // first-rep speed falls 0.01 m/s per kg from 1.0 m/s at 40 kg; failure at 0.3 m/s → 110 kg
    const obs: SetObservation[] = [60, 80, 100].map((load, i) => ({
      id: `v${i}`, date: t0 + i * DAY, lift: 'back squat', name: 'Back squat', pattern: 'squat', load, reps: 3,
      speed: { best: 1 - 0.01 * (load - 40), last: 0.9 - 0.01 * (load - 40), loss: 0.1, slowdown: 1.1, reps: 3 },
    }));
    expect(maxFromSpeed(obs, 'back squat', 0.3, t0 + 3 * DAY)!.e1rm).toBeCloseTo(110, 5);
    expect(maxFromSpeed(obs.slice(0, 2), 'back squat', 0.3, t0 + 3 * DAY)).toBeNull();
  });
});

describe('sets from your log and your clips', () => {
  it('pairs a clip with the logged set it shows', () => {
    const note = {
      id: 'n1', date: t0, createdAt: 0, updatedAt: 0, title: 'Legs', body: '', category: 'workout', feeling: 0, sensations: [], tags: [], locations: [], structureIds: [], links: [],
      workout: { exercises: [{ name: 'Back Squat', sets: 3, reps: 5, load: 220, unit: 'lb', rpe: 8 }, { name: 'Leg curl', sets: 3, reps: 12 }] },
    } as unknown as Note;
    const clip = (id: string, extra: Partial<MediaItem>): MediaItem =>
      ({ id, kind: 'video', purpose: 'form', date: t0 + 3600_000, createdAt: 0, updatedAt: 0, mime: 'video/mp4', size: 1, width: 1, height: 1, tags: [], pattern: 'squat', ...extra }) as MediaItem;
    const v = { pattern: 'squat', v: [0.5, 0.45, 0.4], peak: [0.9, 0.8, 0.7], rom: [0.5, 0.5, 0.5], dur: [1, 1.1, 1.25], h: 1.7094, point: 'shoulder' as const };
    const obs = observations(
      [note],
      [clip('m1', { load: 100, velocity: v }), clip('m2', { load: 60, velocity: v, variant: 'front', rpe: 7 }), clip('m3', { pattern: 'squat' })],
      1.7094,
    );
    expect(obs).toHaveLength(2); // the leg curl has no load or RPE; m3 has neither speed nor RPE
    const squat = obs.find((o) => o.noteId)!;
    expect(squat).toMatchObject({ lift: 'back squat', pattern: 'squat', reps: 5, rpe: 8, mediaId: 'm1' });
    expect(squat.load).toBeCloseTo(99.79, 2);
    expect(squat.speed).toMatchObject({ last: 0.4, reps: 3 });
    expect(squat.speed!.loss).toBeCloseTo(0.2, 5);
    const front = obs.find((o) => o.mediaId === 'm2')!;
    expect(front).toMatchObject({ lift: 'front squat', name: 'Front squat', load: 60, reps: 3, rpe: 7 });
    expect(liftKey('  Back-Squat (paused)! ')).toBe('back-squat paused');
  });
});
