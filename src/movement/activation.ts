// Estimated muscle effort for a movement pattern at one point in its range:
// the torque each joint must produce, as a share of what that joint's muscles
// can typically produce at most, scaled by the group's role. It is an estimate
// from the mechanics, not a measurement of muscle activity (EMG).
import { heatRgb, rgbHex } from '../lib/feeling';
import { runModel, type JointId, type JointResult, type ModelInput, type ModelResult } from './biomech';
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

/** Demand as a share of the typical maximum for a joint. */
export function relativeDemand(j: JointResult, mass: number, sign: 1 | -1 = 1): number {
  return Math.max(0, (sign * j.demand) / (CAPACITY[j.id] * mass));
}

export function groupEfforts(p: PatternDef, result: ModelResult, mass: number): GroupEffort[] {
  return p.groups.map((tag) => {
    const base = tag.base ?? (tag.driver ? 0.04 : 0.3);
    if (!tag.driver) return { group: tag.group, role: tag.role, effort: base };
    const j = result.joints.find((x) => x.id === tag.driver!.joint);
    if (!j) return { group: tag.group, role: tag.role, effort: base };
    const r = relativeDemand(j, mass, tag.driver.sign);
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
