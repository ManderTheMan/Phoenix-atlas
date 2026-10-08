// Builds the shareable coach report as a real PDF (A4, vector text and charts).
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { STRUCTURE_BY_ID } from '../anatomy/catalog';
import { LAYER_BY_ID } from '../anatomy/types';
import { formatDate, formatDateTime, formatShort } from '../lib/dates';
import { CATEGORY_BY_ID, SENSATION_BY_ID, feelingLabel, feelingRgb, formatFeeling } from '../lib/feeling';
import { formatMetric, metricDef } from '../health/metrics';
import type { ReportData } from './data';
import { GROUPS } from '../movement/groups';
import { PATTERNS } from '../movement/patterns';

export interface Still {
  src: string;
  /** Pixel size, for the aspect ratio. */
  w: number;
  h: number;
}

export interface Snapshots {
  surface?: [string, string];
  deep?: [string, string];
  media?: {
    progress: { pose: string; then?: Still & { date: number }; now: Still & { date: number }; changes: string }[];
    form: (Still & { title: string; lines: string[] })[];
  };
}

/** jsPDF's built-in fonts are Latin-1 only: swap common symbols for safe ones. */
export function pdfText(s: string): string {
  return s
    .replace(/[→➝]/g, '->')
    .replace(/[←]/g, '<-')
    .replace(/[−–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/▲/g, '+')
    .replace(/▼/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
}

const INK: [number, number, number] = [26, 29, 36];
const MUTED: [number, number, number] = [107, 114, 128];
const LINE: [number, number, number] = [226, 229, 235];
const ACCENT: [number, number, number] = [255, 122, 61];

export function generateReportPdf(d: ReportData, snaps: Snapshots): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 15;
  const CW = W - 2 * M;
  let y = M;
  const o = d.opts;

  const color = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const text = (s: string, x: number, yy: number, opts?: Parameters<typeof doc.text>[3]) => doc.text(pdfText(s), x, yy, opts);
  const space = (h: number) => {
    if (y + h > H - M - 8) {
      doc.addPage();
      y = M;
    }
  };
  /** Section heading; `follow` reserves room so a heading never sits alone at a page end. */
  const heading = (s: string, follow = 24) => {
    space(12 + follow);
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    color(INK);
    text(s, M, y);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(M, y + 2, W - M, y + 2);
    y += 8;
  };
  const dot = (x: number, yy: number, v: number, r = 1.4) => {
    const c = feelingRgb(v);
    doc.setFillColor(c[0], c[1], c[2]);
    doc.circle(x, yy, r, 'F');
  };
  /** Feeling dot inside a table cell, aligned with the cell's first line of text. */
  const cellDot = (c: { section: string; cell: { x: number; y: number; text: string[] } }) => {
    if (c.section !== 'body') return;
    const t = c.cell.text.join('').trim();
    const v = Number(t);
    if (!t || !Number.isFinite(v)) return;
    dot(c.cell.x + 2.6, c.cell.y + 3.4, v, 1.2);
  };
  const lastY = () => (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y;
  const tableStyle = {
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, textColor: INK, lineColor: LINE, lineWidth: 0 },
    headStyles: { fillColor: [246, 247, 249] as [number, number, number], textColor: MUTED, fontStyle: 'bold' as const, fontSize: 7.5 },
    alternateRowStyles: { fillColor: [252, 252, 253] as [number, number, number] },
    margin: { left: M, right: M },
  };

  // ---------------------------------------------------------------- header
  doc.setFillColor(...ACCENT);
  doc.roundedRect(M, y - 4, 5, 5, 1, 1, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  color(MUTED);
  text('PHOENIX ATLAS', M + 7, y);
  text(`Generated ${formatDateTime(Date.now())}`, W - M, y, { align: 'right' });
  y += 10;
  doc.setFontSize(20);
  color(INK);
  text(o.title || 'Body report', M, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  color(MUTED);
  const sub = [`${formatDate(o.from)} - ${formatDate(o.to)} (${d.days} days)`];
  if (o.recipient) sub.push(`Prepared for ${o.recipient}`);
  if (o.author) sub.push(`From ${o.author}`);
  text(sub.join('   ·   '), M, y);
  y += 4;

  // ---------------------------------------------------------------- summary
  if (o.sections.summary) {
    heading('Summary');
    const boxes: [string, string, string][] = [
      ['Notes logged', String(d.notes.length), `${d.prevNotes.length} in previous period`],
      [
        'Average feeling',
        d.avg !== null ? formatFeeling(d.avg) : '-',
        d.avg !== null && d.prevAvg !== null ? `${formatFeeling(d.avg - d.prevAvg)} vs previous period` : d.avg !== null ? feelingLabel(d.avg) : '',
      ],
      ['Workouts', String(d.workouts.length), `${(d.workouts.length / (d.days / 7)).toFixed(1)} per week`],
      ['Body areas', String(d.areas.length), d.areas[0] ? `most: ${STRUCTURE_BY_ID.get(d.areas[0].structureId)?.name ?? ''}` : ''],
    ];
    const bw = (CW - 9) / 4;
    boxes.forEach(([k, v, s], i) => {
      const x = M + i * (bw + 3);
      doc.setDrawColor(...LINE);
      doc.setFillColor(250, 250, 251);
      doc.roundedRect(x, y, bw, 22, 2, 2, 'FD');
      doc.setFontSize(7.5);
      color(MUTED);
      text(k.toUpperCase(), x + 3, y + 5);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      color(INK);
      text(v, x + 3, y + 13);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      color(MUTED);
      text(doc.splitTextToSize(pdfText(s), bw - 6)[0] ?? '', x + 3, y + 18.5);
    });
    y += 28;

    const col = (title: string, rows: { name: string; v: number; extra: string }[], x: number, w: number) => {
      let yy = y;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      color(INK);
      text(title, x, yy);
      yy += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      if (!rows.length) {
        color(MUTED);
        text('None in this period', x, yy);
        yy += 5;
      }
      for (const r of rows) {
        dot(x + 1.4, yy - 1.2, r.v);
        color(INK);
        text(doc.splitTextToSize(pdfText(r.name), w - 32)[0], x + 4.5, yy);
        color(MUTED);
        text(r.extra, x + w, yy, { align: 'right' });
        yy += 5;
      }
      return yy;
    };
    space(40);
    const half = (CW - 8) / 2;
    const y1 = col(
      'Needs attention',
      d.attention.map((s) => ({ name: STRUCTURE_BY_ID.get(s.structureId)?.name ?? s.structureId, v: s.score, extra: `${formatFeeling(s.score)} · ${s.count} note${s.count === 1 ? '' : 's'}` })),
      M,
      half,
    );
    const changes = [
      ...d.improving.slice(0, 3).map((s) => ({ name: STRUCTURE_BY_ID.get(s.structureId)?.name ?? '', v: s.latest, extra: `improving ${formatFeeling(s.slopePerWeek!)}/wk` })),
      ...d.worsening.slice(0, 3).map((s) => ({ name: STRUCTURE_BY_ID.get(s.structureId)?.name ?? '', v: s.latest, extra: `worse ${formatFeeling(s.slopePerWeek!)}/wk` })),
    ];
    const y2 = col('Changes over the period', changes, M + half + 8, half);
    y = Math.max(y1, y2) + 2;
  }

  if (o.message.trim()) {
    space(20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    const lines = doc.splitTextToSize(pdfText(o.message.trim()), CW - 10);
    const h = lines.length * 4.4 + 10;
    space(h);
    doc.setFillColor(255, 246, 240);
    doc.setDrawColor(255, 205, 180);
    doc.roundedRect(M, y, CW, h, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    color([180, 80, 30]);
    text('NOTE FOR MY COACH', M + 5, y + 5.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    color(INK);
    doc.text(lines, M + 5, y + 10.5);
    y += h + 4;
  }

  // ---------------------------------------------------------------- body map
  if (o.sections.bodyMap && (snaps.surface || snaps.deep)) {
    heading('Body map', 90);
    const imgs: { src: string; cap: string }[] = [];
    if (snaps.surface) imgs.push({ src: snaps.surface[0], cap: 'Front' }, { src: snaps.surface[1], cap: 'Back' });
    if (snaps.deep) imgs.push({ src: snaps.deep[0], cap: 'Deep layers - front' }, { src: snaps.deep[1], cap: 'Deep layers - back' });
    const n = imgs.length;
    const gap = 4;
    const iw = n > 2 ? (CW - gap * (n - 1)) / n : 58;
    const ih = iw * (860 / 520);
    space(ih + 16);
    const startX = n > 2 ? M : M + (CW - (iw * n + gap * (n - 1))) / 2;
    imgs.forEach((im, i) => {
      const x = startX + i * (iw + gap);
      doc.addImage(im.src, 'PNG', x, y, iw, ih, undefined, 'FAST');
      doc.setFontSize(8);
      color(MUTED);
      text(im.cap, x + iw / 2, y + ih + 4, { align: 'center' });
    });
    y += ih + 8;
    // legend
    const lw = 70, lx = M + (CW - lw) / 2;
    for (let i = 0; i < 50; i++) {
      const c = feelingRgb(-5 + (10 * i) / 49);
      doc.setFillColor(c[0], c[1], c[2]);
      doc.rect(lx + (i * lw) / 50, y, lw / 50 + 0.05, 2.5, 'F');
    }
    doc.setFontSize(7.5);
    color(MUTED);
    text('-5 severe', lx - 2, y + 2.2, { align: 'right' });
    text('+5 excellent', lx + lw + 2, y + 2.2);
    y += 5;
    text('Colour = recency-weighted average feeling for each area over the period. Dots mark individual notes.', W / 2, y + 2, { align: 'center' });
    y += 6;
  }

  // ---------------------------------------------------------------- trend chart
  if (o.sections.trend && d.daily.length) {
    const ch = 50;
    heading('Feeling over time', ch + 14);
    space(ch + 12);
    const x0 = M + 10, x1 = W - M, y0 = y, y1 = y + ch;
    const tMin = d.opts.from, tMax = d.opts.to;
    const sx = (t: number) => x0 + ((t - tMin) / (tMax - tMin)) * (x1 - x0);
    const sy = (v: number) => y0 + ((5 - v) / 10) * (y1 - y0);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.setFontSize(7);
    color(MUTED);
    for (const v of [-5, -2.5, 0, 2.5, 5]) {
      doc.line(x0, sy(v), x1, sy(v));
      text(formatFeeling(v), x0 - 2, sy(v) + 1, { align: 'right' });
    }
    doc.setDrawColor(150, 156, 168);
    doc.setLineWidth(0.4);
    doc.line(x0, sy(0), x1, sy(0));
    const ticks = 6;
    for (let i = 0; i <= ticks; i++) {
      const t = tMin + ((tMax - tMin) * i) / ticks;
      text(formatShort(t), sx(t), y1 + 4.5, { align: 'center' });
    }
    if (d.rolling.length > 1) {
      doc.setDrawColor(90, 98, 115);
      doc.setLineWidth(0.6);
      for (let i = 1; i < d.rolling.length; i++) doc.line(sx(d.rolling[i - 1].x), sy(d.rolling[i - 1].y), sx(d.rolling[i].x), sy(d.rolling[i].y));
    }
    for (const p of d.daily) {
      doc.setFillColor(255, 255, 255);
      doc.circle(sx(p.x), sy(p.y), 1.2, 'F');
      dot(sx(p.x), sy(p.y), p.y, 0.95);
    }
    y = y1 + 8;
    doc.setFontSize(7.5);
    color(MUTED);
    text('Dots: average feeling of each day\'s notes. Line: 7-day average.', M, y);
    y += 4;
  }

  // ---------------------------------------------------------------- areas table
  if (o.sections.areas && d.areas.length) {
    heading('Body areas');
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [['Area', 'Layer', 'Notes', 'Average', 'First', 'Latest', 'Trend / week']],
      body: d.areas.slice(0, 40).map((s) => {
        const def = STRUCTURE_BY_ID.get(s.structureId);
        return [
          pdfText(def?.name ?? s.structureId),
          def ? LAYER_BY_ID[def.layer].name : '',
          String(s.count),
          `   ${formatFeeling(s.mean)}`,
          `   ${formatFeeling(s.first)}`,
          `   ${formatFeeling(s.latest)}`,
          s.slopePerWeek === null ? '-' : Math.abs(s.slopePerWeek) < 0.15 ? 'stable' : `${formatFeeling(s.slopePerWeek)} ${s.slopePerWeek > 0 ? '(better)' : '(worse)'}`,
        ];
      }),
      columnStyles: { 2: { halign: 'right' } },
      didDrawCell: (c) => {
        if (c.column.index >= 3 && c.column.index <= 5) cellDot(c);
      },
    });
    y = lastY() + 4;
  }

  // ---------------------------------------------------------------- health metrics
  if (o.sections.metrics && d.metrics.length) {
    heading('Health data');
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [['Metric', 'Daily average', 'Range', 'Days', 'Previous period', 'Change']],
      body: d.metrics.map((m) => {
        const change = m.prevAvg ? (m.avg - m.prevAvg) / Math.abs(m.prevAvg) : null;
        return [
          pdfText(metricDef(m.metric).label),
          formatMetric(m.metric, m.avg),
          `${formatMetric(m.metric, m.min)} - ${formatMetric(m.metric, m.max)}`,
          String(m.days),
          m.prevAvg !== null ? formatMetric(m.metric, m.prevAvg) : '-',
          change === null ? '-' : `${change >= 0 ? '+' : ''}${(change * 100).toFixed(0)}%`,
        ];
      }),
      columnStyles: { 3: { halign: 'right' }, 5: { halign: 'right' } },
    });
    y = lastY() + 4;
  }

  // ---------------------------------------------------------------- workouts
  if (o.sections.workouts && (d.workouts.length || d.activities.length)) {
    heading('Training');
    const rows = d.workouts.map((n) => [
      formatShort(n.date),
      pdfText(n.title || 'Workout'),
      n.workout?.durationMin ? `${n.workout.durationMin} min` : '',
      n.workout?.rpe ? String(n.workout.rpe) : '',
      `   ${formatFeeling(n.feeling)}`,
      pdfText(
        (n.workout?.exercises ?? [])
          .map((e) => `${e.name}${e.sets ? ` ${e.sets}x${e.reps ?? ''}` : ''}${e.load !== undefined ? ` @${e.load}${e.unit ?? 'kg'}` : ''}${e.distanceKm ? ` ${e.distanceKm}km` : ''}`)
          .join('; '),
      ),
    ]);
    // device sessions already covered by a logged workout (same id, or within 3 h) are not repeated
    const logged = new Set(d.workouts.map((n) => n.sourceId).filter(Boolean));
    for (const a of d.activities) {
      if (logged.has(a.id) || d.workouts.some((n) => Math.abs(n.date - a.start) < 3 * 3600_000)) continue;
      rows.push([
        formatShort(a.start),
        pdfText(`${a.name} (${a.source})`),
        `${a.durationMin} min`,
        '',
        '',
        [a.distanceKm ? `${a.distanceKm} km` : '', a.calories ? `${a.calories} kcal` : '', a.avgHr ? `avg HR ${a.avgHr}` : ''].filter(Boolean).join(' · '),
      ]);
    }
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [['Date', 'Session', 'Duration', 'RPE', 'Feeling', 'Details']],
      body: rows,
      columnStyles: { 0: { cellWidth: 16 }, 1: { cellWidth: 34 }, 2: { cellWidth: 18 }, 3: { cellWidth: 10, halign: 'right' }, 4: { cellWidth: 16 }, 5: { cellWidth: 'auto' } },
      didDrawCell: (c) => {
        if (c.column.index === 4) cellDot(c);
      },
    });
    y = lastY() + 4;
  }

  // ---------------------------------------------------------------- movement patterns
  const tr = d.training;
  if (o.sections.movement && tr.sessions > 0) {
    heading('Movement patterns', 40);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    color(MUTED);
    text(`Average sets per week over ${tr.weeks} week${tr.weeks === 1 ? '' : 's'}. Muscle groups: a prime mover counts a full set, a synergist half, a stabiliser a quarter.`, M, y);
    y += 4;
    const fmt = (v: number | null) => (v === null ? '-' : v === Infinity ? 'one side only' : `${v.toFixed(1)} : 1`);
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [['Balance', 'Ratio', 'Balance', 'Ratio']],
      body: [
        ['Push : pull', fmt(tr.balance.pushPull), 'Knee : hip dominant', fmt(tr.balance.kneeHip)],
        ['Horizontal push : pull', fmt(tr.balance.horizontal), 'Vertical push : pull', fmt(tr.balance.vertical)],
      ],
    });
    y = lastY() + 3;
    const patterns = PATTERNS.filter((p) => tr.patternPerWeek[p.id] > 0);
    const groups = GROUPS.filter((g) => tr.groupPerWeek[g.id] >= 0.5).sort((a, b) => tr.groupPerWeek[b.id] - tr.groupPerWeek[a.id]);
    const rows = Math.max(patterns.length, Math.min(groups.length, 12));
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [['Pattern', 'Per week', 'Muscle group', 'Sets / week', 'Feeling']],
      body: Array.from({ length: rows }, (_, i) => {
        const p = patterns[i], g = groups[i];
        const f = g ? tr.groupFeeling[g.id] : undefined;
        return [
          p ? pdfText(p.name) : '',
          p ? `${tr.patternPerWeek[p.id].toFixed(1)}${p.id === 'gait' ? ' runs' : ' sets'}` : '',
          g ? pdfText(g.name) : '',
          g ? tr.groupPerWeek[g.id].toFixed(1) : '',
          f ? `   ${formatFeeling(f.score)}` : '',
        ];
      }),
      columnStyles: { 1: { halign: 'right' }, 3: { halign: 'right' } },
      didDrawCell: (c) => {
        if (c.column.index === 4) cellDot(c);
      },
    });
    y = lastY() + 3;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    for (const ins of tr.insights) {
      const lines = doc.splitTextToSize(pdfText(`- ${ins.text}`), CW);
      space(lines.length * 4.2 + 1);
      color(ins.tone === 'warn' ? [180, 80, 30] : INK);
      doc.text(lines, M, y + 3);
      y += lines.length * 4.2 + 1;
    }
    y += 2;
  }

  // ---------------------------------------------------------------- photos and form checks
  const sm = snaps.media;
  if (o.sections.media && sm && (sm.progress.length || sm.form.length)) {
    heading('Progress photos & form checks', 90);
    const caption = (s: string, x: number, yy: number, align: 'left' | 'center' = 'center') => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      color(MUTED);
      text(s, x, yy, { align });
    };
    for (const p of sm.progress) {
      const imgs = [p.then, p.now].filter(Boolean) as (Still & { date: number })[];
      const ih = 74;
      const ws = imgs.map((im) => Math.min(80, (ih * im.w) / im.h));
      const gap = 6;
      const total = ws.reduce((s, w) => s + w, 0) + gap * (ws.length - 1);
      space(ih + 18);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      color(INK);
      text(p.pose, M, y + 3);
      y += 6;
      let x = M + (CW - total) / 2;
      imgs.forEach((im, i) => {
        const w = ws[i], h = (w * im.h) / im.w;
        doc.addImage(im.src, 'JPEG', x, y + (ih - h) / 2, w, h, undefined, 'FAST');
        caption(`${imgs.length > 1 ? (i === 0 ? 'Then' : 'Now') + ' - ' : ''}${formatDate(im.date)}`, x + w / 2, y + ih + 4);
        x += w + gap;
      });
      y += ih + 7;
      if (p.changes) {
        doc.setFontSize(8);
        const lines: string[] = doc.splitTextToSize(pdfText(p.changes), CW - 20);
        lines.forEach((l, k) => caption(l, W / 2, y + 1 + k * 3.6));
        y += lines.length * 3.6 + 1.5;
      }
      y += 2;
    }
    if (sm.form.length) {
      space(40);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      color(INK);
      text('Form checks', M, y + 3);
      y += 6;
      const cols = 3, gap = 5, cw = (CW - gap * (cols - 1)) / cols;
      for (let r = 0; r < sm.form.length; r += cols) {
        const row = sm.form.slice(r, r + cols);
        const hs = row.map((im) => Math.min(78, (cw * im.h) / im.w));
        const rh = Math.max(...hs);
        const lines = Math.max(...row.map((im) => im.lines.length));
        space(rh + 10 + lines * 3.6);
        row.forEach((im, i) => {
          const x0 = M + i * (cw + gap);
          const h = hs[i], w = (h * im.w) / im.h;
          doc.addImage(im.src, 'JPEG', x0 + (cw - w) / 2, y, w, h, undefined, 'FAST');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8.5);
          color(INK);
          text(im.title, x0, y + rh + 4);
          im.lines.forEach((l, k) => caption(l, x0, y + rh + 7.6 + k * 3.6, 'left'));
        });
        y += rh + 10 + lines * 3.6;
      }
    }
    y += 2;
  }

  // ---------------------------------------------------------------- notes
  if (o.sections.notes && d.notes.length) {
    heading(`Notes (${d.notes.length})`);
    if (o.notesDetail === 'brief') {
      autoTable(doc, {
        ...tableStyle,
        startY: y,
        head: [['Date', 'Type', 'Title', 'Feeling', 'Where']],
        body: d.notes.map((n) => [
          formatShort(n.date),
          CATEGORY_BY_ID.get(n.category)?.label ?? n.category,
          pdfText(n.title || n.body.slice(0, 60)),
          `   ${formatFeeling(n.feeling)}`,
          pdfText(n.structureIds.map((s) => STRUCTURE_BY_ID.get(s)?.name ?? s).join(', ') || 'Whole body'),
        ]),
        columnStyles: { 0: { cellWidth: 16 }, 1: { cellWidth: 22 }, 3: { cellWidth: 16 } },
        didDrawCell: (c) => {
          if (c.column.index === 3) cellDot(c);
        },
      });
      y = lastY() + 4;
    } else {
      for (const n of d.notes) {
        doc.setFontSize(9);
        const where = n.structureIds.map((s) => STRUCTURE_BY_ID.get(s)?.name ?? s).join(', ') || 'Whole body';
        const meta = [
          where,
          n.sensations.map((s) => SENSATION_BY_ID.get(s)?.label ?? s).join(', '),
          n.intensity !== undefined ? `intensity ${n.intensity}/10` : '',
          n.tags.filter((t) => t !== 'demo').map((t) => `#${t}`).join(' '),
        ].filter(Boolean).join('  ·  ');
        const metaLines = doc.splitTextToSize(pdfText(meta), CW - 8);
        const bodyLines = n.body ? doc.splitTextToSize(pdfText(n.body), CW - 8) : [];
        const extras: string[] = [];
        if (n.workout?.exercises.length)
          extras.push(
            'Exercises: ' +
              n.workout.exercises
                .map((e) => `${e.name}${e.sets ? ` ${e.sets}x${e.reps ?? ''}` : ''}${e.load !== undefined ? ` @${e.load}${e.unit ?? 'kg'}` : ''}${e.distanceKm ? ` ${e.distanceKm}km` : ''}`)
                .join('; '),
          );
        if (n.measurements?.length) extras.push('Measurements: ' + n.measurements.map((m) => `${m.label} ${m.value}${m.unit ?? ''}`).join(', '));
        const extraLines = extras.flatMap((e) => doc.splitTextToSize(pdfText(e), CW - 8));
        const h = 6 + metaLines.length * 3.8 + bodyLines.length * 4 + extraLines.length * 3.8 + 3;
        space(h);
        const c = feelingRgb(n.feeling);
        doc.setFillColor(c[0], c[1], c[2]);
        doc.rect(M, y - 3.5, 1.2, h - 2, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        color(INK);
        text(n.title || CATEGORY_BY_ID.get(n.category)?.label || 'Note', M + 4, y);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        color(MUTED);
        text(`${formatDateTime(n.date)}  ·  ${CATEGORY_BY_ID.get(n.category)?.label ?? ''}  ·  feeling ${formatFeeling(n.feeling)} (${feelingLabel(n.feeling)})`, W - M, y, { align: 'right' });
        y += 4.5;
        doc.setFontSize(8);
        doc.text(metaLines, M + 4, y);
        y += metaLines.length * 3.8;
        if (bodyLines.length) {
          doc.setFontSize(9);
          color(INK);
          y += 0.8;
          doc.text(bodyLines, M + 4, y);
          y += bodyLines.length * 4;
        }
        if (extraLines.length) {
          doc.setFontSize(8);
          color(MUTED);
          doc.text(extraLines, M + 4, y);
          y += extraLines.length * 3.8;
        }
        y += 4;
      }
    }
  }

  // ---------------------------------------------------------------- footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    color(MUTED);
    text(`Phoenix Atlas  ·  ${o.title || 'Body report'}`, M, H - 8);
    text(`Page ${p} of ${pages}`, W - M, H - 8, { align: 'right' });
    if (p === pages) text('Self-reported tracking data, not a medical record.', W / 2, H - 8, { align: 'center' });
  }
  return doc.output('blob');
}
