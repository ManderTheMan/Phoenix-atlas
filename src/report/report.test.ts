import { describe, expect, it } from 'vitest';
import type { MetricPoint, Note } from '../db/db';
import { DAY, dayKey } from '../lib/dates';
import { buildReportData, defaultReportOptions } from './data';
import { notesToCsv, reportSummaryText } from './export';
import { generateReportPdf, pdfText } from './pdf';

const now = Date.now();
const notes: Note[] = Array.from({ length: 12 }, (_, i) => ({
  id: `n${i}`,
  date: now - (11 - i) * 2 * DAY,
  createdAt: 0,
  updatedAt: 0,
  title: i % 3 === 0 ? 'Leg day' : 'Left knee check-in',
  body: 'Felt it on the stairs → better after warm-up.',
  category: i % 3 === 0 ? 'workout' : 'symptom',
  feeling: -4 + i * 0.6,
  sensations: ['ache'],
  tags: ['left-knee', i % 2 ? 'running' : 'strength'],
  locations: [{ structureId: 'muscular.vastus_medialis_muscle_l' }],
  structureIds: ['muscular.vastus_medialis_muscle_l'],
  links: [],
  private: i === 5,
  workout: i % 3 === 0 ? { exercises: [{ name: 'Back squat', sets: 5, reps: 5, load: 100, unit: 'kg' }], durationMin: 60, rpe: 8 } : undefined,
}));
const metrics: MetricPoint[] = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, date: dayKey(now - i * DAY), metric: 'sleep_hours', value: 7 + (i % 3) * 0.3, source: 't' }));

describe('report', () => {
  it('builds data, excluding private notes by default', () => {
    const d = buildReportData(notes, metrics, [], defaultReportOptions(30));
    expect(d.notes.length).toBe(notes.filter((n) => !n.private && n.date >= d.opts.from).length);
    expect(d.notes.some((n) => n.private)).toBe(false);
    expect(d.improving[0]?.structureId).toBe('muscular.vastus_medialis_muscle_l');
    expect(d.metrics[0].metric).toBe('sleep_hours');
    expect(d.colors.has('muscular.vastus_medialis_muscle_l')).toBe(true);
  });

  it('renders a PDF, CSV and a text summary', async () => {
    const d = buildReportData(notes, metrics, [], { ...defaultReportOptions(30), recipient: 'Coach Sam', message: 'Knee is improving — OK to add hills?' });
    const pdf = generateReportPdf(d, {});
    expect(pdf.size).toBeGreaterThan(3000);
    const head = new TextDecoder().decode(new Uint8Array(await pdf.slice(0, 5).arrayBuffer()));
    expect(head).toBe('%PDF-');
    const csv = notesToCsv(d.notes);
    expect(csv.split('\n')[0]).toContain('date,title,type,feeling');
    expect(csv).toContain('Left vastus medialis');
    const txt = reportSummaryText(d);
    expect(txt).toContain('For Coach Sam');
    expect(txt).toContain('Improving: Left vastus medialis');
  });

  it('keeps PDF text Latin-1 safe', () => {
    expect(pdfText('a → b − c “d” ▲')).toBe('a -> b - c "d" +');
  });
});
