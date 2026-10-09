import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type MediaItem, type Pairing } from '../db/db';
import { addMedia } from '../media/media';
import { buildFeedback, buildShare, createPairing, joinPairing, openPhx, removePairing } from './coach';
import { b64uDecode, b64uEncode, CHUNK, decryptFile, encryptFile, fingerprint, makePairCode, newSecret, parsePairCode, readHeader } from './crypto';

const bytes = (n: number, seed = 1) => {
  const b = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) b[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24;
  return b;
};
const same = async (a: Blob, b: Uint8Array) => {
  const x = new Uint8Array(await a.arrayBuffer());
  return x.length === b.length && x.every((v, i) => v === b[i]);
};

describe('encrypted files', () => {
  const secret = newSecret();

  it('round-trips small and multi-chunk payloads', async () => {
    for (const n of [0, 10, CHUNK, CHUNK * 2 + 123]) {
      const data = bytes(n, n + 1);
      const file = await encryptFile(new Blob([data]), { kind: 'share', pair: '0123456789abcdef' }, secret);
      const { header, payload } = await decryptFile(file, secret);
      expect(header).toMatchObject({ kind: 'share', pair: '0123456789abcdef', size: n });
      expect(await same(payload, data)).toBe(true);
    }
  });

  it('refuses changed, cut-short, extended or wrongly keyed files', async () => {
    const data = bytes(CHUNK + 1000);
    const file = new Uint8Array(await (await encryptFile(new Blob([data]), { kind: 'share', pair: '0123456789abcdef' }, secret)).arrayBuffer());
    const flipped = file.slice();
    flipped[flipped.length - 50] ^= 1;
    await expect(decryptFile(new Blob([flipped]), secret)).rejects.toThrow(/changed/);
    // drop the last chunk: the first chunk alone isn't marked as the last, so it fails
    const { offset } = await readHeader(new Blob([file]));
    const firstLen = new DataView(file.buffer, offset, 4).getUint32(0, true);
    await expect(decryptFile(new Blob([file.slice(0, offset + 4 + firstLen)]), secret)).rejects.toThrow(/incomplete/);
    await expect(decryptFile(new Blob([file, new Uint8Array([1, 2, 3])]), secret)).rejects.toThrow(/extra data/);
    await expect(decryptFile(new Blob([file]), newSecret())).rejects.toThrow(/different pairing/);
    // a header edited to claim another pairing no longer matches its chunks
    const text = new TextDecoder().decode(file.slice(8, offset));
    const edited = new TextEncoder().encode(text.replace('"share"', '"feedback"'));
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, edited.length, true);
    await expect(decryptFile(new Blob([file.slice(0, 4), len, edited, file.slice(offset)]), secret)).rejects.toThrow(/changed/);
    await expect(readHeader(new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])]))).rejects.toThrow(/isn’t a Phoenix Atlas/);
  });

  it('pairing codes survive links and show matching fingerprints', async () => {
    const code = makePairCode({ pair: '0123456789abcdef', secret, name: 'Mander' });
    const parsed = parsePairCode(`https://example.github.io/Phoenix-atlas/#/coach/pair/${code}`)!;
    expect(parsed.pair).toBe('0123456789abcdef');
    expect(parsed.name).toBe('Mander');
    expect(b64uEncode(parsed.secret)).toBe(b64uEncode(secret));
    expect(await fingerprint(parsed.secret)).toBe(await fingerprint(secret));
    expect(await fingerprint(secret)).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(parsePairCode('hello')).toBeNull();
    expect(b64uDecode(b64uEncode(new Uint8Array([0, 255, 128])))).toEqual(new Uint8Array([0, 255, 128]));
  });
});

describe('working with a coach', () => {
  beforeEach(async () => {
    await Promise.all([db.media.clear(), db.mediaBlobs.clear(), db.poses.clear(), db.notes.clear(), db.measurements.clear(), db.pairings.clear(), db.shares.clear(), db.feedback.clear()]);
  });

  async function athleteDevice() {
    const { pairing, code } = await createPairing('Mander');
    const clip = await addMedia({ blob: new Blob([bytes(5000)], { type: 'video/mp4' }), kind: 'video', purpose: 'form', width: 480, height: 854, duration: 5, pattern: 'squat', date: Date.now() - 86_400_000, marks: [{ id: 'm1', type: 'angle', points: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.1]], label: 'Knee', t: 1 }], source: 'archive:abc', original: { archiveId: 'abc', name: 'VID_secret_name.mp4', width: 1080, height: 1920, bytes: 1, dateSource: 'filename' } });
    const hidden = await addMedia({ blob: new Blob([bytes(100)], { type: 'video/mp4' }), kind: 'video', purpose: 'form', width: 10, height: 10, private: true });
    const photo = await addMedia({ blob: new Blob([bytes(100)], { type: 'image/jpeg' }), kind: 'photo', purpose: 'progress', width: 10, height: 10, pose: 'front' });
    await db.poses.put({ id: clip.id, model: 'm', createdAt: 1, width: 480, height: 854, fps: 15, frames: [{ t: 0, lm: null }] });
    await db.notes.put({ id: 'n1', date: Date.now(), createdAt: 1, updatedAt: 1, title: 'Squats', body: 'Felt good', category: 'workout', feeling: 3, sensations: [], tags: [], locations: [], structureIds: [], links: [] });
    await db.notes.put({ id: 'n2', date: Date.now(), createdAt: 1, updatedAt: 1, title: 'Private', body: '', category: 'health', feeling: 0, sensations: [], tags: [], locations: [], structureIds: [], links: [], private: true });
    return { pairing, code, clip, hidden, photo };
  }

  it('shares, gets feedback and keeps everything else apart', async () => {
    // athlete: pair and share (form clips and notes; progress photos left out by choice)
    const a = await athleteDevice();
    const share = await buildShare(a.pairing, { since: null, form: true, progress: false, notes: true, measurements: true, message: 'Depth ok?' }, 'Mander');
    expect(share.counts).toEqual({ items: 1, notes: 1, measurements: 0 });
    const athleteClip = (await db.media.get(a.clip.id))!;
    const athletePairing = (await db.pairings.get(a.pairing.id))!;

    // coach: a different device
    await Promise.all([db.media.clear(), db.mediaBlobs.clear(), db.poses.clear(), db.notes.clear(), db.pairings.clear()]);
    const coach = await joinPairing(parsePairCode(a.code)!);
    expect(coach).toMatchObject({ role: 'coach', name: 'Mander' });
    const opened = await openPhx(share.file);
    expect(opened.kind).toBe('share');
    if (opened.kind !== 'share') return;
    expect(opened.share).toMatchObject({ from: 'Mander', message: 'Depth ok?', itemIds: [a.clip.id] });
    expect(opened.share.notes.map((n) => n.title)).toEqual(['Squats']);
    const copy = (await db.media.get(a.clip.id))!;
    expect(copy).toMatchObject({ owner: coach.id, sharedMarks: ['m1'], pattern: 'squat' });
    expect(copy.original?.name).toBe(''); // no file names leave the athlete's device
    expect(copy.source).toBeUndefined();
    expect(await db.poses.get(a.clip.id)).toBeTruthy();
    expect((await db.mediaBlobs.get(a.clip.id))?.blob.size).toBe(5000);

    // coach draws an angle, writes a comment and sends feedback
    await db.media.update(copy.id, { marks: [...copy.marks!, { id: 'c1', type: 'line', points: [[0.5, 0.5], [0.5, 0.9]], label: 'Torso lean', t: 2 }], coachComment: { text: 'Chest up at the bottom', at: Date.now() } });
    const fb = await buildFeedback((await db.pairings.get(coach.id))!, 'Nice work', 'Coach Sam');
    expect(fb.items).toBe(1);
    // the same file can't be opened on the coach's own device as feedback
    await expect(openPhx(fb.file)).rejects.toThrow(/for your athlete/);

    // athlete again
    await Promise.all([db.media.clear(), db.mediaBlobs.clear(), db.pairings.clear(), db.shares.clear()]);
    await db.pairings.put(athletePairing as Pairing);
    await db.media.put(athleteClip as MediaItem);
    const back = await openPhx(fb.file);
    expect(back.kind).toBe('feedback');
    const mine = (await db.media.get(a.clip.id))!;
    expect(mine.coachComment).toMatchObject({ text: 'Chest up at the bottom', by: 'Coach Sam' });
    expect(mine.marks!.map((k) => [k.id, k.by, k.label])).toEqual([
      ['m1', undefined, 'Knee'],
      ['c1', 'coach', 'Coach: Torso lean'],
    ]);
    expect((await db.pairings.get(a.pairing.id))!.name).toBe('Coach Sam');
    // opening the same feedback twice doesn't double the coach's marks
    await openPhx(fb.file);
    expect((await db.media.get(a.clip.id))!.marks).toHaveLength(2);
    // a share file can't be opened on the athlete's own device
    await expect(openPhx(share.file)).rejects.toThrow(/for your coach/);
  });

  it('unpairing on the coach’s device removes that athlete’s clips', async () => {
    const a = await athleteDevice();
    const share = await buildShare(a.pairing, { since: null, form: true, progress: true, notes: false, measurements: false, message: '' }, 'Mander');
    expect(share.counts.items).toBe(2); // the private clip stays home
    await Promise.all([db.media.clear(), db.mediaBlobs.clear(), db.pairings.clear()]);
    const coach = await joinPairing(parsePairCode(a.code)!);
    await openPhx(share.file);
    expect(await db.media.count()).toBe(2);
    await removePairing(coach.id);
    expect(await db.media.count()).toBe(0);
    expect(await db.shares.count()).toBe(0);
  });
});

describe('files from the other phone', () => {
  it('keep only well-formed marks', async () => {
    const { cleanMarks } = await import('./coach');
    const good = { id: 'a', type: 'angle', points: [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]], label: 'Knee', t: 1, extra: '<script>' };
    const out = cleanMarks([good, { id: 'b', type: 'circle', points: [[0, 0]] }, { id: 'c', type: 'line', points: [['x', 1]] }, null, 'nope', { type: 'line', points: [[0, 0]] }]);
    expect(out).toEqual([{ id: 'a', type: 'angle', points: good.points, t: 1, label: 'Knee' }]);
    expect(cleanMarks(undefined)).toEqual([]);
  });
});
