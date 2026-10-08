// Pixelating faces before photos and videos are shared. The head is located
// from the pose tracker's face landmarks (nose, eyes, ears, mouth), so no extra
// face model is needed; the area is covered by large blocks, which can't be
// undone the way a light blur sometimes can.
import { landmarksAt, type PoseTrack } from '../vision/analysis';
import { canvasBlob, openVideo, recorderMime } from '../media/process';

export interface Region {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** The head as an ellipse in pixels, from 33 × [x, y, visibility] landmarks. */
export function headRegion(lm: number[] | null, w: number, h: number): Region | null {
  if (!lm) return null;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 10; i++) pts.push([lm[i * 3] * w, lm[i * 3 + 1] * h]);
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let r = Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy))) * 1.9;
  const shoulders = Math.hypot((lm[11 * 3] - lm[12 * 3]) * w, (lm[11 * 3 + 1] - lm[12 * 3 + 1]) * h);
  r = Math.max(r, shoulders * 0.32, Math.max(w, h) * 0.045);
  // the crown sits well above the eyes: move up and make the ellipse taller
  return { cx, cy: cy - r * 0.3, rx: r * 1.1, ry: r * 1.5 };
}

/** Covers a region of a canvas with coarse blocks. */
export function pixelate(ctx: CanvasRenderingContext2D, region: Region, blocks = 8): void {
  const { cx, cy, rx, ry } = region;
  const x0 = Math.max(0, Math.floor(cx - rx)), y0 = Math.max(0, Math.floor(cy - ry));
  const x1 = Math.min(ctx.canvas.width, Math.ceil(cx + rx)), y1 = Math.min(ctx.canvas.height, Math.ceil(cy + ry));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(blocks * (w / (2 * rx))));
  small.height = Math.max(1, Math.round(blocks * (h / (2 * rx))));
  const sctx = small.getContext('2d')!;
  sctx.drawImage(ctx.canvas, x0, y0, w, h, 0, 0, small.width, small.height);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, small.width, small.height, x0, y0, w, h);
  ctx.restore();
}

/** A photo with the face pixelated (re-encoded as JPEG, so no metadata is carried over). */
export async function pixelatePhoto(blob: Blob, lm: number[] | null): Promise<Blob | null> {
  const img = new Image();
  const u = URL.createObjectURL(blob);
  try {
    img.src = u;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const region = headRegion(lm, c.width, c.height);
    if (!region) return null;
    pixelate(ctx, region);
    return canvasBlob(c, 'image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(u);
  }
}

/**
 * A video with the face pixelated in every frame. The clip is played once in
 * real time and recorded from a canvas (so it takes as long as the clip), and
 * the sound is dropped.
 */
export async function pixelateVideo(blob: Blob, track: PoseTrack, onProgress?: (p: number) => void): Promise<Blob | null> {
  const mime = recorderMime();
  if (mime === undefined) return null;
  const { video, close } = await openVideo(blob);
  try {
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    const ctx = c.getContext('2d')!;
    const draw = () => {
      ctx.drawImage(video, 0, 0, c.width, c.height);
      const region = headRegion(landmarksAt(track, video.currentTime), c.width, c.height);
      if (region) pixelate(ctx, region);
    };
    video.currentTime = 0;
    await new Promise((r) => setTimeout(r, 100));
    draw();
    const stream = c.captureStream(30);
    const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 4_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.start(500);
    const duration = video.duration || 1;
    await new Promise<void>((done) => {
      const vfc = 'requestVideoFrameCallback' in video;
      const next = () => {
        draw();
        onProgress?.(Math.min(1, video.currentTime / duration));
        if (video.ended) return done();
        if (vfc) video.requestVideoFrameCallback(next);
        else requestAnimationFrame(next);
      };
      video.onended = () => done();
      video.play().then(next, () => done());
    });
    await new Promise((r) => setTimeout(r, 1200));
    rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    return new Blob(chunks, { type: (rec.mimeType || mime || 'video/webm').split(';')[0] });
  } finally {
    close();
  }
}
