// Browser-side media processing: shrinking photos (which also strips location
// data), thumbnails, video posters, reading when a file was taken, and
// drawing stills with their measurements for reports.
import type { MediaItem, MediaMark } from '../db/db';
import { markName, marksAt, markValue } from './media';

export const PHOTO_MAX_EDGE = 2560;
const THUMB_EDGE = 360;

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function canvasBlob(c: HTMLCanvasElement, type = 'image/jpeg', quality = 0.88): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the image'))), type, quality));
}

/** Draws a source scaled so its longest edge is at most `edge`. */
function scaled(src: CanvasImageSource, w: number, h: number, edge: number): HTMLCanvasElement {
  const k = Math.min(1, edge / Math.max(w, h));
  const c = canvasOf(w * k, h * k);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export async function thumbFrom(src: CanvasImageSource, w: number, h: number): Promise<Blob> {
  return canvasBlob(scaled(src, w, h, THUMB_EDGE), 'image/jpeg', 0.74);
}

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error('This image format can’t be opened here. Try a JPEG or PNG.');
  } finally {
    // decoded pixels stay available after the URL goes
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export interface Processed {
  blob: Blob;
  width: number;
  height: number;
  duration?: number;
  thumb?: Blob;
}

/**
 * A photo ready to store: turned upright, at most PHOTO_MAX_EDGE pixels, re-encoded
 * as JPEG (which drops the camera's metadata, including any GPS location).
 */
export async function processPhoto(file: Blob): Promise<Processed> {
  const img = await loadImage(file);
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = scaled(img, w, h, PHOTO_MAX_EDGE);
  const [blob, thumb] = await Promise.all([canvasBlob(c, 'image/jpeg', 0.88), thumbFrom(c, c.width, c.height)]);
  return { blob, width: c.width, height: c.height, thumb };
}

/** A photo from a camera frame (a <video> showing the live stream). */
export async function photoFromVideo(video: HTMLVideoElement): Promise<Processed> {
  const w = video.videoWidth, h = video.videoHeight;
  const c = scaled(video, w, h, PHOTO_MAX_EDGE);
  const [blob, thumb] = await Promise.all([canvasBlob(c, 'image/jpeg', 0.9), thumbFrom(c, c.width, c.height)]);
  return { blob, width: c.width, height: c.height, thumb };
}

function once(el: EventTarget, ok: string, ms = 8000): Promise<void> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => (cleanup(), rej(new Error('timeout'))), ms);
    const done = () => (cleanup(), res());
    const fail = () => (cleanup(), rej(new Error('This video can’t be played in this browser.')));
    const cleanup = () => {
      clearTimeout(t);
      el.removeEventListener(ok, done);
      el.removeEventListener('error', fail);
    };
    el.addEventListener(ok, done);
    el.addEventListener('error', fail);
  });
}

/** Recorded WebM files often report an infinite duration until the end has been read once. */
export async function ensureDuration(v: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(v.duration) && v.duration > 0) return v.duration;
  const wait = new Promise<void>((res) => {
    const f = () => {
      if (Number.isFinite(v.duration)) (v.removeEventListener('durationchange', f), res());
    };
    v.addEventListener('durationchange', f);
    setTimeout(res, 4000);
  });
  v.currentTime = 1e7;
  await wait;
  v.currentTime = 0;
  return Number.isFinite(v.duration) ? v.duration : 0;
}

export async function seek(v: HTMLVideoElement, t: number): Promise<void> {
  if (Math.abs(v.currentTime - t) < 1e-3 && v.readyState >= 2) return;
  const p = once(v, 'seeked', 6000);
  v.currentTime = t;
  await p;
}

/** Opens a video file off-screen (for posters and stills). */
export async function openVideo(blob: Blob): Promise<{ video: HTMLVideoElement; close: () => void }> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const close = () => {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  };
  try {
    const ready = once(video, 'loadeddata', 10000);
    video.src = url;
    await ready;
    await ensureDuration(video);
    return { video, close };
  } catch (e) {
    close();
    throw e;
  }
}

/** Size, length and a poster thumbnail for a video file. */
export async function processVideo(file: Blob, knownDuration?: number): Promise<Processed> {
  const { video, close } = await openVideo(file);
  try {
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : knownDuration ?? 0;
    await seek(video, Math.min(duration * 0.3, 1.5));
    const thumb = await thumbFrom(video, video.videoWidth, video.videoHeight).catch(() => undefined);
    return { blob: file, width: video.videoWidth, height: video.videoHeight, duration, thumb };
  } finally {
    close();
  }
}

/**
 * The best format this browser can record video in: WebM where it exists
 * (Chrome's fragmented MP4 recordings report only the first second as their
 * length, which breaks seeking), MP4 on Safari. VP8 first: it is light enough
 * to encode in real time almost everywhere, and frames an encoder hasn't
 * caught up with are lost when recording stops.
 */
export function recorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const t of ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'])
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  return '';
}

export function extensionFor(mime: string): string {
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('quicktime')) return 'mov';
  if (mime.includes('png')) return 'png';
  if (mime.includes('heic')) return 'heic';
  return mime.startsWith('video/') ? 'mp4' : 'jpg';
}

// ---------------------------------------------------------------- when was it taken

const sane = (t: number) => t > Date.UTC(1990, 0, 1) && t < Date.now() + 86_400_000;

/** "YYYY:MM:DD HH:MM:SS" (camera local time) */
function exifDate(s: string): number | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  return sane(t) ? t : null;
}

/** DateTimeOriginal from a JPEG's EXIF block. */
export function jpegTakenAt(buf: ArrayBuffer): number | null {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let p = 2;
  while (p + 4 <= v.byteLength) {
    const marker = v.getUint16(p);
    if ((marker & 0xff00) !== 0xff00) return null;
    const len = v.getUint16(p + 2);
    if (marker === 0xffe1 && p + 10 <= v.byteLength && v.getUint32(p + 4) === 0x45786966) return tiffDate(v, p + 10, Math.min(v.byteLength, p + 2 + len));
    if (marker === 0xffda) return null;
    p += 2 + len;
  }
  return null;
}

function tiffDate(v: DataView, start: number, end: number): number | null {
  if (start + 8 > end) return null;
  const le = v.getUint16(start) === 0x4949;
  const u16 = (o: number) => v.getUint16(start + o, le);
  const u32 = (o: number) => v.getUint32(start + o, le);
  const ascii = (o: number, n: number) => {
    let s = '';
    for (let i = 0; i < n && start + o + i < end; i++) {
      const c = v.getUint8(start + o + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const readIfd = (off: number): Map<number, { type: number; count: number; at: number }> => {
    const out = new Map<number, { type: number; count: number; at: number }>();
    if (start + off + 2 > end) return out;
    const n = u16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      if (start + e + 12 > end) break;
      const count = u32(e + 4);
      out.set(u16(e), { type: u16(e + 2), count, at: count > 4 ? u32(e + 8) : e + 8 });
    }
    return out;
  };
  const ifd0 = readIfd(u32(4));
  const exifPtr = ifd0.get(0x8769);
  if (exifPtr) {
    const exif = readIfd(u32(exifPtr.at));
    for (const tag of [0x9003, 0x9004]) {
      const e = exif.get(tag);
      const t = e && exifDate(ascii(e.at, e.count));
      if (t) return t;
    }
  }
  const dt = ifd0.get(0x0132);
  return dt ? exifDate(ascii(dt.at, dt.count)) : null;
}

/** Creation time from an MP4 or QuickTime file's movie header. */
export async function mp4TakenAt(file: Blob): Promise<number | null> {
  let p = 0;
  for (let guard = 0; guard < 64 && p + 8 <= file.size; guard++) {
    const head = new DataView(await file.slice(p, p + 16).arrayBuffer());
    let size = head.getUint32(0);
    const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
    let hdr = 8;
    if (size === 1 && head.byteLength >= 16) {
      size = Number(head.getBigUint64(8));
      hdr = 16;
    } else if (size === 0) size = file.size - p;
    if (size < hdr) return null;
    if (type === 'moov') {
      const moov = new DataView(await file.slice(p + hdr, p + Math.min(size, hdr + 256 * 1024)).arrayBuffer());
      let q = 0;
      while (q + 8 <= moov.byteLength) {
        const s = moov.getUint32(q);
        const t = String.fromCharCode(moov.getUint8(q + 4), moov.getUint8(q + 5), moov.getUint8(q + 6), moov.getUint8(q + 7));
        if (t === 'mvhd' && q + 20 <= moov.byteLength) {
          const version = moov.getUint8(q + 8);
          const secs = version === 1 ? Number(moov.getBigUint64(q + 12)) : moov.getUint32(q + 12);
          if (!secs) return null;
          const ms = (secs - 2082844800) * 1000;
          return sane(ms) ? ms : null;
        }
        if (s < 8) break;
        q += s;
      }
      return null;
    }
    p += size;
  }
  return null;
}

/** When a photo or video was taken, from its metadata; falls back to the file's date. */
export async function takenAt(file: File): Promise<number> {
  try {
    if (/jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name)) {
      const t = jpegTakenAt(await file.slice(0, 256 * 1024).arrayBuffer());
      if (t) return t;
    } else if (file.type.startsWith('video/') || /\.(mp4|mov|m4v)$/i.test(file.name)) {
      const t = await mp4TakenAt(file);
      if (t) return t;
    }
  } catch {
    // metadata is a nicety; fall through
  }
  return sane(file.lastModified) ? file.lastModified : Date.now();
}

// ---------------------------------------------------------------- drawing marks

export const MARK_COLORS: Record<MediaMark['type'], string> = { angle: '#ffb347', line: '#5ad1c4', path: '#ff6fa8' };

/** Draws marks onto a canvas the size of the frame (used for report stills). */
export function drawMarks(ctx: CanvasRenderingContext2D, item: MediaItem, marks: MediaMark[], w: number, h: number): void {
  const s = Math.max(w, h) / 900;
  const P = (p: [number, number]) => [p[0] * w, p[1] * h] as const;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const m of marks) {
    const c = MARK_COLORS[m.type];
    const pts = m.points.map(P);
    if (!pts.length) continue;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 7 * s;
    const path = () => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    };
    path();
    ctx.stroke();
    ctx.strokeStyle = c;
    ctx.lineWidth = 3.5 * s;
    path();
    ctx.stroke();
    if (m.type === 'line' && pts.length === 2) {
      // the vertical it is measured against
      const top = pts[0][1] < pts[1][1] ? pts[0] : pts[1], bot = top === pts[0] ? pts[1] : pts[0];
      ctx.setLineDash([8 * s, 8 * s]);
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(bot[0], bot[1]);
      ctx.lineTo(bot[0], top[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const [x, y] of m.type === 'path' ? [pts[0], pts[pts.length - 1]] : pts) {
      if (x === undefined) continue;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x, y, 6 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    const v = markValue(m, item.width, item.height);
    if (!v) continue;
    const at = m.type === 'angle' ? pts[1] : pts[pts.length - 1];
    const label = `${markName(m)} ${m.type === 'path' ? `${Math.round(v.value)}% drift` : `${Math.round(v.value)}°`}`;
    ctx.font = `600 ${Math.round(22 * s)}px system-ui, sans-serif`;
    const tw = ctx.measureText(label).width;
    const x = Math.min(w - tw - 16 * s, at[0] + 14 * s), y = Math.max(30 * s, at[1] - 14 * s);
    ctx.fillStyle = 'rgba(10,12,16,0.78)';
    ctx.fillRect(x - 6 * s, y - 22 * s, tw + 12 * s, 30 * s);
    ctx.fillStyle = c;
    ctx.fillText(label, x, y);
  }
}

/** A still of a photo, or of a video at time t, with its marks; returned as a JPEG data URL. */
export async function stillOf(item: MediaItem, blob: Blob, t?: number, edge = 1000): Promise<string> {
  let src: CanvasImageSource, close = () => {};
  let at: number | null = null;
  if (item.kind === 'photo') src = await loadImage(blob);
  else {
    const v = await openVideo(blob);
    close = v.close;
    at = Math.max(0, Math.min(t ?? 0, (v.video.duration || 0) - 0.05));
    await seek(v.video, at);
    src = v.video;
  }
  try {
    const w = item.width, h = item.height;
    const k = Math.min(1, edge / Math.max(w, h));
    const c = canvasOf(w * k, h * k);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(src, 0, 0, c.width, c.height);
    drawMarks(ctx, item, marksAt(item, at, 0.35), c.width, c.height);
    return c.toDataURL('image/jpeg', 0.84);
  } finally {
    close();
  }
}
