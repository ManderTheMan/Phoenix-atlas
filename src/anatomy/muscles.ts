// Muscular layer. Superficial muscles are carved out of a thin shell just under
// the skin: every point of the shell belongs to the nearest muscle "region",
// which tiles the body surface with grooves between neighbouring muscles and
// lets each muscle bulge toward its centre. Deep muscles use a deeper shell or
// their own shapes.
import { HIP } from './body';
import { sampleFn, meshFromGrid, meshFromShape, type Grid, type MeshData } from './mc';
import {
  boxDist2,
  capsule,
  chain,
  ellipsoid,
  intersect,
  shell,
  smax,
  smoothstep,
  union,
  type Box,
  type Shape,
  type V3,
} from './sdf';
import { mirrorMesh } from './tube';
import type { StructureDef } from './types';
import type { PartSpec } from './bones';

interface RegionSpec {
  key: string;
  name: string;
  group: string;
  shapes: Shape[];
  info?: string;
  midline?: boolean; // single muscle spanning both sides (not mirrored)
}

const E = (c: V3, r: V3) => ellipsoid(c, r);
const C = (a: V3, b: V3, r: number) => capsule(a, b, r);

function superficialRegions(): RegionSpec[] {
  return [
    // Head & neck
    { key: 'frontalis', name: 'frontalis (forehead)', group: 'Head', shapes: [E([0.032, 1.722, 0.074], [0.042, 0.035, 0.04])] },
    { key: 'temporalis', name: 'temporalis', group: 'Head', shapes: [E([0.07, 1.695, 0.015], [0.03, 0.042, 0.048])], info: 'Jaw-closing muscle at the temple; clenching and tension headaches.' },
    { key: 'masseter', name: 'masseter', group: 'Head', shapes: [E([0.058, 1.586, 0.042], [0.022, 0.034, 0.026])], info: 'Main chewing muscle; often tight with teeth grinding/TMJ.' },
    { key: 'scm', name: 'sternocleidomastoid', group: 'Neck', shapes: [C([0.062, 1.62, -0.012], [0.024, 1.455, 0.058], 0.022)] },
    { key: 'scalenes', name: 'scalenes', group: 'Neck', shapes: [C([0.045, 1.565, -0.012], [0.075, 1.47, -0.005], 0.017)], info: 'Side of the neck; can refer pain or tingling into the arm.' },
    {
      key: 'upper-trapezius', name: 'upper trapezius', group: 'Neck',
      shapes: [C([0.02, 1.6, -0.05], [0.16, 1.452, -0.03], 0.045), E([0.11, 1.475, -0.04], [0.06, 0.03, 0.05])],
      info: 'Shoulder-shrugging muscle; a common spot for stress tension and knots.',
    },
    {
      key: 'mid-trapezius', name: 'middle & lower trapezius', group: 'Back',
      shapes: [C([0.11, 1.4, -0.085], [0.012, 1.18, -0.1], 0.055), C([0.015, 1.45, -0.09], [0.13, 1.42, -0.07], 0.04), E([0.035, 1.37, -0.115], [0.06, 0.08, 0.05])],
    },
    // Shoulder
    { key: 'deltoid-anterior', name: 'anterior deltoid', group: 'Shoulder', shapes: [E([0.18, 1.388, 0.038], [0.036, 0.062, 0.036])] },
    { key: 'deltoid-lateral', name: 'lateral deltoid', group: 'Shoulder', shapes: [E([0.22, 1.378, -0.006], [0.032, 0.072, 0.04])] },
    { key: 'deltoid-posterior', name: 'posterior deltoid', group: 'Shoulder', shapes: [E([0.182, 1.39, -0.05], [0.036, 0.062, 0.036])] },
    { key: 'infraspinatus', name: 'infraspinatus & teres', group: 'Shoulder', shapes: [E([0.112, 1.33, -0.105], [0.058, 0.062, 0.042])], info: 'Rotator cuff muscles on the shoulder blade.' },
    // Chest & core
    { key: 'pectoralis-major', name: 'pectoralis major', group: 'Chest', shapes: [E([0.08, 1.34, 0.075], [0.096, 0.072, 0.056])] },
    { key: 'serratus-anterior', name: 'serratus anterior', group: 'Chest', shapes: [E([0.132, 1.25, 0.035], [0.042, 0.085, 0.062])] },
    { key: 'rectus-abdominis', name: 'rectus abdominis', group: 'Core', shapes: [C([0.036, 1.245, 0.098], [0.03, 0.885, 0.09], 0.042)] },
    { key: 'external-oblique', name: 'external oblique', group: 'Core', shapes: [E([0.115, 1.09, 0.03], [0.058, 0.125, 0.088]), E([0.12, 1.08, -0.04], [0.042, 0.085, 0.05])] },
    // Back
    { key: 'latissimus-dorsi', name: 'latissimus dorsi', group: 'Back', shapes: [C([0.14, 1.32, -0.045], [0.055, 1.07, -0.085], 0.07), C([0.1, 1.2, -0.08], [0.085, 1.04, -0.07], 0.05)] },
    {
      key: 'erector-spinae', name: 'erector spinae (paraspinals)', group: 'Back',
      shapes: [C([0.028, 1.28, -0.11], [0.036, 0.96, -0.092], 0.038)],
      info: 'Long back muscles alongside the spine; lower back tightness lives here.',
    },
    // Arm
    { key: 'biceps', name: 'biceps brachii', group: 'Arm', shapes: [C([0.205, 1.34, 0.03], [0.255, 1.16, 0.024], 0.033)] },
    { key: 'triceps', name: 'triceps brachii', group: 'Arm', shapes: [C([0.198, 1.365, -0.04], [0.25, 1.15, -0.052], 0.038)] },
    { key: 'brachioradialis', name: 'brachioradialis', group: 'Forearm', shapes: [C([0.28, 1.15, 0.0], [0.322, 0.93, 0.024], 0.022)] },
    { key: 'forearm-flexors', name: 'forearm flexors', group: 'Forearm', shapes: [C([0.262, 1.1, 0.024], [0.305, 0.905, 0.034], 0.031)], info: 'Grip muscles; "golfer\'s elbow" pain starts at the inner elbow.' },
    { key: 'forearm-extensors', name: 'forearm extensors', group: 'Forearm', shapes: [C([0.278, 1.1, -0.036], [0.325, 0.9, -0.006], 0.031)], info: '"Tennis elbow" pain starts at the outer elbow.' },
    // Hip
    { key: 'gluteus-maximus', name: 'gluteus maximus', group: 'Hip', shapes: [E([0.078, 0.888, -0.092], [0.08, 0.1, 0.06])] },
    { key: 'gluteus-medius', name: 'gluteus medius', group: 'Hip', shapes: [E([0.13, 0.99, -0.04], [0.055, 0.062, 0.06])], info: 'Hip stabiliser; weakness often shows up as knee or low-back issues.' },
    { key: 'tfl-it-band', name: 'TFL & IT band', group: 'Hip', shapes: [C([0.162, 0.95, 0.002], [0.142, 0.55, -0.004], 0.026)] },
    // Thigh
    { key: 'rectus-femoris', name: 'rectus femoris (quad)', group: 'Thigh', shapes: [C([0.1, 0.88, 0.078], [0.1, 0.56, 0.05], 0.034)] },
    { key: 'vastus-lateralis', name: 'vastus lateralis (quad)', group: 'Thigh', shapes: [C([0.145, 0.85, 0.022], [0.132, 0.56, 0.022], 0.04)] },
    { key: 'vastus-medialis', name: 'vastus medialis (quad)', group: 'Thigh', shapes: [E([0.066, 0.59, 0.035], [0.036, 0.075, 0.038])] },
    { key: 'adductors', name: 'adductors (inner thigh)', group: 'Thigh', shapes: [C([0.04, 0.84, 0.01], [0.07, 0.6, 0.0], 0.044)] },
    { key: 'sartorius', name: 'sartorius', group: 'Thigh', shapes: [chain([[0.13, 0.925, 0.066], [0.085, 0.74, 0.045], [0.062, 0.55, -0.005]], 0.012)] },
    { key: 'biceps-femoris', name: 'biceps femoris (hamstring)', group: 'Thigh', shapes: [C([0.11, 0.82, -0.075], [0.126, 0.53, -0.04], 0.038)] },
    { key: 'semitendinosus', name: 'semitendinosus & semimembranosus (hamstrings)', group: 'Thigh', shapes: [C([0.068, 0.82, -0.07], [0.074, 0.53, -0.04], 0.038)] },
    // Lower leg
    { key: 'tibialis-anterior', name: 'tibialis anterior', group: 'Leg', shapes: [C([0.118, 0.45, 0.036], [0.108, 0.12, 0.03], 0.02)], info: 'Lifts the foot; shin splints often involve this area.' },
    { key: 'fibularis', name: 'fibularis (peroneals)', group: 'Leg', shapes: [C([0.138, 0.45, 0.0], [0.124, 0.13, -0.02], 0.022)] },
    { key: 'gastrocnemius', name: 'gastrocnemius (calf)', group: 'Leg', shapes: [E([0.099, 0.38, -0.045], [0.058, 0.125, 0.042])] },
    { key: 'soleus', name: 'soleus', group: 'Leg', shapes: [C([0.1, 0.3, -0.035], [0.1, 0.12, -0.03], 0.036)] },
  ];
}

function deepShellRegions(): RegionSpec[] {
  return [
    { key: 'rhomboids', name: 'rhomboids', group: 'Back', shapes: [E([0.05, 1.33, -0.1], [0.04, 0.065, 0.045])], info: 'Between the shoulder blades, under the trapezius.' },
    { key: 'levator-scapulae', name: 'levator scapulae', group: 'Neck', shapes: [C([0.035, 1.58, -0.035], [0.08, 1.44, -0.07], 0.016)], info: 'Runs from the neck to the shoulder blade; "crick in the neck".' },
    { key: 'supraspinatus', name: 'supraspinatus (rotator cuff)', group: 'Shoulder', shapes: [C([0.07, 1.428, -0.075], [0.165, 1.43, -0.025], 0.017)] },
    { key: 'quadratus-lumborum', name: 'quadratus lumborum', group: 'Back', shapes: [C([0.055, 1.13, -0.07], [0.06, 1.0, -0.065], 0.028)], info: 'Deep low-back muscle between the ribs and pelvis.' },
  ];
}

const mu = (id: string, name: string, group: string, side?: 'L' | 'R', deep?: boolean, info?: string): StructureDef => ({
  id,
  name,
  layer: 'muscular',
  group,
  side,
  deep,
  info,
});

interface Region {
  spec: RegionSpec;
  shape: Shape;
}

function regionsOf(specs: RegionSpec[]): Region[] {
  return specs.map((spec) => ({ spec, shape: union(spec.shapes) }));
}

/**
 * Build the field for region `i` from the skin grid.
 * shellIn/shellOut: depth range below the skin (positive metres).
 */
function partitionField(
  regions: Region[],
  i: number,
  skin: Grid,
  shellIn: number,
  thickMin: number,
  thickMax: number,
): Grid {
  const me = regions[i].shape;
  const others = regions.map((r) => r.shape);
  const mirroredBoxes: Box[] = others.map((s) => ({
    min: [-s.box.max[0], s.box.min[1], s.box.min[2]],
    max: [-s.box.min[0], s.box.max[1], s.box.max[2]],
  }));
  const gap = 0.0024;
  const box = me.box;
  const crop: Box = {
    min: [Math.max(box.min[0], -0.004), box.min[1], box.min[2]],
    max: [box.max[0], box.max[1], box.max[2]],
  };
  const nxy = skin.nx * skin.ny;
  return sampleFn(
    crop,
    skin.step,
    (x, y, z, gi, gj, gk) => {
      const s = skin.data[gi + skin.nx * gj + nxy * gk];
      const depth = -s;
      if (depth < shellIn - 0.004 || depth > shellIn + thickMax + 0.006) return 0.01;
      const di = me.d(x, y, z);
      if (di > 0.012) return 0.01;
      // nearest competing region (including the mirrored right-side copies)
      let dmin = Infinity;
      for (let j = 0; j < others.length; j++) {
        const oj = others[j];
        if (j !== i) {
          if (dmin === Infinity || boxDist2(oj.box, x, y, z) < dmin * dmin) {
            const dj = oj.d(x, y, z);
            if (dj < dmin) dmin = dj;
          }
        }
        if (dmin === Infinity || boxDist2(mirroredBoxes[j], x, y, z) < dmin * dmin) {
          const dj = oj.d(-x, y, z);
          if (dj < dmin) dmin = dj;
        }
      }
      const margin = dmin - di; // > 0 where this muscle is the closest region
      const t = thickMin + (thickMax - thickMin) * smoothstep(0, 0.035, Math.min(margin, -di + 0.01));
      const outer = shellIn - depth; // <0 below the outer surface
      const inner = depth - (shellIn + t);
      let f = Math.max(outer, inner);
      f = smax(f, di, 0.004);
      f = smax(f, gap - margin, 0.003);
      return f;
    },
    skin,
  );
}

function iliopsoasShape(): Shape {
  return union(
    [
      chain(
        [
          [0.028, 1.13, -0.035],
          [0.04, 1.03, -0.03],
          [0.062, 0.96, 0.0],
          [0.08, 0.9, 0.035],
          [HIP[0] + 0.03, 0.865, 0.008],
        ],
        [0.012, 0.019, 0.02, 0.016, 0.009],
        0.01,
      ),
      ellipsoid([0.075, 1.0, -0.01], [0.03, 0.045, 0.012]),
    ],
    0.015,
  );
}

function diaphragmShape(): Shape {
  const dome = ellipsoid([0, 1.165, -0.008], [0.122, 0.085, 0.088]);
  const sh = shell(dome, 0.003);
  const cut: Shape = {
    d: (_x, y) => 1.165 - y,
    box: { min: [-1, 1.165, -1], max: [1, 2, 1] },
  };
  return intersect(sh, cut, 0.002);
}

function pelvicFloorShape(): Shape {
  return ellipsoid([0, 0.868, -0.012], [0.045, 0.009, 0.048]);
}

export function muscleParts(getSkinGrid: () => Grid): PartSpec[] {
  const parts: PartSpec[] = [];
  const sup = regionsOf(superficialRegions());
  const deep = regionsOf(deepShellRegions());
  const groupDefs = (regs: Region[], shellIn: number, tMin: number, tMax: number, isDeep: boolean) => {
    regs.forEach((r, i) => {
      let cache: MeshData | null = null;
      const left = () => (cache ??= meshFromGrid(partitionField(regs, i, getSkinGrid(), shellIn, tMin, tMax), 1));
      const nm = r.spec.name;
      parts.push(
        { def: mu(`${r.spec.key}-l`, `Left ${nm}`, r.spec.group, 'L', isDeep, r.spec.info), make: left },
        { def: mu(`${r.spec.key}-r`, `Right ${nm}`, r.spec.group, 'R', isDeep, r.spec.info), make: () => mirrorMesh(left()) },
      );
    });
  };
  groupDefs(sup, 0.0014, 0.0085, 0.021, false);
  groupDefs(deep, 0.024, 0.008, 0.014, true);

  let ilio: MeshData | null = null;
  const iliopsoas = () => (ilio ??= meshFromShape(iliopsoasShape(), 0.0036, 1));
  parts.push(
    { def: mu('iliopsoas-l', 'Left iliopsoas (hip flexor)', 'Hip', 'L', true, 'Deep hip flexor from the lumbar spine to the femur; tight with lots of sitting.'), make: iliopsoas },
    { def: mu('iliopsoas-r', 'Right iliopsoas (hip flexor)', 'Hip', 'R', true, 'Deep hip flexor from the lumbar spine to the femur; tight with lots of sitting.'), make: () => mirrorMesh(iliopsoas()) },
    { def: mu('diaphragm', 'Diaphragm', 'Core', undefined, true, 'Main breathing muscle under the lungs.'), make: () => meshFromShape(diaphragmShape(), 0.0036, 1) },
    { def: mu('pelvic-floor', 'Pelvic floor', 'Core', undefined, true), make: () => meshFromShape(pelvicFloorShape(), 0.0025, 1) },
  );
  return parts;
}

