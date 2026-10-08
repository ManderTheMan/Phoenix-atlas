// One photo or video, full screen: watch it slowed down or frame by frame,
// measure angles, lean and bar path on it, line the clip up with the movement
// model's leverage, and edit its details.
import { useEffect, useMemo, useRef, useState } from 'react';
import { uid, type MediaItem, type MediaMark } from '../../db/db';
import { useNotes } from '../../hooks/useData';
import { formatDateTime } from '../../lib/dates';
import {
  deleteMedia,
  formatBytes,
  formatDuration,
  formSeries,
  getMediaBlob,
  MARK_LABELS,
  MARK_TYPE_LABEL,
  markName,
  marksAt,
  markValue,
  phaseAt,
  POSE_BY_ID,
  poseSeries,
  thumbUrl,
  timeForPhase,
  updateMedia,
  useMedia,
  useMediaUrl,
  type P,
} from '../../media/media';
import { useMediaUI } from '../../media/mediaUI';
import { ensureDuration, extensionFor, MARK_COLORS } from '../../media/process';
import { effortColor, relativeDemand } from '../../movement/activation';
import { runModel, type JointResult } from '../../movement/biomech';
import { PATTERN_BY_ID, type PatternId } from '../../movement/patterns';
import { bodyDims } from '../../model/bodyShape';
import { formatMeasure, shapeInputFrom, useBody, useBodyMass } from '../../profile/profile';
import { useUI } from '../../state/ui';
import { ConfirmButton, Seg } from '../common';
import Icon from '../Icon';
import LeverageDiagram from '../movement/LeverageDiagram';
import DetailsForm, { type MediaMeta } from './DetailsForm';
import MarkLayer, { type Draft } from './MarkLayer';
import { useFit } from './useFit';
import VideoBar, { FRAME, fmtTime, useVideoTime } from './VideoBar';

const NEED: Record<MediaMark['type'], number> = { angle: 3, line: 2, path: Infinity };
const HELP: Record<MediaMark['type'], string> = {
  angle: 'Tap three points: one end, the joint, the other end (e.g. hip, knee, ankle).',
  line: 'Tap two points along the body part (e.g. hip, then shoulder). The angle is measured from vertical.',
  path: 'Tap the bar (or joint) on each frame. The video steps forward after each tap. Press Done when finished.',
};

function metaOf(m: MediaItem): MediaMeta {
  return { purpose: m.purpose, date: m.date, tags: m.tags, pose: m.pose, pattern: m.pattern, variant: m.variant, load: m.load, reps: m.reps, camera: m.camera, notes: m.notes, noteId: m.noteId, private: m.private };
}

/** Body proportions and load for the clip's movement model. */
function useModelInput(item: MediaItem | undefined) {
  const { values, profile } = useBody();
  const healthMass = useBodyMass();
  const pattern = item?.pattern ? PATTERN_BY_ID.get(item.pattern as PatternId) : undefined;
  const variantId = item?.variant, itemLoad = item?.load;
  const inp = useMemo(() => {
    if (!pattern) return null;
    const variant = pattern.variants.find((v) => v.value === variantId) ?? pattern.variants[0];
    const options = { ...Object.fromEntries(pattern.options.map((o) => [o.id, o.default])), variant: variant.value };
    const load = variant.load === 'none' ? 0 : (itemLoad ?? variant.load);
    return { dims: bodyDims(shapeInputFrom(values)), mass: values.weight ?? healthMass ?? 75, load, options };
  }, [pattern, variantId, itemLoad, values, healthMass]);
  return { pattern, inp, units: profile.units };
}

export default function MediaViewer({ id, list }: { id: string; list?: string[] }) {
  const mui = useMediaUI();
  const ui = useUI();
  const media = useMedia();
  const notes = useNotes();
  const item = media.find((m) => m.id === id);
  const url = useMediaUrl(id);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [areaRef, box] = useFit(item ? item.width / Math.max(1, item.height) : 1);
  const { t, playing } = useVideoTime(video);
  const [duration, setDuration] = useState(item?.duration ?? 0);
  const [speed, setSpeed] = useState(0.5);
  const [loop, setLoop] = useState(true);
  const [tab, setTab] = useState<'measure' | 'details'>(item?.purpose === 'form' ? 'measure' : 'details');
  const [tool, setTool] = useState<MediaMark['type'] | null>(null);
  const [draft, setDraft] = useState<Draft & { times: number[] } | null>(null);
  const [label, setLabel] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [marks, setMarks] = useState<MediaMark[]>(item?.marks ?? []);
  const [meta, setMeta] = useState<MediaMeta | null>(item ? metaOf(item) : null);
  const [manualPhase, setManualPhase] = useState(0.8);
  const [showModel, setShowModel] = useState(true);
  const close = () => mui.set({ viewer: null });
  const { pattern, inp, units } = useModelInput(item);

  // reset per item
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!item || loadedFor.current === item.id) return;
    loadedFor.current = item.id;
    setMarks(item.marks ?? []);
    setMeta(metaOf(item));
    setDuration(item.duration ?? 0);
    setTool(null);
    setDraft(null);
    setSelected(null);
    setTab(item.purpose === 'form' ? 'measure' : 'details');
  }, [item]);

  // marks and details save shortly after each change
  const marksDirty = useRef(false);
  useEffect(() => {
    if (!marksDirty.current || !item) return;
    const tm = setTimeout(() => {
      marksDirty.current = false;
      void updateMedia(item.id, { marks });
    }, 250);
    return () => clearTimeout(tm);
  }, [marks, item]);
  const metaDirty = useRef(false);
  useEffect(() => {
    if (!metaDirty.current || !item || !meta) return;
    const tm = setTimeout(() => {
      metaDirty.current = false;
      void updateMedia(item.id, { ...meta, notes: meta.notes?.trim() || undefined });
    }, 400);
    return () => clearTimeout(tm);
  }, [meta, item]);
  const editMarks = (fn: (m: MediaMark[]) => MediaMark[]) => {
    marksDirty.current = true;
    setMarks(fn);
  };

  const isVideo = item?.kind === 'video';
  useEffect(() => {
    if (video) video.playbackRate = speed;
  }, [speed, video]);

  const seek = (time: number) => {
    const el = video;
    if (!el) return;
    el.pause();
    el.currentTime = Math.max(0, Math.min(time, (duration || el.duration || 0) - 0.01));
  };
  const step = (dir: 1 | -1) => seek((video?.currentTime ?? 0) + dir * FRAME);
  const toggle = () => {
    const el = video;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  // navigation within the list it was opened from
  const ids = list?.length ? list : media.map((m) => m.id);
  const at = ids.indexOf(id);
  const go = (d: number) => {
    const next = ids[at + d];
    if (next) mui.openViewer(next, list);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      if (e.key === 'Escape') {
        if (tool) (setTool(null), setDraft(null));
        else close();
      } else if (isVideo && e.key === ' ') (e.preventDefault(), toggle());
      else if (isVideo && (e.key === 'ArrowLeft' || e.key === ',')) step(-1);
      else if (isVideo && (e.key === 'ArrowRight' || e.key === '.')) step(1);
      else if (e.key === 'ArrowLeft' || e.key === '[') go(-1);
      else if (e.key === 'ArrowRight' || e.key === ']') go(1);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) editMarks((ms) => ms.filter((m) => m.id !== selected));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!item || !meta) return null;

  const time = isVideo ? t : null;
  const visible = marksAt({ ...item, marks }, time);
  const commit = (d: Draft & { times: number[] }) => {
    if (d.points.length < 2) return;
    const m: MediaMark = { id: uid(), type: d.type, points: d.points, label: label.trim() || undefined };
    if (isVideo) {
      if (d.type === 'path') m.times = d.times;
      else m.t = Math.round(t * 1000) / 1000;
    }
    editMarks((ms) => [...ms, m]);
    setSelected(m.id);
    setDraft(null);
    setTool(null);
  };
  const onTap = (p: P) => {
    if (!tool) return setSelected(null);
    const d = draft ?? { type: tool, points: [], times: [] };
    const next = { ...d, points: [...d.points, p], times: [...d.times, Math.round(t * 1000) / 1000] };
    if (next.points.length >= NEED[tool]) commit(next);
    else setDraft(next);
    if (tool === 'path' && isVideo) seek(t + 3 * FRAME);
  };

  // movement model synced to the clip
  const phase = isVideo ? phaseAt(item, t) : null;
  const shownPhase = phase ?? manualPhase;
  const result = pattern && inp ? runModel(pattern.model, { ...inp, phase: shownPhase }) : null;
  const jointColor = (j: JointResult) => effortColor(relativeDemand(j, inp!.mass, j.demand >= 0 ? 1 : -1));

  const ticks = isVideo
    ? [
        ...(item.phase0 !== undefined ? [{ t: item.phase0, color: '#8fd16a', label: pattern?.phase[0] ?? 'Start' }] : []),
        ...(item.phase1 !== undefined ? [{ t: item.phase1, color: '#ff7a3d', label: pattern?.phase[1] ?? 'End' }] : []),
        ...marks.filter((m) => m.t !== undefined).map((m) => ({ t: m.t!, color: MARK_COLORS[m.type], label: markName(m) })),
      ]
    : [];

  const series = item.purpose === 'progress' ? poseSeries(media, item.pose ?? 'other') : item.purpose === 'form' ? formSeries(media, item.pattern) : [];
  const others = series.filter((m) => m.id !== item.id && m.kind === item.kind).reverse();
  const note = item.noteId ? notes.find((n) => n.id === item.noteId) : undefined;
  const title =
    item.purpose === 'progress'
      ? `${POSE_BY_ID.get(item.pose ?? 'other')?.label ?? ''} photo`
      : item.purpose === 'form'
        ? (pattern?.name ?? 'Form check')
        : item.kind === 'video'
          ? 'Video'
          : 'Photo';

  const download = async () => {
    const blob = await getMediaBlob(item.id);
    if (!blob) return;
    const name = `phoenix-atlas-${new Date(item.date).toISOString().slice(0, 10)}-${item.purpose}.${extensionFor(item.mime)}`;
    const file = new File([blob], name, { type: item.mime });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="mv" role="dialog" aria-modal="true" aria-label={title}>
      <div className="mv-stage">
        <div className="mv-top">
          <button className="cam-btn" onClick={close} aria-label="Close">
            <Icon name="x" />
          </button>
          <div className="mv-title">
            <strong>{title}</strong>
            <span className="tiny dim">
              {formatDateTime(item.date)}
              {item.purpose === 'form' && item.load ? ` · ${formatMeasure(item.load, 'kg', units)}${item.reps ? ` × ${item.reps}` : ''}` : ''}
            </span>
          </div>
          <div className="grow" />
          {ids.length > 1 && (
            <span className="tiny dim">
              {at + 1} / {ids.length}
            </span>
          )}
        </div>
        <div className="mv-area" ref={areaRef}>
          <div className="mv-frame" style={{ width: box.w, height: box.h }}>
            {!url ? (
              <div className="cam-starting">
                <div className="spinner" />
              </div>
            ) : isVideo ? (
              <video
                ref={setVideo}
                src={url}
                playsInline
                muted
                loop={loop}
                preload="auto"
                onLoadedMetadata={async (e) => {
                  const el = e.currentTarget;
                  el.playbackRate = speed;
                  const d = await ensureDuration(el);
                  if (d) setDuration(d);
                  if (!item.duration && d) void updateMedia(item.id, { duration: d });
                }}
              />
            ) : (
              <img src={url} alt={title} draggable={false} />
            )}
            {url && (
              <MarkLayer item={item} marks={visible} t={time} boxW={box.w} draft={draft} selected={selected} onTap={onTap} onSelect={tool ? undefined : setSelected} onDrag={(mid, i, p) => editMarks((ms) => ms.map((m) => (m.id === mid ? { ...m, points: m.points.map((q, j) => (j === i ? p : q)) } : m)))} />
            )}
            {tool && <div className="mv-toolhint">{draft?.points.length ? `${draft.points.length} point${draft.points.length > 1 ? 's' : ''}… ` : ''}{HELP[tool]}</div>}
          </div>
          {at > 0 && (
            <button className="mv-nav prev" onClick={() => go(-1)} aria-label="Previous">
              <Icon name="chevronLeft" />
            </button>
          )}
          {at >= 0 && at < ids.length - 1 && (
            <button className="mv-nav next" onClick={() => go(1)} aria-label="Next">
              <Icon name="chevronRight" />
            </button>
          )}
        </div>
        {isVideo && <VideoBar t={t} duration={duration || video?.duration || 0} playing={playing} onToggle={toggle} onSeek={seek} onStep={step} speed={speed} onSpeed={setSpeed} loop={loop} onLoop={setLoop} ticks={ticks} />}
      </div>

      <aside className="mv-panel">
        <div className="side-section side-tabs">
          <Seg
            value={tab}
            onChange={setTab}
            label="Panel"
            options={[
              { value: 'measure', label: <><Icon name="angle" size={15} /> Measure</> },
              { value: 'details', label: <><Icon name="edit" size={15} /> Details</> },
            ]}
          />
        </div>

        {tab === 'measure' ? (
          <>
            <div className="side-section">
              <div className="row between">
                <h4>Draw</h4>
                {tool && (
                  <button className="btn ghost small" onClick={() => (tool === 'path' && draft && draft.points.length >= 2 ? commit(draft) : (setTool(null), setDraft(null)))}>
                    {tool === 'path' && draft && draft.points.length >= 2 ? 'Done' : 'Cancel'}
                  </button>
                )}
              </div>
              <div className="tool-row">
                {(['angle', 'line', 'path'] as const).map((k) => (
                  <button
                    key={k}
                    className={`tool ${tool === k ? 'on' : ''}`}
                    onClick={() => {
                      setDraft(null);
                      setSelected(null);
                      setTool(tool === k ? null : k);
                      if (tool !== k) setLabel(MARK_LABELS[k][0]);
                      if (isVideo) video?.pause();
                    }}
                    style={{ ['--c' as string]: MARK_COLORS[k] }}
                  >
                    <Icon name={k === 'angle' ? 'angle' : k === 'line' ? 'lean' : 'path'} size={18} />
                    <span>{MARK_TYPE_LABEL[k]}</span>
                  </button>
                ))}
              </div>
              {tool && (
                <div className="col" style={{ gap: 6 }}>
                  <div className="chips">
                    {MARK_LABELS[tool].map((l) => (
                      <button key={l} className={`chip ${label === l ? 'on' : ''}`} onClick={() => setLabel(l)}>
                        {l}
                      </button>
                    ))}
                  </div>
                  <input className="input small" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name (optional)" aria-label="Name of the measurement" />
                </div>
              )}
              {marks.length === 0 && !tool && <p className="tiny muted">Measure a joint angle, how far a body part leans from vertical, or the path of the bar. Name them the same way each time to follow them in Media → Form.</p>}
              {marks.length > 0 && (
                <div className="mark-list">
                  {marks.map((m) => {
                    const val = markValue(m, item.width, item.height);
                    return (
                      <div key={m.id} className={`mark-row ${selected === m.id ? 'on' : ''}`}>
                        <button className="grow mark-row-main" onClick={() => (setSelected(m.id), m.t !== undefined ? seek(m.t) : m.times?.[0] !== undefined ? seek(m.times[0]) : undefined)}>
                          <span className="feel-dot" style={{ background: MARK_COLORS[m.type] }} />
                          <span className="ellipsis">{markName(m)}</span>
                          <span className="mono small">{val ? (m.type === 'path' ? `${Math.round(val.value)}%` : `${Math.round(val.value)}°`) : '—'}</span>
                          {m.t !== undefined && <span className="tiny muted mono">{fmtTime(m.t)}</span>}
                        </button>
                        <select
                          className="input small mark-rename"
                          value=""
                          aria-label="Rename"
                          onChange={(e) => {
                            const name = e.target.value === '__custom' ? prompt('Name', m.label ?? '') : e.target.value;
                            if (name !== null && name !== '') editMarks((ms) => ms.map((x) => (x.id === m.id ? { ...x, label: name.trim() || undefined } : x)));
                          }}
                        >
                          <option value="">Rename</option>
                          {MARK_LABELS[m.type].map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                          <option value="__custom">Other…</option>
                        </select>
                        <button className="btn ghost icon small" aria-label="Delete measurement" onClick={() => editMarks((ms) => ms.filter((x) => x.id !== m.id))}>
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    );
                  })}
                  {selected && <p className="tiny muted">Drag the dots of the selected measurement to adjust it.</p>}
                </div>
              )}
            </div>

            {item.purpose === 'form' && pattern && inp && result && (
              <div className="side-section">
                <div className="row between">
                  <h4>Leverage</h4>
                  <button className="btn ghost small" onClick={() => setShowModel((s) => !s)}>
                    {showModel ? 'Hide' : 'Show'}
                  </button>
                </div>
                {isVideo && (
                  <div className="phase-marks">
                    {([0, 1] as const).map((k) => {
                      const key = k === 0 ? 'phase0' : 'phase1';
                      const val = item[key];
                      return (
                        <div key={k} className="phase-mark">
                          <span className="tiny dim">{pattern.phase[k]}</span>
                          {val !== undefined ? (
                            <button className="chip" onClick={() => seek(val)} title="Go to this moment">
                              <Icon name="flag" size={12} /> {fmtTime(val)}
                            </button>
                          ) : (
                            <span className="tiny muted">not set</span>
                          )}
                          <button className="btn small" onClick={() => void updateMedia(item.id, { [key]: Math.round(t * 1000) / 1000 })}>
                            Set here
                          </button>
                        </div>
                      );
                    })}
                    <p className="tiny muted">
                      {phase === null
                        ? `Pause on the ${pattern.phase[0].toLowerCase()} and the ${pattern.phase[1].toLowerCase()} positions and tap Set here, so the model follows the video.`
                        : `The model follows the video: ${Math.round(phase * 100)}% of the way to the ${pattern.phase[1].toLowerCase()}.`}
                    </p>
                  </div>
                )}
                {showModel && (
                  <>
                    <LeverageDiagram
                      views={result.views}
                      joints={result.joints}
                      selected={null}
                      colorOf={jointColor}
                      onSelect={() => {}}
                      phase={shownPhase}
                      onPhase={(p) => {
                        const time = timeForPhase(item, p);
                        if (isVideo && time !== null) seek(time);
                        else setManualPhase(p);
                      }}
                      height={210}
                    />
                    {phase === null && <input type="range" min={0} max={1} step={0.01} value={manualPhase} onChange={(e) => setManualPhase(Number(e.target.value))} aria-label="Point in the movement" />}
                    <div className="mini-joints">
                      {result.joints.map((j) => (
                        <div key={j.id} className="mini-joint">
                          <span className="feel-dot" style={{ background: jointColor(j) }} />
                          <span className="grow small">{j.label}</span>
                          <span className="mono tiny">{Math.round(Math.abs(j.arm) * 100)} cm</span>
                          <span className="mono tiny">{Math.abs(j.demand) < 4 ? '≈ 0' : Math.round(Math.abs(j.demand))} N·m</span>
                        </div>
                      ))}
                    </div>
                    <p className="tiny muted">
                      The model uses your profile’s proportions{item.load ? ` and this clip’s load (${formatMeasure(item.load, 'kg', units)})` : ''}. Compare its posture with yours to see how your levers change.
                    </p>
                  </>
                )}
                <button className="btn small" onClick={() => (close(), ui.openMovement(pattern.id))}>
                  <Icon name="movement" /> Open in Movement
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="side-section">
            <DetailsForm
              value={meta}
              kind={item.kind}
              onChange={(patch) => {
                metaDirty.current = true;
                setMeta((m) => ({ ...m!, ...patch }));
              }}
            />
          </div>
        )}

        {others.length > 0 && (
          <div className="side-section">
            <h4>Compare with</h4>
            <div className="thumb-strip">
              {others.slice(0, 20).map((o) => (
                <button key={o.id} className="thumb-mini" onClick={() => mui.openCompare(o.date < item.date ? o.id : item.id, o.date < item.date ? item.id : o.id)} title={formatDateTime(o.date)}>
                  {thumbUrl(o) ? <img src={thumbUrl(o)} alt="" /> : <Icon name={o.kind === 'video' ? 'video' : 'image'} />}
                  <span>{new Date(o.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                </button>
              ))}
            </div>
            {item.purpose === 'progress' && series.length > 2 && (
              <button className="btn small" onClick={() => (close(), mui.openTimelapse(item.pose ?? 'other'))}>
                <Icon name="film" /> Time-lapse of {series.length} photos
              </button>
            )}
          </div>
        )}

        <div className="side-section">
          {note && (
            <button className="btn small" onClick={() => (close(), ui.openNote(note.id))}>
              <Icon name="book" /> Open note: {note.title || 'Untitled'}
            </button>
          )}
          <div className="row wrap">
            <button className="btn small" onClick={download}>
              <Icon name="share" /> Save or share
            </button>
            <div className="grow" />
            <ConfirmButton
              className="btn danger small"
              onConfirm={async () => {
                const next = ids[at + 1] ?? ids[at - 1];
                await deleteMedia(item.id);
                ui.showToast('Deleted');
                if (next && next !== item.id) mui.openViewer(next, list?.filter((x) => x !== item.id));
                else close();
              }}
            >
              <Icon name="trash" /> Delete
            </ConfirmButton>
          </div>
          <p className="tiny muted">
            {item.width}×{item.height}
            {item.duration ? ` · ${formatDuration(item.duration)}` : ''} · {formatBytes(item.size)} · stored on this device
          </p>
        </div>
      </aside>
    </div>
  );
}
