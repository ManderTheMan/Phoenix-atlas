// UI state (view settings are remembered per device).
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { LayerId } from '../anatomy/types';
import type { Vec3 } from '../db/db';
import type { NoteDraft } from '../db/notes';

export type ColorMode = 'feeling' | 'trend' | 'activity' | 'anatomy';
export type Route = 'atlas' | 'movement' | 'journal' | 'insights' | 'health' | 'reports' | 'settings' | 'profile';

export interface LayerState {
  visible: boolean;
  opacity: number;
}

export interface Selection {
  structureId: string;
  point?: Vec3;
  normal?: Vec3;
}

export type CameraView = 'front' | 'back' | 'left' | 'right' | 'angle';

interface UIState {
  route: Route;
  layers: Record<LayerId, LayerState>;
  showDeep: boolean;
  showPins: boolean;
  colorMode: ColorMode;
  windowDays: number;
  /** End of the time window; null = live (now). */
  atDate: number | null;
  selection: Selection | null;
  /** Note currently being edited (Atlas side panel or modal). */
  draft: NoteDraft | null;
  viewRequest: { view: CameraView; n: number } | null;
  toast: { msg: string; n: number } | null;
  /** Note shown in the detail modal. */
  openNoteId: string | null;
  /** Journal filters that other pages can set (e.g. "show notes with this tag"). */
  journalFilter: { tag?: string; structureId?: string; q?: string } | null;
  /** Movement pattern to show when the Movement page opens (set from other pages). */
  movementPattern: string | null;
  setRoute: (r: Route) => void;
  setLayer: (id: LayerId, patch: Partial<LayerState>) => void;
  soloLayer: (id: LayerId) => void;
  set: (patch: Partial<Pick<UIState, 'showDeep' | 'showPins' | 'colorMode' | 'windowDays' | 'atDate' | 'selection'>>) => void;
  setDraft: (d: NoteDraft | null) => void;
  updateDraft: (patch: Partial<NoteDraft>) => void;
  requestView: (v: CameraView) => void;
  showToast: (msg: string) => void;
  openNote: (id: string | null) => void;
  showJournal: (f: { tag?: string; structureId?: string; q?: string } | null) => void;
  openMovement: (pattern: string) => void;
}

const ROUTES: Route[] = ['atlas', 'movement', 'journal', 'insights', 'health', 'reports', 'settings', 'profile'];

function initialRoute(): Route {
  if (typeof location === 'undefined') return 'atlas';
  const r = location.hash.replace(/^#\/?/, '') as Route;
  return ROUTES.includes(r) ? r : 'atlas';
}

const DEFAULT_LAYERS: Record<LayerId, LayerState> = {
  skin: { visible: true, opacity: 0.18 },
  muscular: { visible: true, opacity: 1 },
  skeletal: { visible: true, opacity: 1 },
  nerves: { visible: false, opacity: 1 },
  vascular: { visible: false, opacity: 1 },
  organs: { visible: false, opacity: 1 },
};

const safeStorage = createJSONStorage(() => {
  try {
    const k = '__phx_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
  }
});

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      route: initialRoute(),
      layers: DEFAULT_LAYERS,
      showDeep: false,
      showPins: true,
      colorMode: 'feeling',
      windowDays: 30,
      atDate: null,
      selection: null,
      draft: null,
      viewRequest: null,
      toast: null,
      openNoteId: null,
      journalFilter: null,
      movementPattern: null,
      setRoute: (route) => set({ route }),
      setLayer: (id, patch) => set((s) => ({ layers: { ...s.layers, [id]: { ...s.layers[id], ...patch } } })),
      soloLayer: (id) =>
        set((s) => ({
          layers: Object.fromEntries(
            Object.entries(s.layers).map(([k, v]) => [k, { ...v, visible: k === id, opacity: k === id ? 1 : v.opacity }]),
          ) as Record<LayerId, LayerState>,
        })),
      set: (patch) => set(patch),
      setDraft: (draft) => set({ draft }),
      updateDraft: (patch) => set((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : {})),
      requestView: (view) => set((s) => ({ viewRequest: { view, n: (s.viewRequest?.n ?? 0) + 1 } })),
      showToast: (msg) => set((s) => ({ toast: { msg, n: (s.toast?.n ?? 0) + 1 } })),
      openNote: (openNoteId) => set({ openNoteId }),
      showJournal: (journalFilter) => set({ journalFilter, route: 'journal', openNoteId: null }),
      openMovement: (movementPattern) => set({ movementPattern, route: 'movement', openNoteId: null }),
    }),
    {
      name: 'phoenix-atlas-ui',
      storage: safeStorage,
      // layers added in later versions (e.g. vessels) get their defaults
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UIState>;
        const layers = { ...DEFAULT_LAYERS };
        for (const id of Object.keys(layers) as LayerId[]) if (p.layers?.[id]) layers[id] = p.layers[id];
        return { ...current, ...p, layers };
      },
      partialize: (s) => ({
        layers: s.layers,
        showDeep: s.showDeep,
        showPins: s.showPins,
        colorMode: s.colorMode,
        windowDays: s.windowDays,
      }),
    },
  ),
);
