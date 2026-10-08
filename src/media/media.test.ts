import 'fake-indexeddb/auto';
import { strToU8, unzipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeMediaBackup, readBackupFile, restoreBackup } from '../db/backup';
import { db, type MeasurementEntry, type MediaItem, type MediaMark } from '../db/db';
import { deleteNote, saveNote } from '../db/notes';
import { emptyDraft } from '../db/notes';
import { crc32, makeZip, readZip } from '../db/zip';
import {
  addMedia,
  deleteMedia,
  firstAndLatest,
  getMediaBlob,
  markTrends,
  markValue,
  measurementChanges,
  phaseAt,
  poseSeries,
  syncTime,
  timeForPhase,
} from './media';
import { jpegTakenAt, mp4TakenAt } from './process';
import { defaultReportOptions, reportMedia } from '../report/data';

const DAY = 86_400_000;
const mark = (type: MediaMark['type'], points: [number, number][], extra: Partial<MediaMark> = {}): MediaMark => ({ id: Math.random().toString(36), type, points, ...extra });

describe('measuring on frames', () => {
  it('measures a joint angle in the frame’s real proportions', () => {
    // a right angle in a square frame
    expect(markValue(mark('angle', [[0.5, 0.2], [0.5, 0.5], [0.8, 0.5]]), 1000, 1000)!.value).toBeCloseTo(90, 5);
    // the same fractions in a tall 1080×1920 frame are no longer a right angle… but a true 45° is still 45°
    const tall = markValue(mark('angle', [[0.5, 0.5 - 0.3 * (1080 / 1920)], [0.5, 0.5], [0.8, 0.5 - 0.3 * (1080 / 1920)]]), 1080, 1920)!;
    expect(tall.value).toBeCloseTo(45, 5);
  });

  it('measures lean from vertical and how far a path drifts', () => {
    expect(markValue(mark('line', [[0.5, 0.2], [0.5, 0.8]]), 800, 600)!.value).toBeCloseTo(0, 5);
    expect(markValue(mark('line', [[0.4, 0.4], [0.6, 0.6]]), 1000, 1000)!.value).toBeCloseTo(45, 5);
    const path = markValue(mark('path', [[0.5, 0.2], [0.55, 0.5], [0.5, 0.8]]), 1000, 1000)!;
    expect(path.unit).toBe('%');
    expect(path.value).toBeCloseTo((50 / 600) * 100, 5);
    expect(markValue(mark('angle', [[0.5, 0.5], [0.5, 0.5]]), 100, 100)).toBeNull();
  });

  it('maps video time to the point in the movement, out and back', () => {
    const v = { phase0: 1, phase1: 2.5 };
    expect(phaseAt(v, 0.5)).toBe(0);
    expect(phaseAt(v, 1.75)).toBeCloseTo(0.5);
    expect(phaseAt(v, 2.5)).toBe(1);
    expect(phaseAt(v, 3.25)).toBeCloseTo(0.5);
    expect(phaseAt(v, 5)).toBe(0);
    expect(phaseAt({ phase0: 1 }, 2)).toBeNull();
    expect(timeForPhase(v, 0.5)).toBeCloseTo(1.75);
  });
});

describe('tracking over time', () => {
  const base = (over: Partial<MediaItem>): MediaItem => ({
    id: Math.random().toString(36),
    kind: 'photo',
    purpose: 'progress',
    date: 0,
    createdAt: 0,
    updatedAt: 0,
    mime: 'image/jpeg',
    size: 1,
    width: 1000,
    height: 1000,
    tags: [],
    ...over,
  });

  it('pairs the first and latest photo of a pose', () => {
    const items = [base({ pose: 'front', date: 3 * DAY }), base({ pose: 'side', date: 2 * DAY }), base({ pose: 'front', date: 1 * DAY }), base({ pose: 'front', date: 9 * DAY })];
    const series = poseSeries(items, 'front');
    expect(series.map((m) => m.date / DAY)).toEqual([1, 3, 9]);
    expect(firstAndLatest(series)!.map((m) => m.date / DAY)).toEqual([1, 9]);
    expect(firstAndLatest(poseSeries(items, 'side'))).toBeNull();
  });

  it('follows a named measurement across form videos', () => {
    const knee = (deg: number) => {
      const r = (deg * Math.PI) / 180;
      return mark('angle', [[0.5, 0.2], [0.5, 0.5], [0.5 + 0.3 * Math.sin(r), 0.5 - 0.3 * Math.cos(r)]], { label: 'Knee' });
    };
    const items = [
      base({ purpose: 'form', kind: 'video', date: 10 * DAY, marks: [knee(70)] }),
      base({ purpose: 'form', kind: 'video', date: 1 * DAY, marks: [knee(95), mark('line', [[0.5, 0.2], [0.6, 0.4]], { label: 'Torso lean' })] }),
    ];
    const trends = markTrends(items);
    const k = trends.find((t) => t.label === 'Knee')!;
    expect(k.points.map((p) => Math.round(p.y))).toEqual([95, 70]);
    expect(trends.find((t) => t.label === 'Torso lean')!.points.length).toBe(1);
  });

  it('lines two videos up on their marked end-range position', () => {
    expect(syncTime(base({ kind: 'video', phase0: 0.4, phase1: 1.9 }))).toBe(1.9);
    expect(syncTime(base({ kind: 'video', marks: [mark('angle', [], { t: 2.2 })] }))).toBe(2.2);
    expect(syncTime(base({ kind: 'video' }))).toBe(0);
  });

  it('reports measurement changes between two photo dates', () => {
    const entries: MeasurementEntry[] = [
      { id: 'a', date: 100 * DAY, values: { weight: 82, waist: 88 } },
      { id: 'b', date: 140 * DAY, values: { weight: 80.5 } },
      { id: 'c', date: 160 * DAY, values: { waist: 85 } },
    ];
    const c = measurementChanges(entries, 102 * DAY, 158 * DAY);
    expect(c.find((x) => x.key === 'waist')).toMatchObject({ from: 88, to: 85, diff: -3 });
    // no weight measured within 10 days of the second photo
    expect(c.find((x) => x.key === 'weight')).toBeUndefined();
  });
});

describe('storage', () => {
  beforeEach(async () => {
    await Promise.all([db.media.clear(), db.mediaBlobs.clear(), db.notes.clear()]);
  });

  it('keeps the file apart from its details and deletes both', async () => {
    const m = await addMedia({ blob: new Blob([new Uint8Array(2048)], { type: 'video/webm' }), kind: 'video', width: 640, height: 480, duration: 3, purpose: 'form', pattern: 'squat', tags: ['Squat', 'squat', ' depth '] });
    expect(m.size).toBe(2048);
    expect(m.mime).toBe('video/webm');
    expect(m.tags).toEqual(['squat', 'depth']);
    expect((await getMediaBlob(m.id))!.size).toBe(2048);
    await deleteMedia(m.id);
    expect(await db.media.count()).toBe(0);
    expect(await db.mediaBlobs.count()).toBe(0);
  });

  it('lets a new note take photos before it is saved', async () => {
    const draft = emptyDraft({ title: 'Swollen ankle', pendingId: 'pending-1' });
    await addMedia({ blob: new Blob(['x'], { type: 'image/jpeg' }), kind: 'photo', width: 10, height: 10, noteId: 'pending-1' });
    const note = await saveNote(draft);
    expect(note.id).toBe('pending-1');
    expect('pendingId' in note).toBe(false);
    expect(await db.media.where('noteId').equals(note.id).count()).toBe(1);
  });

  it('unlinks media when its note is deleted', async () => {
    const note = await saveNote(emptyDraft({ title: 'Bruise' }));
    const m = await addMedia({ blob: new Blob(['x'], { type: 'image/jpeg' }), kind: 'photo', width: 10, height: 10, noteId: note.id });
    await deleteNote(note.id);
    expect((await db.media.get(m.id))!.noteId).toBeUndefined();
  });
});

describe('coach reports', () => {
  const item = (over: Partial<MediaItem>): MediaItem => ({ id: Math.random().toString(36), kind: 'photo', purpose: 'progress', pose: 'front', date: 0, createdAt: 0, updatedAt: 0, mime: 'image/jpeg', size: 1, width: 3, height: 4, tags: [], ...over });

  it('pairs each pose’s latest photo with the first of the period, or the last before it', () => {
    const o = defaultReportOptions(30);
    const inside = (d: number) => o.to - d * DAY;
    const media = [
      item({ date: inside(100), pose: 'front' }),
      item({ date: inside(20), pose: 'front' }),
      item({ date: inside(2), pose: 'front' }),
      item({ date: inside(200), pose: 'side' }),
      item({ date: inside(3), pose: 'side' }),
      item({ date: inside(5), pose: 'back', private: true }),
      item({ date: inside(1), purpose: 'form', kind: 'video', pattern: 'squat' }),
      item({ date: inside(60), purpose: 'form', kind: 'video', pattern: 'squat' }),
    ];
    const r = reportMedia(media, o);
    const front = r.progress.find((p) => p.pose === 'front')!;
    expect([front.then!.date, front.now.date]).toEqual([inside(20), inside(2)]);
    const side = r.progress.find((p) => p.pose === 'side')!;
    expect(side.then!.date).toBe(inside(200));
    // private photos stay out unless private items are included
    expect(r.progress.some((p) => p.pose === 'back')).toBe(false);
    expect(reportMedia(media, { ...o, includePrivate: true }).progress.some((p) => p.pose === 'back')).toBe(true);
    expect(r.form.map((m) => m.date)).toEqual([inside(1)]);
  });
});

describe('backups with media', () => {
  it('writes ZIP files other tools can open, and reads them back', async () => {
    const data = new Uint8Array(70_000).map((_, i) => (i * 7) & 0xff);
    const zip = await makeZip([
      { name: 'a.txt', data: strToU8('hello hello hello hello'), compress: true },
      { name: 'media/v.webm', data: new Blob([data]) },
    ]);
    const other = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(new TextDecoder().decode(other['a.txt'])).toBe('hello hello hello hello');
    expect(other['media/v.webm']).toEqual(data);
    const ours = await readZip(zip);
    expect(new Uint8Array(await ours.get('media/v.webm')!.arrayBuffer())).toEqual(data);
    expect(await ours.get('a.txt')!.text()).toBe('hello hello hello hello');
    expect(crc32(strToU8('123456789'))).toBe(0xcbf43926);
  });

  it('restores photos and videos with their details and thumbnails', async () => {
    await Promise.all([db.media.clear(), db.mediaBlobs.clear()]);
    const photo = await addMedia({ blob: new Blob([new Uint8Array(500).fill(9)], { type: 'image/jpeg' }), thumb: new Blob([new Uint8Array(40).fill(3)], { type: 'image/jpeg' }), kind: 'photo', width: 30, height: 40, purpose: 'progress', pose: 'side', date: 5 * DAY });
    await addMedia({ blob: new Blob([new Uint8Array(900).fill(1)], { type: 'video/mp4' }), kind: 'video', width: 30, height: 40, purpose: 'form', pattern: 'hinge', marks: [mark('line', [[0, 0], [1, 1]], { t: 1, label: 'Torso lean' })] });
    const zip = await makeMediaBackup();
    await Promise.all([db.media.clear(), db.mediaBlobs.clear()]);
    const { backup, files } = await readBackupFile(zip);
    expect(backup.media!.length).toBe(2);
    const r = await restoreBackup(backup, 'merge', files);
    expect(r.media).toBe(2);
    const back = await db.media.get(photo.id);
    expect(back).toMatchObject({ pose: 'side', date: 5 * DAY, width: 30 });
    expect(back!.thumb!.size).toBe(40);
    expect((await getMediaBlob(photo.id))!.size).toBe(500);
    const video = (await db.media.where('pattern').equals('hinge').first())!;
    expect(video.marks![0].label).toBe('Torso lean');
    expect((await getMediaBlob(video.id))!.type).toBe('video/mp4');
  });

  it('still reads plain JSON backups', async () => {
    const { backup, files } = await readBackupFile(new Blob([JSON.stringify({ app: 'phoenix-atlas', notes: [] })]));
    expect(backup.notes).toEqual([]);
    expect(files).toBeUndefined();
  });
});

describe('when a file was taken', () => {
  it('reads DateTimeOriginal from JPEG EXIF', () => {
    // FFD8, APP1 "Exif\0\0", little-endian TIFF with IFD0 -> Exif IFD -> 0x9003
    const date = '2025:03:14 07:30:05\0';
    const tiff = new Uint8Array(8 + 2 + 12 + 4 + 2 + 12 + 4 + date.length);
    const v = new DataView(tiff.buffer);
    v.setUint16(0, 0x4949);
    v.setUint16(2, 42, true);
    v.setUint32(4, 8, true);
    v.setUint16(8, 1, true); // IFD0: one entry
    v.setUint16(10, 0x8769, true);
    v.setUint16(12, 4, true);
    v.setUint32(14, 1, true);
    v.setUint32(18, 26, true); // Exif IFD offset
    v.setUint16(26, 1, true);
    v.setUint16(28, 0x9003, true);
    v.setUint16(30, 2, true);
    v.setUint32(32, date.length, true);
    v.setUint32(36, 44, true);
    for (let i = 0; i < date.length; i++) tiff[44 + i] = date.charCodeAt(i);
    const app1 = new Uint8Array(4 + 6 + tiff.length);
    const a = new DataView(app1.buffer);
    a.setUint16(0, 0xffe1);
    a.setUint16(2, 2 + 6 + tiff.length);
    app1.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);
    app1.set(tiff, 10);
    const jpeg = new Uint8Array([0xff, 0xd8, ...app1, 0xff, 0xda, 0, 2]);
    expect(jpegTakenAt(jpeg.buffer)).toBe(new Date(2025, 2, 14, 7, 30, 5).getTime());
    expect(jpegTakenAt(new Uint8Array([0xff, 0xd8, 0xff, 0xda]).buffer)).toBeNull();
  });

  it('reads the creation time from an MP4 movie header', async () => {
    const when = Date.UTC(2026, 0, 2, 3, 4, 5);
    const box = (type: string, body: Uint8Array) => {
      const b = new Uint8Array(8 + body.length);
      new DataView(b.buffer).setUint32(0, b.length);
      for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
      b.set(body, 8);
      return b;
    };
    const mvhd = new Uint8Array(100);
    new DataView(mvhd.buffer).setUint32(4, when / 1000 + 2082844800);
    const file = new Blob([box('ftyp', new Uint8Array(12)), box('mdat', new Uint8Array(5000)), box('moov', box('mvhd', mvhd))]);
    expect(await mp4TakenAt(file)).toBe(when);
  });
});
