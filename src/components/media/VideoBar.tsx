// Playback controls for analysing a clip: slow motion, frame steps, loop, and
// a scrubber with ticks for marked positions.
import { useEffect, useState } from 'react';
import { Seg } from '../common';
import Icon from '../Icon';

export const FRAME = 1 / 30;
export const SPEEDS = [0.25, 0.5, 1] as const;

/**
 * The video's current time, updated every frame while it plays. Takes the element
 * itself (kept in state with `ref={setEl}`) so it attaches whenever the video mounts.
 */
export function useVideoTime(v: HTMLVideoElement | null): { t: number; playing: boolean } {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!v) return;
    setT(v.currentTime);
    setPlaying(!v.paused);
    let raf = 0;
    const tick = () => {
      setT(v.currentTime);
      if (!v.paused) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      setT(v.currentTime);
    };
    const onSeek = () => setT(v.currentTime);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeek);
    v.addEventListener('timeupdate', onSeek);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', onSeek);
      v.removeEventListener('timeupdate', onSeek);
    };
  }, [v]);
  return { t, playing };
}

export function fmtTime(s: number): string {
  if (!Number.isFinite(s)) return '0:00.0';
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

export interface Tick {
  t: number;
  color: string;
  label: string;
}

export default function VideoBar({
  t,
  duration,
  playing,
  onToggle,
  onSeek,
  onStep,
  speed,
  onSpeed,
  loop,
  onLoop,
  ticks = [],
}: {
  t: number;
  duration: number;
  playing: boolean;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onStep: (dir: 1 | -1) => void;
  speed: number;
  onSpeed: (s: number) => void;
  loop: boolean;
  onLoop: (v: boolean) => void;
  ticks?: Tick[];
}) {
  const d = duration > 0 ? duration : 1;
  return (
    <div className="vbar">
      <div className="vbar-scrub">
        <input type="range" min={0} max={d} step={FRAME / 2} value={Math.min(t, d)} onChange={(e) => onSeek(Number(e.target.value))} aria-label="Position in the video" />
        {ticks.map((k, i) => (
          <button key={i} className="vbar-tick" style={{ left: `${(k.t / d) * 100}%`, background: k.color }} title={`${k.label} · ${fmtTime(k.t)}`} aria-label={`Go to ${k.label}`} onClick={() => onSeek(k.t)} />
        ))}
      </div>
      <div className="vbar-row">
        <button className="btn icon small" onClick={() => onStep(-1)} aria-label="Back one frame" title="Back one frame (←)">
          <Icon name="stepBack" size={15} />
        </button>
        <button className="btn icon vbar-play" onClick={onToggle} aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (space)">
          <Icon name={playing ? 'pause' : 'play'} size={16} />
        </button>
        <button className="btn icon small" onClick={() => onStep(1)} aria-label="Forward one frame" title="Forward one frame (→)">
          <Icon name="stepForward" size={15} />
        </button>
        <span className="mono tiny vbar-time">
          {fmtTime(t)} <span className="muted">/ {fmtTime(duration)}</span>
        </span>
        <div className="grow" />
        <Seg value={speed} onChange={onSpeed} label="Playback speed" options={SPEEDS.map((s) => ({ value: s, label: s === 1 ? '1×' : `${s}×`, title: s < 1 ? 'Slow motion' : 'Normal speed' }))} />
        <button className={`btn icon small ${loop ? 'on' : ''}`} onClick={() => onLoop(!loop)} aria-pressed={loop} aria-label="Loop" title="Loop">
          <Icon name="repeat" size={15} />
        </button>
      </div>
    </div>
  );
}
