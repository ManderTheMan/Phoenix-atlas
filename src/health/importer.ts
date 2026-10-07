// File import entry point: accepts Takeout/Health Connect zips or loose
// CSV/JSON/DB files, streams through zips (only decompressing what we use)
// and dispatches each entry to the right parser.
import { Unzip, UnzipInflate, UnzipPassThrough, strFromU8 } from 'fflate';
import type { SqlJsStatic } from 'sql.js';
import type { Activity } from '../db/db';
import { parseHealthConnect } from './healthConnect';
import { DailyAccumulator, type ImportResult } from './metrics';
import {
  finishFitbit,
  isFitbitJson,
  parseFitDailySummary,
  parseFitIntervals,
  parseFitSession,
  parseFitbitJson,
  parseFitbitProfile,
  parseGenericCsv,
  type FitbitContext,
} from './parsers';

export type Progress = (p: { file: string; fraction: number; message?: string }) => void;

/** Lazily load sql.js + its wasm (only needed for Health Connect exports). */
let sqlPromise: Promise<SqlJsStatic> | null = null;
export function loadSqlJs(): Promise<SqlJsStatic> {
  sqlPromise ??= (async () => {
    const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
      import('sql.js'),
      import('sql.js/dist/sql-wasm.wasm?url'),
    ]);
    return initSqlJs({ locateFile: () => wasmUrl });
  })();
  return sqlPromise;
}

/** Collects entries from any number of files, then produces one ImportResult. */
export class ImportSession {
  acc = new DailyAccumulator();
  fitSummary = new DailyAccumulator();
  fitIntervals = new DailyAccumulator();
  fitbit: FitbitContext = { weights: [] };
  activities: Activity[] = [];
  databases: { name: string; bytes: Uint8Array }[] = [];
  log: string[] = [];
  warnings: string[] = [];
  sources = new Set<string>();
  entries = 0;

  /** Should this zip entry be decompressed at all? */
  static wanted(path: string): boolean {
    const p = path.toLowerCase();
    if (p.endsWith('/')) return false;
    if (p.endsWith('.db') || p.endsWith('.sqlite')) return true;
    if (!p.endsWith('.csv') && !p.endsWith('.json')) return false;
    // Skip obviously irrelevant Takeout products and huge GPS/raw folders.
    if (/(^|\/)(mail|drive|photos|youtube|chrome|maps|location history|keep)\//.test(p)) return false;
    if (/all data\/raw_|\.tcx$|\.gpx$/.test(p)) return false;
    return true;
  }

  handle(path: string, data: Uint8Array): void {
    this.entries++;
    const p = path.replace(/\\/g, '/');
    const lower = p.toLowerCase();
    const base = lower.split('/').pop() ?? lower;
    if (lower.endsWith('.db') || lower.endsWith('.sqlite')) {
      this.databases.push({ name: p, bytes: data });
      this.sources.add('Health Connect');
      return;
    }
    const text = strFromU8(data);
    if (base.endsWith('.json')) {
      if (isFitbitJson(p)) {
        if (parseFitbitJson(p, text, this.acc, this.fitbit, this.activities)) this.sources.add('Fitbit');
        return;
      }
      if (/all sessions\//.test(lower) || /"fitnessactivity"/i.test(text.slice(0, 400))) {
        const a = parseFitSession(text);
        if (a) {
          this.activities.push(a);
          this.sources.add('Google Fit');
        }
        return;
      }
      return; // other JSON (profile, badges, …) ignored
    }
    // CSV
    if (/^profile\.csv$/.test(base) && /fitbit/.test(lower)) {
      parseFitbitProfile(text, this.fitbit);
      return;
    }
    if (/daily (activity metrics|summaries)\.csv$/.test(base)) {
      if (parseFitDailySummary(text, this.fitSummary)) this.sources.add('Google Fit');
      return;
    }
    const day = base.match(/^(\d{4}-\d{2}-\d{2})\.csv$/);
    if (day && /fit\//.test(lower)) {
      if (parseFitIntervals(text, day[1], this.fitIntervals)) this.sources.add('Google Fit');
      return;
    }
    const n = parseGenericCsv(text, this.acc, base.replace(/\.csv$/, ''), this.warnings);
    if (n) {
      this.sources.add(/fitbit/.test(lower) ? 'Fitbit' : 'CSV');
      this.log.push(`${p}: ${n} values`);
    }
  }

  async finish(): Promise<ImportResult> {
    if (this.databases.length) {
      const SQL = await loadSqlJs();
      for (const d of this.databases) {
        try {
          parseHealthConnect(SQL, d.bytes, this.acc, this.activities, this.log);
        } catch (e) {
          this.warnings.push(`${d.name}: could not read database (${(e as Error).message})`);
        }
      }
    }
    finishFitbit(this.fitbit, this.acc, this.warnings);
    // Google Fit daily summary wins; per-day interval files fill any gaps.
    const merged = [...this.acc.points('x')];
    const have = new Set(merged.map((m) => m.id));
    const summary = this.fitSummary.points('x');
    const summaryIds = new Set(summary.map((m) => m.id));
    for (const m of summary) if (!have.has(m.id)) merged.push(m);
    for (const m of this.fitIntervals.points('x')) if (!have.has(m.id) && !summaryIds.has(m.id)) merged.push(m);
    const source = [...this.sources].join(' + ') || 'Import';
    const metrics = merged.map((m) => ({ ...m, source }));
    const seen = new Set<string>();
    const activities = this.activities.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
    if (!metrics.length && !activities.length)
      this.warnings.push('No recognisable health data found. Supported: Google Takeout (Fit or Fitbit), Health Connect export, or a CSV with a date column.');
    return { source, metrics, activities, log: this.log, warnings: this.warnings };
  }
}

async function streamZip(file: File, session: ImportSession, onProgress?: Progress): Promise<void> {
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  const errors: string[] = [];
  unzip.onfile = (f) => {
    if (!ImportSession.wanted(f.name)) return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    f.ondata = (err, chunk, final) => {
      if (err) {
        errors.push(`${f.name}: ${err.message}`);
        return;
      }
      chunks.push(chunk);
      size += chunk.length;
      if (final) {
        const data = new Uint8Array(size);
        let o = 0;
        for (const c of chunks) { data.set(c, o); o += c.length; }
        try {
          session.handle(f.name, data);
        } catch (e) {
          errors.push(`${f.name}: ${(e as Error).message}`);
        }
      }
    };
    f.start();
  };
  const reader = file.stream().getReader();
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      unzip.push(new Uint8Array(0), true);
      break;
    }
    unzip.push(value);
    read += value.length;
    onProgress?.({ file: file.name, fraction: file.size ? read / file.size : 0 });
  }
  if (errors.length) session.warnings.push(...errors.slice(0, 5));
}

export async function importFiles(files: File[], onProgress?: Progress): Promise<ImportResult> {
  const session = new ImportSession();
  for (const f of files) {
    onProgress?.({ file: f.name, fraction: 0, message: `Reading ${f.name}…` });
    if (/\.zip$/i.test(f.name)) await streamZip(f, session, onProgress);
    else session.handle(f.name, new Uint8Array(await f.arrayBuffer()));
    onProgress?.({ file: f.name, fraction: 1 });
  }
  return session.finish();
}
