// Demo photos and clips, so the media features have something to show with
// the demo data: "progress photos" rendered from the atlas body fitted to the
// demo's measurements on three dates, and squat clips drawn from the movement
// model and recorded the way the camera records, with angles already marked.
import { AmbientLight, Color, DirectionalLight, HemisphereLight, Mesh, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { db, uid, type MediaItem, type MediaMark, type MeasurementEntry, type Note, type PoseId } from '../db/db';
import { applyShape, buildLayerModel } from '../model/atlasModel';
import { bodyDims, computeBodyShape } from '../model/bodyShape';
import { createLayerMaterial } from '../model/layerMaterial';
import { runModel, type DiagramView, type P2 } from '../movement/biomech';
import { currentValues, shapeInputFrom } from '../profile/profile';
import { canvasBlob, recorderMime, thumbFrom } from './process';

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
        out.push({ blob, meta: { kind: 'photo', purpose: 'progress', pose, date: date.getTime(), width: W, height: H, thumb, tags: ['demo'], source: 'demo' } });
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

interface ClipSpec {
  ago: number;
  depth: string;
  ankle: string;
  load: number;
  reps: number;
  notes?: string;
}

const CLIP_W = 480, CLIP_H = 640;
const STAND = 0.4, REP = 2.0, REPS_SHOWN = 2;
const CLIP_SECONDS = STAND + REP * REPS_SHOWN + 0.3;
const phaseAtTime = (t: number) => (t < STAND ? 0 : 0.5 - 0.5 * Math.cos((2 * Math.PI * Math.min(t - STAND, REP * REPS_SHOWN)) / REP));

/** Model metres → canvas pixels (side view, floor near the bottom). */
function projector(v: DiagramView) {
  const s = CLIP_H / 2.35;
  const mid = v.base ? (v.base[0] + v.base[1]) / 2 : 0;
  return (p: P2): P2 => [CLIP_W * 0.46 + (p[0] - mid) * s, CLIP_H * 0.93 - p[1] * s];
}

function drawFrame(ctx: CanvasRenderingContext2D, v: DiagramView) {
  const P = projector(v);
  const s = CLIP_H / 2.35;
  const g = ctx.createLinearGradient(0, 0, 0, CLIP_H);
  g.addColorStop(0, '#59606f');
  g.addColorStop(0.92, '#434956');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CLIP_W, CLIP_H);
  ctx.fillStyle = '#1c1f26';
  ctx.fillRect(0, CLIP_H * 0.93, CLIP_W, CLIP_H * 0.07);
  // rack uprights in the background
  ctx.fillStyle = '#6a7182';
  ctx.fillRect(CLIP_W * 0.08, CLIP_H * 0.12, 14, CLIP_H * 0.81);
  ctx.fillRect(CLIP_W * 0.86, CLIP_H * 0.12, 14, CLIP_H * 0.81);
  const pt = v.points;
  const limb = (a: string, b: string, w: number, color: string) => {
    if (!pt[a] || !pt[b]) return;
    const [x1, y1] = P(pt[a]), [x2, y2] = P(pt[b]);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  // plate behind the lifter
  if (v.bar) {
    const [bx, by] = P(v.bar.at);
    ctx.fillStyle = '#16181d';
    ctx.beginPath();
    ctx.arc(bx, by, v.bar.r * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5b6170';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#9aa1ad';
    ctx.beginPath();
    ctx.arc(bx, by, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  limb('heel', 'toe', 13, '#e9e9ec');
  limb('ankle', 'knee', 21, '#d6a184');
  limb('knee', 'hip', 30, '#15171c');
  limb('hip', 'shoulder', 38, '#3d64a8');
  limb('shoulder', 'elbow', 15, '#d6a184');
  limb('elbow', 'hand', 13, '#d6a184');
  if (pt.head) {
    const [hx, hy] = P(pt.head);
    ctx.fillStyle = '#d6a184';
    ctx.beginPath();
    ctx.arc(hx, hy, 0.105 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a2a22';
    ctx.beginPath();
    ctx.arc(hx - 0.02 * s, hy - 0.03 * s, 0.1 * s, Math.PI * 0.9, Math.PI * 2.05);
    ctx.fill();
  }
}

function squatAt(spec: ClipSpec, dims: ReturnType<typeof bodyDims>, mass: number, phase: number): DiagramView {
  return runModel('squat', { phase, dims, mass, load: spec.load, options: { variant: 'highbar', depth: spec.depth, ankle: spec.ankle } }).views[0];
}

/** The marks a coach would draw: knee angle and torso lean at the bottom, and the bar path through the first rep. */
function clipMarks(spec: ClipSpec, dims: ReturnType<typeof bodyDims>, mass: number): MediaMark[] {
  const bottom = squatAt(spec, dims, mass, 1);
  const P = projector(bottom);
  const n = (p: P2): [number, number] => {
    const [x, y] = P(p);
    return [Math.round((x / CLIP_W) * 1e4) / 1e4, Math.round((y / CLIP_H) * 1e4) / 1e4];
  };
  const tBottom = STAND + REP / 2;
  const path: [number, number][] = [], times: number[] = [];
  for (let t = STAND; t <= STAND + REP + 1e-6; t += REP / 10) {
    const v = squatAt(spec, dims, mass, phaseAtTime(t));
    if (v.bar) {
      path.push(n(v.bar.at));
      times.push(Math.round(t * 1000) / 1000);
    }
  }
  return [
    { id: uid(), type: 'angle', label: 'Knee', points: [n(bottom.points.hip), n(bottom.points.knee), n(bottom.points.ankle)], t: tBottom },
    { id: uid(), type: 'line', label: 'Torso lean', points: [n(bottom.points.hip), n(bottom.points.shoulder)], t: tBottom },
    ...(path.length > 2 ? [{ id: uid(), type: 'path' as const, label: 'Bar path', points: path, times }] : []),
  ];
}

async function recordClip(spec: ClipSpec, dims: ReturnType<typeof bodyDims>, mass: number): Promise<Blob | null> {
  const mime = recorderMime();
  const canvas = document.createElement('canvas');
  canvas.width = CLIP_W;
  canvas.height = CLIP_H;
  const ctx = canvas.getContext('2d')!;
  if (mime === undefined || !('captureStream' in canvas)) return null;
  drawFrame(ctx, squatAt(spec, dims, mass, 0));
  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 2_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(250);
  const t0 = performance.now();
  await new Promise<void>((done) => {
    const frame = () => {
      const t = (performance.now() - t0) / 1000;
      drawFrame(ctx, squatAt(spec, dims, mass, phaseAtTime(t)));
      if (t < CLIP_SECONDS) requestAnimationFrame(frame);
      else done();
    };
    requestAnimationFrame(frame);
  });
  // let the encoder catch up before stopping (nothing new is drawn meanwhile)
  await new Promise((r) => setTimeout(r, 1500));
  rec.stop();
  await stopped;
  stream.getTracks().forEach((tr) => tr.stop());
  return new Blob(chunks, { type: (rec.mimeType || mime || 'video/webm').split(';')[0] });
}

async function formClips(entries: MeasurementEntry[], notes: Note[]) {
  const values = currentValues(entries);
  const dims = bodyDims(shapeInputFrom(values));
  const mass = values.weight ?? 80;
  const specs: ClipSpec[] = [
    { ago: 62, depth: 'half', ankle: '28', load: 70, reps: 5, notes: 'Knee still cranky, kept it shallow.' },
    { ago: 30, depth: 'parallel', ankle: '38', load: 85, reps: 5 },
    { ago: 3, depth: 'parallel', ankle: '48', load: 100, reps: 5, notes: 'Ankle work is paying off: more upright, knee happy.' },
  ];
  // one at a time: several software encoders at once drop most of their frames
  const blobs: (Blob | null)[] = [];
  for (const s of specs) blobs.push(await recordClip(s, dims, mass).catch(() => null));
  const out: { blob: Blob; meta: Omit<MediaItem, 'id' | 'createdAt' | 'updatedAt' | 'mime' | 'size'> }[] = [];
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const date = new Date(Date.now() - s.ago * DAY);
    date.setHours(18, 10, 0, 0);
    const workout = notes.filter((n) => n.category === 'workout' && Math.abs(n.date - date.getTime()) < 1.2 * DAY).sort((a, b) => Math.abs(a.date - date.getTime()) - Math.abs(b.date - date.getTime()))[0];
    // the poster frame: standing at the start
    const c = document.createElement('canvas');
    c.width = CLIP_W;
    c.height = CLIP_H;
    drawFrame(c.getContext('2d')!, squatAt(s, dims, mass, blobs[i] ? 0.55 : 1));
    const thumb = await thumbFrom(c, CLIP_W, CLIP_H);
    const base = { purpose: 'form' as const, pattern: 'squat', variant: 'highbar', load: s.load, reps: s.reps, camera: 'side' as const, date: date.getTime(), width: CLIP_W, height: CLIP_H, thumb, notes: s.notes, tags: ['demo'], source: 'demo', noteId: workout?.id };
    const marks = clipMarks(s, dims, mass);
    const blob = blobs[i];
    if (blob)
      out.push({ blob, meta: { ...base, kind: 'video', duration: CLIP_SECONDS, marks, phase0: 0.2, phase1: STAND + REP / 2 } });
    else
      // no video recording here: a still of the bottom position instead
      out.push({ blob: await canvasBlob(c, 'image/jpeg', 0.88), meta: { ...base, kind: 'photo', marks: marks.filter((m) => m.type !== 'path').map(({ t: _t, ...m }) => m) } });
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
    items.push(...(await formClips(entries, notes)));
  } catch (e) {
    console.warn('Demo form clips skipped', e);
  }
  await save(items);
  return items.length;
}
