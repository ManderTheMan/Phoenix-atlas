// CSV export of notes and a plain-text summary for pasting into a message.
import Papa from 'papaparse';
import { STRUCTURE_BY_ID } from '../anatomy/catalog';
import type { Note } from '../db/db';
import { formatDate, toLocalInput } from '../lib/dates';
import { CATEGORY_BY_ID, SENSATION_BY_ID, formatFeeling } from '../lib/feeling';
import { formatMetric, metricDef } from '../health/metrics';
import type { ReportData } from './data';

export function notesToCsv(notes: Note[]): string {
  return Papa.unparse(
    notes.map((n) => ({
      date: toLocalInput(n.date).replace('T', ' '),
      title: n.title,
      type: CATEGORY_BY_ID.get(n.category)?.label ?? n.category,
      feeling: n.feeling,
      intensity: n.intensity ?? '',
      sensations: n.sensations.map((s) => SENSATION_BY_ID.get(s)?.label ?? s).join('; '),
      areas: n.structureIds.map((s) => STRUCTURE_BY_ID.get(s)?.name ?? s).join('; '),
      tags: n.tags.join('; '),
      notes: n.body,
      duration_min: n.workout?.durationMin ?? '',
      rpe: n.workout?.rpe ?? '',
      exercises: (n.workout?.exercises ?? [])
        .map((e) => `${e.name}${e.sets ? ` ${e.sets}x${e.reps ?? ''}` : ''}${e.load !== undefined ? ` @${e.load}${e.unit ?? 'kg'}` : ''}`)
        .join('; '),
      measurements: (n.measurements ?? []).map((m) => `${m.label}=${m.value}${m.unit ?? ''}`).join('; '),
      private: n.private ? 'yes' : '',
    })),
  );
}

export function reportSummaryText(d: ReportData): string {
  const o = d.opts;
  const lines: string[] = [];
  lines.push(`${o.title || 'Body report'} — ${formatDate(o.from)} to ${formatDate(o.to)}`);
  if (o.recipient) lines.push(`For ${o.recipient}`);
  lines.push('');
  lines.push(`• ${d.notes.length} notes, ${d.workouts.length} workouts`);
  if (d.avg !== null) lines.push(`• Average feeling ${formatFeeling(d.avg)}${d.prevAvg !== null ? ` (${formatFeeling(d.avg - d.prevAvg)} vs previous ${d.days} days)` : ''}`);
  if (d.attention.length)
    lines.push(`• Needs attention: ${d.attention.slice(0, 4).map((s) => `${STRUCTURE_BY_ID.get(s.structureId)?.name} (${formatFeeling(s.score)})`).join(', ')}`);
  if (d.improving.length) lines.push(`• Improving: ${d.improving.slice(0, 3).map((s) => STRUCTURE_BY_ID.get(s.structureId)?.name).join(', ')}`);
  if (d.worsening.length) lines.push(`• Getting worse: ${d.worsening.slice(0, 3).map((s) => STRUCTURE_BY_ID.get(s.structureId)?.name).join(', ')}`);
  const keyMetrics = d.metrics.filter((m) => ['sleep_hours', 'resting_hr', 'hrv_ms', 'steps'].includes(m.metric));
  if (keyMetrics.length) lines.push(`• ${keyMetrics.map((m) => `${metricDef(m.metric).label} ${formatMetric(m.metric, m.avg)}`).join(' · ')}`);
  if (o.message.trim()) {
    lines.push('');
    lines.push(o.message.trim());
  }
  return lines.join('\n');
}
