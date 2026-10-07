import { useEffect, useMemo, useRef, useState } from 'react';
import type { Note } from '../../db/db';
import { DAY, formatDate, startOfDay } from '../../lib/dates';
import { feelingColor } from '../../lib/feeling';
import { useUI } from '../../state/ui';
import { Seg } from '../common';
import Icon from '../Icon';

const WINDOWS = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: 365, label: '1y' },
  { value: 0, label: 'All' },
];

export function Legend() {
  const mode = useUI((s) => s.colorMode);
  if (mode === 'anatomy') return <div className="legend">Natural colours</div>;
  if (mode === 'activity')
    return (
      <div className="legend">
        <span>Few</span>
        <span className="legend-bar" style={{ background: 'linear-gradient(90deg,#48345c,#b03a5e,#f46d43,#fdc45c)' }} />
        <span>Many notes</span>
      </div>
    );
  return (
    <div className="legend">
      <span>{mode === 'trend' ? 'Worse' : 'Bad'}</span>
      <span className="legend-bar" />
      <span>{mode === 'trend' ? 'Better' : 'Good'}</span>
    </div>
  );
}

export default function TimeBar({ notes }: { notes: Note[] }) {
  const ui = useUI();
  const now = Date.now();
  const minDate = useMemo(() => {
    const m = notes.length ? Math.min(...notes.map((n) => n.date)) : now - 30 * DAY;
    return startOfDay(Math.min(m, now - 7 * DAY));
  }, [notes, now]);
  const at = ui.atDate ?? now;
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number>(0);

  useEffect(() => {
    if (!playing) return;
    const span = now - minDate;
    const duration = Math.min(14000, Math.max(5000, (span / DAY) * 60));
    let start: number | null = null;
    const from = ui.atDate && ui.atDate < now - DAY ? ui.atDate : minDate;
    const step = (t: number) => {
      if (start === null) start = t;
      const k = Math.min(1, (t - start) / (duration * (1 - (from - minDate) / span)));
      const v = from + (now - from) * k;
      ui.set({ atDate: k >= 1 ? null : v });
      if (k < 1) raf.current = requestAnimationFrame(step);
      else setPlaying(false);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const span = Math.max(DAY, now - minDate);
  const ticks = useMemo(() => {
    // one tick per day with notes, coloured by that day's mean feeling
    const m = new Map<number, { s: number; c: number }>();
    for (const n of notes) {
      const d = startOfDay(n.date);
      const e = m.get(d) ?? { s: 0, c: 0 };
      e.s += n.feeling;
      e.c++;
      m.set(d, e);
    }
    return [...m.entries()].map(([d, e]) => ({ pos: (d + DAY / 2 - minDate) / span, color: feelingColor(e.s / e.c) }));
  }, [notes, minDate, span]);

  const live = ui.atDate === null;
  return (
    <div className="overlay time-bar">
      <div className="top">
        <button className="btn icon small" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause playback' : 'Play changes over time'} title="Play how your body changed over time">
          <Icon name={playing ? 'pause' : 'play'} size={15} />
        </button>
        <div className="col" style={{ gap: 0 }}>
          <span className="date">{live ? 'Now' : formatDate(at)}</span>
          <span className="tiny muted">
            {ui.windowDays ? `Showing the ${ui.windowDays} days up to this date` : 'Showing all notes up to this date'}
          </span>
        </div>
        <div className="grow" />
        <Seg value={ui.windowDays} onChange={(v) => ui.set({ windowDays: v })} options={WINDOWS} label="Time window" />
        {!live && (
          <button className="btn small" onClick={() => ui.set({ atDate: null })}>
            Back to now
          </button>
        )}
        <Legend />
      </div>
      <input
        type="range"
        min={minDate}
        max={now}
        step={DAY / 4}
        value={at}
        onChange={(e) => {
          const v = Number(e.target.value);
          ui.set({ atDate: v >= now - DAY / 4 ? null : v });
        }}
        aria-label="Date"
      />
      <div className="time-ticks" aria-hidden>
        {ticks.map((t, i) => (
          <span key={i} style={{ left: `${t.pos * 100}%`, background: t.color }} />
        ))}
      </div>
    </div>
  );
}
