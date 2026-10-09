// Two photos or videos from different days: side by side, as a wipe, or laid
// over each other. Photos can be nudged and zoomed into line (saved for next
// time); videos play in step, lined up on the position you marked.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { MediaItem } from '../../db/db';
import { DAY, formatDate } from '../../lib/dates';
import { alignTransform, formSeries, marksAt, markName, markValue, measurementChanges, POSE_BY_ID, poseSeries, syncTime, updateMedia, useAllMedia, useMediaUrl } from '../../media/media';
import { useMediaUI } from '../../media/mediaUI';
import { ensureDuration } from '../../media/process';
import { PATTERN_BY_ID, type PatternId } from '../../movement/patterns';
import { formatMeasure, MEASURE_BY_KEY, measureLabel, useBody } from '../../profile/profile';
import { Seg } from '../common';
import Icon from '../Icon';
import MarkLayer from './MarkLayer';
import { useFit } from './useFit';
import VideoBar, { FRAME, useVideoTime } from './VideoBar';

type Mode = 'side' | 'slider' | 'overlay';
type Align = NonNullable<MediaItem['align']>;
const IDENTITY: Align = { x: 0, y: 0, s: 1 };

function Pane({ item, url, videoRef, t, label }: { item: MediaItem; url: string | null; videoRef?: (el: HTMLVideoElement | null) => void; t: number | null; label: string }) {
  const [ref, box] = useFit(item.width / Math.max(1, item.height));
  return (
    <div className="cmp-pane">
      <div className="cmp-area" ref={ref}>
        <div className="mv-frame" style={{ width: box.w, height: box.h }}>
          {url && (item.kind === 'video' ? <video ref={videoRef} src={url} playsInline muted preload="auto" onLoadedMetadata={(e) => void ensureDuration(e.currentTarget)} /> : <img src={url} alt={label} draggable={false} />)}
          {url && <MarkLayer item={item} marks={marksAt(item, t)} t={t} boxW={box.w} />}
          <span className="cmp-label">{label}</span>
        </div>
      </div>
    </div>
  );
}

export default function MediaCompare({ a: aId, b: bId }: { a: string; b: string }) {
  const mui = useMediaUI();
  const media = useAllMedia();
  const { entries, profile } = useBody();
  const a = media.find((m) => m.id === aId), b = media.find((m) => m.id === bId);
  const aUrl = useMediaUrl(aId), bUrl = useMediaUrl(bId);
  const isVideo = a?.kind === 'video' && b?.kind === 'video';
  const [mode, setMode] = useState<Mode>('side');
  const [opacity, setOpacity] = useState(0.5);
  const [split, setSplit] = useState(0.5);
  const [aligning, setAligning] = useState(false);
  const [draft, setDraft] = useState<Align>(b?.align ?? IDENTITY);
  const [speed, setSpeed] = useState(0.5);
  const [loop, setLoop] = useState(true);
  const [nudge, setNudge] = useState(0);
  const [aVid, setAVid] = useState<HTMLVideoElement | null>(null);
  const [bVid, setBVid] = useState<HTMLVideoElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [stageRef, box] = useFit(a ? a.width / Math.max(1, a.height) : 1);
  const { t, playing } = useVideoTime(aVid);
  const close = () => mui.set({ compare: null });

  useEffect(() => setDraft(b?.align ?? IDENTITY), [bId]); // eslint-disable-line react-hooks/exhaustive-deps

  // the second video follows the first, lined up on the marked position
  const offset = a && b ? syncTime(b) - syncTime(a) + nudge : 0;
  useEffect(() => {
    const va = aVid, vb = bVid;
    if (!va || !vb || !isVideo) return;
    vb.playbackRate = va.playbackRate = speed;
    let raf = 0;
    const follow = () => {
      const target = va.currentTime + offset;
      const inRange = target >= 0 && target <= (vb.duration || Infinity);
      if (!inRange) {
        if (!vb.paused) vb.pause();
      } else {
        if (Math.abs(vb.currentTime - target) > 0.06) vb.currentTime = target;
        if (!va.paused && vb.paused) void vb.play().catch(() => {});
        if (va.paused && !vb.paused) vb.pause();
      }
      raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(raf);
  }, [isVideo, offset, speed, aVid, bVid]);

  useEffect(() => {
    if (aVid) aVid.loop = loop;
  }, [loop, aVid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      if (e.key === 'Escape') close();
      else if (isVideo && e.key === ' ') (e.preventDefault(), toggle());
      else if (isVideo && e.key === 'ArrowLeft') step(-1);
      else if (isVideo && e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const series = useMemo(() => {
    if (!a) return [];
    const s = a.purpose === 'progress' ? poseSeries(media, a.pose ?? 'other') : a.purpose === 'form' ? formSeries(media, a.pattern) : media;
    return s.filter((m) => m.kind === a.kind);
  }, [media, a]);

  if (!a || !b) return null;

  const seek = (time: number) => {
    const va = aVid;
    if (!va) return;
    va.pause();
    va.currentTime = Math.max(0, time);
  };
  const step = (d: 1 | -1) => seek((aVid?.currentTime ?? 0) + d * FRAME);
  const toggle = () => {
    const va = aVid;
    if (!va) return;
    if (va.paused) void va.play();
    else va.pause();
  };

  const days = Math.round(Math.abs(b.date - a.date) / DAY);
  const title = a.purpose === 'progress' ? `${POSE_BY_ID.get(a.pose ?? 'other')?.label} · then and now` : a.purpose === 'form' ? `${PATTERN_BY_ID.get(a.pattern as PatternId)?.name ?? 'Form'} · then and now` : 'Compare';
  const changes = a.purpose === 'progress' ? measurementChanges(entries, Math.min(a.date, b.date), Math.max(a.date, b.date)) : [];
  // the same measurements drawn on both
  const markPairs = (() => {
    const first = (it: MediaItem) => {
      const out = new Map<string, { name: string; v: number; unit: string }>();
      for (const m of it.marks ?? []) {
        const val = markValue(m, it.width, it.height);
        const key = `${m.type}|${markName(m).toLowerCase()}`;
        if (val && !out.has(key)) out.set(key, { name: markName(m), v: val.value, unit: m.type === 'path' ? '%' : '°' });
      }
      return out;
    };
    const fa = first(a), fb = first(b);
    return [...new Set([...fa.keys(), ...fb.keys()])].map((k) => ({ key: k, name: (fa.get(k) ?? fb.get(k))!.name, unit: (fa.get(k) ?? fb.get(k))!.unit, a: fa.get(k)?.v, b: fb.get(k)?.v }));
  })();

  // dragging / zooming the newer photo into line with the older one
  const onDown = (e: React.PointerEvent) => {
    if (!aligning && mode !== 'slider') return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!aligning) setSplit(Math.max(0, Math.min(1, (e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left) / box.w)));
  };
  const onMove = (e: React.PointerEvent) => {
    const ps = pointers.current;
    const prev = ps.get(e.pointerId);
    if (!prev) return;
    if (!aligning) {
      setSplit(Math.max(0, Math.min(1, (e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left) / box.w)));
      return;
    }
    if (ps.size === 2) {
      const [p1, p2] = [...ps.values()];
      const before = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      ps.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [q1, q2] = [...ps.values()];
      const after = Math.hypot(q1.x - q2.x, q1.y - q2.y);
      if (before > 10) setDraft((d) => ({ ...d, s: Math.max(0.5, Math.min(2.5, d.s * (after / before))) }));
      return;
    }
    ps.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setDraft((d) => ({ ...d, x: d.x + (e.clientX - prev.x) / box.w, y: d.y + (e.clientY - prev.y) / box.h }));
  };
  const onUp = (e: React.PointerEvent) => pointers.current.delete(e.pointerId);

  const bStyle: CSSProperties = { transform: alignTransform(aligning ? draft : (b.align ?? undefined)) };
  if (mode === 'overlay') bStyle.opacity = opacity;
  if (mode === 'slider') bStyle.clipPath = `inset(0 0 0 ${split * 100}%)`;
  const aStyle: CSSProperties = { transform: alignTransform(a.align) };
  const label = (m: MediaItem) => formatDate(m.date);

  return (
    <div className="mv cmp" role="dialog" aria-modal="true" aria-label={title}>
      <div className="mv-stage">
        <div className="mv-top">
          <button className="cam-btn" onClick={close} aria-label="Close">
            <Icon name="x" />
          </button>
          <div className="mv-title">
            <strong>{title}</strong>
            <span className="tiny dim">
              {formatDate(a.date)} → {formatDate(b.date)} · {days} day{days === 1 ? '' : 's'} apart
            </span>
          </div>
          <div className="grow" />
          <Seg
            value={mode}
            onChange={(m) => (setMode(m), setAligning(false))}
            label="Comparison"
            options={[
              { value: 'side', label: 'Side by side' },
              ...(isVideo ? [] : [{ value: 'slider' as Mode, label: 'Wipe' }]),
              { value: 'overlay', label: 'Overlay' },
            ]}
          />
        </div>

        {mode === 'side' ? (
          <div className="cmp-side">
            <Pane item={a} url={aUrl} videoRef={setAVid} t={isVideo ? t : null} label={label(a)} />
            <Pane item={b} url={bUrl} videoRef={setBVid} t={isVideo ? t + offset : null} label={label(b)} />
          </div>
        ) : (
          <div className="mv-area" ref={stageRef}>
            <div
              className={`mv-frame cmp-stack ${aligning ? 'aligning' : ''} ${mode === 'slider' ? 'wipe' : ''}`}
              style={{ width: box.w, height: box.h }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onWheel={(e) => aligning && setDraft((d) => ({ ...d, s: Math.max(0.5, Math.min(2.5, d.s * Math.exp(-e.deltaY * 0.0015))) }))}
            >
              {aUrl && (isVideo ? <video ref={setAVid} src={aUrl} playsInline muted preload="auto" style={aStyle} onLoadedMetadata={(e) => void ensureDuration(e.currentTarget)} /> : <img src={aUrl} alt={label(a)} style={aStyle} draggable={false} />)}
              {bUrl && (isVideo ? <video ref={setBVid} src={bUrl} playsInline muted preload="auto" className="cmp-top" style={bStyle} onLoadedMetadata={(e) => void ensureDuration(e.currentTarget)} /> : <img src={bUrl} alt={label(b)} className="cmp-top" style={bStyle} draggable={false} />)}
              {mode === 'slider' && <div className="cmp-divider" style={{ left: `${split * 100}%` }} />}
              <span className="cmp-label">{label(a)}</span>
              <span className="cmp-label right">{label(b)}</span>
            </div>
          </div>
        )}

        {isVideo && (
          <VideoBar t={t} duration={a.duration ?? aVid?.duration ?? 0} playing={playing} onToggle={toggle} onSeek={seek} onStep={step} speed={speed} onSpeed={setSpeed} loop={loop} onLoop={setLoop} />
        )}
      </div>

      <aside className="mv-panel">
        <div className="side-section">
          <div className="grid two">
            {([a, b] as const).map((m, i) => (
              <label key={i} className="field">
                <span className="label">{i === 0 ? 'Then' : 'Now'}</span>
                <select
                  className="input small"
                  value={m.id}
                  onChange={(e) => {
                    const other = i === 0 ? b : a;
                    const pick = series.find((x) => x.id === e.target.value)!;
                    const [x, y] = [pick, other].sort((p, q) => p.date - q.date);
                    mui.openCompare(x.id, y.id);
                  }}
                >
                  {series.map((x) => (
                    <option key={x.id} value={x.id} disabled={x.id === (i === 0 ? b.id : a.id)}>
                      {formatDate(x.date)}
                      {x.load ? ` · ${formatMeasure(x.load, 'kg', profile.units)}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {mode === 'overlay' && (
            <label className="field">
              <span className="label">Newer on top: {Math.round(opacity * 100)}%</span>
              <input type="range" min={0} max={1} step={0.01} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
            </label>
          )}
          {mode !== 'side' && !isVideo && (
            <div className="col" style={{ gap: 8 }}>
              {aligning ? (
                <>
                  <p className="tiny dim">Drag the newer photo to line it up; pinch, scroll or use the buttons to zoom.</p>
                  <div className="row wrap">
                    <button className="btn icon small" aria-label="Zoom out" onClick={() => setDraft((d) => ({ ...d, s: Math.max(0.5, d.s / 1.03) }))}>
                      −
                    </button>
                    <button className="btn icon small" aria-label="Zoom in" onClick={() => setDraft((d) => ({ ...d, s: Math.min(2.5, d.s * 1.03) }))}>
                      +
                    </button>
                    <button className="btn small" onClick={() => setDraft(IDENTITY)}>
                      Reset
                    </button>
                    <button
                      className="btn primary small"
                      onClick={() => {
                        void updateMedia(b.id, { align: draft.x === 0 && draft.y === 0 && draft.s === 1 ? undefined : draft });
                        setAligning(false);
                      }}
                    >
                      <Icon name="check" /> Save alignment
                    </button>
                  </div>
                </>
              ) : (
                <button className="btn small" onClick={() => (setDraft(b.align ?? IDENTITY), setAligning(true), mode === 'slider' && setMode('overlay'))}>
                  <Icon name="ghost" /> Line up the photos
                </button>
              )}
            </div>
          )}
          {isVideo && (
            <div className="col" style={{ gap: 6 }}>
              <span className="tiny dim">
                Lined up on {a.phase1 !== undefined && b.phase1 !== undefined ? `the marked ${PATTERN_BY_ID.get(a.pattern as PatternId)?.phase[1].toLowerCase() ?? 'end position'}` : a.phase0 !== undefined && b.phase0 !== undefined ? 'the marked start' : 'the start of each clip'}
                {nudge ? ` (newer ${nudge > 0 ? '+' : ''}${Math.round(nudge / FRAME)} frames)` : ''}. Mark positions in each video to line them up exactly.
              </span>
              <div className="row">
                <button className="btn small" onClick={() => setNudge((n) => n - FRAME)}>
                  Newer −1 frame
                </button>
                <button className="btn small" onClick={() => setNudge((n) => n + FRAME)}>
                  +1 frame
                </button>
              </div>
            </div>
          )}
        </div>

        {(a.purpose === 'form' || markPairs.length > 0) && (
          <div className="side-section">
            <h4>Then and now</h4>
            <table className="table cmp-table">
              <tbody>
                {a.purpose === 'form' && (
                  <tr>
                    <td>Load</td>
                    <td className="num">{a.load ? `${formatMeasure(a.load, 'kg', profile.units)}${a.reps ? ` × ${a.reps}` : ''}` : '—'}</td>
                    <td className="num">{b.load ? `${formatMeasure(b.load, 'kg', profile.units)}${b.reps ? ` × ${b.reps}` : ''}` : '—'}</td>
                  </tr>
                )}
                {markPairs.map((p) => (
                  <tr key={p.key}>
                    <td>{p.name}</td>
                    <td className="num">{p.a !== undefined ? `${Math.round(p.a)}${p.unit}` : '—'}</td>
                    <td className="num">
                      {p.b !== undefined ? `${Math.round(p.b)}${p.unit}` : '—'}
                      {p.a !== undefined && p.b !== undefined && Math.round(p.b - p.a) !== 0 && <span className="tiny muted"> ({p.b > p.a ? '+' : ''}{Math.round(p.b - p.a)})</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {markPairs.length === 0 && <p className="tiny muted">Measure the same angles on both (with the same names) to compare them here.</p>}
          </div>
        )}

        {a.purpose === 'progress' && (
          <div className="side-section">
            <h4>Measurements</h4>
            {changes.length ? (
              <table className="table cmp-table">
                <tbody>
                  {changes.map((c) => {
                    const def = MEASURE_BY_KEY.get(c.key)!;
                    return (
                      <tr key={c.key}>
                        <td>{measureLabel(c.key)}</td>
                        <td className="num">{formatMeasure(c.from, def.unit, profile.units)}</td>
                        <td className="num">
                          {formatMeasure(c.to, def.unit, profile.units)}
                          {c.diff !== 0 && <span className="tiny muted"> ({c.diff > 0 ? '+' : ''}{formatMeasure(c.diff, def.unit, profile.units)})</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="tiny muted">Save measurements in your Profile on the days you take photos to see how they changed here.</p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
