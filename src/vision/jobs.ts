// Pose analyses in progress (one at a time; the tracker isn't re-entrant), so
// any screen can start one and show its progress.
import { useLiveQuery } from 'dexie-react-hooks';
import { create } from 'zustand';
import { db, type MediaItem } from '../db/db';
import { getMediaBlob } from '../media/media';
import { trackSummary, type PoseTrack } from './analysis';

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

/**
 * Keeps each clip's reps-and-depth summary in step with its movement and joint track, a few clips at a
 * time, so long lists (years of archive clips) never need every track in memory.
 */
export async function refreshSummaries(items: MediaItem[], limit = 25): Promise<number> {
  const stale = items.filter((m) => m.kind === 'video' && m.pattern && m.tracked?.pattern !== m.pattern && !noTrack.has(m.id)).slice(0, limit);
  let n = 0;
  for (const m of stale) {
    const t = await db.poses.get(m.id);
    if (!t) {
      noTrack.add(m.id);
      continue;
    }
    await db.media.update(m.id, { tracked: trackSummary(t, m.pattern!) });
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
