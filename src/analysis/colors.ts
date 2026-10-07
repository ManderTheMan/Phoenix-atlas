// Maps structure statuses to display colours for each colour mode.
import { LAYER_BY_ID, type LayerId } from '../anatomy/types';
import { feelingRgb, heatRgb, hexRgb, mixRgb, rgbHex } from '../lib/feeling';
import type { ColorMode } from '../state/ui';
import { STRUCTURE_BY_ID } from '../anatomy/catalog';
import type { Note } from '../db/db';
import { computeStatuses, type StructureStatus } from './status';

export function baseColor(layer: LayerId, mode: ColorMode): string {
  const l = LAYER_BY_ID[layer];
  return mode === 'anatomy' ? l.anatomyColor : l.color;
}

/** Colour for a structure with a status (undefined = draw with its base colour). */
export function statusColor(
  layer: LayerId,
  st: StructureStatus | undefined,
  mode: ColorMode,
  maxCount: number,
): string | undefined {
  if (!st || mode === 'anatomy') return undefined;
  const base = hexRgb(LAYER_BY_ID[layer].color);
  if (mode === 'feeling') {
    return rgbHex(mixRgb(base, feelingRgb(st.score), 0.45 + 0.55 * st.confidence));
  }
  if (mode === 'trend') {
    if (st.slopePerWeek === null) return rgbHex(mixRgb(base, [235, 235, 240], 0.25));
    return rgbHex(mixRgb(base, feelingRgb(Math.max(-5, Math.min(5, st.slopePerWeek * 2.5))), 0.9));
  }
  // activity
  return rgbHex(heatRgb(maxCount > 0 ? Math.sqrt(st.count / maxCount) : 0));
}

export function maxCount(statuses: Map<string, StructureStatus>): number {
  let m = 0;
  for (const s of statuses.values()) m = Math.max(m, s.count);
  return m;
}

/** Statuses + display colours for every structure that has notes in the window. */
export function computeBodyColors(
  notes: Note[],
  opts: { at?: number; windowDays: number; mode: ColorMode },
): { statuses: Map<string, StructureStatus>; colors: Map<string, string> } {
  const statuses = computeStatuses(notes, { at: opts.at, windowDays: opts.windowDays });
  const mc = maxCount(statuses);
  const colors = new Map<string, string>();
  for (const [id, st] of statuses) {
    const def = STRUCTURE_BY_ID.get(id);
    if (!def) continue;
    const c = statusColor(def.layer, st, opts.mode, mc);
    if (c) colors.set(id, c);
  }
  return { statuses, colors };
}
