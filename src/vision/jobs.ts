// Pose analyses in progress (one at a time; the tracker isn't re-entrant), so
// any screen can start one and show its progress.
import { useLiveQuery } from 'dexie-react-hooks';
import { create } from 'zustand';
import { db, type MediaItem } from '../db/db';
import { getMediaBlob } from '../media/media';
import type { PoseTrack } from './analysis';

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

/** Every saved pose track (live), for lists and the dataset view. */
export function usePoseTracks(): Map<string, PoseTrack> {
  const all = useLiveQuery(() => db.poses.toArray(), [], [] as PoseTrack[]);
  return new Map((all ?? []).map((t) => [t.id, t]));
}
