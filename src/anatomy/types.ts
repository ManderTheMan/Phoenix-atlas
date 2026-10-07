import type { MeshData } from './mc';

export type LayerId = 'skin' | 'skeletal' | 'muscular' | 'nerves' | 'organs';
export type Side = 'L' | 'R';

export interface StructureDef {
  id: string;
  name: string;
  layer: LayerId;
  group: string;
  side?: Side;
  /** Deep structures sit underneath others in the same layer (e.g. iliopsoas). */
  deep?: boolean;
  info?: string;
}

export interface StructureMesh extends MeshData {
  id: string;
  /** For the skin: per-vertex index into SURFACE_REGIONS (region colouring). */
  regions?: Uint8Array;
  /** Optional fatter proxy geometry used only for tap/click hit-testing (thin nerves). */
  hitPositions?: Float32Array;
  hitIndices?: Uint32Array;
}

export interface LayerDef {
  id: LayerId;
  name: string;
  color: string; // neutral base colour in "feeling" mode
  anatomyColor: string; // natural colour in "anatomy" mode
}

export const LAYERS: LayerDef[] = [
  { id: 'skin', name: 'Surface', color: '#9aa4b1', anatomyColor: '#e0b49a' },
  { id: 'muscular', name: 'Muscular', color: '#a3868b', anatomyColor: '#b8473f' },
  { id: 'skeletal', name: 'Skeletal', color: '#cfc8b8', anatomyColor: '#ece3cf' },
  { id: 'nerves', name: 'Nerves', color: '#c9b46a', anatomyColor: '#f1d34b' },
  { id: 'organs', name: 'Organs', color: '#a08aa6', anatomyColor: '#c0627a' },
];

export const LAYER_BY_ID: Record<LayerId, LayerDef> = Object.fromEntries(LAYERS.map((l) => [l.id, l])) as Record<
  LayerId,
  LayerDef
>;
