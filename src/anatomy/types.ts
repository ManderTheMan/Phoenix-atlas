export type LayerId = 'skin' | 'muscular' | 'skeletal' | 'nerves' | 'vascular' | 'organs';
export type Side = 'L' | 'R';

export interface StructureDef {
  id: string;
  name: string;
  /** Latin (Terminologia Anatomica) name when known. */
  latin?: string;
  layer: LayerId;
  group: string;
  side?: Side;
  /** Lies beneath other structures of the same layer (hidden when peeling to deep muscles). */
  deep?: boolean;
  /** Geometry is an approximation rather than from the anatomical dataset. */
  approx?: boolean;
  info?: string;
}

export interface LayerDef {
  id: LayerId;
  name: string;
  color: string; // neutral base colour in "feeling" mode
  anatomyColor: string; // fallback natural colour in "anatomy" mode
}

export const LAYERS: LayerDef[] = [
  { id: 'skin', name: 'Surface', color: '#9aa4b1', anatomyColor: '#e2b095' },
  { id: 'muscular', name: 'Muscular', color: '#a3868b', anatomyColor: '#b54a40' },
  { id: 'skeletal', name: 'Skeletal', color: '#cfc8b8', anatomyColor: '#e6dcc2' },
  { id: 'nerves', name: 'Nerves', color: '#c9b46a', anatomyColor: '#f0cf5a' },
  { id: 'vascular', name: 'Vessels', color: '#a5838e', anatomyColor: '#c8322f' },
  { id: 'organs', name: 'Organs', color: '#a08aa6', anatomyColor: '#c47a68' },
];

export const LAYER_BY_ID: Record<LayerId, LayerDef> = Object.fromEntries(LAYERS.map((l) => [l.id, l])) as Record<
  LayerId,
  LayerDef
>;
