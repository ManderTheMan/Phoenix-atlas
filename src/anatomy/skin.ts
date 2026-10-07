// Skin surface: a smooth implicit body built from blended primitives, plus the
// named surface regions used to colour and label taps on the skin.
import { ANKLE, ELBOW, KNEE, SHOULDER, WRIST, fingers, handFrame, handPt, thumb, toes } from './body';
import {
  boxDist,
  boxUnion,
  chain,
  ellipsoid,
  ellipsoidBetween,
  eulerRows,
  lerp3,
  roundCone,
  smax,
  smin,
  sphere,
  subtract,
  union,
  type Shape,
  type V3,
} from './sdf';
import type { StructureDef } from './types';

function headShape(): Shape {
  const head = union(
    [
      ellipsoid([0, 1.672, -0.01], [0.077, 0.106, 0.1]),
      ellipsoid([0, 1.603, 0.035], [0.061, 0.07, 0.068]),
      ellipsoid([0, 1.556, 0.078], [0.022, 0.018, 0.016]),
      ellipsoid([0, 1.634, 0.098], [0.0105, 0.021, 0.014], eulerRows(-0.25, 0, 0)),
      sphere([0, 1.622, 0.107], 0.0088),
      ellipsoid([0, 1.683, 0.072], [0.048, 0.012, 0.018]),
      ellipsoid([0, 1.585, 0.094], [0.021, 0.0085, 0.0095]),
      ellipsoid([0.038, 1.618, 0.07], [0.019, 0.019, 0.018]),
      ellipsoid([-0.038, 1.618, 0.07], [0.019, 0.019, 0.018]),
      ellipsoid([0.049, 1.578, 0.004], [0.019, 0.032, 0.036]),
      ellipsoid([-0.049, 1.578, 0.004], [0.019, 0.032, 0.036]),
      ellipsoid([0.077, 1.645, -0.01], [0.011, 0.03, 0.018]),
      ellipsoid([-0.077, 1.645, -0.01], [0.011, 0.03, 0.018]),
      roundCone([0, 1.45, -0.015], [0, 1.588, -0.008], 0.058, 0.05),
    ],
    [0.02, 0.02, 0.014, 0.01, 0.008, 0.016, 0.008, 0.02, 0.02, 0.02, 0.02, 0.006, 0.006, 0.03],
  );
  // eye sockets
  const eyes = union([sphere([0.031, 1.657, 0.103], 0.013), sphere([-0.031, 1.657, 0.103], 0.013)]);
  return subtract(head, eyes, 0.01);
}

function torsoMid(): Shape {
  return union(
    [
      ellipsoid([0, 1.4, -0.006], [0.17, 0.085, 0.1]),
      ellipsoid([0, 1.452, 0.0], [0.1, 0.03, 0.078]),
      ellipsoid([0, 1.3, -0.008], [0.152, 0.16, 0.105]),
      ellipsoid([0, 1.125, -0.003], [0.132, 0.13, 0.093]),
      ellipsoid([0, 1.055, 0.022], [0.122, 0.09, 0.086]),
      ellipsoid([0, 0.96, -0.008], [0.168, 0.11, 0.105]),
    ],
    0.05,
  );
}

function torsoSide(): Shape {
  return union(
    [
      ellipsoid([0.078, 1.338, 0.052], [0.074, 0.056, 0.045], eulerRows(0, 0, -0.15)),
      ellipsoid([0.075, 1.33, -0.052], [0.075, 0.11, 0.07]),
      ellipsoid([0.095, 1.24, -0.035], [0.075, 0.12, 0.068]),
      roundCone([0.0, 1.5, -0.03], [0.165, 1.445, -0.025], 0.05, 0.042),
      ellipsoid([0.072, 0.9, -0.058], [0.085, 0.09, 0.075]),
      ellipsoid([0.13, 0.93, -0.005], [0.06, 0.08, 0.08]),
      ellipsoid([0.112, 1.03, -0.008], [0.05, 0.07, 0.075]),
    ],
    0.05,
  );
}

function armShape(): Shape {
  const arm = union(
    [
      ellipsoid([0.192, 1.398, -0.008], [0.05, 0.065, 0.055]),
      roundCone([0.195, 1.39, -0.015], ELBOW, 0.045, 0.035),
      ellipsoidBetween([0.205, 1.33, 0.0], [0.25, 1.17, 0.0], 0.033, 0.03),
      ellipsoidBetween([0.2, 1.36, -0.04], [0.25, 1.17, -0.045], 0.032, 0.032),
      roundCone(ELBOW, WRIST, 0.037, 0.023),
      ellipsoidBetween([ELBOW[0] + 0.004, ELBOW[1] - 0.01, ELBOW[2]], lerp3(ELBOW, WRIST, 0.55), 0.039, 0.031),
    ],
    0.02,
  );
  const f = handFrame();
  const parts: Shape[] = [
    ellipsoid(handPt(0.052, 0.0, 0.003), [0.041, 0.015, 0.047], [f.l, f.n, f.d]),
    ellipsoid(handPt(0.032, 0.02, 0.01), [0.017, 0.013, 0.026], [f.l, f.n, f.d]),
  ];
  const ks: number[] = [0.01, 0.01];
  for (const fg of fingers()) {
    parts.push(chain([fg.knuckle, ...fg.joints], [0.0095, 0.0088, 0.008, 0.0072], 0.002));
    ks.push(0.006);
  }
  const th = thumb();
  parts.push(chain([th.base, ...th.joints], [0.013, 0.011, 0.0095, 0.0082], 0.003));
  ks.push(0.008);
  const hand = union(parts, ks);
  return union([arm, hand], [0, 0.012]);
}

function legShape(): Shape {
  const leg = union(
    [
      roundCone([0.092, 0.92, 0.0], [0.099, 0.52, 0.006], 0.088, 0.05),
      ellipsoidBetween([0.1, 0.84, 0.04], [0.1, 0.56, 0.035], 0.05, 0.04),
      ellipsoidBetween([0.135, 0.85, 0.0], [0.125, 0.58, 0.005], 0.04, 0.05),
      ellipsoidBetween([0.05, 0.85, 0.0], [0.08, 0.62, 0.0], 0.045, 0.05),
      ellipsoidBetween([0.09, 0.85, -0.045], [0.1, 0.56, -0.03], 0.055, 0.04),
      sphere([0.1, 0.5, 0.01], 0.046),
      roundCone([KNEE[0], KNEE[1] - 0.005, KNEE[2]], [ANKLE[0], ANKLE[1] + 0.015, ANKLE[2] - 0.003], 0.046, 0.027),
      ellipsoidBetween([0.1, 0.46, -0.032], [0.1, 0.27, -0.03], 0.048, 0.042),
      ellipsoidBetween([0.11, 0.44, 0.02], [0.105, 0.2, 0.018], 0.028, 0.024),
      sphere([0.1, 0.075, -0.012], 0.031),
    ],
    0.03,
  );
  const footParts: Shape[] = [
    ellipsoid([0.105, 0.036, 0.05], [0.043, 0.036, 0.125], eulerRows(0, 0.12, 0)),
    sphere([0.099, 0.037, -0.045], 0.037),
  ];
  const ks = [0.02, 0.02];
  for (const t of toes()) {
    footParts.push(chain([t.head, ...t.joints].map((p): V3 => [p[0], p[1] + 0.006, p[2]]), t.r + 0.0055, 0.002));
    ks.push(0.008);
  }
  const footRaw = union(footParts, ks);
  const foot: Shape = {
    d: (x, y, z) => smax(footRaw.d(x, y, z), -y, 0.01),
    box: footRaw.box,
  };
  return union([leg, foot], [0, 0.018]);
}

let cached: Shape | null = null;

/** The full skin as a symmetric signed distance field. */
export function skinShape(): Shape {
  if (cached) return cached;
  const head = headShape();
  const mid = torsoMid();
  const side = torsoSide();
  const arm = armShape();
  const leg = legShape();
  const sideBox = boxUnion(boxUnion(side.box, arm.box), leg.box);
  const mirroredBox = {
    min: [-sideBox.max[0], sideBox.min[1], sideBox.min[2]] as V3,
    max: [sideBox.max[0], sideBox.max[1], sideBox.max[2]] as V3,
  };
  const box = boxUnion(boxUnion(head.box, mid.box), mirroredBox);
  cached = {
    d: (x, y, z) => {
      const ax = Math.abs(x);
      let d = mid.d(x, y, z);
      if (boxDist(side.box, ax, y, z) < d + 0.05) d = smin(d, side.d(ax, y, z), 0.05);
      if (boxDist(head.box, x, y, z) < d + 0.03) d = smin(d, head.d(x, y, z), 0.03);
      if (boxDist(arm.box, ax, y, z) < d + 0.022) d = smin(d, arm.d(ax, y, z), 0.022);
      if (boxDist(leg.box, ax, y, z) < d + 0.025) d = smin(d, leg.d(ax, y, z), 0.025);
      return d;
    },
    box,
  };
  return cached;
}

// ----------------------------------------------------------- surface regions

type RegionSpec = [key: string, name: string, group: string, sided: boolean];

const REGION_SPECS: RegionSpec[] = [
  ['head', 'Head & scalp', 'Head', false],
  ['face', 'Face & jaw', 'Head', false],
  ['neck', 'Neck', 'Neck', false],
  ['chest', 'Chest', 'Torso', true],
  ['abdomen', 'Abdomen', 'Torso', true],
  ['upper-back', 'Upper back', 'Torso', true],
  ['lower-back', 'Lower back', 'Torso', true],
  ['shoulder', 'Shoulder', 'Arm', true],
  ['upper-arm', 'Upper arm', 'Arm', true],
  ['elbow', 'Elbow', 'Arm', true],
  ['forearm', 'Forearm', 'Arm', true],
  ['hand', 'Hand & wrist', 'Arm', true],
  ['hip', 'Hip', 'Pelvis', true],
  ['glute', 'Buttock', 'Pelvis', true],
  ['groin', 'Groin', 'Pelvis', false],
  ['thigh-front', 'Front of thigh', 'Leg', true],
  ['thigh-back', 'Back of thigh', 'Leg', true],
  ['knee', 'Knee', 'Leg', true],
  ['shin', 'Shin', 'Leg', true],
  ['calf', 'Calf', 'Leg', true],
  ['ankle', 'Ankle', 'Leg', true],
  ['foot', 'Foot', 'Leg', true],
];

export const SURFACE_REGIONS: StructureDef[] = REGION_SPECS.flatMap(([key, name, group, sided]) =>
  sided
    ? [
        { id: `skin-${key}-l`, name: `Left ${name.toLowerCase()}`, layer: 'skin' as const, group, side: 'L' as const },
        { id: `skin-${key}-r`, name: `Right ${name.toLowerCase()}`, layer: 'skin' as const, group, side: 'R' as const },
      ]
    : [{ id: `skin-${key}`, name, layer: 'skin' as const, group }],
);

const REGION_INDEX = new Map(SURFACE_REGIONS.map((r, i) => [r.id, i]));

function segParam(p: V3, a: V3, b: V3): { t: number; d: number } {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const l2 = abx * abx + aby * aby + abz * abz;
  const tr = (apx * abx + apy * aby + apz * abz) / l2;
  const t = Math.max(0, Math.min(1, tr));
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return { t: tr, d: Math.sqrt(dx * dx + dy * dy + dz * dz) };
}

/** Classify a skin point into a named surface region id. */
export function surfaceRegionAt(x: number, y: number, z: number): string {
  const ax = Math.abs(x);
  const s = x >= 0 ? 'l' : 'r';
  const p: V3 = [ax, y, z];
  const sided = (k: string) => `skin-${k}-${s}`;

  // Arms
  if (ax > 0.15 && y > 0.6 && y < 1.47) {
    const up = segParam(p, SHOULDER, ELBOW);
    const fo = segParam(p, ELBOW, WRIST);
    const tip = handPt(0.17, 0, 0);
    const ha = segParam(p, WRIST, tip);
    const dArm = Math.min(up.d, fo.d, ha.d);
    if (dArm < 0.075 && !(ax < 0.19 && y > 1.2 && up.d > 0.06)) {
      if (ha.t > -0.05 && ha.d < 0.07 && fo.t > 0.95) return sided('hand');
      const dElbow = Math.hypot(ax - ELBOW[0], y - ELBOW[1], z - ELBOW[2]);
      if (dElbow < 0.055) return sided('elbow');
      if (up.t < 0.2 || y > 1.37) return sided('shoulder');
      if (up.t <= 1) return sided('upper-arm');
      return sided('forearm');
    }
  }
  if (y > 1.535) {
    if (z > 0.03 && y < 1.705) return 'skin-face';
    if (y < 1.6 && z > 0.0) return 'skin-face';
    return 'skin-head';
  }
  if (y > 1.455 && ax < 0.075) return 'skin-neck';
  if (y > 1.42 && ax > 0.11) return sided('shoulder');
  if (y > 1.455) return 'skin-neck';
  if (y > 0.985) {
    const front = z > -0.025;
    if (front) return y > 1.215 ? sided('chest') : sided('abdomen');
    return y > 1.17 ? sided('upper-back') : sided('lower-back');
  }
  if (y > 0.83) {
    if (z < -0.035) return sided('glute');
    if (ax > 0.115) return sided('hip');
    if (y > 0.925) return sided('abdomen');
    if (ax < 0.06) return 'skin-groin';
    return sided('hip');
  }
  if (y > 0.555) {
    const axisZ = 0.0;
    return z < axisZ - 0.012 ? sided('thigh-back') : sided('thigh-front');
  }
  if (y > 0.44) return sided('knee');
  if (y > 0.11) return z > -0.008 ? sided('shin') : sided('calf');
  if (y > 0.055 && z < 0.03) return sided('ankle');
  return sided('foot');
}

export function surfaceRegionIndex(x: number, y: number, z: number): number {
  return REGION_INDEX.get(surfaceRegionAt(x, y, z)) ?? 0;
}
