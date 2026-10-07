// Organs layer.
import { meshFromShape, type MeshData } from './mc';
import {
  capsule,
  chain,
  ellipsoid,
  ellipsoidBetween,
  eulerRows,
  halfSpace,
  intersect,
  displace,
  roundCone,
  sphere,
  subtract,
  union,
  type Shape,
  type V3,
} from './sdf';
import { mergeMeshes, mirrorMesh, tube } from './tube';
import type { StructureDef } from './types';
import type { PartSpec } from './bones';

const og = (id: string, name: string, group: string, side?: 'L' | 'R', info?: string): StructureDef => ({
  id,
  name,
  layer: 'organs',
  group,
  side,
  info,
});

function brainShape(): Shape {
  const cerebrum = ellipsoid([0, 1.69, -0.012], [0.062, 0.068, 0.081]);
  const fissure: Shape = {
    d: (x, y) => Math.max(Math.abs(x) - 0.0018, 1.645 - y),
    box: { min: [-0.002, 1.645, -0.1], max: [0.002, 1.8, 0.08] },
  };
  const gyri = displace(cerebrum, 0.002, (x, y, z) =>
    0.0016 * Math.sin(x * 260 + Math.sin(y * 170) * 2.2) * Math.sin(y * 230 + Math.sin(z * 140) * 2.0) * Math.sin(z * 210 + x * 90),
  );
  const halves = subtract(gyri, fissure, 0.002);
  return union(
    [
      halves,
      ellipsoid([0, 1.632, -0.058], [0.046, 0.024, 0.03]),
      roundCone([0, 1.648, -0.02], [0, 1.59, -0.022], 0.012, 0.008),
    ],
    [0, 0.006, 0.008],
  );
}

function lungShape(right: boolean): Shape {
  const s = right ? -1 : 1;
  const w = right ? 0.062 : 0.056;
  const base = ellipsoid([s * 0.067, 1.295, -0.008], [w, 0.122, 0.078]);
  const mediastinum = halfSpace([s * 0.018, 0, 0], [-s, 0, 0]);
  let lung = intersect(base, mediastinum, 0.012);
  const dome = ellipsoid([0, 1.13, -0.005], [0.15, 0.075, 0.12]);
  lung = subtract(lung, dome, 0.015);
  if (!right) lung = subtract(lung, ellipsoid([0.025, 1.255, 0.04], [0.045, 0.05, 0.04]), 0.01);
  // fissures
  const fiss: Shape = {
    d: (_x, y, z) => Math.abs(y - (1.3 - (z + 0.02) * 0.9)) - 0.0012,
    box: { min: [-0.2, 1.1, -0.15], max: [0.2, 1.5, 0.15] },
  };
  return subtract(lung, fiss, 0.002);
}

function heartShape(): Shape {
  const rows = eulerRows(0.35, -0.3, 0.6);
  return union(
    [
      ellipsoid([0.018, 1.262, 0.034], [0.04, 0.058, 0.038], rows),
      sphere([-0.012, 1.3, 0.02], 0.026),
      sphere([0.018, 1.31, 0.002], 0.022),
    ],
    0.02,
  );
}

function aortaMesh(): MeshData {
  return tube(
    [
      [0.004, 1.3, 0.03],
      [0.0, 1.345, 0.025],
      [0.002, 1.378, 0.004],
      [0.014, 1.376, -0.022],
      [0.018, 1.34, -0.035],
      [0.016, 1.25, -0.04],
      [0.012, 1.15, -0.032],
      [0.006, 1.03, -0.02],
      [0.004, 0.99, -0.015],
    ],
    { radius: (t) => (t < 0.35 ? 0.0115 : 0.0095 - t * 0.002), radial: 12 },
  );
}

function liverShape(): Shape {
  const body = union(
    [
      ellipsoid([-0.06, 1.162, 0.0], [0.075, 0.06, 0.072], eulerRows(0, 0, -0.25)),
      ellipsoid([0.018, 1.17, 0.032], [0.058, 0.03, 0.045], eulerRows(0, 0, -0.15)),
    ],
    0.03,
  );
  const under = halfSpace([0, 1.105, 0.0], [-0.25, 1, 0.15]);
  return subtract(body, intersect(sphere([0, 1.0, 0], 0.3), under), 0.01);
}

function stomachShape(): Shape {
  return chain(
    [
      [0.058, 1.19, -0.008],
      [0.07, 1.145, 0.016],
      [0.055, 1.105, 0.038],
      [0.025, 1.095, 0.045],
      [0.002, 1.105, 0.04],
    ],
    [0.03, 0.034, 0.03, 0.02, 0.012],
    0.02,
  );
}

function kidneyShape(right: boolean): Shape {
  const s = right ? -1 : 1;
  const y = right ? 1.062 : 1.078;
  const k = ellipsoid([s * 0.052, y, -0.045], [0.021, 0.05, 0.019], eulerRows(0, 0, s * 0.18));
  return subtract(k, sphere([s * 0.031, y, -0.04], 0.012), 0.006);
}

function smallIntestineMesh(): MeshData {
  const pts: V3[] = [];
  const rows = 6;
  for (let r = 0; r < rows; r++) {
    const y = 1.05 - r * 0.022;
    const z = 0.028 + (r % 2) * 0.016;
    const wid = 0.066 - Math.abs(r - 2.5) * 0.004;
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = (r % 2 === 0 ? -1 : 1) * wid * (1 - 2 * t);
      const wob = Math.sin(i * 1.9 + r) * 0.009;
      pts.push([x, y + wob, z + Math.cos(i * 2.3 + r) * 0.01]);
    }
  }
  return tube(pts, { radius: 0.0105, radial: 9, tension: 0.5 });
}

function colonMesh(): MeshData {
  const pts: V3[] = [
    [-0.072, 0.945, 0.032],
    [-0.084, 0.98, 0.028],
    [-0.088, 1.04, 0.02],
    [-0.082, 1.085, 0.026],
    [-0.05, 1.075, 0.062],
    [0.0, 1.058, 0.072],
    [0.05, 1.075, 0.062],
    [0.084, 1.115, 0.022],
    [0.094, 1.06, 0.004],
    [0.092, 0.98, 0.006],
    [0.075, 0.928, 0.024],
    [0.035, 0.925, 0.03],
    [0.008, 0.92, -0.02],
    [0.0, 0.89, -0.05],
    [0.0, 0.862, -0.055],
  ];
  return tube(pts, {
    radius: (t) => (t > 0.86 ? 0.014 : 0.0175 + 0.0025 * Math.sin(t * 160)),
    radial: 12,
  });
}

function bladderShape(): Shape {
  return ellipsoid([0, 0.888, 0.044], [0.03, 0.025, 0.026]);
}

export function organParts(): PartSpec[] {
  const s = (f: () => Shape, step: number) => () => meshFromShape(f(), step, 1);
  let kid: MeshData | null = null;
  const kidneyL = () => (kid ??= meshFromShape(kidneyShape(false), 0.0025, 1));
  let lungL: MeshData | null = null;
  let lungR: MeshData | null = null;
  return [
    { def: og('brain', 'Brain', 'Head', undefined, 'Track headaches, focus, mood and mental energy here.'), make: s(brainShape, 0.003) },
    {
      def: og('eyes', 'Eyes', 'Head'),
      make: () => {
        const e = meshFromShape(sphere([0.031, 1.655, 0.074], 0.0115), 0.0018, 0);
        return mergeMeshes([e, mirrorMesh(e)]);
      },
    },
    {
      def: og('thyroid', 'Thyroid', 'Neck'),
      make: s(
        () =>
          union(
            [
              ellipsoid([0.012, 1.478, 0.041], [0.007, 0.016, 0.007]),
              ellipsoid([-0.012, 1.478, 0.041], [0.007, 0.016, 0.007]),
              capsule([0.01, 1.472, 0.046], [-0.01, 1.472, 0.046], 0.004),
            ],
            0.004,
          ),
        0.0015,
      ),
    },
    {
      def: og('airway', 'Trachea & bronchi', 'Chest'),
      make: s(
        () =>
          union(
            [
              ellipsoid([0, 1.548, 0.038], [0.014, 0.016, 0.012]),
              capsule([0, 1.535, 0.03], [0, 1.36, 0.004], 0.0085),
              roundCone([0, 1.36, 0.004], [0.042, 1.318, -0.006], 0.0068, 0.0048),
              roundCone([0, 1.36, 0.004], [-0.045, 1.322, -0.004], 0.0072, 0.005),
            ],
            0.006,
          ),
        0.0022,
      ),
    },
    {
      def: og('esophagus', 'Esophagus', 'Chest', undefined, 'Heartburn and reflux are often felt behind the sternum.'),
      make: () =>
        tube(
          [
            [0, 1.535, 0.012],
            [0, 1.45, -0.002],
            [0.002, 1.36, -0.02],
            [0.008, 1.26, -0.022],
            [0.022, 1.2, -0.016],
            [0.05, 1.188, -0.008],
          ],
          { radius: 0.0068, radial: 9 },
        ),
    },
    { def: og('lung-l', 'Left lung', 'Chest', 'L'), make: () => (lungL ??= meshFromShape(lungShape(false), 0.0045, 1)) },
    { def: og('lung-r', 'Right lung', 'Chest', 'R'), make: () => (lungR ??= meshFromShape(lungShape(true), 0.0045, 1)) },
    { def: og('heart', 'Heart & aorta', 'Chest', undefined, 'Note palpitations, chest tightness, resting heart rate.'), make: () => mergeMeshes([meshFromShape(heartShape(), 0.003, 1), aortaMesh()]) },
    { def: og('liver', 'Liver', 'Abdomen'), make: s(liverShape, 0.0036) },
    { def: og('gallbladder', 'Gallbladder', 'Abdomen'), make: s(() => ellipsoidBetween([-0.05, 1.12, 0.042], [-0.062, 1.092, 0.066], 0.011, 0.011), 0.0018) },
    { def: og('stomach', 'Stomach', 'Abdomen', undefined, 'Digestion, bloating, nausea, hunger.'), make: s(stomachShape, 0.0035) },
    { def: og('spleen', 'Spleen', 'Abdomen'), make: s(() => ellipsoid([0.098, 1.16, -0.05], [0.017, 0.044, 0.029], eulerRows(0.3, 0, -0.3)), 0.0028) },
    { def: og('pancreas', 'Pancreas', 'Abdomen'), make: s(() => chain([[-0.02, 1.085, 0.008], [0.03, 1.098, -0.008], [0.082, 1.12, -0.032]], [0.014, 0.01, 0.0075], 0.008), 0.0026) },
    { def: og('kidney-l', 'Left kidney', 'Abdomen', 'L'), make: kidneyL },
    { def: og('kidney-r', 'Right kidney', 'Abdomen', 'R'), make: () => meshFromShape(kidneyShape(true), 0.0025, 1) },
    { def: og('small-intestine', 'Small intestine', 'Abdomen', undefined, 'Gut comfort, cramps, food reactions.'), make: smallIntestineMesh },
    { def: og('large-intestine', 'Large intestine (colon)', 'Abdomen'), make: colonMesh },
    { def: og('bladder', 'Bladder', 'Pelvis'), make: s(bladderShape, 0.0022) },
  ];
}
