// Every progress photo of one pose played in order, lined up, with the date
// and your weight at the time. Can be saved as a video to share.
import { useEffect, useMemo, useState } from 'react';
import type { MediaItem, PoseId } from '../../db/db';
import { DAY, formatDate } from '../../lib/dates';
import { alignTransform, getMediaBlob, measurementsNear, POSE_BY_ID, poseSeries, useMedia } from '../../media/media';
import { useMediaUI } from '../../media/mediaUI';
import { recorderMime } from '../../media/process';
import { formatMeasure, useBody } from '../../profile/profile';
import { useUI } from '../../state/ui';
import { Seg } from '../common';
import Icon from '../Icon';
import { useFit } from './useFit';

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Could not load a photo'));
    i.src = url;
  });
}

/** Draws a photo into a frame like CSS object-fit: contain plus its alignment. */
function drawFit(ctx: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number, align?: MediaItem['align']) {
  const k = Math.min(W / img.naturalWidth, H / img.naturalHeight);
  const w = img.naturalWidth * k, h = img.naturalHeight * k;
  const a = align ?? { x: 0, y: 0, s: 1 };
  ctx.save();
  ctx.translate(W / 2 + a.x * W, H / 2 + a.y * H);
  ctx.scale(a.s, a.s);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

async function exportVideo(items: MediaItem[], urls: Map<string, string>, aspect: number, hold: number, caption: (m: MediaItem) => string, title: string): Promise<Blob> {
  const mime = recorderMime();
  if (mime === undefined) throw new Error('This browser can’t make videos.');
  const H = 1280, W = Math.round((H * aspect) / 2) * 2;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const imgs = await Promise.all(items.map((m) => loadImg(urls.get(m.id)!)));
  const stream = c.captureStream(30);
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((res) => (rec.onstop = () => res()));
  const total = items.length * hold + 0.8;
  rec.start(250);
  const t0 = performance.now();
  await new Promise<void>((res) => {
    const frame = () => {
      const t = (performance.now() - t0) / 1000;
      const i = Math.min(items.length - 1, Math.floor(t / hold));
      ctx.fillStyle = '#0e1117';
      ctx.fillRect(0, 0, W, H);
      drawFit(ctx, imgs[i], W, H, items[i].align);
      const pad = Math.round(H * 0.03);
      ctx.font = `600 ${Math.round(H * 0.032)}px system-ui, sans-serif`;
      const text = caption(items[i]);
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(10,12,16,0.72)';
      ctx.fillRect(pad - 12, H - pad - H * 0.05, tw + 24, H * 0.062);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, pad, H - pad - H * 0.008);
      ctx.font = `600 ${Math.round(H * 0.022)}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(title, pad, pad + H * 0.02);
      if (t < total) requestAnimationFrame(frame);
      else res();
    };
    requestAnimationFrame(frame);
  });
  // let the encoder catch up before stopping
  await new Promise((r) => setTimeout(r, 1000));
  rec.stop();
  await done;
  stream.getTracks().forEach((tr) => tr.stop());
  return new Blob(chunks, { type: (rec.mimeType || mime || 'video/webm').split(';')[0] });
}

export default function Timelapse({ pose }: { pose: PoseId }) {
  const mui = useMediaUI();
  const ui = useUI();
  const media = useMedia();
  const { entries, profile } = useBody();
  const series = useMemo(() => poseSeries(media, pose), [media, pose]);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState(2);
  const [busy, setBusy] = useState(false);
  const first = series[0];
  const [areaRef, box] = useFit(first ? first.width / Math.max(1, first.height) : 0.75);
  const close = () => mui.set({ timelapse: null });

  const ids = series.map((m) => m.id).join(',');
  useEffect(() => {
    let live = true;
    const made: string[] = [];
    (async () => {
      const m = new Map<string, string>();
      for (const it of series) {
        const b = await getMediaBlob(it.id);
        if (!b || !live) continue;
        const u = URL.createObjectURL(b);
        made.push(u);
        m.set(it.id, u);
        if (live) setUrls(new Map(m));
      }
    })();
    return () => {
      live = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  useEffect(() => {
    if (!playing || series.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % series.length), 1000 / rate);
    return () => clearInterval(t);
  }, [playing, rate, series.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === ' ') (e.preventDefault(), setPlaying((p) => !p));
      if (e.key === 'ArrowLeft') (setPlaying(false), setI((x) => Math.max(0, x - 1)));
      if (e.key === 'ArrowRight') (setPlaying(false), setI((x) => Math.min(series.length - 1, x + 1)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!first) return null;
  const cur = series[Math.min(i, series.length - 1)];
  const weightAt = (m: MediaItem) => measurementsNear(entries, m.date).weight?.value;
  const caption = (m: MediaItem) => {
    const w = weightAt(m);
    return `${formatDate(m.date)} · day ${Math.round((m.date - first.date) / DAY)}${w ? ` · ${formatMeasure(w, 'kg', profile.units)}` : ''}`;
  };
  const poseLabel = POSE_BY_ID.get(pose)?.label ?? '';

  const save = async () => {
    if (urls.size < series.length) return ui.showToast('Still loading the photos…');
    setBusy(true);
    setPlaying(false);
    try {
      const blob = await exportVideo(series, urls, first.width / first.height, Math.max(0.35, 1 / rate), caption, `${poseLabel} · Phoenix Atlas`);
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([blob], `progress-${pose}.${ext}`, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `${poseLabel} progress` });
          return;
        } catch (e) {
          if ((e as Error).name === 'AbortError') return;
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    } catch (e) {
      ui.showToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mv tl" role="dialog" aria-modal="true" aria-label={`${poseLabel} time-lapse`}>
      <div className="mv-stage">
        <div className="mv-top">
          <button className="cam-btn" onClick={close} aria-label="Close">
            <Icon name="x" />
          </button>
          <div className="mv-title">
            <strong>{poseLabel} time-lapse</strong>
            <span className="tiny dim">
              {series.length} photos · {formatDate(first.date)} → {formatDate(series[series.length - 1].date)}
            </span>
          </div>
        </div>
        <div className="mv-area" ref={areaRef}>
          <div className="mv-frame tl-frame" style={{ width: box.w, height: box.h }}>
            {urls.get(cur.id) && <img key={cur.id} src={urls.get(cur.id)} alt={formatDate(cur.date)} style={{ transform: alignTransform(cur.align) }} draggable={false} />}
            <span className="tl-caption">{caption(cur)}</span>
          </div>
        </div>
        <div className="vbar">
          <div className="vbar-scrub">
            <input type="range" min={0} max={series.length - 1} step={1} value={i} onChange={(e) => (setPlaying(false), setI(Number(e.target.value)))} aria-label="Photo" />
          </div>
          <div className="vbar-row">
            <button className="btn icon vbar-play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
              <Icon name={playing ? 'pause' : 'play'} size={16} />
            </button>
            <span className="mono tiny vbar-time">
              {i + 1} / {series.length}
            </span>
            <div className="grow" />
            <Seg value={rate} onChange={setRate} label="Photos per second" options={[1, 2, 4].map((r) => ({ value: r, label: `${r}/s` }))} />
            <button className="btn small" onClick={save} disabled={busy}>
              <Icon name="download" /> {busy ? 'Making video…' : 'Save as video'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
