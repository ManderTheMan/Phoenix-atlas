// The camera: photos with a self-timer and a faint "ghost" of your last photo
// of the same pose to line up with, videos for form checks, and importing
// from your library. Nothing leaves the device.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PoseId } from '../../db/db';
import { formatDate } from '../../lib/dates';
import {
  addMedia,
  formatDuration,
  formSeries,
  latestByPose,
  MAX_VIDEO_SECONDS,
  POSE_BY_ID,
  POSE_SET,
  POSES,
  requestPersistentStorage,
  thumbUrl,
  useMedia,
  useMediaUrl,
} from '../../media/media';
import { useMediaUI, type CameraRequest } from '../../media/mediaUI';
import { photoFromVideo, processPhoto, processVideo, recorderMime, takenAt, type Processed } from '../../media/process';
import { PATTERN_BY_ID, PATTERNS, type PatternId } from '../../movement/patterns';
import { useUI } from '../../state/ui';
import { Seg } from '../common';
import Icon from '../Icon';
import DetailsForm, { type MediaMeta } from './DetailsForm';
import { useFit } from './useFit';

type Stage = 'live' | 'countdown' | 'recording' | 'busy' | 'review' | 'import' | 'error';

interface Shot extends Processed {
  kind: 'photo' | 'video';
  url: string;
  /** Small preview (the thumbnail for videos). */
  preview?: string;
  source: 'camera' | 'upload';
}

const revoke = (s?: Shot) => {
  if (!s) return;
  URL.revokeObjectURL(s.url);
  if (s.preview && s.preview !== s.url) URL.revokeObjectURL(s.preview);
};

interface ImportItem {
  key: string;
  name: string;
  date: number;
  shot?: Shot;
  error?: string;
}

const TIMERS = [0, 3, 5, 10];
const GHOSTS = [0, 0.25, 0.4, 0.6];

let audio: AudioContext | null = null;
function beep(freq: number, ms: number) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + ms / 1000);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + ms / 1000 + 0.02);
  } catch {
    // sound is optional
  }
}

function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was blocked. Allow it in your browser’s site settings, or use your camera app instead.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is busy in another app.';
  return 'The camera couldn’t be opened here.';
}

function metaFrom(req: CameraRequest): MediaMeta {
  return {
    purpose: req.purpose,
    date: Date.now(),
    tags: [],
    pose: req.purpose === 'progress' ? (req.pose ?? 'front') : undefined,
    pattern: req.pattern,
    variant: req.variant,
    load: req.load,
    camera: req.purpose === 'form' ? 'side' : undefined,
    noteId: req.noteId,
  };
}

/** Only the fields that apply to the chosen purpose. */
function cleanMeta(m: MediaMeta): MediaMeta {
  const out: MediaMeta = { ...m, notes: m.notes?.trim() || undefined };
  if (m.purpose !== 'progress') delete out.pose;
  if (m.purpose !== 'form') for (const k of ['pattern', 'variant', 'load', 'reps', 'camera'] as const) delete out[k];
  return out;
}

function saveError(e: unknown): string {
  const n = (e as { name?: string })?.name;
  if (n === 'QuotaExceededError') return 'There isn’t enough storage space on this device. Delete some videos or free up space.';
  return (e as Error)?.message || 'Couldn’t save';
}

export default function CameraSheet({ req }: { req: CameraRequest }) {
  const mui = useMediaUI();
  const ui = useUI();
  const media = useMedia();
  const [mode, setMode] = useState(req.mode);
  const [meta, setMetaRaw] = useState<MediaMeta>(() => metaFrom(req));
  const [stage, setStage] = useState<Stage>(req.upload ? 'import' : 'live');
  const [error, setError] = useState('');
  const [count, setCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [shot, setShot] = useState<Shot | null>(null);
  const [imports, setImports] = useState<ImportItem[]>([]);
  const [cameras, setCameras] = useState(0);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [mirrored, setMirrored] = useState(false);
  const [flash, setFlash] = useState(0);
  const [done, setDone] = useState<PoseId[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nativeRef = useRef<HTMLInputElement>(null);
  const setMeta = (patch: Partial<MediaMeta>) => setMetaRaw((m) => ({ ...m, ...patch }));
  const close = () => mui.set({ camera: null });
  const live = stage === 'live' || stage === 'countdown' || stage === 'recording';
  const [areaRef, box] = useFit(size ? size.w / size.h : 3 / 4);

  // the live camera runs only while it is on screen
  useEffect(() => {
    if (!live) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(window.isSecureContext ? 'This browser can’t use the camera.' : 'The camera only works over a secure (https) connection.');
      setStage('error');
      return;
    }
    let stopped = false;
    navigator.mediaDevices
      // full HD for photos; 720p for video keeps recording light enough for any phone
      .getUserMedia({ video: { facingMode: { ideal: mui.facing }, width: { ideal: mode === 'photo' ? 1920 : 1280 }, height: { ideal: mode === 'photo' ? 1080 : 720 } }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        streamRef.current = s;
        const fm = s.getVideoTracks()[0]?.getSettings().facingMode;
        setMirrored(fm ? fm === 'user' : true);
        const v = videoRef.current;
        if (v) {
          v.srcObject = s;
          v.play().catch(() => {});
        }
        navigator.mediaDevices
          .enumerateDevices()
          .then((d) => setCameras(d.filter((x) => x.kind === 'videoinput').length))
          .catch(() => {});
      })
      .catch((e) => {
        if (stopped) return;
        setError(cameraError(e));
        setStage('error');
      });
    return () => {
      stopped = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [live, mui.facing, mode]);

  // stop recording and free files if the sheet closes mid-way
  useEffect(
    () => () => {
      if (recRef.current?.state === 'recording') {
        recRef.current.ondataavailable = null;
        recRef.current.onstop = null;
        recRef.current.stop();
      }
    },
    [],
  );
  useEffect(() => () => revoke(shot ?? undefined), [shot]);
  const importsRef = useRef(imports);
  importsRef.current = imports;
  useEffect(() => () => importsRef.current.forEach((i) => revoke(i.shot)), []);

  // the file picker opens straight away when asked for
  useEffect(() => {
    if (req.upload) fileRef.current?.click();
  }, [req.upload]);

  // ghost: the last photo of this pose (or the last clip of this lift) to line up with
  const ghostItem = useMemo(() => {
    if (meta.purpose === 'progress') return latestByPose(media).get(meta.pose ?? 'front');
    if (meta.purpose === 'form' && meta.pattern) return formSeries(media, meta.pattern).pop();
    return undefined;
  }, [media, meta.purpose, meta.pose, meta.pattern]);
  const ghostFull = useMediaUrl(ghostItem?.kind === 'photo' ? ghostItem.id : null);
  const ghostSrc = ghostFull ?? (ghostItem ? thumbUrl(ghostItem) : undefined);

  // countdown, one beep a second
  useEffect(() => {
    if (stage !== 'countdown') return;
    if (count <= 0) {
      fire();
      return;
    }
    beep(count <= 3 ? 880 : 660, 90);
    const t = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, count]);

  // recording clock and the time limit
  useEffect(() => {
    if (stage !== 'recording') return;
    const start = performance.now();
    const t = setInterval(() => {
      const s = (performance.now() - start) / 1000;
      setElapsed(s);
      if (s >= MAX_VIDEO_SECONDS) stopRecording();
    }, 200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const fire = () => {
    if (mode === 'photo') void takePhoto();
    else startRecording();
  };

  const takePhoto = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return setStage('live');
    try {
      const p = await photoFromVideo(v);
      beep(1320, 140);
      setFlash((f) => f + 1);
      setShot({ ...p, kind: 'photo', url: URL.createObjectURL(p.blob), source: 'camera' });
      setMeta({ date: Date.now() });
      setStage('review');
    } catch (e) {
      ui.showToast((e as Error).message);
      setStage('live');
    }
  };

  const startRecording = () => {
    const s = streamRef.current;
    if (!s || typeof MediaRecorder === 'undefined') {
      setError('This browser can’t record video. Use your camera app instead.');
      setStage('error');
      return;
    }
    const mime = recorderMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(s, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 4_000_000 });
    } catch {
      rec = new MediaRecorder(s);
    }
    const chunks: Blob[] = [];
    const started = performance.now();
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      const duration = (performance.now() - started) / 1000;
      const blob = new Blob(chunks, { type: (rec.mimeType || mime || 'video/webm').split(';')[0] });
      setStage('busy');
      try {
        const p = await processVideo(blob, duration);
        setShot({ ...p, duration: p.duration || duration, kind: 'video', url: URL.createObjectURL(blob), source: 'camera' });
        setMeta({ date: Date.now() - duration * 1000 });
        setStage('review');
      } catch (e) {
        ui.showToast((e as Error).message);
        setStage('live');
      }
    };
    rec.start(1000);
    recRef.current = rec;
    beep(1320, 140);
    setElapsed(0);
    setStage('recording');
  };

  const stopRecording = () => {
    if (recRef.current?.state === 'recording') recRef.current.stop();
    recRef.current = null;
  };

  const shutter = () => {
    if (stage === 'countdown') return setStage('live');
    if (stage === 'recording') return stopRecording();
    if (stage !== 'live') return;
    if (mui.timer > 0) {
      setCount(mui.timer);
      setStage('countdown');
    } else fire();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      if (e.key === 'Escape') close();
      if (e.key === ' ' && live) {
        e.preventDefault();
        shutter();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------------------------------------------------------------- files

  const processFile = async (f: File): Promise<Shot> => {
    if (f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(f.name)) {
      const p = await processVideo(f);
      return { ...p, kind: 'video', url: URL.createObjectURL(f), preview: p.thumb && URL.createObjectURL(p.thumb), source: 'upload' };
    }
    const p = await processPhoto(f);
    const url = URL.createObjectURL(p.blob);
    return { ...p, kind: 'photo', url, preview: url, source: 'upload' };
  };

  const onNative = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setStage('busy');
    try {
      const s = await processFile(f);
      setShot({ ...s, source: 'camera' });
      setMode(s.kind);
      setMeta({ date: await takenAt(f) });
      setStage('review');
    } catch (e) {
      ui.showToast((e as Error).message);
      setStage('error');
    }
  };

  const onFiles = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    if (!list.length) return;
    setStage('import');
    const items: ImportItem[] = list.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, date: f.lastModified || Date.now() }));
    setImports((cur) => [...cur, ...items]);
    for (let i = 0; i < list.length; i++) {
      const f = list[i], key = items[i].key;
      const date = await takenAt(f);
      try {
        const s = await processFile(f);
        setImports((cur) => cur.map((x) => (x.key === key ? { ...x, date, shot: s } : x)));
      } catch (e) {
        setImports((cur) => cur.map((x) => (x.key === key ? { ...x, date, error: (e as Error).message } : x)));
      }
    }
  };

  // ---------------------------------------------------------------- saving

  const nextPose = (() => {
    if (!req.sequence || meta.purpose !== 'progress') return undefined;
    const left = POSE_SET.filter((p) => p !== meta.pose && !done.includes(p));
    return left[0];
  })();

  const saveShot = async (then: 'close' | 'again' | 'next') => {
    if (!shot) return;
    setStage('busy');
    try {
      const m = cleanMeta(meta);
      await addMedia({ blob: shot.blob, kind: shot.kind, width: shot.width, height: shot.height, duration: shot.duration, thumb: shot.thumb, ...m, source: shot.source });
      void requestPersistentStorage();
      setShot(null);
      if (then === 'close') {
        ui.showToast(shot.kind === 'photo' ? 'Photo saved' : 'Video saved');
        close();
        return;
      }
      if (then === 'next' && nextPose) {
        setDone((d) => [...d, meta.pose!]);
        setMeta({ pose: nextPose });
        ui.showToast(`Saved. Now the ${POSE_BY_ID.get(nextPose)!.label.toLowerCase()} photo.`);
      } else ui.showToast('Saved');
      setStage('live');
    } catch (e) {
      ui.showToast(saveError(e));
      setStage('review');
    }
  };

  const saveImports = async () => {
    const ready = imports.filter((i) => i.shot);
    if (!ready.length) return;
    setStage('busy');
    try {
      const m = cleanMeta(meta);
      for (const it of ready) {
        const s = it.shot!;
        await addMedia({ blob: s.blob, kind: s.kind, width: s.width, height: s.height, duration: s.duration, thumb: s.thumb, ...m, date: it.date, source: 'upload' });
      }
      void requestPersistentStorage();
      ui.showToast(`Imported ${ready.length} file${ready.length > 1 ? 's' : ''}`);
      close();
    } catch (e) {
      ui.showToast(saveError(e));
      setStage('import');
    }
  };

  const retake = () => {
    setShot(null);
    setStage('live');
  };

  // ---------------------------------------------------------------- views

  const pose = meta.pose ? POSE_BY_ID.get(meta.pose) : undefined;
  const pattern = meta.pattern ? PATTERN_BY_ID.get(meta.pattern as PatternId) : undefined;
  const hint =
    meta.purpose === 'progress'
      ? `${pose?.hint ?? ''} Keep your head and feet between the lines.`
      : meta.purpose === 'form'
        ? 'Stand the phone at hip height, side on, 3–4 m away, with your whole body and the bar in the frame.'
        : '';
  const fileInputs = (
    <>
      <input ref={fileRef} type="file" accept={mode === 'video' ? 'video/*' : 'image/*,video/*'} multiple hidden onChange={(e) => (onFiles(e.target.files), (e.target.value = ''))} />
      <input ref={nativeRef} type="file" accept={mode === 'video' ? 'video/*' : 'image/*'} capture="environment" hidden onChange={(e) => (onNative(e.target.files), (e.target.value = ''))} />
    </>
  );

  if (stage === 'review' && shot) {
    return (
      <div className="cam" role="dialog" aria-modal="true" aria-label="Save">
        <div className="cam-review">
          <div className="cam-review-media">
            {shot.kind === 'photo' ? <img src={shot.url} alt="The photo you took" /> : <video src={shot.url} controls playsInline loop autoPlay muted />}
          </div>
          <div className="cam-review-side">
            <div className="row between">
              <h2>{shot.kind === 'photo' ? 'Save photo' : 'Save video'}</h2>
              <button className="btn ghost icon" onClick={close} aria-label="Discard and close">
                <Icon name="x" />
              </button>
            </div>
            <DetailsForm value={meta} onChange={setMeta} kind={shot.kind} />
            <div className="row wrap cam-review-actions">
              {nextPose ? (
                <button className="btn primary" onClick={() => saveShot('next')}>
                  <Icon name="check" /> Save, then {POSE_BY_ID.get(nextPose)!.label.toLowerCase()}
                </button>
              ) : (
                <button className="btn primary" onClick={() => saveShot('close')}>
                  <Icon name="check" /> Save
                </button>
              )}
              {nextPose ? (
                <button className="btn" onClick={() => saveShot('close')}>
                  Save and finish
                </button>
              ) : (
                shot.source === 'camera' && (
                  <button className="btn" onClick={() => saveShot('again')}>
                    Save, take another
                  </button>
                )
              )}
              <button className="btn ghost" onClick={retake}>
                <Icon name="repeat" /> Retake
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'import' || (stage === 'busy' && !live && imports.length)) {
    const ready = imports.filter((i) => i.shot).length;
    const pending = imports.filter((i) => !i.shot && !i.error).length;
    return (
      <div className="cam" role="dialog" aria-modal="true" aria-label="Import photos and videos">
        {fileInputs}
        <div className="cam-review">
          <div className="cam-import-list">
            {imports.length === 0 ? (
              <div className="empty" style={{ margin: 'auto' }}>
                <h3>Import photos and videos</h3>
                <p>Pick earlier progress photos or lift videos. Their dates are read from the files, and photos lose any location data.</p>
                <div className="row wrap" style={{ justifyContent: 'center', marginTop: 12 }}>
                  <button className="btn primary" onClick={() => fileRef.current?.click()}>
                    <Icon name="image" /> Choose files
                  </button>
                  <button className="btn" onClick={() => setStage('live')}>
                    <Icon name="camera" /> Use the camera
                  </button>
                </div>
              </div>
            ) : (
              <div className="import-grid">
                {imports.map((it) => (
                  <div key={it.key} className="import-item">
                    <div className="import-thumb">
                      {it.shot ? it.shot.preview ? <img src={it.shot.preview} alt="" /> : <Icon name="video" /> : it.error ? <Icon name="info" /> : <div className="spinner small" />}
                      {it.shot?.kind === 'video' && <span className="thumb-badge">{formatDuration(it.shot.duration)}</span>}
                    </div>
                    <div className="col" style={{ gap: 4, minWidth: 0 }}>
                      <span className="tiny ellipsis dim" title={it.name}>
                        {it.name}
                      </span>
                      {it.error ? (
                        <span className="tiny" style={{ color: 'var(--bad)' }}>
                          {it.error}
                        </span>
                      ) : (
                        <input
                          className="input small"
                          type="date"
                          aria-label="Date taken"
                          value={new Date(it.date - new Date(it.date).getTimezoneOffset() * 60000).toISOString().slice(0, 10)}
                          onChange={(e) => {
                            const [y, m, d] = e.target.value.split('-').map(Number);
                            if (!y) return;
                            const t = new Date(it.date);
                            t.setFullYear(y, m - 1, d);
                            setImports((cur) => cur.map((x) => (x.key === it.key ? { ...x, date: Math.min(Date.now(), t.getTime()) } : x)));
                          }}
                        />
                      )}
                    </div>
                    <button className="btn ghost icon small" aria-label="Remove" onClick={() => (revoke(it.shot), setImports((cur) => cur.filter((x) => x.key !== it.key)))}>
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="cam-review-side">
            <div className="row between">
              <h2>Import</h2>
              <button className="btn ghost icon" onClick={close} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>
            <p className="tiny muted">These details apply to every file. You can change each one later.</p>
            <DetailsForm value={meta} onChange={setMeta} showDate={false} kind="mixed" />
            <div className="row wrap cam-review-actions">
              <button className="btn primary" disabled={!ready || pending > 0 || stage === 'busy'} onClick={saveImports}>
                <Icon name="check" /> {pending ? `Reading ${pending}…` : `Save ${ready || ''}`.trim()}
              </button>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                <Icon name="plus" /> Add files
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'error') {
    return (
      <div className="cam" role="dialog" aria-modal="true" aria-label="Camera">
        {fileInputs}
        <div className="cam-top">
          <button className="cam-btn" onClick={close} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="cam-error">
          <Icon name="camera" size={34} />
          <p>{error}</p>
          <div className="col" style={{ width: 'min(320px, 100%)' }}>
            <button className="btn primary block" onClick={() => nativeRef.current?.click()}>
              <Icon name={mode === 'video' ? 'video' : 'camera'} /> Use the camera app
            </button>
            <button className="btn block" onClick={() => fileRef.current?.click()}>
              <Icon name="image" /> Choose from your library
            </button>
            <button className="btn ghost block" onClick={() => setStage('live')}>
              <Icon name="refresh" /> Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cam" role="dialog" aria-modal="true" aria-label="Camera">
      {fileInputs}
      <div className="cam-top">
        <button className="cam-btn" onClick={close} aria-label="Close">
          <Icon name="x" />
        </button>
        <Seg
          value={mode}
          onChange={(m) => stage === 'live' && setMode(m)}
          label="Photo or video"
          options={[
            { value: 'photo', label: 'Photo' },
            { value: 'video', label: 'Video' },
          ]}
        />
        <div className="grow" />
        <button
          className={`cam-btn ${mui.timer ? 'on' : ''}`}
          onClick={() => mui.set({ timer: TIMERS[(TIMERS.indexOf(mui.timer) + 1) % TIMERS.length] })}
          aria-label={`Self-timer: ${mui.timer ? `${mui.timer} seconds` : 'off'}`}
          title="Self-timer"
        >
          <Icon name="timer" />
          <span>{mui.timer ? `${mui.timer}s` : 'Off'}</span>
        </button>
        {ghostSrc && (
          <button
            className={`cam-btn ${mui.ghost ? 'on' : ''}`}
            onClick={() => mui.set({ ghost: GHOSTS[(GHOSTS.indexOf(mui.ghost) + 1) % GHOSTS.length] })}
            aria-label={`Ghost of your last photo: ${mui.ghost ? `${Math.round(mui.ghost * 100)}%` : 'off'}`}
            title={`Show your last ${meta.purpose === 'progress' ? 'photo of this pose' : 'clip of this lift'} to line up with`}
          >
            <Icon name="ghost" />
            <span>{mui.ghost ? `${Math.round(mui.ghost * 100)}%` : 'Off'}</span>
          </button>
        )}
        {cameras > 1 && (
          <button className="cam-btn" disabled={stage === 'recording'} onClick={() => mui.set({ facing: mui.facing === 'user' ? 'environment' : 'user' })} aria-label="Switch camera">
            <Icon name="flip" />
          </button>
        )}
      </div>

      <div className="cam-area" ref={areaRef}>
        <div className="cam-frame" style={{ width: box.w, height: box.h }}>
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={mirrored ? 'mirror' : ''}
            onLoadedMetadata={(e) => setSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
            onResize={(e) => setSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
          />
          {ghostSrc && mui.ghost > 0 && <img className={`cam-ghost ${mirrored ? 'mirror' : ''}`} src={ghostSrc} alt="" style={{ opacity: mui.ghost }} />}
          <svg className="cam-guides" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            {meta.purpose === 'progress' ? (
              <>
                <line x1="0" x2="100" y1="5" y2="5" />
                <line x1="0" x2="100" y1="95" y2="95" />
                <line x1="50" x2="50" y1="0" y2="100" className="faint" />
              </>
            ) : (
              <>
                <line x1="33.3" x2="33.3" y1="0" y2="100" className="faint" />
                <line x1="66.6" x2="66.6" y1="0" y2="100" className="faint" />
                <line x1="0" x2="100" y1="33.3" y2="33.3" className="faint" />
                <line x1="0" x2="100" y1="66.6" y2="66.6" className="faint" />
              </>
            )}
          </svg>
          {stage === 'countdown' && <div className="cam-count">{count}</div>}
          {stage === 'recording' && (
            <div className="cam-rec">
              <span className="rec-dot" /> {formatDuration(elapsed)}
              <span className="dim"> / {formatDuration(MAX_VIDEO_SECONDS)}</span>
            </div>
          )}
          {flash > 0 && <div key={flash} className="cam-flash" />}
          {ghostSrc && mui.ghost > 0 && ghostItem && stage === 'live' && <div className="cam-ghost-label">Ghost: {formatDate(ghostItem.date)}</div>}
        </div>
        {(!size || stage === 'busy') && (
          <div className="cam-starting">
            <div className="spinner" />
          </div>
        )}
      </div>

      <div className="cam-bottom">
        {hint && stage === 'live' && <p className="cam-hint">{hint}</p>}
        <div className="cam-context">
          {meta.purpose === 'progress' && (
            <div className="chips" role="radiogroup" aria-label="Pose">
              {POSES.filter((p) => p.id !== 'other').map((p) => (
                <button key={p.id} role="radio" aria-checked={meta.pose === p.id} className={`chip ${meta.pose === p.id ? 'on' : ''}`} onClick={() => setMeta({ pose: p.id })}>
                  {done.includes(p.id) && <Icon name="check" size={12} />} {p.label}
                </button>
              ))}
            </div>
          )}
          {meta.purpose === 'form' && (
            <select className="input cam-select" value={meta.pattern ?? ''} onChange={(e) => setMeta({ pattern: e.target.value || undefined, variant: undefined })} aria-label="Movement">
              <option value="">Movement…</option>
              {PATTERNS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {meta.purpose === 'other' && <span className="tiny muted">Photo or video for anything else</span>}
        </div>
        <div className="cam-controls">
          <button className="cam-btn round" onClick={() => fileRef.current?.click()} aria-label="Import from your library" disabled={stage === 'recording'}>
            <Icon name="image" />
          </button>
          <button
            className={`shutter ${mode} ${stage === 'recording' ? 'recording' : ''} ${stage === 'countdown' ? 'counting' : ''}`}
            onClick={shutter}
            disabled={!size || stage === 'busy'}
            aria-label={stage === 'recording' ? 'Stop recording' : stage === 'countdown' ? 'Cancel the timer' : mode === 'photo' ? 'Take photo' : 'Start recording'}
          >
            <span />
          </button>
          <span className="cam-btn round ghosted" aria-hidden>
            {pattern ? <span className="tiny">{pattern.short}</span> : <Icon name={mode === 'photo' ? 'camera' : 'video'} />}
          </span>
        </div>
      </div>
    </div>
  );
}
