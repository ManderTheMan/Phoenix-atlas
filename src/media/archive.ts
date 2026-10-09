// Bringing in results from the archive tool (tools/archive): its pack zips or
// its output folder. Each usable clip arrives with its small copy, thumbnail
// and joint track, so nothing needs analysing again, plus a suggested
// movement pattern from the joints and your training log.
import { gunzipSync, strFromU8 } from 'fflate';
import { db, type CameraAngle, type MediaItem } from '../db/db';
import { readZip } from '../db/zip';
import type { PatternId } from '../movement/patterns';
import { trackSummary, type PoseTrack } from '../vision/analysis';
import { guessPattern, loggedThatDay, suggest } from '../vision/classify';
import { addMedia } from './media';

export interface ArchiveRow {
  id: string;
  name: string;
  date: number | null;
  dateSource: string;
  duration: number;
  width: number;
  height: number;
  fps?: number | null;
  slowmo?: boolean;
  codec?: string;
  bytes: number;
  status: 'usable' | 'skipped';
  reason?: string | null;
  description?: string;
  triage?: { people?: number; bodySize?: number | null; view?: 'side' | 'angle' | 'front' | null; movement?: number; found?: number };
  track?: string;
  proxy?: string;
  thumb?: string;
  proxyWidth?: number;
  proxyHeight?: number;
  proxyBytes?: number;
  copies?: string[];
  nearDuplicateOf?: string;
}

export interface ArchiveSource {
  label: string;
  rows: ArchiveRow[];
  file: (id: string, name: string) => Promise<Blob | undefined>;
}

function parseIndex(text: string): ArchiveRow[] {
  const rows: ArchiveRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r.id === 'string' && /^[0-9a-f]{16}$/.test(r.id)) rows.push(r as ArchiveRow);
    } catch {
      // a damaged line costs that clip only
    }
  }
  return rows;
}

/** A pack zip made by `phoenix-archive pack`. */
export async function readArchivePack(file: File): Promise<ArchiveSource> {
  const entries = await readZip(file);
  const index = entries.get('index.jsonl');
  if (!index) throw new Error(`${file.name} isn’t an archive pack (no index.jsonl).`);
  return { label: file.name, rows: parseIndex(await index.text()), file: async (id, name) => entries.get(`clips/${id}/${name}`) };
}

/** The archive tool's output folder, chosen with a folder picker (files carry webkitRelativePath). */
export async function readArchiveFolder(files: File[]): Promise<ArchiveSource> {
  const rel = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
  const indexFile = files.find((f) => /(^|\/)index\.jsonl$/.test(rel(f)) && !rel(f).includes('/clips/') && !rel(f).includes('/packs/'));
  if (!indexFile) throw new Error('That folder isn’t an archive folder (no index.jsonl). Choose the folder you gave the tool as --out.');
  const base = rel(indexFile).slice(0, -'index.jsonl'.length);
  const byPath = new Map(files.map((f) => [rel(f), f]));
  return { label: base.replace(/\/$/, '') || 'archive folder', rows: parseIndex(await indexFile.text()), file: async (id, name) => byPath.get(`${base}clips/${id}/${name}`) };
}

/** Packs and folders, in any mix: zips are read as packs, everything else as one chosen folder. */
export async function readArchives(files: File[]): Promise<ArchiveSource[]> {
  const isPack = (f: File) => f.name.toLowerCase().endsWith('.zip') && !(f as File & { webkitRelativePath?: string }).webkitRelativePath;
  const out: ArchiveSource[] = [];
  for (const z of files.filter(isPack)) out.push(await readArchivePack(z));
  const rest = files.filter((f) => !isPack(f));
  if (rest.length) out.push(await readArchiveFolder(rest));
  return out;
}

export interface ImportOptions {
  /** Years to bring in; null for all. */
  years: Set<number> | null;
  skipCrowded: boolean;
  sideOnly: boolean;
}

export interface PlanRow {
  row: ArchiveRow;
  source: ArchiveSource;
}

export interface ImportPlan {
  rows: PlanRow[];
  /** Usable clips in the sources, before options. */
  usable: number;
  already: number;
  noCopy: number;
  copies: number;
  bytes: number;
  years: Map<number, number>;
}

export const archiveKey = (id: string) => `archive:${id}`;
export const yearOf = (r: ArchiveRow) => (r.date ? new Date(r.date).getFullYear() : 0);

/** Which clips an import would bring in. Clips already imported, near-duplicates and clips without a small copy are left out. */
export function planImport(sources: ArchiveSource[], existing: Pick<MediaItem, 'source'>[], o: ImportOptions): ImportPlan {
  const have = new Set(existing.map((m) => m.source).filter(Boolean));
  const seen = new Set<string>();
  const plan: ImportPlan = { rows: [], usable: 0, already: 0, noCopy: 0, copies: 0, bytes: 0, years: new Map() };
  for (const source of sources)
    for (const row of source.rows) {
      if (row.status !== 'usable' || seen.has(row.id)) continue;
      seen.add(row.id);
      if (row.nearDuplicateOf) {
        plan.copies++;
        continue;
      }
      plan.usable++;
      const y = yearOf(row);
      plan.years.set(y, (plan.years.get(y) ?? 0) + 1);
      if (have.has(archiveKey(row.id))) {
        plan.already++;
        continue;
      }
      if (!row.proxy) {
        plan.noCopy++;
        continue;
      }
      if (o.years && !o.years.has(y)) continue;
      if (o.skipCrowded && (row.triage?.people ?? 1) > 1) continue;
      if (o.sideOnly && row.triage?.view && row.triage.view !== 'side') continue;
      plan.rows.push({ row, source });
      plan.bytes += row.proxyBytes ?? 0;
    }
  plan.rows.sort((a, b) => (b.row.date ?? 0) - (a.row.date ?? 0));
  return plan;
}

const CAMERA: Record<string, CameraAngle> = { side: 'side', front: 'front', angle: 'angle' };

/** Tags for what the tool noticed about a clip. */
export function archiveTags(row: ArchiveRow): string[] {
  const tags = ['archive'];
  if ((row.triage?.people ?? 1) > 1) tags.push('several-people');
  if (row.slowmo) tags.push('slow-motion');
  return tags;
}

export interface ImportResult {
  imported: number;
  failed: { name: string; reason: string }[];
}

/** Brings the planned clips in, newest first. Stops cleanly between clips when the signal aborts. */
export async function importArchive(plan: ImportPlan, logged: { date: number; pattern?: PatternId }[], onProgress?: (done: number, total: number, name: string) => void, signal?: AbortSignal): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, failed: [] };
  let done = 0;
  for (const { row, source } of plan.rows) {
    if (signal?.aborted) break;
    onProgress?.(done, plan.rows.length, row.name);
    try {
      const [proxy, thumb, trackBlob] = await Promise.all([source.file(row.id, row.proxy!), row.thumb ? source.file(row.id, row.thumb) : undefined, row.track ? source.file(row.id, row.track) : undefined]);
      if (!proxy) throw new Error('its small copy is missing');
      let track: PoseTrack | null = null;
      if (trackBlob) {
        const raw = new Uint8Array(await trackBlob.arrayBuffer());
        track = JSON.parse(strFromU8(raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw)) as PoseTrack;
      }
      const day = row.date ?? Date.now();
      const s = track ? suggest(guessPattern(track), loggedThatDay(day, logged)) : null;
      const tracked = track && s?.pattern ? trackSummary(track, s.pattern) : undefined;
      const item = await addMedia({
        blob: new Blob([proxy], { type: row.proxy!.endsWith('.webm') ? 'video/webm' : 'video/mp4' }),
        kind: 'video',
        purpose: 'form',
        date: day,
        width: row.proxyWidth ?? row.width,
        height: row.proxyHeight ?? row.height,
        duration: row.duration,
        thumb: thumb ? new Blob([thumb], { type: 'image/jpeg' }) : undefined,
        tags: archiveTags(row),
        camera: row.triage?.view ? CAMERA[row.triage.view] : undefined,
        notes: row.description || undefined,
        source: archiveKey(row.id),
        original: {
          archiveId: row.id,
          name: row.name,
          width: row.width,
          height: row.height,
          bytes: row.bytes,
          fps: row.fps ?? undefined,
          codec: row.codec,
          dateSource: row.dateSource,
          copies: row.copies?.length,
          slowmo: row.slowmo || undefined,
        },
        tracked,
        suggestion: s ? { pattern: s.pattern, confidence: Math.round(s.confidence * 100) / 100, from: s.from, why: s.why, options: s.options, reps: tracked?.reps } : undefined,
      });
      if (track) await db.poses.put({ ...track, id: item.id });
      result.imported++;
    } catch (e) {
      result.failed.push({ name: row.name, reason: (e as Error).message });
    }
    done++;
  }
  onProgress?.(done, plan.rows.length, '');
  return result;
}

/** Archive clips still waiting for a movement pattern. */
export function unlabelled(media: MediaItem[]): MediaItem[] {
  return media.filter((m) => m.source?.startsWith('archive:') && m.purpose === 'form' && !m.pattern);
}
