// Small inputs used by the note editor.
import { useMemo, useState } from 'react';
import { STRUCTURE_BY_ID, searchStructures } from '../../anatomy/catalog';
import { LAYER_BY_ID } from '../../anatomy/types';
import type { Note } from '../../db/db';
import { formatShort } from '../../lib/dates';
import { feelingColor, feelingLabel, formatFeeling, normalizeTag } from '../../lib/feeling';
import Icon from '../Icon';

export function FeelingPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const steps = Array.from({ length: 11 }, (_, i) => i - 5);
  return (
    <div className="feel-picker">
      <div className="row between">
        <span className="label">How does it feel?</span>
        <span className="feel-badge">
          <span className="feel-dot" style={{ background: feelingColor(value) }} />
          {formatFeeling(value)} <span className="dim">{feelingLabel(value)}</span>
        </span>
      </div>
      <div className="feel-scale" role="radiogroup" aria-label="Feeling from -5 (severe) to +5 (excellent)">
        {steps.map((v) => (
          <button
            key={v}
            role="radio"
            aria-checked={value === v}
            aria-label={`${formatFeeling(v)} ${feelingLabel(v)}`}
            className={Math.round(value) === v ? 'on' : ''}
            style={{ background: feelingColor(v) }}
            onClick={() => onChange(v)}
          >
            {v > 0 ? `+${v}` : v}
          </button>
        ))}
      </div>
      <div className="feel-ends">
        <span>Severe</span>
        <span>Neutral</span>
        <span>Excellent</span>
      </div>
    </div>
  );
}

export function TagInput({
  value,
  onChange,
  suggestions,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: { tag: string; count: number }[];
}) {
  const [text, setText] = useState('');
  const q = normalizeTag(text);
  const matches = useMemo(
    () => suggestions.filter((s) => !value.includes(s.tag) && (!q || s.tag.includes(q))).slice(0, q ? 8 : 10),
    [suggestions, value, q],
  );
  const add = (t: string) => {
    const n = normalizeTag(t);
    if (n && !value.includes(n)) onChange([...value, n]);
    setText('');
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      {value.length > 0 && (
        <div className="chips">
          {value.map((t) => (
            <button key={t} className="chip tag on" onClick={() => onChange(value.filter((x) => x !== t))} title="Remove tag">
              {t} <span className="x">×</span>
            </button>
          ))}
        </div>
      )}
      <input
        className="input"
        placeholder="Add tags (e.g. left-knee, running, sleep) — Enter to add"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ',') && text.trim()) {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => text.trim() && add(text)}
      />
      {matches.length > 0 && (
        <div className="chips">
          {matches.map((s) => (
            <button key={s.tag} className="chip tag" onMouseDown={(e) => e.preventDefault()} onClick={() => add(s.tag)}>
              {s.tag} <span className="muted">{s.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function StructurePicker({ onPick, exclude = [] }: { onPick: (id: string) => void; exclude?: string[] }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => searchStructures(q, 40).filter((s) => !exclude.includes(s.id)), [q, exclude]);
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row" style={{ position: 'relative' }}>
        <input className="input" placeholder="Search body parts (e.g. left knee, hamstring, L4)…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {q && (
        <div className="picker-results">
          {results.length === 0 && <div className="muted small" style={{ padding: 10 }}>No matches</div>}
          {results.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                onPick(s.id);
                setQ('');
              }}
            >
              <span className="feel-dot" style={{ background: LAYER_BY_ID[s.layer].anatomyColor }} />
              <span className="grow ellipsis">{s.name}</span>
              <span className="muted tiny">{LAYER_BY_ID[s.layer].name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NoteLinkPicker({ notes, exclude, onPick }: { notes: Note[]; exclude: string[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const t = q.toLowerCase().trim();
    if (!t) return [];
    return notes
      .filter((n) => !exclude.includes(n.id))
      .filter((n) => `${n.title} ${n.body} ${n.tags.join(' ')} ${n.structureIds.map((s) => STRUCTURE_BY_ID.get(s)?.name ?? '').join(' ')}`.toLowerCase().includes(t))
      .slice(0, 12);
  }, [q, notes, exclude]);
  return (
    <div className="col" style={{ gap: 6 }}>
      <input className="input" placeholder="Search notes to link…" value={q} onChange={(e) => setQ(e.target.value)} />
      {q && (
        <div className="picker-results">
          {results.length === 0 && <div className="muted small" style={{ padding: 10 }}>No matches</div>}
          {results.map((n) => (
            <button key={n.id} onClick={() => { onPick(n.id); setQ(''); }}>
              <span className="feel-dot" style={{ background: feelingColor(n.feeling) }} />
              <span className="grow ellipsis">{n.title || 'Untitled note'}</span>
              <span className="muted tiny">{formatShort(n.date)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function LocationList({ ids, onRemove }: { ids: { structureId: string; point?: unknown }[]; onRemove?: (i: number) => void }) {
  if (!ids.length) return null;
  return (
    <div className="loc-list">
      {ids.map((l, i) => {
        const def = STRUCTURE_BY_ID.get(l.structureId);
        return (
          <div className="loc-item" key={`${l.structureId}-${i}`}>
            <span className="layer-dot" style={{ background: def ? LAYER_BY_ID[def.layer].anatomyColor : '#888' }} />
            <span className="grow ellipsis">{def?.name ?? l.structureId}</span>
            {l.point ? <span title="Pinned on the model"><Icon name="pin" size={14} /></span> : null}
            {onRemove && (
              <button className="btn ghost icon small" onClick={() => onRemove(i)} aria-label="Remove location">
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
