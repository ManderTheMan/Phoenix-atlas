// Skeletal layer: each bone is an implicit shape polygonised at fine resolution.
import {
  ANKLE,
  ELBOW,
  HIP,
  KNEE,
  STERNUM_BOTTOM,
  STERNUM_TOP,
  canalPoint,
  fingers,
  handFrame,
  handPt,
  ribPath,
  ribSpecs,
  thumb,
  toes,
  vertebrae,
  type Vertebra,
} from './body';
import { meshFromShape, type MeshData } from './mc';
import {
  add,
  capsule,
  chain,
  ellipsoid,
  ellipsoidBetween,
  eulerRows,
  lerp3,
  mirror,
  roundCone,
  sphere,
  subtract,
  triPlate,
  union,
  type Shape,
  type V3,
} from './sdf';
import { mergeMeshes, mirrorMesh, tube } from './tube';
import type { StructureDef } from './types';

export interface PartSpec {
  def: StructureDef;
  make: () => MeshData;
}

const sk = (id: string, name: string, group: string, side?: 'L' | 'R', info?: string): StructureDef => ({
  id,
  name,
  layer: 'skeletal',
  group,
  side,
  info,
});

/** Build a left/right pair from a left-side shape factory (right side is mirrored). */
function pair(
  base: string,
  name: string,
  group: string,
  make: () => MeshData,
  info?: string,
): PartSpec[] {
  let cache: MeshData | null = null;
  const left = () => (cache ??= make());
  return [
    { def: sk(`${base}-l`, `Left ${name}`, group, 'L', info), make: left },
    { def: sk(`${base}-r`, `Right ${name}`, group, 'R', info), make: () => mirrorMesh(left()) },
  ];
}

const shapeMesh = (s: () => Shape, step: number, smooth = 1) => () => meshFromShape(s(), step, smooth);

// ------------------------------------------------------------- skull & jaw

function skullShape(): Shape {
  const cranium = union(
    [
      ellipsoid([0, 1.676, -0.012], [0.07, 0.092, 0.09]),
      ellipsoid([0, 1.613, 0.042], [0.05, 0.045, 0.048]),
      ellipsoid([0, 1.676, 0.06], [0.047, 0.019, 0.022]),
      capsule([0.036, 1.637, 0.064], [0.06, 1.632, 0.004], 0.0065),
      capsule([-0.036, 1.637, 0.064], [-0.06, 1.632, 0.004], 0.0065),
      ellipsoid([0, 1.582, 0.05], [0.04, 0.012, 0.03]),
    ],
    [0.02, 0.02, 0.015, 0.01, 0.01, 0.012],
  );
  const holes = union([
    sphere([0.031, 1.655, 0.084], 0.019),
    sphere([-0.031, 1.655, 0.084], 0.019),
    ellipsoid([0, 1.622, 0.092], [0.011, 0.017, 0.02]),
  ]);
  return subtract(cranium, holes, 0.006);
}

function mandibleShape(): Shape {
  const chin: V3 = [0, 1.559, 0.066];
  const angL: V3 = [0.045, 1.569, 0.0];
  const condL: V3 = [0.052, 1.617, -0.006];
  const corL: V3 = [0.046, 1.612, 0.018];
  return union(
    [
      chain([mirror(angL), [-0.03, 1.56, 0.05], chin, [0.03, 1.56, 0.05], angL], 0.008, 0.008),
      capsule(angL, condL, 0.0075),
      capsule(mirror(angL), mirror(condL), 0.0075),
      capsule(angL, corL, 0.005),
      capsule(mirror(angL), mirror(corL), 0.005),
      ellipsoid(chin, [0.016, 0.011, 0.008]),
    ],
    0.006,
  );
}

// ------------------------------------------------------------- spine

function vertebraShape(v: Vertebra): Shape {
  const [, y, z] = v.c;
  const canal = canalPoint(y);
  const zc = canal[2];
  const rc = Math.max(0.005, z - v.r * 0.85 - zc);
  const t = v.region === 'cervical' ? 0.0028 : v.region === 'thoracic' ? 0.0032 : 0.0042;
  const parts: Shape[] = [ellipsoid([0, y, z], [v.r, v.h, v.r * 0.82])];
  const P1: V3 = [rc * 0.8 + 0.001, y, z - v.r * 0.65];
  const P2: V3 = [rc + 0.0025, y, zc - rc * 0.15];
  const P3: V3 = [0, y - 0.001, zc - rc - 0.0015];
  parts.push(chain([P1, P2, P3], t), chain([mirror(P1), mirror(P2), P3], t));
  // spinous process
  if (v.region === 'cervical') {
    const tip: V3 = [0, y - 0.006, P3[2] - 0.014];
    parts.push(capsule(P3, tip, 0.003), sphere([0.003, tip[1], tip[2]], 0.0032), sphere([-0.003, tip[1], tip[2]], 0.0032));
  } else if (v.region === 'thoracic') {
    parts.push(roundCone(P3, [0, y - 0.022, P3[2] - 0.022], 0.0042, 0.0034));
  } else {
    parts.push(ellipsoidBetween(P3, [0, y - 0.004, P3[2] - 0.026], 0.0035, 0.008));
  }
  // transverse processes
  const tl = v.region === 'cervical' ? 0.021 : v.region === 'thoracic' ? 0.03 : 0.037;
  const tz = v.region === 'thoracic' ? -0.011 : -0.002;
  const T0: V3 = [rc + 0.002, y, zc - rc * 0.1];
  const T1: V3 = [tl, y + (v.region === 'lumbar' ? 0 : 0.001), zc + tz];
  parts.push(roundCone(T0, T1, t + 0.0008, t * 0.9), roundCone(mirror(T0), mirror(T1), t + 0.0008, t * 0.9));
  // articular processes (little knobs above and below)
  for (const sx of [1, -1]) {
    parts.push(sphere([sx * (rc + 0.003), y + v.h * 0.9, zc - rc * 0.2], t * 0.95));
    parts.push(sphere([sx * (rc + 0.003), y - v.h * 0.9, zc - rc * 0.4], t * 0.95));
  }
  return union(parts, 0.003);
}

function sacrumShape(): Shape {
  const top = 0.983;
  return union(
    [
      triPlate([-0.042, top, -0.043], [0.042, top, -0.043], [0, 0.893, -0.085], 0.009),
      triPlate([-0.03, top - 0.005, -0.06], [0.03, top - 0.005, -0.06], [0, 0.9, -0.09], 0.007),
      ellipsoid([0, top - 0.004, -0.036], [0.022, 0.009, 0.015]),
      ellipsoid([0.038, 0.965, -0.055], [0.01, 0.022, 0.012]),
      ellipsoid([-0.038, 0.965, -0.055], [0.01, 0.022, 0.012]),
    ],
    0.008,
  );
}

function coccyxShape(): Shape {
  return chain(
    [
      [0, 0.887, -0.087],
      [0, 0.875, -0.088],
      [0, 0.864, -0.083],
      [0, 0.856, -0.075],
    ],
    [0.0065, 0.0055, 0.0045, 0.0035],
    0.002,
  );
}

// ------------------------------------------------------------- thorax

function sternumShape(): Shape {
  const mid = lerp3(STERNUM_TOP, STERNUM_BOTTOM, 0.18);
  return union(
    [
      ellipsoid(add(STERNUM_TOP, [0, -0.01, 0]), [0.026, 0.02, 0.0075]),
      ellipsoidBetween(mid, add(STERNUM_BOTTOM, [0, 0.008, 0]), 0.0075, 0.016, [0, 0, 1]),
      capsule(STERNUM_BOTTOM, add(STERNUM_BOTTOM, [0, -0.026, -0.004]), 0.0045),
    ],
    0.008,
  );
}

function ribMesh(n: number): MeshData {
  const spec = ribSpecs()[n - 1];
  const pts = ribPath(spec, 28);
  const bonyEnd = n <= 7 ? 0.78 : n <= 10 ? 0.86 : 1;
  const r0 = n === 1 ? 0.0055 : n >= 11 ? 0.0042 : 0.0052;
  return tube(pts, {
    radius: (t) => {
      const head = t < 0.04 ? 0.0045 + t * 20 * 0.001 : r0;
      const cart = t > bonyEnd ? r0 * 0.82 : head;
      const tip = n >= 11 ? r0 * (1 - Math.max(0, t - 0.75) * 2.2) : cart;
      return Math.max(0.002, Math.min(cart, tip));
    },
    radial: 7,
  });
}

/** Costal cartilage of ribs 8–10 sweeping up to join rib 7's cartilage. */
function costalMarginMesh(): MeshData {
  const specs = ribSpecs();
  const p8 = ribPath(specs[7], 28).slice(-1)[0];
  const p9 = ribPath(specs[8], 28).slice(-1)[0];
  const p10 = ribPath(specs[9], 28).slice(-1)[0];
  const p7 = ribPath(specs[6], 28);
  const join = p7[p7.length - 3];
  return tube([p10, p9, p8, join], { radius: 0.0042, radial: 7 });
}

function clavicleShape(): Shape {
  return chain(
    [
      [0.02, 1.442, 0.06],
      [0.055, 1.449, 0.056],
      [0.105, 1.457, 0.029],
      [0.158, 1.454, -0.01],
    ],
    [0.0075, 0.006, 0.0058, 0.0075],
    0.01,
  );
}

function scapulaShape(): Shape {
  const sup: V3 = [0.068, 1.43, -0.088];
  const inf: V3 = [0.088, 1.255, -0.094];
  const lat: V3 = [0.152, 1.398, -0.058];
  const med: V3 = [0.062, 1.385, -0.092];
  return union(
    [
      triPlate(sup, inf, lat, 0.0028),
      triPlate(sup, med, inf, 0.0028),
      capsule(inf, lat, 0.0045),
      capsule(sup, inf, 0.0028),
      roundCone(med, [0.155, 1.448, -0.045], 0.0035, 0.007),
      ellipsoid([0.165, 1.452, -0.024], [0.015, 0.006, 0.02]),
      ellipsoid([0.158, 1.402, -0.034], [0.007, 0.018, 0.013]),
      chain([[0.142, 1.418, -0.045], [0.145, 1.42, -0.015], [0.15, 1.412, 0.004]], [0.006, 0.005, 0.0042], 0.003),
    ],
    [0.002, 0.002, 0.004, 0.003, 0.005, 0.006, 0.006, 0.004],
  );
}

// ------------------------------------------------------------- arm

function humerusShape(): Shape {
  const head: V3 = [0.18, 1.402, -0.022];
  return union(
    [
      sphere(head, 0.021),
      sphere([0.196, 1.408, -0.012], 0.012),
      roundCone([0.188, 1.382, -0.02], [ELBOW[0] - 0.008, ELBOW[1] + 0.03, ELBOW[2] - 0.004], 0.0115, 0.0098),
      ellipsoid([ELBOW[0] - 0.006, ELBOW[1] + 0.006, ELBOW[2]], [0.022, 0.011, 0.012], eulerRows(0, 0, 0.28)),
      sphere([ELBOW[0] + 0.012, ELBOW[1] + 0.012, ELBOW[2] - 0.006], 0.0095),
      sphere([ELBOW[0] - 0.026, ELBOW[1] + 0.016, ELBOW[2] - 0.01], 0.0105),
    ],
    [0.01, 0.008, 0.012, 0.012, 0.008, 0.008],
  );
}

function radiusShape(): Shape {
  const top: V3 = [ELBOW[0] + 0.011, ELBOW[1] - 0.012, ELBOW[2] + 0.004];
  const bot: V3 = handPt(-0.008, 0.012, 0.002);
  return union(
    [
      roundCone(top, add(top, [0.003, -0.012, 0.001]), 0.0098, 0.0075),
      roundCone(add(top, [0.003, -0.014, 0.001]), bot, 0.0068, 0.0085),
      ellipsoid(bot, [0.013, 0.008, 0.01], eulerRows(0, 0, 0.25)),
    ],
    0.008,
  );
}

function ulnaShape(): Shape {
  const olec: V3 = [ELBOW[0] - 0.016, ELBOW[1] + 0.012, ELBOW[2] - 0.022];
  const prox: V3 = [ELBOW[0] - 0.012, ELBOW[1] - 0.006, ELBOW[2] - 0.006];
  const bot: V3 = handPt(-0.006, -0.012, -0.003);
  return union(
    [
      ellipsoid(olec, [0.009, 0.013, 0.01]),
      roundCone(olec, prox, 0.009, 0.0095),
      roundCone(prox, bot, 0.0085, 0.0055),
      sphere(bot, 0.0068),
    ],
    0.007,
  );
}

function handBonesShape(): Shape {
  const f = handFrame();
  const parts: Shape[] = [ellipsoid(handPt(0.012, 0.0, 0.0), [0.021, 0.009, 0.012], [f.l, f.n, f.d])];
  const ks: number[] = [0.004];
  for (const fg of fingers()) {
    parts.push(roundCone(fg.base, fg.knuckle, 0.0048, 0.0055));
    ks.push(0.003);
    const pts = [fg.knuckle, ...fg.joints];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = lerp3(pts[i], pts[i + 1], 0.06);
      const b = lerp3(pts[i], pts[i + 1], 0.94);
      parts.push(roundCone(a, b, 0.0048 - i * 0.0007, 0.0038 - i * 0.0007));
      ks.push(0.0015);
    }
  }
  const th = thumb();
  const tp = [th.base, ...th.joints];
  for (let i = 0; i < tp.length - 1; i++) {
    const a = lerp3(tp[i], tp[i + 1], i === 0 ? 0 : 0.06);
    const b = lerp3(tp[i], tp[i + 1], 0.94);
    parts.push(roundCone(a, b, 0.0058 - i * 0.0008, 0.0045 - i * 0.0006));
    ks.push(0.0015);
  }
  return union(parts, ks);
}

// ------------------------------------------------------------- pelvis & leg

function hipBoneShape(): Shape {
  const acet: V3 = [HIP[0], HIP[1], HIP[2]];
  const asis: V3 = [0.116, 0.998, 0.052];
  const crest: V3[] = [asis, [0.128, 1.035, 0.02], [0.123, 1.053, -0.02], [0.098, 1.055, -0.05], [0.06, 1.032, -0.07]];
  const psis: V3 = [0.042, 1.0, -0.072];
  const hub: V3 = [0.088, 0.95, -0.01];
  const plates: Shape[] = [];
  const all = [...crest, psis];
  for (let i = 0; i < all.length - 1; i++) plates.push(triPlate(hub, all[i], all[i + 1], 0.0042));
  const shapes: Shape[] = [
    ...plates,
    chain([...crest, psis], 0.0058, 0.004),
    capsule(psis, [0.036, 0.975, -0.06], 0.009),
    sphere(acet, 0.0245),
    capsule(acet, [0.062, 0.862, -0.035], 0.0105),
    ellipsoid([0.06, 0.857, -0.036], [0.011, 0.01, 0.014]),
    capsule(acet, [0.012, 0.893, 0.05], 0.008),
    capsule([0.012, 0.893, 0.05], [0.048, 0.856, -0.02], 0.0065),
    capsule([0.048, 0.853, -0.02], [0.062, 0.86, -0.034], 0.007),
    capsule(asis, acet, 0.006),
  ];
  const solid = union(shapes, 0.008);
  return subtract(solid, sphere([acet[0] + 0.012, acet[1], acet[2] + 0.004], 0.019), 0.003);
}

function femurShape(): Shape {
  return union(
    [
      sphere([HIP[0] + 0.003, HIP[1], HIP[2]], 0.0205),
      roundCone([HIP[0] + 0.006, HIP[1] - 0.003, HIP[2]], [0.135, 0.915, -0.006], 0.012, 0.014),
      ellipsoid([0.148, 0.927, -0.012], [0.014, 0.022, 0.019]),
      sphere([0.12, 0.872, -0.017], 0.009),
      roundCone([0.138, 0.9, -0.006], [KNEE[0] + 0.004, KNEE[1] + 0.05, KNEE[2] - 0.002], 0.0135, 0.0125),
      ellipsoid([KNEE[0] - 0.019, KNEE[1] + 0.012, KNEE[2] - 0.004], [0.016, 0.02, 0.026]),
      ellipsoid([KNEE[0] + 0.02, KNEE[1] + 0.013, KNEE[2] - 0.004], [0.016, 0.02, 0.025]),
    ],
    [0.01, 0.012, 0.01, 0.006, 0.015, 0.018, 0.018],
  );
}

function patellaShape(): Shape {
  return ellipsoid([KNEE[0] + 0.002, KNEE[1] + 0.024, 0.04], [0.02, 0.023, 0.009], eulerRows(-0.15, 0, 0));
}

function tibiaShape(): Shape {
  return union(
    [
      ellipsoid([KNEE[0], KNEE[1] - 0.014, KNEE[2]], [0.038, 0.011, 0.028]),
      ellipsoid([KNEE[0], KNEE[1] - 0.035, KNEE[2] + 0.004], [0.026, 0.02, 0.022]),
      sphere([KNEE[0], KNEE[1] - 0.05, 0.022], 0.0075),
      roundCone([KNEE[0] - 0.001, KNEE[1] - 0.045, KNEE[2]], [ANKLE[0] - 0.006, ANKLE[1] + 0.03, ANKLE[2]], 0.0145, 0.011),
      ellipsoid([ANKLE[0] - 0.005, ANKLE[1] + 0.01, ANKLE[2] + 0.002], [0.018, 0.012, 0.018]),
      sphere([ANKLE[0] - 0.019, ANKLE[1] - 0.003, ANKLE[2] + 0.002], 0.009),
    ],
    [0.012, 0.012, 0.008, 0.015, 0.012, 0.008],
  );
}

function fibulaShape(): Shape {
  const head: V3 = [KNEE[0] + 0.03, KNEE[1] - 0.04, KNEE[2] - 0.018];
  const mal: V3 = [ANKLE[0] + 0.022, ANKLE[1] - 0.008, ANKLE[2] - 0.01];
  return union([sphere(head, 0.0095), roundCone(head, mal, 0.006, 0.0055), sphere(mal, 0.0095)], 0.006);
}

function footBonesShape(): Shape {
  const lift = 0.006;
  const L = (p: V3): V3 => [p[0], p[1] + lift, p[2]];
  const parts: Shape[] = [
    ellipsoid(L([ANKLE[0], ANKLE[1] - 0.022, ANKLE[2] + 0.004]), [0.016, 0.012, 0.021]),
    roundCone(L([0.1, 0.034, 0.0]), L([0.098, 0.022, -0.047]), 0.015, 0.016),
    ellipsoid(L([0.088, 0.045, 0.026]), [0.015, 0.01, 0.009]),
    ellipsoid(L([0.117, 0.03, 0.03]), [0.012, 0.01, 0.014]),
    ellipsoid(L([0.09, 0.04, 0.046]), [0.02, 0.011, 0.01]),
  ];
  const ks = [0.006, 0.008, 0.005, 0.005, 0.005];
  for (const t of toes()) {
    parts.push(roundCone(L(t.base), L(t.head), t.r * 0.85, t.r));
    ks.push(0.003);
    const pts = [t.head, ...t.joints].map(L);
    for (let i = 0; i < pts.length - 1; i++) {
      parts.push(roundCone(lerp3(pts[i], pts[i + 1], 0.08), lerp3(pts[i], pts[i + 1], 0.92), t.r * 0.85, t.r * 0.7));
      ks.push(0.0015);
    }
  }
  return union(parts, ks);
}

// ------------------------------------------------------------- assembly

export function boneParts(): PartSpec[] {
  const parts: PartSpec[] = [
    { def: sk('skull', 'Skull (cranium)', 'Head', undefined, 'Protects the brain; tension headaches often refer here.'), make: shapeMesh(skullShape, 0.0032) },
    { def: sk('mandible', 'Mandible (jaw)', 'Head', undefined, 'Lower jaw; TMJ issues show up at the joint in front of the ear.'), make: shapeMesh(mandibleShape, 0.0026) },
  ];
  for (const v of vertebrae()) {
    const group = v.region === 'cervical' ? 'Cervical spine' : v.region === 'thoracic' ? 'Thoracic spine' : 'Lumbar spine';
    parts.push({ def: sk(v.id, v.name, group), make: shapeMesh(() => vertebraShape(v), 0.0024, 1) });
  }
  parts.push(
    { def: sk('sacrum', 'Sacrum', 'Pelvis', undefined, 'Base of the spine; sacroiliac (SI) joints sit on either side.'), make: shapeMesh(sacrumShape, 0.003) },
    { def: sk('coccyx', 'Coccyx (tailbone)', 'Pelvis'), make: shapeMesh(coccyxShape, 0.0018) },
    { def: sk('sternum', 'Sternum', 'Thorax'), make: shapeMesh(sternumShape, 0.0027) },
  );
  for (let n = 1; n <= 12; n++) {
    parts.push(...pair(`rib-${n}`, `rib ${n}`, 'Thorax', () => (n === 7 ? mergeMeshes([ribMesh(7), costalMarginMesh()]) : ribMesh(n))));
  }
  parts.push(
    ...pair('clavicle', 'clavicle', 'Shoulder', shapeMesh(clavicleShape, 0.0026)),
    ...pair('scapula', 'scapula', 'Shoulder', shapeMesh(scapulaShape, 0.0028), 'Shoulder blade; anchors the rotator cuff.'),
    ...pair('humerus', 'humerus', 'Arm', shapeMesh(humerusShape, 0.0031)),
    ...pair('radius', 'radius', 'Arm', shapeMesh(radiusShape, 0.0026)),
    ...pair('ulna', 'ulna', 'Arm', shapeMesh(ulnaShape, 0.0026)),
    ...pair('hand-bones', 'hand & wrist bones', 'Hand', shapeMesh(handBonesShape, 0.0021, 1)),
    ...pair('hip-bone', 'hip bone (ilium, ischium, pubis)', 'Pelvis', shapeMesh(hipBoneShape, 0.0033)),
    ...pair('femur', 'femur', 'Leg', shapeMesh(femurShape, 0.0035)),
    ...pair('patella', 'patella (kneecap)', 'Leg', shapeMesh(patellaShape, 0.002)),
    ...pair('tibia', 'tibia', 'Leg', shapeMesh(tibiaShape, 0.0033)),
    ...pair('fibula', 'fibula', 'Leg', shapeMesh(fibulaShape, 0.0026)),
    ...pair('foot-bones', 'foot & ankle bones', 'Foot', shapeMesh(footBonesShape, 0.0022, 1)),
  );
  return parts;
}

