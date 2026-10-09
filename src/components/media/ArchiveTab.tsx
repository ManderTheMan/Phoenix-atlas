// Your video archive: results from the archive tool (tools/archive) brought in
// with their joint tracks, and a quick way to label which movement each clip
// shows, helped by suggestions from the joints and your training log.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MediaItem } from '../../db/db';
import { APP_URL } from '../../dataset/card';
import { useActivities, useNotes } from '../../hooks/useData';
import { importArchive, planImport, readArchives, unlabelled, type ArchiveSource, type ImportResult } from '../../media/archive';
import { formatBytes, formatDuration, requestPersistentStorage, storageInfo, updateMedia } from '../../media/media';
import { useMediaUI } from '../../media/mediaUI';
import { PATTERN_BY_ID, PATTERNS, type PatternId } from '../../movement/patterns';
import { loggedExercises } from '../../movement/training';
import { useUI } from '../../state/ui';
import { Check } from '../common';
import Icon from '../Icon';
import MediaThumb from './MediaThumb';

const GUIDE_URL = `${APP_URL}/tree/HEAD/tools/archive`;
const CONFIDENT = 0.8;
const PAGE = 30;

const patternName = (p: string | null | undefined) => (p ? PATTERN_BY_ID.get(p as PatternId)?.name ?? p : 'Not sure');

export default function ArchiveTab({ media }: { media: MediaItem[] }) {
  const ui = useUI();
  const notes = useNotes();
  const activities = useActivities();
  const logged = useMemo(() => loggedExercises(notes, activities).exercises, [notes, activities]);
  const archived = useMemo(() => media.filter((m) => m.source?.startsWith('archive:')), [media]);

  // ---------------------------------------------------------------- import
  const [sources, setSources] = useState<ArchiveSource[] | null>(null);
  const [reading, setReading] = useState(false);
  const [years, setYears] = useState<Set<number> | null>(null);
  const [skipCrowded, setSkipCrowded] = useState(false);
  const [sideOnly, setSideOnly] = useState(false);
  const plan = useMemo(() => (sources ? planImport(sources, media, { years, skipCrowded, sideOnly }) : null), [sources, media, years, skipCrowded, sideOnly]);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number }>({});
  useEffect(() => {
    void storageInfo().then(setStorage);
  }, [media.length]);
  const packInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const choose = async (list: FileList | null) => {
    if (!list?.length) return;
    setReading(true);
    setResult(null);
    try {
      const s = await readArchives([...list]);
      setSources((prev) => [...(prev ?? []), ...s]);
      setYears(null);
    } catch (e) {
      ui.showToast((e as Error).message);
    } finally {
      setReading(false);
      if (packInput.current) packInput.current.value = '';
      if (folderInput.current) folderInput.current.value = '';
    }
  };

  const doImport = async () => {
    if (!plan?.rows.length) return;
    await requestPersistentStorage();
    abort.current = new AbortController();
    setResult(null);
    try {
      const r = await importArchive(plan, logged, (done, total, name) => setProgress({ done, total, name }), abort.current.signal);
      setResult(r);
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  const free = storage.quota ? storage.quota - (storage.usage ?? 0) : undefined;
  const yearList = plan ? [...plan.years.keys()].sort((a, b) => b - a) : [];
  const toggleYear = (y: number) => {
    const all = new Set(yearList);
    const cur = years ?? all;
    const next = new Set(cur);
    if (next.has(y)) next.delete(y);
    else next.add(y);
    setYears(next.size === all.size ? null : next);
  };

  const hours = archived.reduce((s, m) => s + (m.duration ?? 0), 0) / 3600;
  const span = archived.length ? [Math.min(...archived.map((m) => m.date)), Math.max(...archived.map((m) => m.date))].map((d) => new Date(d).getFullYear()) : null;

  return (
    <>
      <div className="card col">
        <div className="row between wrap">
          <h3>Your video archive</h3>
          <a className="btn small" href={GUIDE_URL} target="_blank" rel="noreferrer">
            <Icon name="book" /> Archive tool guide
          </a>
        </div>
        <p className="small dim">
          Years of videos are too big to go through here. The archive tool does it on your computer or home server: it finds the clips with you
          training, tracks the joints with the same model as this app, and makes small copies. Bring its results in here.
        </p>
        {archived.length > 0 && (
          <p className="small">
            <Icon name="film" size={14} /> {archived.length} archive clip{archived.length === 1 ? '' : 's'}
            {span ? ` from ${span[0] === span[1] ? span[0] : `${span[0]}–${span[1]}`}` : ''} · {hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min` : `${hours.toFixed(1)} h`} · {archived.length - unlabelled(media).length} labelled
          </p>
        )}
        <div className="row wrap">
          <button className="btn primary" disabled={reading || !!progress} onClick={() => packInput.current?.click()}>
            <Icon name="upload" /> Choose pack files (.zip)
          </button>
          <button className="btn" disabled={reading || !!progress} onClick={() => folderInput.current?.click()}>
            <Icon name="file" /> Choose archive folder
          </button>
          <input ref={packInput} type="file" accept=".zip,application/zip" multiple hidden onChange={(e) => void choose(e.target.files)} />
          <input ref={folderInput} type="file" hidden onChange={(e) => void choose(e.target.files)} {...{ webkitdirectory: '', directory: '' }} />
        </div>
        {reading && <p className="small dim">Reading…</p>}

        {plan && sources && (
          <div className="col archive-plan" style={{ gap: 10 }}>
            <p className="small">
              {sources.map((s) => s.label).join(', ')}: <strong>{plan.usable}</strong> usable clip{plan.usable === 1 ? '' : 's'}
              {plan.already ? `, ${plan.already} already here` : ''}
              {plan.copies ? `, ${plan.copies} copies of other clips left out` : ''}
              {plan.noCopy ? `, ${plan.noCopy} without a small copy (packed with --tracks-only)` : ''}.
            </p>
            {yearList.length > 1 && (
              <div className="field">
                <span className="label">Years</span>
                <div className="chips">
                  {yearList.map((y) => (
                    <button key={y} className={`chip ${!years || years.has(y) ? 'on' : ''}`} onClick={() => toggleYear(y)}>
                      {y || 'Unknown'} <span className="dim">{plan.years.get(y)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="export-opts">
              <label className="row" style={{ gap: 8 }}>
                <Check on={skipCrowded} onChange={setSkipCrowded} label="Leave out clips with other people in them" />
                <span className="small">Leave out clips with other people in them</span>
              </label>
              <label className="row" style={{ gap: 8 }}>
                <Check on={sideOnly} onChange={setSideOnly} label="Side-on clips only" />
                <span className="small">Side-on clips only</span>
              </label>
            </div>
            {plan.rows.length > 0 ? (
              <p className="tiny dim">
                {plan.rows.length} clip{plan.rows.length === 1 ? '' : 's'} to bring in, about {formatBytes(plan.bytes)}
                {free !== undefined ? ` · ${formatBytes(free)} free for the app` : ''}. They’re stored on this device; the originals stay where they are.
              </p>
            ) : (
              !progress && <p className="small dim">{plan.already && plan.already === plan.usable ? 'Everything here has been brought in.' : 'Nothing to bring in with these choices.'}</p>
            )}
            {free !== undefined && plan.bytes > free * 0.9 && <p className="tiny warn-text">That’s more than this device has room for: choose fewer years.</p>}
            {progress ? (
              <div className="col" style={{ gap: 6 }}>
                <div className="progress">
                  <span style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
                </div>
                <div className="row between tiny dim">
                  <span className="ellipsis">
                    {progress.done} of {progress.total} · {progress.name}
                  </span>
                  <button className="btn ghost small" onClick={() => abort.current?.abort()}>
                    Stop
                  </button>
                </div>
              </div>
            ) : (
              plan.rows.length > 0 && (
                <button className="btn primary" onClick={() => void doImport()}>
                  <Icon name="download" /> Bring in {plan.rows.length} clip{plan.rows.length === 1 ? '' : 's'}
                </button>
              )
            )}
            {result && (
              <p className="small">
                <Icon name="check" size={14} /> Brought in {result.imported} clip{result.imported === 1 ? '' : 's'}.
                {result.failed.length > 0 && (
                  <span className="warn-text">
                    {' '}
                    {result.failed.length} couldn’t be read: {result.failed.slice(0, 3).map((f) => `${f.name} (${f.reason})`).join(', ')}
                    {result.failed.length > 3 ? '…' : ''}
                  </span>
                )}
              </p>
            )}
          </div>
        )}
      </div>

      <Labeller media={media} />
    </>
  );
}

function Labeller({ media }: { media: MediaItem[] }) {
  const mui = useMediaUI();
  const todo = useMemo(() => unlabelled(media).sort((a, b) => (b.suggestion?.confidence ?? 0) - (a.suggestion?.confidence ?? 0) || b.date - a.date), [media]);
  const [view, setView] = useState<'suggested' | 'unsure'>('suggested');
  const [shown, setShown] = useState(PAGE);
  const [picked, setPicked] = useState<Record<string, string>>({});
  if (!todo.length) return null;
  const suggested = todo.filter((m) => m.suggestion?.pattern);
  const unsure = todo.filter((m) => !m.suggestion?.pattern);
  const confident = suggested.filter((m) => (m.suggestion?.confidence ?? 0) >= CONFIDENT);
  const list = view === 'suggested' ? suggested : unsure;

  const accept = async (m: MediaItem, choice: string) => {
    if (choice === 'none') await updateMedia(m.id, { purpose: 'other', suggestion: undefined });
    else await updateMedia(m.id, { pattern: choice, reps: m.suggestion?.pattern === choice ? m.suggestion.reps : m.reps, suggestion: undefined });
  };
  const acceptAll = async () => {
    for (const m of confident) await accept(m, m.suggestion!.pattern!);
  };

  return (
    <div className="card col">
      <div className="row between wrap">
        <h3>Label your clips</h3>
        {confident.length > 0 && (
          <button className="btn small primary" onClick={() => void acceptAll()}>
            <Icon name="check" /> Accept {confident.length} confident suggestion{confident.length === 1 ? '' : 's'}
          </button>
        )}
      </div>
      <p className="small dim">
        {todo.length} clip{todo.length === 1 ? ' needs' : 's need'} a movement. Suggestions come from how the joints move and, where you logged a
        workout that day, from your training log. Tap a clip to watch it.
      </p>
      <div className="chips">
        <button className={`chip ${view === 'suggested' ? 'on' : ''}`} onClick={() => setView('suggested')}>
          Suggested <span className="dim">{suggested.length}</span>
        </button>
        <button className={`chip ${view === 'unsure' ? 'on' : ''}`} onClick={() => setView('unsure')}>
          Not sure <span className="dim">{unsure.length}</span>
        </button>
      </div>
      <div className="label-list">
        {list.slice(0, shown).map((m) => {
          const s = m.suggestion;
          const choice = picked[m.id] ?? s?.pattern ?? '';
          const options = [...new Set([...(s?.options ?? []), ...PATTERNS.map((p) => p.id)])];
          return (
            <div key={m.id} className="label-row">
              <MediaThumb item={m} onClick={() => mui.openViewer(m.id, list.map((x) => x.id))} />
              <div className="grow col" style={{ gap: 3, minWidth: 0 }}>
                <span className="small">
                  {new Date(m.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · {formatDuration(m.duration)}
                  {s?.reps ? ` · ${s.reps} rep${s.reps === 1 ? '' : 's'}` : ''}
                  {m.tags.includes('several-people') ? ' · others in shot' : ''}
                </span>
                <span className="tiny dim" title={s?.why}>
                  {s?.pattern ? (
                    <>
                      <strong className={(s.confidence ?? 0) >= CONFIDENT ? 'ok-text' : ''}>{patternName(s.pattern)}</strong> · {Math.round(s.confidence * 100)}%
                      {s.from === 'both' ? ' · movement and log agree' : s.from === 'log' ? ' · from your log' : ' · from the movement'}
                    </>
                  ) : (
                    s?.why ?? 'No suggestion'
                  )}
                </span>
                <div className="row" style={{ gap: 6 }}>
                  <select className="input small" value={choice} onChange={(e) => setPicked((p) => ({ ...p, [m.id]: e.target.value }))} aria-label="Movement">
                    <option value="" disabled>
                      Choose…
                    </option>
                    {options.map((id) => (
                      <option key={id} value={id}>
                        {patternName(id)}
                        {s?.options.includes(id as PatternId) ? ' (logged that day)' : ''}
                      </option>
                    ))}
                    <option value="none">Not a lift</option>
                  </select>
                  <button className="btn small" disabled={!choice} onClick={() => void accept(m, choice)} aria-label="Confirm">
                    <Icon name="check" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {list.length > shown && (
        <button className="btn ghost small" onClick={() => setShown((n) => n + PAGE)}>
          Show {Math.min(PAGE, list.length - shown)} more
        </button>
      )}
    </div>
  );
}
