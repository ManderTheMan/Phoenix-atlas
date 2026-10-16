// Pose analyses in progress (one at a time; the tracker isn't re-entrant), so
// any screen can start one and show its progress.
import { useLiveQuery } from 'dexie-react-hooks';
import { create } from 'zustand';
import { db, type MediaItem } from '../db/db';
import { getMediaBlob } from '../media/media';
import type { BodyDims } from '../model/bodyShape';
import { trackSummary, type PoseTrack } from './analysis';
import { FORM_VERSION, formSummary, hasForm } from './form';
import { hasVelocity, timeScaleOf, velocitySummary } from './velocity';

interface Job {
  done: number;
  total: number;
}

interface JobsState {
  jobs: Record<string, Job>;
  queue: string[];
  error: Record<string, string>;
  start: (items: MediaItem[]) => void;
  stop: () => void;
}

let controller: AbortController | null = null;
let running = false;

export const useVisionJobs = create<JobsState>()((set, get) => ({
  jobs: {},
  queue: [],
  error: {},
  start(items) {
    const ids = items.map((i) => i.id).filter((id) => !get().queue.includes(id) && !get().jobs[id]);
    if (!ids.length) return;
    set((s) => ({ queue: [...s.queue, ...ids], error: Object.fromEntries(Object.entries(s.error).filter(([k]) => !ids.includes(k))) }));
    void pump();
  },
  stop() {
    controller?.abort();
    set({ queue: [] });
  },
}));

async function pump() {
  if (running) return;
  running = true;
  try {
    const { analyzeMedia } = await import('./runner');
    for (;;) {
      const id = useVisionJobs.getState().queue[0];
      if (!id) break;
      useVisionJobs.setState((s) => ({ queue: s.queue.slice(1), jobs: { ...s.jobs, [id]: { done: 0, total: 1 } } }));
      controller = new AbortController();
      try {
        const item = await db.media.get(id);
        const blob = item && (await getMediaBlob(id));
        if (!item || !blob) throw new Error('File not found');
        await analyzeMedia(item, blob, {
          signal: controller.signal,
          onProgress: (p) => useVisionJobs.setState((s) => ({ jobs: { ...s.jobs, [id]: p } })),
        });
      } catch (e) {
        if ((e as Error).name !== 'AbortError') useVisionJobs.setState((s) => ({ error: { ...s.error, [id]: (e as Error).message } }));
      } finally {
        useVisionJobs.setState((s) => {
          const jobs = { ...s.jobs };
          delete jobs[id];
          return { jobs };
        });
      }
    }
  } finally {
    running = false;
    controller = null;
  }
}

/** The saved pose track of a photo or video (live). */
export function usePoseTrack(id: string | null | undefined): PoseTrack | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.poses.get(id)) ?? null) : null), [id]);
}


const noTrack = new Set<string>();

const staleSummary = (m: MediaItem) => !!m.pattern && m.tracked?.pattern !== m.pattern;
const staleSpeed = (m: MediaItem, dims?: BodyDims) => !!dims && hasVelocity(m.pattern) && m.velocity?.pattern !== m.pattern;
const staleForm = (m: MediaItem, dims?: BodyDims) => !!dims && hasForm(m.pattern) && (m.form?.pattern !== m.pattern || (m.form?.v ?? 1) < FORM_VERSION);

/**
 * Keeps each clip's reps-and-depth summary, rep speeds and form markers in step with its movement and joint track, a few
 * clips at a time, so long lists (years of archive clips) never need every track in memory.
 */
export async function refreshSummaries(items: MediaItem[], dims?: BodyDims, limit = 25): Promise<number> {
  const stale = items.filter((m) => m.kind === 'video' && (staleSummary(m) || staleSpeed(m, dims) || staleForm(m, dims)) && !noTrack.has(m.id)).slice(0, limit);
  let n = 0;
  for (const m of stale) {
    const t = await db.poses.get(m.id);
    if (!t) {
      noTrack.add(m.id);
      continue;
    }
    const patch: Partial<MediaItem> = {};
    if (staleSummary(m)) patch.tracked = trackSummary(t, m.pattern!);
    if (staleSpeed(m, dims)) {
      const k = timeScaleOf(m);
      // an empty record when there's nothing to measure, so it isn't looked at again
      patch.velocity = (k !== null && velocitySummary(t, m.pattern!, dims!, { timeScale: k })) || { pattern: m.pattern!, v: [], peak: [], rom: [], dur: [], h: dims!.height, point: 'wrist' };
    }
    if (staleForm(m, dims)) {
      const k = timeScaleOf(m);
      patch.form = (k !== null && formSummary(t, m.pattern!, dims!, { timeScale: k })) || { v: FORM_VERSION, pattern: m.pattern!, reps: [], h: dims!.height };
    }
    await db.media.update(m.id, patch);
    n++;
  }
  return n;
}

/** Saved pose tracks for some media items only. */
export function usePoseTracksFor(ids: string[]): Map<string, PoseTrack> {
  const key = ids.join(',');
  const list = useLiveQuery(() => db.poses.bulkGet(ids), [key], [] as (PoseTrack | undefined)[]);
  return new Map((list ?? []).filter((t): t is PoseTrack => !!t).map((t) => [t.id, t]));
}
