// Working with your coach, without a server: pair once by QR code, then send
// encrypted share files (your clips, photos, notes and measurements) and get
// encrypted feedback files back (comments and angles drawn on your clips).
// Files travel however you like; only the paired device can open them.
import { useLiveQuery } from 'dexie-react-hooks';
import { strFromU8, strToU8 } from 'fflate';
import { db, uid, type CoachFeedback, type CoachShare, type MeasurementEntry, type MediaItem, type MediaMark, type Note, type Pairing } from '../db/db';
import { makeZip, readZip, type ZipEntry } from '../db/zip';
import { extensionFor } from '../media/process';
import type { PoseTrack } from '../vision/analysis';
import { b64uDecode, b64uEncode, decryptFile, encryptFile, fingerprint, makePairCode, newPairId, newSecret, readHeader, type PairCode } from './crypto';

export const secretOf = (p: Pairing) => b64uDecode(p.secret);
export const pairingFingerprint = (p: Pairing) => fingerprint(secretOf(p));

/** Starts a pairing as the athlete: the code (shown as a QR) goes to your coach. */
export async function createPairing(myName: string): Promise<{ pairing: Pairing; code: string }> {
  const secret = newSecret();
  const pairing: Pairing = { id: newPairId(), role: 'athlete', secret: b64uEncode(secret), name: 'Your coach', created: Date.now() };
  await db.pairings.put(pairing);
  return { pairing, code: makePairCode({ pair: pairing.id, secret, name: myName || 'Athlete' }) };
}

/** The code to show again for an existing pairing. */
export function pairingCode(p: Pairing, myName: string): string {
  return makePairCode({ pair: p.id, secret: secretOf(p), name: myName || 'Athlete' });
}

/** Joins a pairing as the coach, from the athlete's code. */
export async function joinPairing(code: PairCode): Promise<Pairing> {
  const existing = await db.pairings.get(code.pair);
  if (existing && existing.secret !== b64uEncode(code.secret)) throw new Error('A different pairing with this id is already on this device.');
  const pairing: Pairing = existing ?? { id: code.pair, role: 'coach', secret: b64uEncode(code.secret), name: code.name || 'Athlete', created: Date.now() };
  await db.pairings.put(pairing);
  return pairing;
}

/** Removes a pairing, and on a coach's device everything that athlete shared. */
export async function removePairing(id: string): Promise<void> {
  const items = (await db.media.toArray()).filter((m) => m.owner === id).map((m) => m.id);
  await db.transaction('rw', [db.pairings, db.shares, db.feedback, db.media, db.mediaBlobs, db.poses], async () => {
    await db.pairings.delete(id);
    await db.shares.where('pairId').equals(id).delete();
    await db.feedback.where('pairId').equals(id).delete();
    await db.media.bulkDelete(items);
    await db.mediaBlobs.bulkDelete(items);
    await db.poses.bulkDelete(items);
  });
}

export function usePairings(): Pairing[] {
  return useLiveQuery(() => db.pairings.orderBy('id').toArray(), [], [] as Pairing[]);
}

// ---------------------------------------------------------------- sharing (athlete → coach)

export interface ShareOptions {
  /** Earliest date to include; null for everything. */
  since: number | null;
  form: boolean;
  progress: boolean;
  notes: boolean;
  measurements: boolean;
  message: string;
}

export interface ShareContents {
  items: MediaItem[];
  notes: Note[];
  measurements: MeasurementEntry[];
  bytes: number;
}

/** What a share would contain. Private photos, videos and notes are never shared. */
export async function shareContents(o: ShareOptions): Promise<ShareContents> {
  const since = o.since ?? -Infinity;
  const items = (await db.media.toArray())
    .filter((m) => !m.owner && !m.private && m.date >= since && ((o.form && m.purpose === 'form') || (o.progress && m.purpose === 'progress')))
    .sort((a, b) => a.date - b.date);
  const notes = o.notes ? (await db.notes.toArray()).filter((n) => !n.private && n.date >= since).sort((a, b) => a.date - b.date) : [];
  const measurements = o.measurements ? (await db.measurements.toArray()).filter((e) => e.source !== 'demo' && e.date >= since).sort((a, b) => a.date - b.date) : [];
  return { items, notes, measurements, bytes: items.reduce((s, m) => s + m.size, 0) };
}

/** Only what the coach needs to see a clip: no file names, folders or pending suggestions. */
function shareable(m: MediaItem): Omit<MediaItem, 'thumb'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { thumb, original, suggestion, source, noteId, coachComment, private: _p, ...rest } = m;
  return { ...rest, ...(original ? { original: { ...original, name: '' } } : {}) };
}

/** Builds the encrypted share file for your coach. */
export async function buildShare(pairing: Pairing, o: ShareOptions, from: string, onProgress?: (text: string, p: number) => void): Promise<{ file: Blob; name: string; counts: { items: number; notes: number; measurements: number } }> {
  const c = await shareContents(o);
  const entries: ZipEntry[] = [];
  for (const [i, m] of c.items.entries()) {
    onProgress?.('Gathering files', i / Math.max(1, c.items.length));
    const blob = (await db.mediaBlobs.get(m.id))?.blob;
    if (!blob) continue;
    entries.push({ name: `media/${m.id}.${extensionFor(m.mime)}`, data: blob });
    if (m.thumb) entries.push({ name: `thumbs/${m.id}.jpg`, data: m.thumb });
    const track = await db.poses.get(m.id);
    if (track) entries.push({ name: `poses/${m.id}.json`, data: strToU8(JSON.stringify(track)), compress: true });
  }
  const manifest = {
    kind: 'share',
    app: 'phoenix-atlas',
    version: 1,
    id: uid(),
    from,
    created: Date.now(),
    message: o.message.trim() || undefined,
    period: { from: o.since, to: Date.now() },
    items: c.items.map(shareable),
    notes: c.notes.map(({ source, sourceId, ...n }) => n), // eslint-disable-line @typescript-eslint/no-unused-vars
    measurements: c.measurements,
  };
  entries.unshift({ name: 'manifest.json', data: strToU8(JSON.stringify(manifest)), compress: true });
  onProgress?.('Packing', 0);
  const zip = await makeZip(entries);
  const file = await encryptFile(zip, { kind: 'share', pair: pairing.id }, secretOf(pairing), (p) => onProgress?.('Encrypting', p));
  await db.pairings.update(pairing.id, { lastSent: Date.now() });
  const day = new Date().toISOString().slice(0, 10);
  return { file, name: `phoenix-share-${day}.phx`, counts: { items: c.items.length, notes: c.notes.length, measurements: c.measurements.length } };
}

// ---------------------------------------------------------------- feedback (coach → athlete)

/** Marks the coach drew on an athlete's clip (not the ones that came with it). */
export function coachMarks(m: MediaItem): MediaMark[] {
  const shared = new Set(m.sharedMarks ?? []);
  return (m.marks ?? []).filter((k) => !shared.has(k.id) && k.source !== 'pose');
}

/** The athlete's clips the coach has commented on or drawn on. */
export async function feedbackItems(pairId: string): Promise<MediaItem[]> {
  return (await db.media.toArray()).filter((m) => m.owner === pairId && (m.coachComment?.text.trim() || coachMarks(m).length));
}

/** Builds the encrypted feedback file for an athlete: your comments and drawn angles, and a message. */
export async function buildFeedback(pairing: Pairing, message: string, from: string): Promise<{ file: Blob; name: string; items: number }> {
  const items = await feedbackItems(pairing.id);
  const manifest = {
    kind: 'feedback',
    app: 'phoenix-atlas',
    version: 1,
    id: uid(),
    from,
    created: Date.now(),
    message: message.trim(),
    items: items.map((m) => ({ id: m.id, comment: m.coachComment?.text.trim() || undefined, marks: coachMarks(m) })),
  };
  const zip = await makeZip([{ name: 'manifest.json', data: strToU8(JSON.stringify(manifest)) }]);
  const file = await encryptFile(zip, { kind: 'feedback', pair: pairing.id }, secretOf(pairing));
  await db.pairings.update(pairing.id, { lastSent: Date.now() });
  const day = new Date().toISOString().slice(0, 10);
  return { file, name: `phoenix-feedback-${day}.phx`, items: items.length };
}

// ---------------------------------------------------------------- opening files

const isPoint = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'number' && Number.isFinite(x));

/** Keeps only well-formed marks from a file, so a damaged or odd file can't break the viewer. */
export function cleanMarks(list: unknown): MediaMark[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((k): k is MediaMark => !!k && typeof k === 'object' && typeof k.id === 'string' && ['angle', 'line', 'path'].includes(k.type) && Array.isArray(k.points) && k.points.length > 0 && k.points.length <= 500 && k.points.every(isPoint))
    .map((k) => ({
      id: k.id,
      type: k.type,
      points: k.points,
      ...(typeof k.t === 'number' ? { t: k.t } : {}),
      ...(Array.isArray(k.times) && k.times.every((x) => typeof x === 'number') ? { times: k.times } : {}),
      ...(typeof k.label === 'string' ? { label: k.label.slice(0, 60) } : {}),
      ...(k.source === 'pose' ? { source: 'pose' as const } : {}),
    }));
}

export type Opened = { kind: 'share'; pairing: Pairing; share: CoachShare } | { kind: 'feedback'; pairing: Pairing; feedback: CoachFeedback };

/** Opens a share or feedback file sent by the person you're paired with. */
export async function openPhx(file: Blob, onProgress?: (p: number) => void): Promise<Opened> {
  const { header } = await readHeader(file);
  const pairing = await db.pairings.get(header.pair);
  if (!pairing) throw new Error('This file is for a pairing that isn’t on this device. Pair first, on the device you’ll use.');
  if (header.kind === 'share' && pairing.role !== 'coach') throw new Error('This is a share for your coach; open it on their device.');
  if (header.kind === 'feedback' && pairing.role !== 'athlete') throw new Error('This is feedback for your athlete; open it on their device.');
  const { payload } = await decryptFile(file, secretOf(pairing), onProgress);
  const entries = await readZip(payload);
  const man = entries.get('manifest.json');
  if (!man) throw new Error('This file is missing its contents list.');
  const manifest = JSON.parse(strFromU8(new Uint8Array(await man.arrayBuffer())));
  if (header.kind === 'share') return { kind: 'share', pairing, share: await importShare(pairing, manifest, entries) };
  return { kind: 'feedback', pairing, feedback: await importFeedback(pairing, manifest) };
}

interface ShareManifest {
  id: string;
  from: string;
  created: number;
  message?: string;
  period: { from: number | null; to: number };
  items: MediaItem[];
  notes: Note[];
  measurements: MeasurementEntry[];
}

async function importShare(pairing: Pairing, man: ShareManifest, entries: Map<string, Blob>): Promise<CoachShare> {
  const ids: string[] = [];
  for (const raw of man.items ?? []) {
    if (typeof raw?.id !== 'string') continue;
    const blob = [...entries.entries()].find(([k]) => k.startsWith(`media/${raw.id}.`))?.[1];
    if (!blob) continue;
    const prev = await db.media.get(raw.id);
    if (prev && prev.owner !== pairing.id) continue; // never overwrite anything else on this device
    const thumb = entries.get(`thumbs/${raw.id}.jpg`);
    const trackBlob = entries.get(`poses/${raw.id}.json`);
    const athleteMarks = cleanMarks(raw.marks);
    // the coach's own marks and comment on an earlier copy are kept
    const keep = prev ? (prev.marks ?? []).filter((k) => !(prev.sharedMarks ?? []).includes(k.id)) : [];
    const item: MediaItem = {
      ...raw,
      owner: pairing.id,
      thumb: thumb ? new Blob([thumb], { type: 'image/jpeg' }) : undefined,
      marks: [...athleteMarks, ...keep.filter((k) => !athleteMarks.some((a) => a.id === k.id))],
      sharedMarks: athleteMarks.map((k) => k.id),
      coachComment: prev?.coachComment,
      private: undefined,
    };
    // read everything first: awaiting anything but the database inside a transaction ends it early
    const track = trackBlob ? ({ ...(JSON.parse(strFromU8(new Uint8Array(await trackBlob.arrayBuffer()))) as PoseTrack), id: item.id } as PoseTrack) : null;
    const file = new Blob([blob], { type: item.mime });
    await db.transaction('rw', db.media, db.mediaBlobs, db.poses, async () => {
      await db.mediaBlobs.put({ id: item.id, blob: file });
      await db.media.put(item);
      if (track) await db.poses.put(track);
    });
    ids.push(item.id);
  }
  const share: CoachShare = {
    id: man.id || uid(),
    pairId: pairing.id,
    created: man.created ?? Date.now(),
    received: Date.now(),
    from: man.from || pairing.name,
    message: man.message,
    period: man.period ?? { from: null, to: Date.now() },
    itemIds: ids,
    notes: Array.isArray(man.notes) ? man.notes : [],
    measurements: Array.isArray(man.measurements) ? man.measurements : [],
  };
  await db.shares.put(share);
  await db.pairings.update(pairing.id, { lastReceived: Date.now(), name: share.from || pairing.name });
  return share;
}

interface FeedbackManifest {
  id: string;
  from: string;
  created: number;
  message: string;
  items: { id: string; comment?: string; marks?: MediaMark[] }[];
}

async function importFeedback(pairing: Pairing, man: FeedbackManifest): Promise<CoachFeedback> {
  const ids: string[] = [];
  const from = man.from || pairing.name;
  for (const f of man.items ?? []) {
    const m = await db.media.get(f.id);
    if (!m || m.owner) continue;
    // the coach's marks are replaced by the latest feedback; yours are untouched
    const coach = cleanMarks(f.marks).map((k) => ({ ...k, by: 'coach' as const, label: k.label && !k.label.startsWith('Coach: ') ? `Coach: ${k.label}` : k.label ?? 'Coach' }));
    await db.media.update(m.id, {
      marks: [...(m.marks ?? []).filter((k) => k.by !== 'coach'), ...coach],
      coachComment: typeof f.comment === 'string' && f.comment.trim() ? { text: f.comment.slice(0, 4000), at: man.created ?? Date.now(), by: from.slice(0, 60) } : m.coachComment,
      updatedAt: Date.now(),
    });
    ids.push(m.id);
  }
  const feedback: CoachFeedback = { id: man.id || uid(), pairId: pairing.id, created: man.created ?? Date.now(), received: Date.now(), from, message: man.message ?? '', itemIds: ids };
  await db.feedback.put(feedback);
  await db.pairings.update(pairing.id, { lastReceived: Date.now(), name: from });
  return feedback;
}

export function useShares(pairId: string): CoachShare[] {
  return useLiveQuery(() => db.shares.where('pairId').equals(pairId).reverse().sortBy('received'), [pairId], [] as CoachShare[]);
}

export function useFeedback(): CoachFeedback[] {
  return useLiveQuery(() => db.feedback.toArray().then((f) => f.sort((a, b) => b.received - a.received)), [], [] as CoachFeedback[]);
}

/** Hands a file to the phone's share sheet when it can take files, otherwise downloads it. */
export async function sendFile(file: Blob, name: string): Promise<'shared' | 'saved'> {
  const f = new File([file], name, { type: 'application/octet-stream' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [f] })) {
    try {
      await nav.share({ files: [f], title: name });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
    }
  }
  const url = URL.createObjectURL(f);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}
