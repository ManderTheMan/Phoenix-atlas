// Demo data: ~3 months of realistic notes and health metrics so every screen
// has something to show. Clearly marked with the "demo" source/tag.
import { STRUCTURE_BY_ID } from '../anatomy/catalog';
import { loadAtlasModel, type AtlasModel } from '../model/atlasModel';
import { DAY, dayKey, startOfDay } from '../lib/dates';
import type { CategoryId } from '../lib/feeling';
import { db, uid, type Activity, type MetricPoint, type Note, type NoteLocation, type Vec3 } from './db';

type Facing = 'front' | 'back' | 'left' | 'right' | 'up';

const DIRS: Record<Facing, Vec3> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [1, 0, 0.2],
  right: [-1, 0, 0.2],
  up: [0, 1, 0],
};

/** Pick a surface point on a structure that faces the given direction. */
function pointOn(model: AtlasModel, id: string, facing: Facing, bias = 0): NoteLocation {
  const mesh = model.meshes.find((m) => m.id === id);
  if (!mesh) return { structureId: id };
  const p = mesh.positions;
  let cx = 0, cy = 0, cz = 0;
  const n = p.length / 3;
  for (let i = 0; i < p.length; i += 3) { cx += p[i]; cy += p[i + 1]; cz += p[i + 2]; }
  cx /= n; cy /= n; cz /= n;
  let d = DIRS[facing];
  // structures on the right side mirror left/right facings
  if (id.endsWith('-r') && (facing === 'left' || facing === 'right')) d = [-d[0], d[1], d[2]];
  let best = 0, bestScore = -Infinity;
  for (let i = 0; i < n; i++) {
    const vx = p[i * 3] - cx, vy = p[i * 3 + 1] - cy, vz = p[i * 3 + 2] - cz;
    const score = vx * d[0] + vy * d[1] + vz * d[2] - Math.abs(vy) * 0.6 + vy * bias;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  const nn = mesh.normals;
  return {
    structureId: id,
    point: [p[best * 3], p[best * 3 + 1], p[best * 3 + 2]],
    normal: [nn[best * 3], nn[best * 3 + 1], nn[best * 3 + 2]],
  };
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export async function seedDemoData(): Promise<number> {
  const model = await loadAtlasModel();
  const rand = rng(42);
  const today = startOfDay(Date.now());
  const day = (ago: number, hour = 9, min = 0) => today - ago * DAY + hour * 3600_000 + min * 60_000;
  const notes: Note[] = [];
  const at = (id: string, f: Facing, bias = 0) => pointOn(model, id, f, bias);

  const add = (n: {
    ago: number;
    hour?: number;
    title: string;
    body?: string;
    category: CategoryId;
    feeling: number;
    sensations?: string[];
    tags: string[];
    locations?: NoteLocation[];
    intensity?: number;
    workout?: Note['workout'];
    measurements?: Note['measurements'];
    follow?: boolean; // follow-up of the previous note with the same first tag
    private?: boolean;
  }) => {
    const locations = n.locations ?? [];
    let followUpOf: string | undefined;
    if (n.follow) {
      const prev = [...notes].reverse().find((x) => x.tags[0] === n.tags[0]);
      followUpOf = prev?.id;
    }
    const id = uid();
    const date = day(n.ago, n.hour ?? 9 + Math.floor(rand() * 9), Math.floor(rand() * 60));
    notes.push({
      id,
      date,
      createdAt: date,
      updatedAt: date,
      title: n.title,
      body: n.body ?? '',
      category: n.category,
      feeling: n.feeling,
      intensity: n.intensity,
      sensations: n.sensations ?? [],
      tags: [...n.tags, 'demo'],
      locations,
      structureIds: [...new Set(locations.map((l) => l.structureId))],
      links: followUpOf ? [followUpOf] : [],
      followUpOf,
      workout: n.workout,
      measurements: n.measurements,
      private: n.private,
      source: 'demo',
    });
  };

  // --- Thread: left knee pain from running, improving -----------------------
  const knee = [at('vastus-medialis-l', 'front', 0.3), at('patella-l', 'front')];
  const kneeSeries: [number, number, string][] = [
    [80, -4, 'Sharp pain on the inside of the left knee on the downhill section of my run. Stopped at 6 km.'],
    [76, -3, 'Still sore on stairs. Iced twice. Skipping runs this week.'],
    [71, -3, 'Physio: likely patellofemoral irritation + weak VMO. Started terminal knee extensions and split squats.'],
    [64, -2, 'Easy 3 km on flat ground, mild ache after.'],
    [57, -1, 'Stairs fine now. 5 km easy, slight tightness only.'],
    [49, -1, 'Added step-downs. Knee feels more stable.'],
    [40, 0, '7 km easy, no pain during. A bit stiff in the morning.'],
    [31, 1, 'First tempo run back. Knee felt good.'],
    [20, 2, '10 km long run, no knee pain at all.'],
    [9, 2, 'Hill repeats — knee solid. Keeping the VMO work 2x/week.'],
    [2, 3, 'Best run in months. Knee feels strong.'],
  ];
  kneeSeries.forEach(([ago, feeling, body], i) =>
    add({
      ago,
      title: i === 0 ? 'Left knee pain on run' : 'Left knee check-in',
      body,
      category: i === 0 ? 'symptom' : feeling >= 1 ? 'movement' : 'symptom',
      feeling,
      intensity: feeling < 0 ? Math.min(10, -feeling * 2) : undefined,
      sensations: feeling <= -3 ? ['pain'] : feeling < 0 ? ['ache', 'stiff'] : feeling < 2 ? ['stable'] : ['strong', 'stable'],
      tags: ['left-knee', 'running'],
      locations: knee,
      follow: i > 0,
    }),
  );

  // --- Thread: lower back tightness (flare-up, recovery, small relapse) ------
  const back = [at('erector-spinae-l', 'back', -0.4), at('erector-spinae-r', 'back', -0.4), at('l4', 'back')];
  const backSeries: [number, number, string, string[]][] = [
    [62, -3, 'Lower back locked up after heavy deadlifts + long drive. Hard to bend.', ['tight', 'pain', 'stiff']],
    [59, -2, 'Better with walking. Sitting still makes it worse.', ['tight', 'stiff']],
    [54, -1, 'Cat-cow and McGill big 3 daily. Much looser.', ['tight']],
    [45, 1, 'Deadlifts at 70%, felt fine.', ['mobile']],
    [33, 0, 'Long day at the desk — some stiffness by evening.', ['stiff']],
    [26, -2, 'Tweaked it picking up a box. Mild spasm left side.', ['pain', 'cramping']],
    [22, -1, 'Spasm gone, still guarded.', ['tight']],
    [14, 1, 'Back feels normal. Added standing breaks at work.', ['mobile']],
    [4, 2, 'Pulled 140 kg for a triple, back felt strong.', ['strong']],
  ];
  backSeries.forEach(([ago, feeling, body, sensations], i) =>
    add({
      ago,
      title: i === 0 ? 'Lower back flare-up' : 'Lower back',
      body,
      category: feeling < 0 ? 'symptom' : 'movement',
      feeling,
      intensity: feeling < 0 ? -feeling * 2 : undefined,
      sensations,
      tags: ['lower-back', ...(body.includes('desk') ? ['desk'] : []), ...(body.toLowerCase().includes('deadlift') ? ['deadlift'] : [])],
      locations: back,
      follow: i > 0,
    }),
  );

  // --- Thread: right shoulder pinch on overhead press ------------------------
  const shoulder = [at('deltoid-anterior-r', 'front', 0.5), at('supraspinatus-r', 'up')];
  const shSeries: [number, number, string][] = [
    [47, -2, 'Pinch at the front of the right shoulder at the top of the overhead press.'],
    [43, -2, 'Swapped to landmine press. Doing band pull-aparts + face pulls.'],
    [35, -1, 'Thoracic mobility work helps. Less pinch.'],
    [24, 0, 'Back to strict press with lighter weight, minor awareness only.'],
    [12, 1, 'No pinch at 50 kg.'],
    [3, 2, 'Pressed 55 kg x 5, shoulder felt great.'],
  ];
  shSeries.forEach(([ago, feeling, body], i) =>
    add({
      ago,
      title: i === 0 ? 'Right shoulder pinch' : 'Right shoulder',
      body,
      category: feeling < 0 ? 'symptom' : 'movement',
      feeling,
      sensations: feeling < 0 ? ['pain'] : ['mobile'],
      tags: ['right-shoulder', 'overhead-press', 'mobility'],
      locations: shoulder,
      follow: i > 0,
    }),
  );

  // --- Workouts ---------------------------------------------------------------
  const legs = () => [at('rectus-femoris-l', 'front'), at('rectus-femoris-r', 'front'), at('gluteus-maximus-l', 'back'), at('gluteus-maximus-r', 'back')];
  const push = () => [at('pectoralis-major-l', 'front'), at('pectoralis-major-r', 'front'), at('triceps-l', 'back'), at('triceps-r', 'back')];
  const pull = () => [at('latissimus-dorsi-l', 'back'), at('latissimus-dorsi-r', 'back'), at('biceps-l', 'front'), at('biceps-r', 'front')];
  const run = () => [at('gastrocnemius-l', 'back'), at('gastrocnemius-r', 'back')];
  for (let ago = 88; ago >= 0; ago--) {
    const dow = new Date(today - ago * DAY).getDay();
    const progress = (88 - ago) / 88;
    if (dow === 1) {
      add({
        ago, hour: 18, title: 'Leg day', category: 'workout', feeling: ago > 60 && ago < 78 ? 0 : 2 + Math.round(rand()),
        sensations: ['pumped', 'strong'], tags: ['legs', 'strength'], locations: legs(),
        workout: {
          durationMin: 60 + Math.round(rand() * 15), rpe: 7 + Math.round(rand() * 2),
          exercises: [
            { name: 'Back squat', sets: 5, reps: 5, load: Math.round(90 + progress * 20), unit: 'kg' },
            { name: 'Romanian deadlift', sets: 3, reps: 8, load: Math.round(80 + progress * 15), unit: 'kg' },
            { name: 'Split squat', sets: 3, reps: 10, load: 16, unit: 'kg' },
          ],
        },
      });
      if (rand() > 0.35)
        add({ ago: ago - 1, hour: 8, title: 'DOMS after leg day', category: 'recovery', feeling: -1, sensations: ['sore'], tags: ['legs', 'doms'], locations: [at('rectus-femoris-l', 'front'), at('vastus-lateralis-r', 'right')] });
    } else if (dow === 3) {
      add({
        ago, hour: 18, title: 'Push day', category: 'workout', feeling: ago > 30 && ago < 48 ? 0 : 2,
        sensations: ['pumped'], tags: ['push', 'strength'], locations: push(),
        workout: {
          durationMin: 55, rpe: 7,
          exercises: [
            { name: 'Bench press', sets: 5, reps: 5, load: Math.round(75 + progress * 10), unit: 'kg' },
            { name: ago > 24 && ago < 48 ? 'Landmine press' : 'Overhead press', sets: 4, reps: 6, load: Math.round(40 + progress * 12), unit: 'kg' },
            { name: 'Dips', sets: 3, reps: 10 },
          ],
        },
      });
    } else if (dow === 5) {
      add({
        ago, hour: 18, title: 'Pull day', category: 'workout', feeling: 2 + Math.round(rand()),
        sensations: ['pumped', 'strong'], tags: ['pull', 'strength'], locations: pull(),
        workout: {
          durationMin: 50, rpe: 7,
          exercises: [
            { name: 'Deadlift', sets: 3, reps: 3, load: ago > 62 ? 130 : ago > 40 ? 100 : Math.round(110 + progress * 30), unit: 'kg' },
            { name: 'Pull-ups', sets: 4, reps: 8 },
            { name: 'Barbell row', sets: 3, reps: 8, load: 70, unit: 'kg' },
          ],
        },
      });
    } else if ((dow === 6 || dow === 2) && (ago < 66 || ago > 80)) {
      const km = Math.round((3 + progress * 7) * 10) / 10;
      add({
        ago, hour: 7, title: `Run ${km} km`, category: 'workout', feeling: 1 + Math.round(rand() * 2),
        sensations: ['energized'], tags: ['running', 'cardio'], locations: run(),
        workout: { durationMin: Math.round(km * 5.6), rpe: 5, exercises: [{ name: 'Easy run', distanceKm: km, durationMin: Math.round(km * 5.6) }] },
      });
    }
  }

  // --- Energy / general health ------------------------------------------------
  const sleepByDay = new Map<string, number>();
  for (let ago = 89; ago >= 0; ago--) {
    const base = 7.1 + Math.sin(ago / 9) * 0.6 + (rand() - 0.5) * 1.3 - (ago % 7 === 5 ? 0.8 : 0);
    sleepByDay.set(dayKey(today - ago * DAY), Math.max(4.6, Math.min(9, base)));
  }
  for (let ago = 88; ago >= 0; ago -= 2 + Math.floor(rand() * 2)) {
    const sleep = sleepByDay.get(dayKey(today - ago * DAY)) ?? 7;
    const energy = Math.max(-4, Math.min(4, Math.round((sleep - 7) * 1.6 + (rand() - 0.5) * 2)));
    add({
      ago, hour: 8, title: energy >= 2 ? 'Great energy' : energy <= -2 ? 'Low energy' : 'Energy check-in', category: 'energy', feeling: energy,
      sensations: energy > 0 ? ['energized'] : energy < 0 ? ['fatigued'] : [],
      tags: ['energy', ...(sleep < 6.3 ? ['poor-sleep'] : [])],
      body: `Slept ${sleep.toFixed(1)} h.`,
      measurements: [{ label: 'Energy', value: Math.round(5 + energy), unit: '/10' }, { label: 'Sleep', value: Math.round(sleep * 10) / 10, unit: 'h' }],
    });
  }
  const headache = [at('upper-trapezius-l', 'back', 0.3), at('occipital-nerve-l', 'back'), at('brain', 'front')];
  for (const [ago, f] of [[70, -3], [52, -2], [27, -2], [11, -1]] as const)
    add({ ago, hour: 16, title: 'Tension headache', category: 'symptom', feeling: f, intensity: -f * 2, sensations: ['ache', 'tight'], tags: ['headache', 'desk', 'neck'], locations: headache, body: 'Started behind the eyes after a long screen day; neck and upper traps tight.' });
  add({ ago: 38, title: 'Bloated after dinner', category: 'health', feeling: -2, sensations: ['swollen'], tags: ['digestion'], locations: [at('stomach', 'front'), at('small-intestine', 'front')] });
  add({ ago: 18, title: 'Tingling down left leg', category: 'symptom', feeling: -2, sensations: ['tingling'], tags: ['lower-back', 'nerve'], locations: [at('sciatic-nerve-l', 'back')], body: 'Brief tingling into the back of the thigh after sitting 3 hours. Gone after a walk.' });
  add({ ago: 16, title: 'Sports massage', category: 'recovery', feeling: 3, sensations: ['relaxed', 'mobile'], tags: ['massage', 'recovery'], locations: [at('biceps-femoris-l', 'back'), at('biceps-femoris-r', 'back'), at('erector-spinae-l', 'back')] });
  add({ ago: 6, title: 'Hip flexors tight', category: 'movement', feeling: -1, sensations: ['tight'], tags: ['hips', 'mobility', 'desk'], locations: [at('iliopsoas-l', 'front'), at('iliopsoas-r', 'front')], body: 'Couch stretch 2 min each side helped.' });
  add({ ago: 1, title: 'Resting heart rate low', category: 'health', feeling: 2, tags: ['heart', 'recovery'], locations: [at('heart', 'front')], measurements: [{ label: 'Resting HR', value: 52, unit: 'bpm' }] });

  // --- Health metrics (as if imported from Google Health) ----------------------
  const metrics: MetricPoint[] = [];
  const activities: Activity[] = [];
  for (let ago = 89; ago >= 0; ago--) {
    const d = dayKey(today - ago * DAY);
    const sleep = sleepByDay.get(d)!;
    const runDay = notes.some((n) => n.tags.includes('running') && n.category === 'workout' && dayKey(n.date) === d);
    const steps = Math.round(6500 + rand() * 4500 + (runDay ? 6000 : 0));
    const rhr = Math.round(58 - (89 - ago) * 0.05 + (7 - sleep) * 1.5 + (rand() - 0.5) * 3);
    const hrv = Math.round(52 + (89 - ago) * 0.08 + (sleep - 7) * 6 + (rand() - 0.5) * 10);
    const push = (metric: string, value: number) => metrics.push({ id: `${metric}|${d}`, date: d, metric, value, source: 'demo' });
    push('steps', steps);
    push('sleep_hours', Math.round(sleep * 100) / 100);
    push('resting_hr', rhr);
    push('hrv_ms', hrv);
    push('active_minutes', Math.round(25 + rand() * 30 + (runDay ? 40 : 0)));
    push('calories_kcal', Math.round(2300 + steps * 0.04 + rand() * 200));
    if (ago % 7 === 0) push('weight_kg', Math.round((82.5 - (89 - ago) * 0.012 + (rand() - 0.5) * 0.6) * 10) / 10);
    if (runDay) {
      const start = today - ago * DAY + 7 * 3600_000;
      const km = Math.round((3 + ((89 - ago) / 89) * 7) * 10) / 10;
      activities.push({ id: `demo-run-${d}`, start, end: start + km * 5.6 * 60_000, type: 'RUNNING', name: 'Run', durationMin: Math.round(km * 5.6), distanceKm: km, calories: Math.round(km * 70), avgHr: 148, steps: Math.round(km * 1300), source: 'demo' });
    }
  }

  await db.transaction('rw', db.notes, db.metrics, db.activities, async () => {
    await db.notes.bulkPut(notes);
    await db.metrics.bulkPut(metrics);
    await db.activities.bulkPut(activities);
  });
  // ensure every referenced structure exists in the catalog (sanity)
  for (const n of notes) for (const s of n.structureIds) if (!STRUCTURE_BY_ID.has(s)) console.warn('unknown structure in demo data', s);
  return notes.length;
}

export async function clearDemoData(): Promise<void> {
  await db.transaction('rw', db.notes, db.metrics, db.activities, async () => {
    await db.notes.where('tags').equals('demo').delete();
    await db.metrics.filter((m) => m.source === 'demo').delete();
    await db.activities.filter((a) => a.source === 'demo').delete();
  });
}
