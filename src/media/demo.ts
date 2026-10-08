// Demo photos and clips, so the media features have something to show with
// the demo data: "progress photos" rendered from the atlas body fitted to the
// demo's measurements on three dates, and squat clips of the body posed by the
// squat model (see synthetic.ts), recorded the way the camera records, with
// angles marked on the true joints.
import { AmbientLight, Color, DirectionalLight, HemisphereLight, Mesh, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { db, uid, type MediaItem, type MediaMark, type MeasurementEntry, type Note, type PoseId } from '../db/db';
import { applyShape, buildLayerModel } from '../model/atlasModel';
import { computeBodyShape } from '../model/bodyShape';
import { createLayerMaterial } from '../model/layerMaterial';
import { currentValues, shapeInputFrom } from '../profile/profile';
import { canvasBlob, recorderMime, thumbFrom } from './process';
import { openStudio, squatDuration, squatReps, type SquatSpec, type Studio, type Truth } from './synthetic';

const DAY = 86_400_000;

async function save(items: { blob: Blob; meta: Omit<MediaItem, 'id' | 'createdAt' | 'updatedAt' | 'mime' | 'size'> }[]) {
  const now = Date.now();
  await db.transaction('rw', db.media, db.mediaBlobs, async () => {
    for (const { blob, meta } of items) {
      const id = uid();
      await db.mediaBlobs.put({ id, blob });
      await db.media.put({ ...meta, id, createdAt: now, updatedAt: now, mime: blob.type, size: blob.size });
    }
  });
}

/** Front, side and back renders of the body as fitted on each measurement date. */
async function progressPhotos(entries: MeasurementEntry[]) {
  const res = await fetch(`${import.meta.env.BASE_URL}atlas/skin.bin`);
  if (!res.ok) throw new Error('skin layer');
  // a private copy, so the shared model the viewers use is untouched
  const m = buildLayerModel(new Uint8Array(await res.arrayBuffer()));
  const W = 720, H = 1080;
  const canvas = document.createElement('canvas');
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  const scene = new Scene();
  scene.background = new Color('#d7dbe0');
  scene.add(new HemisphereLight('#ffffff', '#b8aea6', 1.15));
  scene.add(new AmbientLight('#ffffff', 0.2));
  const key = new DirectionalLight('#fff6ee', 1.6);
  key.position.set(1.2, 3, 3);
  scene.add(key);
  const rim = new DirectionalLight('#e8f0ff', 0.7);
  rim.position.set(-2, 2, -2.5);
  scene.add(rim);
  const lm = createLayerMaterial('skin', m.ids.length);
  // dressed in shorts, as progress photos usually are
  const shorts = /(gluteal|anal|urogenital|inguinal|femoral_triangle|hip_region|sacral|hypogastric)/;
  lm.setStates(m.ids.length, (i) => ({ visible: true, color: shorts.test(m.ids[i]) ? '#2a3140' : undefined }));
  lm.uniforms.uNeutral.value.set('#c99b82');
  lm.setOpacity(1);
  const mesh = new Mesh(m.geometry, lm.material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const cam = new PerspectiveCamera(28, W / H, 0.1, 30);
  const out: { blob: Blob; meta: Omit<MediaItem, 'id' | 'createdAt' | 'updatedAt' | 'mime' | 'size'> }[] = [];
  const sorted = [...entries].sort((a, b) => a.date - b.date);
  try {
    for (let k = 0; k < sorted.length; k++) {
      const e = sorted[k];
      applyShape(m, computeBodyShape(shapeInputFrom(currentValues(sorted.slice(0, k + 1)))));
      // the middle set was taken from a little closer and lower, as real photos often are
      const off = k === 1 ? { d: 0.94, y: -0.05 } : { d: 1, y: 0 };
      const views: [PoseId, [number, number, number]][] = [
        ['front', [0, 0, 1]],
        ['side', [1, 0, 0]],
        ['back', [0, 0, -1]],
      ];
      for (const [pose, dir] of views) {
        const d = 4.0 * off.d;
        cam.position.set(dir[0] * d, 0.92 + off.y, 0.05 + dir[2] * d);
        cam.lookAt(0, 0.9 + off.y, 0.05);
        renderer.render(scene, cam);
        const blob = await canvasBlob(canvas, 'image/jpeg', 0.86);
        const thumb = await thumbFrom(canvas, W, H);
        const date = new Date(e.date);
        date.setHours(7, 20 + (pose === 'side' ? 1 : pose === 'back' ? 2 : 0), 0, 0);
        out.push({ blob, meta: { kind: 'photo', purpose: 'progress', pose, date: date.getTime(), width: W, height: H, thumb, tags: ['demo', 'synthetic'], notes: 'Synthetic photo: the 3D body fitted to the demo measurements and rendered.', source: 'demo' } });
      }
    }
  } finally {
    lm.dispose();
    m.geometry.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return out;
}

interface ClipSpec extends SquatSpec {
  ago: number;
  notes?: string;
}

/**
 * Records a synthetic squat with MediaRecorder, the way the camera records.
 * Also returns the true joint positions at the first rep's bottom and the
 * hip's path through it.
 */
async function recordSquat(studio: Studio, spec: ClipSpec): Promise<{ blob: Blob | null; poster: Blob; bottom: Truth; path: { t: number; p: [number, number] }[] }> {
  const reps = squatReps(spec);
  const bottom = studio.frame(spec, reps[0].bottom);
  // the hip's path through the first rep
  const path: { t: number; p: [number, number] }[] = [];
  for (let t = reps[0].start; t <= reps[0].end + 1e-6; t += spec.rep / 10) path.push({ t: Math.round(t * 1000) / 1000, p: studio.frame(spec, t).image.hip });
  studio.frame(spec, 0);
  const poster = await thumbFrom(studio.canvas, studio.width, studio.height);
  const mime = recorderMime();
  if (mime === undefined || typeof MediaRecorder === 'undefined') return { blob: null, poster, bottom, path };
  // render every frame first, then play them back in real time for the recorder:
  // the encoder then has the processor to itself and keeps every frame
  const FPS = 30;
  const total = squatDuration(spec);
  const frames: Blob[] = [];
  for (let i = 0; i <= Math.ceil(total * FPS); i++) {
    studio.frame(spec, Math.min(total, i / FPS));
    frames.push(await canvasBlob(studio.canvas, 'image/jpeg', 0.9));
    if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0));
  }
  const screen = document.createElement('canvas');
  screen.width = studio.width;
  screen.height = studio.height;
  const ctx = screen.getContext('2d')!;
  const decoded = new Map<number, Promise<ImageBitmap>>();
  const bitmap = (i: number) => {
    let p = decoded.get(i);
    if (!p) decoded.set(i, (p = createImageBitmap(frames[Math.min(i, frames.length - 1)])));
    return p;
  };
  ctx.drawImage(await bitmap(0), 0, 0);
  const stream = screen.captureStream(FPS);
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 3_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(500);
  const t0 = performance.now();
  let shown = -1;
  await new Promise<void>((done) => {
    const tick = async () => {
      const i = Math.floor(((performance.now() - t0) / 1000) * FPS);
      if (i !== shown && i < frames.length) {
        shown = i;
        ctx.drawImage(await bitmap(i), 0, 0);
        for (let k = 1; k <= 4; k++) if (i + k < frames.length) void bitmap(i + k);
        decoded.get(i - 2)?.then((b) => b.close());
        decoded.delete(i - 2);
      }
      if (i < frames.length) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });
  // let the encoder catch up before stopping (nothing new is drawn meanwhile)
  await new Promise((r) => setTimeout(r, 1500));
  rec.stop();
  await stopped;
  stream.getTracks().forEach((tr) => tr.stop());
  for (const p of decoded.values()) void p.then((b) => b.close());
  return { blob: new Blob(chunks, { type: (rec.mimeType || mime || 'video/webm').split(';')[0] }), poster, bottom, path };
}

const r4 = (p: [number, number]): [number, number] => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];

/** Marks drawn exactly on the true joints (what a perfect hand-marker would draw). */
function truthMarks(bottom: Truth, path: { t: number; p: [number, number] }[]): MediaMark[] {
  const j = bottom.image;
  const t = Math.round(bottom.t * 1000) / 1000;
  return [
    { id: uid(), type: 'angle', label: 'Knee', points: [r4(j.hip), r4(j.knee), r4(j.ankle)], t },
    { id: uid(), type: 'angle', label: 'Hip', points: [r4(j.shoulder), r4(j.hip), r4(j.knee)], t },
    { id: uid(), type: 'line', label: 'Torso lean', points: [r4(j.hip), r4(j.shoulder)], t },
    { id: uid(), type: 'path', label: 'Hip path', points: path.map((x) => r4(x.p)), times: path.map((x) => x.t) },
  ];
}

async function formClips(notes: Note[]) {
  const specs: ClipSpec[] = [
    { ago: 62, depth: 'half', ankle: '28', reps: 2, rep: 2.2, stand: 0.6, notes: 'Knee still cranky: kept it shallow, ankles stiff.' },
    { ago: 30, depth: 'parallel', ankle: '38', reps: 2, rep: 2.2, stand: 0.6 },
    { ago: 3, depth: 'parallel', ankle: '48', reps: 2, rep: 2.2, stand: 0.6, notes: 'Ankle work is paying off: deeper and more upright, knee happy.' },
  ];
  const studio = await openStudio(540, 960);
  const out: { blob: Blob; meta: Omit<MediaItem, 'id' | 'createdAt' | 'updatedAt' | 'mime' | 'size'> }[] = [];
  try {
    for (const s of specs) {
      const date = new Date(Date.now() - s.ago * DAY);
      date.setHours(18, 10, 0, 0);
      const workout = notes.filter((n) => n.category === 'workout' && Math.abs(n.date - date.getTime()) < 1.2 * DAY).sort((a, b) => Math.abs(a.date - date.getTime()) - Math.abs(b.date - date.getTime()))[0];
      const { blob, poster, bottom, path } = await recordSquat(studio, s);
      const reps = squatReps(s);
      const base = {
        purpose: 'form' as const,
        pattern: 'squat',
        variant: 'goblet',
        load: 0,
        reps: s.reps,
        camera: 'side' as const,
        date: date.getTime(),
        width: studio.width,
        height: studio.height,
        thumb: poster,
        notes: `${s.notes ? `${s.notes} ` : ''}Synthetic clip: the 3D body posed by the squat model; its angles are marked on the true joints.`,
        tags: ['demo', 'synthetic'],
        source: 'demo',
        noteId: workout?.id,
      };
      const marks = truthMarks(bottom, path);
      if (blob) out.push({ blob, meta: { ...base, kind: 'video', duration: squatDuration(s), marks, phase0: reps[0].start, phase1: reps[0].bottom } });
      else {
        // no video recording here: a still of the bottom position instead
        studio.frame(s, reps[0].bottom);
        out.push({ blob: await canvasBlob(studio.canvas, 'image/jpeg', 0.88), meta: { ...base, kind: 'photo', marks: marks.filter((m) => m.type !== 'path').map(({ t: _t, ...m }) => m) } });
      }
    }
  } finally {
    studio.dispose();
  }
  return out;
}

/** Adds the demo photos and clips. Returns how many were added (0 if this browser can't render them). */
export async function seedDemoMedia(entries: MeasurementEntry[], notes: Note[]): Promise<number> {
  const items = [];
  try {
    items.push(...(await progressPhotos(entries)));
  } catch (e) {
    console.warn('Demo progress photos skipped', e);
  }
  try {
    items.push(...(await formClips(notes)));
  } catch (e) {
    console.warn('Demo form clips skipped', e);
  }
  await save(items);
  return items.length;
}
