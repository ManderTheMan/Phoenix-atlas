// Runs MediaPipe Pose Landmarker on photos and videos, on this device. The
// WebAssembly runtime and the model are served by the app itself (see
// scripts/vision-assets.mjs), so nothing is sent anywhere.
import type { MediaItem } from '../db/db';
import { db } from '../db/db';
import { openVideo, seek } from '../media/process';
import type { ImageStats, PoseFrame, PoseTrack } from './analysis';

export const MODEL_ID = 'mediapipe-pose-landmarker-full/float16/1';
const MODEL_FILE = 'vision/pose_landmarker_full.task';

type Landmarker = import('@mediapipe/tasks-vision').PoseLandmarker;
let loading: Promise<{ image: Landmarker; video: Landmarker; delegate: 'GPU' | 'CPU' }> | null = null;
/** VIDEO mode needs ever-increasing timestamps across every clip analysed. */
let clock = 0;

const url = (p: string) => new URL(p, document.baseURI).href;

async function create(mode: 'IMAGE' | 'VIDEO', delegate: 'GPU' | 'CPU'): Promise<Landmarker> {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(url('vision/wasm'));
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: url(MODEL_FILE), delegate },
    runningMode: mode,
    numPoses: 2,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

/** Loads the tracker once (GPU when available, otherwise CPU). */
export function loadPose(): Promise<{ image: Landmarker; video: Landmarker; delegate: 'GPU' | 'CPU' }> {
  loading ??= (async () => {
    const head = await fetch(url(MODEL_FILE), { method: 'HEAD' }).catch(() => null);
    if (!head?.ok) throw new Error('The pose model isn’t included in this build (run npm run vision).');
    for (const delegate of ['GPU', 'CPU'] as const) {
      try {
        const [image, video] = await Promise.all([create('IMAGE', delegate), create('VIDEO', delegate)]);
        return { image, video, delegate };
      } catch (e) {
        if (delegate === 'CPU') throw e;
      }
    }
    throw new Error('unreachable');
  })();
  loading.catch(() => (loading = null));
  return loading;
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r3 = (x: number) => Math.round(x * 1e3) / 1e3;

type Result = import('@mediapipe/tasks-vision').PoseLandmarkerResult;

function toFrame(t: number, r: Result): PoseFrame {
  const people = r.landmarks.length;
  if (!people) return { t, lm: null, people: 0 };
  // the largest person is the subject
  let best = 0, bestArea = -1;
  r.landmarks.forEach((lms, i) => {
    const xs = lms.map((p) => p.x), ys = lms.map((p) => p.y);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (area > bestArea) (bestArea = area), (best = i);
  });
  const lm = r.landmarks[best].flatMap((p) => [r4(p.x), r4(p.y), r3(p.visibility ?? 0)]);
  const world = r.worldLandmarks[best]?.flatMap((p) => [r3(p.x), r3(p.y), r3(p.z)]) ?? null;
  return { t: r3(t), lm, world, people };
}

// ---------------------------------------------------------------- image statistics

const STAT_W = 256;

/** Brightness, contrast and sharpness of a frame, and the brightness inside the person's box. */
export function imageStats(src: CanvasImageSource, w: number, h: number, frame?: PoseFrame | null): ImageStats {
  const W = STAT_W, H = Math.max(1, Math.round((STAT_W * h) / w));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const g = new Float32Array(W * H);
  let sum = 0;
  for (let i = 0; i < W * H; i++) {
    g[i] = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
    sum += g[i];
  }
  const m = sum / g.length;
  let v = 0;
  for (let i = 0; i < g.length; i++) v += (g[i] - m) ** 2;
  // variance of the Laplacian: a standard focus / blur measure
  let lsum = 0, lsq = 0, n = 0;
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const l = g[i - 1] + g[i + 1] + g[i - W] + g[i + W] - 4 * g[i];
      lsum += l;
      lsq += l * l;
      n++;
    }
  const lm = lsum / n;
  const out: ImageStats = { luma: m / 255, contrast: Math.sqrt(v / g.length) / 255, sharpness: lsq / n - lm * lm };
  if (frame?.lm) {
    const xs: number[] = [], ys: number[] = [];
    for (let k = 0; k < 33; k++)
      if (frame.lm[k * 3 + 2] > 0.5) {
        xs.push(frame.lm[k * 3]);
        ys.push(frame.lm[k * 3 + 1]);
      }
    if (xs.length > 4) {
      const x0 = Math.max(0, Math.floor(Math.min(...xs) * W)), x1 = Math.min(W, Math.ceil(Math.max(...xs) * W));
      const y0 = Math.max(0, Math.floor(Math.min(...ys) * H)), y1 = Math.min(H, Math.ceil(Math.max(...ys) * H));
      let s = 0, k = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          s += g[y * W + x];
          k++;
        }
      if (k) out.subjectLuma = s / k / 255;
    }
  }
  return out;
}

function meanStats(list: ImageStats[]): ImageStats | undefined {
  if (!list.length) return undefined;
  const avg = (f: (s: ImageStats) => number | undefined) => {
    const v = list.map(f).filter((x): x is number => x !== undefined);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
  };
  return { luma: avg((s) => s.luma)!, contrast: avg((s) => s.contrast)!, sharpness: avg((s) => s.sharpness)!, subjectLuma: avg((s) => s.subjectLuma) };
}

/** The video's real frame rate, from the timing of frames as it plays for a moment (when the browser can tell). */
async function measureFps(v: HTMLVideoElement): Promise<number | undefined> {
  if (!('requestVideoFrameCallback' in v)) return undefined;
  const times: number[] = [];
  v.currentTime = 0;
  await new Promise((r) => setTimeout(r, 50));
  await new Promise<void>((done) => {
    const stop = setTimeout(done, 1500);
    const cb = (_: number, meta: { mediaTime: number }) => {
      times.push(meta.mediaTime);
      if (times.length >= 25) {
        clearTimeout(stop);
        done();
      } else v.requestVideoFrameCallback(cb);
    };
    v.requestVideoFrameCallback(cb);
    v.play().catch(() => {
      clearTimeout(stop);
      done();
    });
  });
  v.pause();
  const gaps = times.slice(1).map((t, i) => t - times[i]).filter((d) => d > 0.004 && d < 0.2).sort((a, b) => a - b);
  if (gaps.length < 5) return undefined;
  return 1 / gaps[Math.floor(gaps.length / 2)];
}

export interface Progress {
  done: number;
  total: number;
}

/** Finds the joints in a photo or video and saves the track. */
export async function analyzeMedia(item: MediaItem, blob: Blob, opts: { fps?: number; onProgress?: (p: Progress) => void; signal?: AbortSignal } = {}): Promise<PoseTrack> {
  const pose = await loadPose();
  let track: PoseTrack;
  if (item.kind === 'photo') {
    const img = new Image();
    const u = URL.createObjectURL(blob);
    try {
      img.src = u;
      await img.decode();
      const frame = toFrame(0, pose.image.detect(img));
      track = { id: item.id, model: MODEL_ID, createdAt: Date.now(), width: img.naturalWidth, height: img.naturalHeight, fps: 1, frames: [frame], image: imageStats(img, img.naturalWidth, img.naturalHeight, frame) };
    } finally {
      URL.revokeObjectURL(u);
    }
    opts.onProgress?.({ done: 1, total: 1 });
  } else {
    const { video, close } = await openVideo(blob);
    try {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (item.duration ?? 0);
      const sourceFps = await measureFps(video).catch(() => undefined);
      const fps = opts.fps ?? (duration > 45 ? 10 : 15);
      const total = Math.max(1, Math.floor(duration * fps));
      const frames: PoseFrame[] = [];
      const stats: ImageStats[] = [];
      const statEvery = Math.max(1, Math.floor(total / 8));
      clock += 1000;
      for (let i = 0; i < total; i++) {
        if (opts.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
        const t = Math.min(duration - 0.02, i / fps);
        await seek(video, t);
        clock += 1000 / fps;
        const frame = toFrame(t, pose.video.detectForVideo(video, clock));
        frames.push(frame);
        if (i % statEvery === 0) stats.push(imageStats(video, video.videoWidth, video.videoHeight, frame));
        opts.onProgress?.({ done: i + 1, total });
        // let the page breathe
        if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
      }
      track = { id: item.id, model: MODEL_ID, createdAt: Date.now(), width: video.videoWidth, height: video.videoHeight, fps, sourceFps, frames, image: meanStats(stats) };
    } finally {
      close();
    }
  }
  await db.poses.put(track);
  return track;
}
