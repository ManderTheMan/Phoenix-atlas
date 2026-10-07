import { useEffect, useMemo, useState } from 'react';
import { STRUCTURE_BY_ID } from '../anatomy/catalog';
import { Empty, Seg } from '../components/common';
import Icon from '../components/Icon';
import NoteCard from '../components/notes/NoteCard';
import { emptyDraft } from '../db/notes';
import { useNotesLoaded, useTagCounts } from '../hooks/useData';
import { DAY, relativeDay, startOfDay } from '../lib/dates';
import { CATEGORIES, SENSATION_BY_ID, type CategoryId } from '../lib/feeling';
import { useUI } from '../state/ui';

type FeelFilter = 'all' | 'neg' | 'pos';

export default function JournalPage() {
  const ui = useUI();
  const { notes, loaded } = useNotesLoaded();
  const tagCounts = useTagCounts(notes);
  const [q, setQ] = useState('');
  const [cats, setCats] = useState<CategoryId[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [structureId, setStructureId] = useState<string | null>(null);
  const [range, setRange] = useState(0);
  const [feel, setFeel] = useState<FeelFilter>('all');

  // filters handed over from other pages (tag chips, "open in journal")
  useEffect(() => {
    const f = ui.journalFilter;
    if (!f) return;
    if (f.tag) setTags([f.tag]);
    if (f.structureId) setStructureId(f.structureId);
    if (f.q) setQ(f.q);
    ui.showJournal(null);
    ui.setRoute('journal');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.journalFilter]);

  const filtered = useMemo(() => {
    const t = q.toLowerCase().trim();
    const from = range ? Date.now() - range * DAY : -Infinity;
    return notes.filter((n) => {
      if (n.date < from) return false;
      if (cats.length && !cats.includes(n.category)) return false;
      if (tags.length && !tags.every((tg) => n.tags.includes(tg))) return false;
      if (structureId && !n.structureIds.includes(structureId)) return false;
      if (feel === 'neg' && n.feeling >= 0) return false;
      if (feel === 'pos' && n.feeling <= 0) return false;
      if (t) {
        const hay = `${n.title} ${n.body} ${n.tags.join(' ')} ${n.sensations.map((s) => SENSATION_BY_ID.get(s)?.label).join(' ')} ${n.structureIds
          .map((s) => STRUCTURE_BY_ID.get(s)?.name)
          .join(' ')} ${n.workout?.exercises.map((e) => e.name).join(' ') ?? ''}`.toLowerCase();
        if (!hay.includes(t)) return false;
      }
      return true;
    });
  }, [notes, q, cats, tags, structureId, range, feel]);

  const groups = useMemo(() => {
    const out: { day: number; notes: typeof filtered }[] = [];
    for (const n of filtered) {
      const d = startOfDay(n.date);
      const last = out[out.length - 1];
      if (last && last.day === d) last.notes.push(n);
      else out.push({ day: d, notes: [n] });
    }
    return out;
  }, [filtered]);

  const anyFilter = q || cats.length || tags.length || structureId || range || feel !== 'all';

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Journal</h1>
            <p>Every note, newest first. Notes that share tags or follow-ups are linked.</p>
          </div>
          <button className="btn primary" onClick={() => ui.setDraft(emptyDraft())}>
            <Icon name="plus" /> New note
          </button>
        </div>

        <div className="card col" style={{ gap: 12 }}>
          <div className="row wrap">
            <div className="grow" style={{ minWidth: 200 }}>
              <input className="input" placeholder="Search notes, exercises, body parts…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notes" />
            </div>
            <Seg
              value={range}
              onChange={setRange}
              label="Date range"
              options={[
                { value: 7, label: '7d' },
                { value: 30, label: '30d' },
                { value: 90, label: '90d' },
                { value: 0, label: 'All' },
              ]}
            />
            <Seg
              value={feel}
              onChange={setFeel}
              label="Feeling"
              options={[
                { value: 'all', label: 'Any feeling' },
                { value: 'neg', label: 'Negative' },
                { value: 'pos', label: 'Positive' },
              ]}
            />
          </div>
          <div className="chips">
            {CATEGORIES.map((c) => (
              <button key={c.id} className={`chip ${cats.includes(c.id) ? 'on' : ''}`} onClick={() => setCats((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))}>
                <span style={{ color: c.color }}>{c.icon}</span> {c.label}
              </button>
            ))}
          </div>
          {tagCounts.length > 0 && (
            <div className="chips">
              {tagCounts.slice(0, 24).map((t) => (
                <button key={t.tag} className={`chip tag ${tags.includes(t.tag) ? 'on' : ''}`} onClick={() => setTags((s) => (s.includes(t.tag) ? s.filter((x) => x !== t.tag) : [...s, t.tag]))}>
                  {t.tag} <span className="muted">{t.count}</span>
                </button>
              ))}
            </div>
          )}
          {(structureId || anyFilter) && (
            <div className="row wrap small">
              {structureId && (
                <button className="chip on" onClick={() => setStructureId(null)}>
                  <Icon name="pin" size={12} /> {STRUCTURE_BY_ID.get(structureId)?.name ?? structureId} <span className="x">×</span>
                </button>
              )}
              <span className="muted">
                {filtered.length} of {notes.length} notes
              </span>
              {anyFilter && (
                <button
                  className="btn ghost small"
                  onClick={() => {
                    setQ('');
                    setCats([]);
                    setTags([]);
                    setStructureId(null);
                    setRange(0);
                    setFeel('all');
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>

        {loaded && notes.length === 0 && (
          <Empty
            title="Your journal is empty"
            action={
              <div className="row wrap" style={{ justifyContent: 'center' }}>
                <button className="btn primary" onClick={() => ui.setRoute('atlas')}>
                  <Icon name="body" /> Tap the body to start
                </button>
                <button className="btn" onClick={() => ui.setRoute('settings')}>
                  Load demo data
                </button>
              </div>
            }
          >
            Notes you create on the atlas appear here.
          </Empty>
        )}
        {notes.length > 0 && filtered.length === 0 && <Empty title="No notes match these filters" />}

        <div className="note-list">
          {groups.map((g) => (
            <div key={g.day} className="col" style={{ gap: 8 }}>
              <div className="day-head">{relativeDay(g.day)}</div>
              {g.notes.map((n) => (
                <NoteCard key={n.id} note={n} onOpen={ui.openNote} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
