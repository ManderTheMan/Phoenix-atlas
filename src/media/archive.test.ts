import 'fake-indexeddb/auto';
import { gzipSync, strToU8, zipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { archiveTags, importArchive, planImport, readArchiveFolder, readArchivePack, readArchives, unlabelled, type ArchiveRow } from './archive';

const row = (id: string, extra: Partial<ArchiveRow> = {}): ArchiveRow => ({
  id,
  name: `VID_${id}.mp4`,
  date: new Date(2019, 2, 12, 18).getTime(),
  dateSource: 'filename',
  duration: 5.6,
  width: 1080,
  height: 1920,
  fps: 30,
  bytes: 9_000_000,
  status: 'usable',
  triage: { people: 1, view: 'side' },
  track: 'track.json.gz',
  proxy: 'proxy.mp4',
  thumb: 'thumb.jpg',
  proxyWidth: 480,
  proxyHeight: 854,
  proxyBytes: 700_000,
  ...extra,
});

const track = (id: string) => ({ id, model: 'mediapipe-pose-landmarker-full/float16/1', createdAt: 1, width: 1080, height: 1920, fps: 15, frames: [{ t: 0, lm: null, people: 0 }] });

function pack(rows: ArchiveRow[]): File {
  const files: Record<string, Uint8Array> = { 'index.jsonl': strToU8(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'), 'archive.json': strToU8('{}') };
  for (const r of rows) {
    files[`clips/${r.id}/track.json.gz`] = gzipSync(strToU8(JSON.stringify(track(r.id))));
    if (r.proxy) files[`clips/${r.id}/proxy.mp4`] = new Uint8Array(2000).fill(7);
    files[`clips/${r.id}/thumb.jpg`] = new Uint8Array(100).fill(9);
  }
  return new File([zipSync(files, { level: 0 })], 'phoenix-archive-clips-01.zip', { type: 'application/zip' });
}

const ids = ['0123456789abcdef', '1123456789abcdef', '2123456789abcdef', '3123456789abcdef', '4123456789abcdef'];

describe('archive import', () => {
  beforeEach(async () => {
    await db.media.clear();
    await db.mediaBlobs.clear();
    await db.poses.clear();
  });

  it('reads a pack and plans what to bring in', async () => {
    const rows = [
      row(ids[0]),
      row(ids[1], { date: new Date(2021, 0, 1).getTime(), triage: { people: 3, view: 'side' } }),
      row(ids[2], { nearDuplicateOf: ids[0] }),
      row(ids[3], { status: 'skipped', reason: 'no person', proxy: undefined, track: undefined }),
      row(ids[4], { proxy: undefined, triage: { people: 1, view: 'front' } }),
    ];
    const src = await readArchivePack(pack(rows));
    expect(src.rows).toHaveLength(5);
    const all = planImport([src], [], { years: null, skipCrowded: false, sideOnly: false });
    expect(all.usable).toBe(3);
    expect(all.copies).toBe(1);
    expect(all.noCopy).toBe(1);
    expect(all.rows.map((r) => r.row.id)).toEqual([ids[1], ids[0]]); // newest first
    expect([...all.years.entries()].sort()).toEqual([[2019, 2], [2021, 1]]);
    expect(planImport([src], [], { years: new Set([2019]), skipCrowded: false, sideOnly: false }).rows).toHaveLength(1);
    expect(planImport([src], [], { years: null, skipCrowded: true, sideOnly: false }).rows.map((r) => r.row.id)).toEqual([ids[0]]);
    expect(archiveTags(rows[1])).toContain('several-people');
  });

  it('brings clips in once, with their tracks and a suggestion from the training log', async () => {
    const src = await readArchivePack(pack([row(ids[0]), row(ids[1])]));
    const plan = planImport([src], [], { years: null, skipCrowded: false, sideOnly: false });
    const logged = [{ date: new Date(2019, 2, 12, 9).getTime(), pattern: 'hinge' as const }];
    const r = await importArchive(plan, logged);
    expect(r).toEqual({ imported: 2, failed: [] });
    const items = await db.media.toArray();
    expect(items).toHaveLength(2);
    const it0 = items.find((m) => m.source === `archive:${ids[0]}`)!;
    expect(it0).toMatchObject({ kind: 'video', purpose: 'form', width: 480, height: 854, camera: 'side', tags: ['archive'] });
    expect(it0.original).toMatchObject({ archiveId: ids[0], width: 1080, height: 1920, dateSource: 'filename' });
    expect(it0.suggestion).toMatchObject({ pattern: 'hinge', from: 'log' });
    expect(await db.poses.get(it0.id)).toMatchObject({ id: it0.id, fps: 15 });
    expect(unlabelled(items)).toHaveLength(2);
    // a second time: nothing new
    expect(planImport([src], items, { years: null, skipCrowded: false, sideOnly: false })).toMatchObject({ rows: [], already: 2 });
  });

  it('reads the tool’s output folder and refuses other folders', async () => {
    const rel = (path: string, data: BlobPart) => Object.assign(new File([data], path.split('/').pop()!), { webkitRelativePath: path });
    const files = [
      rel('phoenix-archive/index.jsonl', JSON.stringify(row(ids[0])) + '\n'),
      rel(`phoenix-archive/clips/${ids[0]}/proxy.mp4`, 'video'),
      rel('phoenix-archive/packs/x.zip', 'zip'),
    ];
    const src = await readArchiveFolder(files);
    expect(src.rows).toHaveLength(1);
    expect(await (await src.file(ids[0], 'proxy.mp4'))?.text()).toBe('video');
    await expect(readArchives([rel('photos/a.jpg', 'x')])).rejects.toThrow(/isn’t an archive folder/);
  });
});
