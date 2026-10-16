// Estimated muscle effort for a movement pattern at one point in its range:
// the torque each joint must produce, as a share of what that joint's muscles
// can typically produce at most, scaled by the group's role. It is an estimate
// from the mechanics, not a measurement of muscle activity (EMG).
import { heatRgb, rgbHex } from '../lib/feeling';
import { runModel, type JointId, type JointResult, type ModelInput, type ModelResult } from './biomech';
import { kindOf, PEAK_FACTOR, strengthShare } from './strength';
import { groupStructures, type GroupId } from './groups';
import type { PatternDef, Role } from './patterns';

/** Typical maximal joint torque for a trained adult, N·m per kg of body mass (per side where the joint is paired). */
export const CAPACITY: Record<JointId, number> = {
  ankle: 2.6,
  knee: 3.5,
  hip: 4.2,
  lumbar: 6.5,
  shoulder: 1.3,
  elbow: 1.0,
  hipFrontal: 2.0,
  spineLateral: 2.6,
  spineAxial: 1.6,
};

const ROLE_K: Record<Role, number> = { prime: 1, synergist: 0.75, stabiliser: 0.55 };
export const ROLE_LABEL: Record<Role, string> = { prime: 'Prime mover', synergist: 'Synergist', stabiliser: 'Stabiliser' };

export interface GroupEffort {
  group: GroupId;
  role: Role;
  /** 0–1. */
  effort: number;
  joint?: JointResult;
}

/**
 * What the muscles at a joint can produce at its current angle (N·m): the typical
 * maximum, shaped by the strength curve for that angle, times your own scale.
 */
export function capacity(j: JointResult, mass: number, sign: 1 | -1 = j.demand >= 0 ? 1 : -1, scale = 1): number {
  return CAPACITY[j.id] * mass * PEAK_FACTOR * strengthShare(kindOf(j, sign), j.angle) * scale;
}

/** Demand as a share of what the joint's muscles can produce at this angle. */
export function relativeDemand(j: JointResult, mass: number, sign: 1 | -1 = 1, scale = 1): number {
  return Math.max(0, (sign * j.demand) / capacity(j, mass, sign, scale));
}

export function groupEfforts(p: PatternDef, result: ModelResult, mass: number, scale = 1): GroupEffort[] {
  return p.groups.map((tag) => {
    const base = tag.base ?? (tag.driver ? 0.04 : 0.3);
    if (!tag.driver) return { group: tag.group, role: tag.role, effort: base };
    const j = result.joints.find((x) => x.id === tag.driver!.joint);
    if (!j) return { group: tag.group, role: tag.role, effort: base };
    const r = relativeDemand(j, mass, tag.driver.sign, scale);
    return { group: tag.group, role: tag.role, effort: Math.min(1, base + r * ROLE_K[tag.role] * (tag.share ?? 1)), joint: j };
  });
}

export function effortColor(e: number): string {
  return rgbHex(heatRgb(0.08 + 0.92 * Math.max(0, Math.min(1, e))));
}

/** Structure colours for the 3D body (the strongest group wins where groups overlap). */
export function effortColors(efforts: GroupEffort[], minEffort = 0.06): Map<string, string> {
  const best = new Map<string, number>();
  for (const e of efforts) {
    if (e.effort < minEffort) continue;
    for (const id of groupStructures(e.group)) best.set(id, Math.max(best.get(id) ?? 0, e.effort));
  }
  return new Map([...best].map(([id, e]) => [id, effortColor(e)]));
}

/** Runs a pattern's model over its range (for curves and peaks). */
export function sweep(p: PatternDef, inp: Omit<ModelInput, 'phase'>, steps = 24): { phase: number; result: ModelResult }[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const phase = i / steps;
    return { phase, result: runModel(p.model, { ...inp, phase }) };
  });
}

/** The hardest joint at one point in the range: its share of what it can produce there. */
export function hardest(result: ModelResult, mass: number, scale = 1): { joint: JointResult; rel: number } | null {
  let best: { joint: JointResult; rel: number } | null = null;
  for (const j of result.joints) {
    if (Math.abs(j.demand) < 4) continue; // held by the joint, not the muscles
    const rel = relativeDemand(j, mass, j.demand >= 0 ? 1 : -1, scale);
    if (!best || rel > best.rel) best = { joint: j, rel };
  }
  return best;
}

export interface StickingPoint {
  phase: number;
  joint: JointResult;
  /** Share of what that joint can produce there (1 = at your max). */
  rel: number;
}

/** Where in the range the lift is hardest: the point where some joint is closest to what it can produce. */
export function stickingPoint(points: { phase: number; result: ModelResult }[], mass: number, scale = 1): StickingPoint | null {
  let best: StickingPoint | null = null;
  for (const { phase, result } of points) {
    const h = hardest(result, mass, scale);
    if (h && (!best || h.rel > best.rel)) best = { phase, joint: h.joint, rel: h.rel };
  }
  return best;
}

/**
 * Your strength against the typical trained adult the curves describe, from a
 * max: at that load the hardest point of the lift should be all you've got, so
 * the scale is how hard the model finds it with typical strength.
 */
export function personalScale(p: PatternDef, inp: Omit<ModelInput, 'phase' | 'load'>, max: number): number {
  if (!(max > 0)) return 1;
  const sp = stickingPoint(sweep(p, { ...inp, load: max }, 24), inp.mass);
  return sp ? Math.max(0.4, Math.min(2.5, sp.rel)) : 1;
}
