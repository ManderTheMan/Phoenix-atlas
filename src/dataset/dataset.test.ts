import { describe, expect, it } from 'vitest';
import type { MediaItem } from '../db/db';
import { scrubVideo } from '../media/scrub';
import { datasetIds, datasheet, formatWhen, metadataRows, readme, repsFile, toCsv, type CardInfo, type Entry } from './card';
import { headRegion } from './privacy';

const DAY = 86_400_000;

const enc = new TextEncoder();
function box(type: string, ...children: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const body = children.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(8 + body);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(enc.encode(type), 4);
  let p = 8;
  for (const c of children) (out.set(c, p), (p += c.length));
  return out;
}
const bytes = (s: string) => enc.encode(s);
/** A full-box header with version 0 and creation/modification times. */
const dated = (type: string, created: number) => {
  const b = new Uint8Array(4 + 8 + 8);
  const v = new DataView(b.buffer);
  v.setUint32(4, created);
  v.setUint32(8, created);
  return box(type, b);
};
const has = async (blob: Blob, s: string) => new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer())).includes(s);

describe('video metadata', () => {
  it('blanks location and other metadata in place, leaving the video intact', async () => {
    const mdat = box('mdat', bytes('VIDEO-DATA'.repeat(50)));
    const moov = box('moov', dated('mvhd', 3_800_000_000), box('udta', box('©xyz', bytes('+37.7749-122.4194/'))), box('trak', dated('tkhd', 3_800_000_000), box('meta', bytes('com.apple.quicktime.location.ISO6709 +37.77'))));
    const file = new Blob([box('ftyp', bytes('qt  ')), mdat, moov], { type: 'video/quicktime' });
    expect(await has(file, '+37.7749')).toBe(true);
    const { blob, report } = await scrubVideo(file);
    expect(blob.size).toBe(file.size);
    expect(await has(blob, '+37.7749')).toBe(false);
    expect(await has(blob, 'ISO6709')).toBe(false);
    expect(await has(blob, 'VIDEO-DATA')).toBe(true);
    expect(report.removed).toEqual(['/moov/udta', '/moov/trak/meta']);
    // dates stay unless asked
    const view = new DataView(await blob.arrayBuffer());
    const mvhdAt = file.size - moov.length + 8;
    expect(view.getUint32(mvhdAt + 12)).toBe(3_800_000_000);
    const { blob: noDates, report: r2 } = await scrubVideo(file, { dates: true });
    expect(r2.datesCleared).toBe(true);
    expect(new DataView(await noDates.arrayBuffer()).getUint32(mvhdAt + 12)).toBe(0);
  });

  it('leaves other formats alone', async () => {
    const webm = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6])], { type: 'video/webm' });
    expect((await scrubVideo(webm)).blob).toBe(webm);
  });
});

describe('dataset files', () => {
  const item = (over: Partial<MediaItem>): MediaItem => ({ id: Math.random().toString(36).slice(2), kind: 'photo', purpose: 'progress', date: 0, createdAt: 0, updatedAt: 0, mime: 'image/jpeg', size: 1, width: 1080, height: 1920, tags: [], ...over });
  const t0 = new Date(2026, 0, 10, 8, 30).getTime();

  it('names files by what they are, not by anything personal', () => {
    const a = item({ pose: 'front', date: t0 }), b = item({ pose: 'front', date: t0 + DAY }), c = item({ purpose: 'form', kind: 'video', pattern: 'squat', date: t0 });
    const ids = datasetIds([b, c, a]);
    expect(ids.get(a.id)).toBe('progress-front-001');
    expect(ids.get(b.id)).toBe('progress-front-002');
    expect(ids.get(c.id)).toBe('form-squat-001');
  });

  it('writes dates at the chosen precision', () => {
    expect(formatWhen(t0 + 3 * DAY + 3600_000, 'relative', t0)).toBe(3);
    expect(formatWhen(t0, 'day', t0)).toBe('2026-01-10');
    expect(String(formatWhen(t0, 'exact', t0))).toMatch(/^2026-01-10T/);
  });

  it('builds metadata rows and escapes CSV', () => {
    const m = item({ purpose: 'form', kind: 'video', pattern: 'squat', duration: 5.678, date: t0, notes: 'felt "heavy", knee ok', tags: ['demo', 'flawed'], marks: [{ id: 'k', type: 'angle', points: [[0, 0], [0.5, 0.5], [1, 0.5]], label: 'Knee' }] });
    const e: Entry = { item: m, id: 'form-squat-001', file: 'media/videos/form-squat-001.webm', facesPixelated: true };
    const [row] = metadataRows([e], { dates: 'relative', notes: true });
    expect(row).toMatchObject({ id: 'form-squat-001', date: 0, duration_s: 5.68, hand_marks: 1, tags: 'flawed', faces_pixelated: true, quality: 'not checked' });
    const csv = toCsv([row as unknown as Record<string, unknown>]);
    expect(csv.split('\n')[0].split(',')).toContain('notes');
    expect(csv).toContain('"felt ""heavy"", knee ok"');
    expect(metadataRows([e], { dates: 'day', notes: false })[0].notes).toBeUndefined();
  });

  it('writes a dataset card and datasheet that state the privacy choices', () => {
    const e: Entry = { item: item({ pose: 'side', date: t0, tags: ['synthetic'] }), id: 'progress-side-001', file: 'media/photos/progress-side-001.jpg', facesPixelated: false };
    const info: CardInfo = { name: 'Test set', creator: 'A. Lifter', description: '', license: 'CC-BY-NC-4.0', dates: 'relative', facesPixelated: true, measurements: false, notes: false, createdAt: t0, appUrl: 'https://example.org', validation: [{ joint: 'knee', mae: 6.3, bias: -6 }] };
    const md = readme([e], info);
    expect(md).toMatch(/^---\nlicense: cc-by-nc-4.0\n/);
    expect(md).toContain('| Knee | 6.3° | -6.0° |');
    expect(md).toContain('days since the first file only');
    expect(md).toContain('Faces pixelated');
    expect(md).toContain('Files tagged `synthetic` are not photographs');
    expect(datasheet([e], info)).toContain('Datasheets for Datasets');
  });

  it('rounds rep timings for sharing', () => {
    const r = repsFile({ joint: 'knee', side: 'left', reps: [{ start: 0.5333333, bottom: 1.8000001, end: 2.8, min: 40.3599, rom: 131.149, down: 1.2667, up: 0.99999 }], meanMin: 40.36, sdMin: 0, meanDown: 1.2667, meanUp: 1 });
    expect(r.reps[0]).toEqual({ start_s: 0.533, bottom_s: 1.8, end_s: 2.8, deepest_deg: 40.4, range_deg: 131.1, down_s: 1.267, up_s: 1 });
  });
});

describe('face pixelation', () => {
  it('covers the head from the face landmarks', () => {
    const lm = new Array(99).fill(0);
    const set = (i: number, x: number, y: number) => ((lm[i * 3] = x), (lm[i * 3 + 1] = y), (lm[i * 3 + 2] = 1));
    for (let i = 0; i <= 10; i++) set(i, 0.5 + (i % 3) * 0.01, 0.1 + (i % 2) * 0.01);
    set(11, 0.58, 0.2);
    set(12, 0.42, 0.2);
    const r = headRegion(lm, 1000, 1000)!;
    expect(r.cx).toBeCloseTo(510, -1);
    // above the eyes (the crown) and wider than the face points
    expect(r.cy).toBeLessThan(105);
    expect(r.rx).toBeGreaterThanOrEqual(0.32 * 160);
    expect(r.ry).toBeGreaterThan(r.rx);
    expect(headRegion(null, 10, 10)).toBeNull();
  });
});
