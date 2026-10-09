// Reading a 3D body scan report (PDF) into a dated measurement entry. Written
// for Styku's summary report, and tolerant of similar "label value" layouts.
// The PDF is read on this device and isn't kept; neither are the name, email
// or location printed on it. Only the measurements are saved.
import { MEASURE_BY_KEY, type MeasureKey } from './profile';

export interface ScanDetail {
  label: string;
  value: number;
  unit: string;
}

export interface ScanReport {
  date: number | null;
  /** Units printed on the report (values below are always cm, kg and %). */
  units: 'imperial' | 'metric';
  values: Partial<Record<MeasureKey, number>>;
  /** Everything else measured, by label. */
  extra: Record<string, ScanDetail>;
  /** Values that didn't make sense and were left out. */
  warnings: string[];
}

/** Report labels that match the profile's measurements (lower case). */
const KEYS: Record<string, MeasureKey> = {
  neck: 'neck',
  chest: 'chest',
  'waist (abdominal)': 'waist',
  waist: 'waist',
  hip: 'hips',
  hips: 'hips',
  'bicep left': 'armL',
  'bicep right': 'armR',
  'forearm left': 'forearmL',
  'forearm right': 'forearmR',
  'mid-thigh left': 'thighL',
  'mid-thigh right': 'thighR',
  'calf left': 'calfL',
  'calf right': 'calfR',
  'body fat %': 'bodyFat',
  'body fat': 'bodyFat',
};

const LINE = /^([A-Za-z][A-Za-z0-9 ()\-%/&.']*?)\s+(-?\d+(?:\.\d+)?)\s*(%|lbs?|kg|in|cm)?$/;
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Parses the text of a report: pages of lines, as read from the PDF. Null when it doesn't look like a scan report. */
export function parseScanText(pages: string[][]): ScanReport | null {
  const all = pages.flat();
  const text = all.join('\n');
  const header = all.find((l) => /body measurements/i.test(l)) ?? '';
  const units: ScanReport['units'] = /\(\s*kg\s*,\s*cm\s*\)/i.test(header) || (!/lbs|\bin\b/i.test(header) && /\bcm\b/.test(text) && !/\blbs\b/.test(text)) ? 'metric' : 'imperial';
  const len = (v: number) => (units === 'imperial' ? v * 2.54 : v);
  const mass = (v: number) => (units === 'imperial' ? v * 0.45359237 : v);
  const out: ScanReport = { date: null, units, values: {}, extra: {}, warnings: [] };

  const put = (key: MeasureKey, v: number, label: string) => {
    const def = MEASURE_BY_KEY.get(key)!;
    if (v < def.min || v > def.max) out.warnings.push(`${label} ${r1(v)} ${def.unit} is outside the usual range, so it was left out.`);
    else if (out.values[key] === undefined) out.values[key] = r1(v);
  };

  // the measurements page: one "label value" per line
  const start = header ? all.indexOf(header) + 1 : 0;
  for (const line of all.slice(start)) {
    const m = LINE.exec(line.trim());
    if (!m) continue;
    const label = m[1].trim(), raw = Number(m[2]), low = label.toLowerCase();
    if (!Number.isFinite(raw)) continue;
    const key = KEYS[low];
    if (key === 'bodyFat') put(key, raw, label);
    else if (key) put(key, len(raw), label);
    else if (/%/.test(label) || m[3] === '%') out.extra[label] = { label, value: r1(raw), unit: '%' };
    else if (/mass|weight/i.test(label)) out.extra[label] = { label, value: r1(mass(raw)), unit: 'kg' };
    else out.extra[label] = { label, value: r1(len(raw)), unit: 'cm' };
  }

  // the summary page: height, weight, date and metabolic rate sit among other text
  const hw = /Height\s*&\s*Weight\s+(\d+)\s*ft\s*(\d+(?:\.\d+)?)\s*in\s*&\s*(\d+(?:\.\d+)?)\s*lbs/i.exec(text);
  const hwMetric = /Height\s*&\s*Weight\s+(\d+(?:\.\d+)?)\s*cm\s*&\s*(\d+(?:\.\d+)?)\s*kg/i.exec(text);
  if (hw) {
    put('height', (Number(hw[1]) * 12 + Number(hw[2])) * 2.54, 'Height');
    put('weight', Number(hw[3]) * 0.45359237, 'Weight');
  } else if (hwMetric) {
    put('height', Number(hwMetric[1]), 'Height');
    put('weight', Number(hwMetric[2]), 'Weight');
  }
  if (out.values.bodyFat === undefined) {
    const bf = /Body Fat %\s+(\d+(?:\.\d+)?)\s*%/i.exec(text);
    if (bf) put('bodyFat', Number(bf[1]), 'Body fat');
  }
  const bmr = /\bBMR\s+(\d+(?:\.\d+)?)/i.exec(text);
  if (bmr) out.extra.BMR = { label: 'BMR', value: Number(bmr[1]), unit: 'kcal/day' };
  const d = /Scan Date\s+(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i.exec(text);
  if (d) {
    let [mo, day] = [Number(d[1]), Number(d[2])];
    if (mo > 12) [mo, day] = [day, mo]; // day/month order
    let h = Number(d[4] ?? 12);
    if (d[7]?.toUpperCase() === 'PM' && h < 12) h += 12;
    if (d[7]?.toUpperCase() === 'AM' && h === 12) h = 0;
    const t = new Date(Number(d[3]), mo - 1, day, h, Number(d[5] ?? 0), Number(d[6] ?? 0)).getTime();
    if (Number.isFinite(t)) out.date = t;
  }
  return Object.keys(out.values).length >= 3 ? out : null;
}

/** The text of a PDF on this device, as pages of lines (pdf.js, loaded only when needed). */
export async function readPdfLines(file: Blob): Promise<string[][]> {
  // the "legacy" build carries fallbacks for features older phones lack (pdf.js 6 uses very new JavaScript)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: string[][] = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, 12); p++) {
      const content = await (await doc.getPage(p)).getTextContent();
      const rows: { y: number; items: { x: number; s: string }[] }[] = [];
      for (const it of content.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        const y = it.transform[5], x = it.transform[4];
        let row = rows.find((r) => Math.abs(r.y - y) <= 2);
        if (!row) rows.push((row = { y, items: [] }));
        row.items.push({ x, s: it.str.trim() });
      }
      pages.push(rows.sort((a, b) => b.y - a.y).map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ')));
    }
  } finally {
    void task.destroy();
  }
  return pages;
}
