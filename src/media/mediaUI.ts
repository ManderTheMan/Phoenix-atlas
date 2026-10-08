// Which media screen is open (camera, viewer, comparison, time-lapse). Any page
// can open them; they are drawn once, above everything, by <MediaModals />.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { MediaPurpose, PoseId } from '../db/db';

export interface CameraRequest {
  mode: 'photo' | 'video';
  purpose: MediaPurpose;
  pose?: PoseId;
  pattern?: string;
  variant?: string;
  /** kg */
  load?: number;
  noteId?: string;
  /** Take front, side and back one after another. */
  sequence?: boolean;
  /** Go straight to choosing files instead of the camera. */
  upload?: boolean;
}

export type MediaTab = 'body' | 'form' | 'all';

interface MediaUIState {
  /** Tab (and movement) the Media page shows when it next opens. */
  focus: { tab: MediaTab; pattern?: string } | null;
  camera: CameraRequest | null;
  viewer: { id: string; list?: string[] } | null;
  compare: { a: string; b: string } | null;
  timelapse: { pose: PoseId } | null;
  /** Blur body photos in lists until you tap them (for looking at the app in public). */
  blurBody: boolean;
  /** Camera preferences remembered per device. */
  timer: number;
  ghost: number;
  facing: 'user' | 'environment';
  openCamera: (r: CameraRequest) => void;
  openViewer: (id: string, list?: string[]) => void;
  openCompare: (a: string, b: string) => void;
  openTimelapse: (pose: PoseId) => void;
  set: (patch: Partial<Pick<MediaUIState, 'focus' | 'camera' | 'viewer' | 'compare' | 'timelapse' | 'blurBody' | 'timer' | 'ghost' | 'facing'>>) => void;
}

const storage = createJSONStorage(() => {
  try {
    localStorage.setItem('__phx_m__', '1');
    localStorage.removeItem('__phx_m__');
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  }
});

export const useMediaUI = create<MediaUIState>()(
  persist(
    (set) => ({
      focus: null,
      camera: null,
      viewer: null,
      compare: null,
      timelapse: null,
      blurBody: false,
      timer: 5,
      ghost: 0.35,
      facing: 'environment',
      openCamera: (camera) => set({ camera }),
      openViewer: (id, list) => set({ viewer: { id, list } }),
      openCompare: (a, b) => set({ compare: { a, b }, viewer: null }),
      openTimelapse: (pose) => set({ timelapse: { pose } }),
      set: (patch) => set(patch),
    }),
    {
      name: 'phoenix-atlas-media-ui',
      storage,
      partialize: (s) => ({ blurBody: s.blurBody, timer: s.timer, ghost: s.ghost, facing: s.facing }),
    },
  ),
);
