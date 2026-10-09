// Builds a shareable dataset ZIP from your photos and videos: privacy first
// (no private files, no location metadata, optional face pixelation, dates at
// the precision you choose), then the files, their metadata and annotations,
// and the documents that explain them.
import { strToU8 } from 'fflate';
import { db, type MediaItem, type MediaPurpose } from '../db/db';
import { makeZip, type ZipEntry } from '../db/zip';
import { getMediaBlob } from '../media/media';
import { extensionFor } from '../media/process';
import { scrubVideo } from '../media/scrub';
import { MEASURE_BY_KEY, measureLabel, type MeasureKey } from '../profile/profile';
import { summarizeReps } from '../vision/analysis';
import { qualityChecks } from '../vision/quality';
import { APP_URL, datasetIds, datasheet, formatWhen, licenseText, marksFile, metadataRows, poseFile, readme, repsFile, SCHEMA, toCsv, type CardInfo, type DatePrecision, type Entry, type License } from './card';
import { pixelatePhoto, pixelateVideo } from './privacy';

export interface ExportOptions {
  name: string;
  creator: string;
  description: string;
  license: License;
  purposes: MediaPurpose[];
  dates: DatePrecision;
  measurements: boolean;
  notes: boolean;
  pixelateFaces: boolean;
  /** Leave out files whose quality checks found problems. */
  skipProblems: boolean;
  /** Include the demo's rendered files. */
  includeSynthetic: boolean;
  validation?: CardInfo['validation'];
}

export interface ExportReport {
  included: number;
  skipped: { id: string; reason: string }[];
  bytes: number;
}

/** The files an export would include, before privacy steps (for the preview). */
export async function exportCandidates(o: Pick<ExportOptions, 'purposes' | 'includeSynthetic'>): Promise<MediaItem[]> {
  const all = await db.media.toArray();
  // clips from the video archive aren't exported yet (they stay in the Archive tab)
  return all.filter((m) => !m.private && !m.owner && !m.source?.startsWith('archive:') && o.purposes.includes(m.purpose) && (o.includeSynthetic || !m.tags.includes('synthetic'))).sort((a, b) => a.date - b.date);
}

export async function exportDataset(o: ExportOptions, onProgress?: (text: string, p: number) => void): Promise<{ blob: Blob; report: ExportReport }> {
  const items = await exportCandidates(o);
  const ids = datasetIds(items);
  const skipped: ExportReport['skipped'] = [];
  const entries: Entry[] = [];
  const files: ZipEntry[] = [];
  const first = items.length ? items[0].date : Date.now();
  for (let i = 0; i < items.length; i++) {
    const m = items[i];
    const id = ids.get(m.id)!;
    onProgress?.(`Preparing ${id}`, i / Math.max(1, items.length));
    const track = (await db.poses.get(m.id)) ?? null;
    const checks = qualityChecks(m, track);
    if (o.skipProblems && checks.some((c) => c.status === 'fail')) {
      skipped.push({ id, reason: `quality problems: ${checks.filter((c) => c.status === 'fail').map((c) => c.label.toLowerCase()).join(', ')}` });
      continue;
    }
    let blob = await getMediaBlob(m.id);
    if (!blob) {
      skipped.push({ id, reason: 'file missing' });
      continue;
    }
    let pixelated = false;
    if (o.pixelateFaces) {
      const synthetic = m.tags.includes('synthetic');
      if (!track || !track.frames.some((f) => f.lm)) {
        if (!synthetic) {
          skipped.push({ id, reason: 'faces were to be pixelated, but no person was found to locate the face (run “Find joints”, or untick pixelation)' });
          continue;
        }
      } else if (!synthetic) {
        const out = m.kind === 'photo' ? await pixelatePhoto(blob, track.frames[0].lm) : await pixelateVideo(blob, track, (p) => onProgress?.(`Pixelating the face in ${id}`, (i + p) / items.length));
        if (!out) {
          skipped.push({ id, reason: 'this browser couldn’t re-record the video to pixelate the face' });
          continue;
        }
        blob = out;
        pixelated = true;
      }
    }
    if (m.kind === 'video') blob = (await scrubVideo(blob, { dates: o.dates !== 'exact' })).blob;
    const file = `media/${m.kind === 'photo' ? 'photos' : 'videos'}/${id}.${extensionFor(blob.type || m.mime)}`;
    files.push({ name: file, data: blob });
    entries.push({ item: m, id, file, track, reps: track && m.kind === 'video' ? summarizeReps(track, m.pattern) : null, checks, facesPixelated: pixelated });
  }
  if (!entries.length) throw new Error(skipped.length ? `Every file was left out: ${skipped[0].reason}` : 'There are no photos or videos to export with these settings.');
  onProgress?.('Writing metadata', 0.95);
  const info: CardInfo = { name: o.name.trim() || 'Personal training and body dataset', creator: o.creator.trim(), description: o.description, license: o.license, dates: o.dates, facesPixelated: o.pixelateFaces, measurements: o.measurements, notes: o.notes, createdAt: Date.now(), validation: o.validation, appUrl: APP_URL };
  const rows = metadataRows(entries, info);
  const json = (name: string, data: unknown) => files.push({ name, data: strToU8(JSON.stringify(data, null, 1)), compress: true });
  const text = (name: string, s: string) => files.push({ name, data: strToU8(s), compress: true });
  for (const e of entries) {
    if ((e.item.marks?.length ?? 0) || e.item.phase0 !== undefined) json(`annotations/marks/${e.id}.json`, marksFile(e, first, o.dates));
    if (e.track) json(`annotations/pose/${e.id}.json`, poseFile(e));
    if (e.reps) json(`annotations/reps/${e.id}.json`, repsFile(e.reps));
    if (e.checks) json(`annotations/quality/${e.id}.json`, e.checks);
  }
  if (o.measurements) {
    const ms = (await db.measurements.toArray()).filter((x) => x.source !== 'demo' || items.some((m) => m.source === 'demo')).sort((a, b) => a.date - b.date);
    const rowsM = ms.flatMap((x) =>
      Object.entries(x.values).map(([k, v]) => ({ date: formatWhen(x.date, o.dates, first), measurement: measureLabel(k as MeasureKey), key: k, value: v, unit: MEASURE_BY_KEY.get(k as MeasureKey)?.unit ?? '' })),
    );
    if (rowsM.length) text('measurements.csv', toCsv(rowsM));
  }
  text('metadata.csv', toCsv(rows as unknown as Record<string, unknown>[]));
  text('metadata.jsonl', rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  json('schema.json', SCHEMA);
  if (o.validation?.length) json('validation.json', { method: 'Pose tracker run on synthetic side-on squats with known joint angles (see README).', joints: o.validation });
  text('README.md', readme(entries, info));
  text('DATASHEET.md', datasheet(entries, info));
  text('LICENSE.txt', licenseText(info));
  // documents first in the archive, then annotations, then media
  const order = (n: string) => (n.startsWith('media/') ? 2 : n.startsWith('annotations/') ? 1 : 0);
  files.sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name));
  const folder = (info.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dataset').slice(0, 60);
  const zip = await makeZip(files.map((f) => ({ ...f, name: `${folder}/${f.name}` })), (d, t) => onProgress?.('Packing', 0.95 + (0.05 * d) / t));
  return { blob: zip, report: { included: entries.length, skipped, bytes: zip.size } };
}
