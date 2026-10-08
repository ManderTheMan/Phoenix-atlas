// Measures the reference body: joint centres, segment lengths and the girths a
// tape measure would give, taken from the built atlas layers. The results
// (src/anatomy/landmarks.json) let the app scale the model to someone's own
// measurements and give the movement models their default proportions.
//   npx tsx scripts/build-landmarks.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LayerId } from '../src/anatomy/types';
import { buildLayerModel, type LayerModel } from '../src/model/atlasModel';

type V3 = [number, number, number];
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const layer = (id: LayerId) => buildLayerModel(new Uint8Array(readFileSync(join(root, 'public', 'atlas', `${id}.bin`))));
const skin = layer('skin');
const bones = layer('skeletal');

function points(m: LayerModel, id: string): V3[] {
  const i = m.indexOf.get(id);
  if (i === undefined) throw new Error(`missing ${id}`);
  const [v0, vc] = m.ranges[i];
  const p = m.geometry.getAttribute('position');
  const out: V3[] = [];
  for (let v = v0; v < v0 + vc; v++) out.push([p.getX(v), p.getY(v), p.getZ(v)]);
  return out;
}
const bbox = (pts: V3[]) => {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let a = 0; a < 3; a++) (min[a] = Math.min(min[a], p[a])), (max[a] = Math.max(max[a], p[a]));
  return { min, max, center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] as V3 };
};
const mean = (pts: V3[]): V3 => {
  const c: V3 = [0, 0, 0];
  for (const p of pts) (c[0] += p[0]), (c[1] += p[1]), (c[2] += p[2]);
  return [c[0] / pts.length, c[1] / pts.length, c[2] / pts.length];
};
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const mid = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/** Least-squares sphere through points: x²+y²+z² = 2c·p + d. */
function sphereFit(pts: V3[]): { center: V3; radius: number } {
  const A = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  const b = [0, 0, 0, 0];
  for (const [x, y, z] of pts) {
    const row = [2 * x, 2 * y, 2 * z, 1];
    const r = x * x + y * y + z * z;
    for (let i = 0; i < 4; i++) {
      b[i] += row[i] * r;
      for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j];
    }
  }
  // Gaussian elimination
  for (let i = 0; i < 4; i++) {
    let p = i;
    for (let k = i + 1; k < 4; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    [A[i], A[p]] = [A[p], A[i]];
    [b[i], b[p]] = [b[p], b[i]];
    for (let k = i + 1; k < 4; k++) {
      const f = A[k][i] / A[i][i];
      for (let j = i; j < 4; j++) A[k][j] -= f * A[i][j];
      b[k] -= f * b[i];
    }
  }
  const s = [0, 0, 0, 0];
  for (let i = 3; i >= 0; i--) {
    let v = b[i];
    for (let j = i + 1; j < 4; j++) v -= A[i][j] * s[j];
    s[i] = v / A[i][i];
  }
  const center: V3 = [s[0], s[1], s[2]];
  return { center, radius: Math.sqrt(s[3] + s[0] ** 2 + s[1] ** 2 + s[2] ** 2) };
}

/** Centre of a joint head: sphere fit to the bone surface near its most extreme point. */
function headCentre(pts: V3[], score: (p: V3) => number, reach: number) {
  let p0 = pts[0];
  for (const p of pts) if (score(p) > score(p0)) p0 = p;
  return sphereFit(pts.filter((p) => dist(p, p0) < reach));
}

// ---------------------------------------------------------------- girths

/** Points where a horizontal plane cuts the skin, limited to some structures. */
function sliceY(m: LayerModel, y: number, keep: (id: string) => boolean): [number, number][] {
  const pos = m.geometry.getAttribute('position');
  const idx = m.geometry.getIndex()!;
  const st = m.geometry.getAttribute('aStruct');
  const out: [number, number][] = [];
  for (let t = 0; t < idx.count; t += 3) {
    if (!keep(m.ids[st.getX(idx.getX(t))])) continue;
    for (let e = 0; e < 3; e++) {
      const a = idx.getX(t + e), b = idx.getX(t + ((e + 1) % 3));
      const ya = pos.getY(a), yb = pos.getY(b);
      if ((ya - y) * (yb - y) > 0 || ya === yb) continue;
      const k = (y - ya) / (yb - ya);
      out.push([pos.getX(a) + (pos.getX(b) - pos.getX(a)) * k, pos.getZ(a) + (pos.getZ(b) - pos.getZ(a)) * k]);
    }
  }
  return out;
}

/** Perimeter of the convex hull — what a tape measure spans. */
function hullPerimeter(pts: [number, number][]): number {
  if (pts.length < 3) return 0;
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  let per = 0;
  for (let i = 0; i < hull.length; i++) per += Math.hypot(hull[i][0] - hull[(i + 1) % hull.length][0], hull[i][1] - hull[(i + 1) % hull.length][1]);
  return per;
}

const UPPER_LIMB = /region_of_arm|bicipital|deltoid_region|forearm|elbow|cubital|wrist|carpal|radial_foveola|hand|palm|digits_of_hand|nail_plate_l$|nail_plate_r$|perionyx_[lr]$/;
const torso = (id: string) => !UPPER_LIMB.test(id) && !/auricle|auricular|helix|tragus|concha|scapha|lobule/.test(id);

function girth(y: number, keep: (id: string) => boolean) {
  return { y: round(y), cm: round(hullPerimeter(sliceY(skin, y, keep)) * 100, 1) };
}
function maxGirth(y0: number, y1: number, keep: (id: string) => boolean) {
  let best = girth(y0, keep);
  for (let i = 1; i <= 24; i++) {
    const g = girth(y0 + ((y1 - y0) * i) / 24, keep);
    if (g.cm > best.cm) best = g;
  }
  return best;
}
const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const r3 = (p: V3): V3 => [round(p[0]), round(p[1]), round(p[2])];

// ---------------------------------------------------------------- joints

const joints: Record<string, V3> = {};
/** Lengths between the bony landmarks people measure with a tape (per side, averaged later). */
const measured: Record<string, number[]> = { upperArm: [], forearm: [], hand: [], thigh: [], shank: [], foot: [] };
const axes: Record<string, V3> = {};
const lengths: Record<string, number> = {};
const girths: Record<string, { y: number; cm: number }> = {};

for (const s of ['l', 'r'] as const) {
  const sx = s === 'l' ? 1 : -1;
  // hip: femoral head
  const femur = points(bones, `skeletal.femur_${s}`);
  const fTop = bbox(femur).max[1];
  const hip = headCentre(femur.filter((p) => p[1] > fTop - 0.09), (p) => -sx * p[0], 0.03);
  if (hip.radius < 0.015 || hip.radius > 0.035) throw new Error(`femoral head fit looks wrong (${hip.radius})`);
  joints[`hip_${s}`] = hip.center;
  // knee: centre of the femoral condyles
  const fMin = bbox(femur).min[1];
  joints[`knee_${s}`] = bbox(femur.filter((p) => p[1] < fMin + 0.045)).center;
  // ankle: between the malleolus tips
  const tibia = points(bones, `skeletal.tibia_${s}`);
  const fibula = points(bones, `skeletal.fibula_${s}`);
  const medMal = bbox(tibia.filter((p) => p[1] < bbox(tibia).min[1] + 0.012)).center;
  const latMal = bbox(fibula.filter((p) => p[1] < bbox(fibula).min[1] + 0.012)).center;
  joints[`ankle_${s}`] = mid(medMal, latMal);
  axes[`ankle_${s}`] = [latMal[0] - medMal[0], latMal[1] - medMal[1], latMal[2] - medMal[2]];
  // foot
  const calc = points(bones, `skeletal.calcaneus_${s}`);
  let heel = calc[0];
  for (const p of calc) if (p[2] < heel[2]) heel = p;
  const toes = ['first', 'second', 'third'].flatMap((f) => points(bones, `skeletal.distal_phalanx_of_${f}_finger_of_foot_${s}`));
  let toe = toes[0];
  for (const p of toes) if (p[2] > toe[2]) toe = p;
  joints[`heel_${s}`] = heel;
  joints[`toe_${s}`] = toe;
  // shoulder: humeral head
  const humerus = points(bones, `skeletal.humerus_${s}`);
  const hTop = bbox(humerus).max[1];
  const sh = headCentre(humerus.filter((p) => p[1] > hTop - 0.07), (p) => p[1] - 0.6 * sx * p[0], 0.032);
  if (sh.radius < 0.016 || sh.radius > 0.035) throw new Error(`humeral head fit looks wrong (${sh.radius})`);
  joints[`shoulder_${s}`] = sh.center;
  // elbow: between the epicondyles
  const hMin = bbox(humerus).min[1];
  const distal = bbox(humerus.filter((p) => p[1] < hMin + 0.04));
  joints[`elbow_${s}`] = distal.center;
  // wrist
  const radius = points(bones, `skeletal.radius_${s}`);
  const ulna = points(bones, `skeletal.ulna_${s}`);
  const rTip = bbox(radius.filter((p) => p[1] < bbox(radius).min[1] + 0.02)).center;
  const uTip = bbox(ulna.filter((p) => p[1] < bbox(ulna).min[1] + 0.02)).center;
  const w = mid(rTip, uTip);
  joints[`wrist_${s}`] = [w[0], w[1] - 0.008, w[2]];
  // fingertip (skin of the middle finger)
  const digits = points(skin, `regions.palmar_surfaces_of_digits_of_hand_${s}`).concat(points(skin, `regions.dorsal_surfaces_of_digits_of_hand_${s}`));
  let tip = digits[0];
  for (const p of digits) if (p[1] < tip[1]) tip = p;
  joints[`fingertip_${s}`] = tip;
  // tape-measure landmarks
  const extreme = (pts: V3[], f: (p: V3) => number) => pts.reduce((a, b) => (f(b) > f(a) ? b : a));
  const latEpi = extreme(humerus.filter((p) => p[1] < hMin + 0.04), (p) => sx * p[0]);
  const styloid = extreme(radius, (p) => -p[1]);
  const trochanter = extreme(femur.filter((p) => p[1] > fTop - 0.08), (p) => sx * p[0]);
  const kneeC = joints[`knee_${s}`];
  const latCondyle = extreme(femur.filter((p) => sx * p[0] > sx * kneeC[0]), (p) => -p[1]);
  const medPlateau = extreme(tibia.filter((p) => sx * p[0] < sx * kneeC[0]), (p) => p[1]);
  const medTip = extreme(tibia, (p) => -p[1]);
  const footSkin = ['heel_region', 'sole', 'plantar_surfaces_of_digits_of_foot', 'dorsal_surfaces_of_digits_of_foot'].flatMap((r) => points(skin, `regions.${r}_${s}`));
  const fb = bbox(footSkin);
  // acromion (lateral tip of the shoulder blade)
  const scap = points(bones, `skeletal.scapula_${s}`);
  let acr = scap[0];
  for (const p of scap) if (p[1] > sh.center[1] - 0.03 && sx * p[0] > sx * acr[0]) acr = p;
  joints[`acromion_${s}`] = acr;
  measured.upperArm.push(dist(acr, latEpi));
  measured.forearm.push(dist(latEpi, styloid));
  measured.hand.push(dist(styloid, tip));
  measured.thigh.push(dist(trochanter, latCondyle));
  measured.shank.push(dist(medPlateau, medTip));
  measured.foot.push(fb.max[2] - fb.min[2]);
}

const disc = (id: string) => bbox(points(bones, `joints.intervertebral_disc_${id}`)).center;
joints.c7t1 = disc('c7_t1');
joints.t12l1 = disc('t12_l1');
joints.l4l5 = disc('l4_l5');
joints.l5s1 = disc('l5_s1');
joints.pelvis = mid(joints.hip_l, joints.hip_r);
joints.neck = mid(joints.shoulder_l, joints.shoulder_r);
joints.neck[0] = 0;
const skinBox = bbox(points(skin, 'regions.parietal_region_l').concat(points(skin, 'regions.parietal_region_r')));
joints.head_top = [0, round(skin.geometry.boundingBox!.max.y), skinBox.center[2]];
const mand = points(bones, 'skeletal.mandible');
let chin = mand[0];
for (const p of mand) if (p[1] < chin[1] && p[2] > bbox(mand).center[2]) chin = p;
joints.chin = chin;
const thyroid = bbox(points(bones, 'skeletal.thyroid_cartilage')).center;
const navel = mean(points(skin, 'regions.umbilicus_l').concat(points(skin, 'regions.umbilicus_r')));
const nipple = mean(points(skin, 'regions.mammary_region_l').concat(points(skin, 'regions.mammary_region_r')));

// ---------------------------------------------------------------- lengths and girths

const L = (a: string, b: string) => round((dist(joints[`${a}_l`], joints[`${b}_l`]) + dist(joints[`${a}_r`], joints[`${b}_r`])) / 2);
lengths.height = joints.head_top[1];
lengths.upperArm = L('shoulder', 'elbow');
lengths.forearm = L('elbow', 'wrist');
lengths.hand = L('wrist', 'fingertip');
lengths.thigh = L('hip', 'knee');
lengths.shank = L('knee', 'ankle');
lengths.foot = round((joints.toe_l[2] - joints.heel_l[2] + joints.toe_r[2] - joints.heel_r[2]) / 2);
lengths.torso = round(joints.neck[1] - joints.pelvis[1]);
lengths.shoulderWidth = round(joints.acromion_l[0] - joints.acromion_r[0]);
lengths.hipWidth = round(joints.hip_l[0] - joints.hip_r[0]);
lengths.armSpan = round(lengths.shoulderWidth + 2 * (lengths.upperArm + lengths.forearm + lengths.hand));
lengths.ankleHeight = round((joints.ankle_l[1] + joints.ankle_r[1]) / 2);

const side = (s: 'l' | 'r', re: RegExp) => (id: string) => id.endsWith(`_${s}`) && re.test(id);
girths.neck = girth(thyroid[1], (id) => /neck|cervical|sternocleidomastoid|carotid|muscular_triangle|hyoid|submandibular|submental/.test(id));
girths.chest = girth(nipple[1], torso);
girths.waist = girth(navel[1], torso);
girths.hips = maxGirth(joints.pelvis[1] - 0.12, joints.pelvis[1] + 0.04, torso);
for (const s of ['l', 'r'] as const) {
  const sh = joints[`shoulder_${s}`], el = joints[`elbow_${s}`], wr = joints[`wrist_${s}`];
  const hp = joints[`hip_${s}`], kn = joints[`knee_${s}`], an = joints[`ankle_${s}`];
  girths[`upperArm_${s}`] = girth((sh[1] + el[1]) / 2, side(s, /region_of_arm|bicipital|deltoid_region/));
  girths[`forearm_${s}`] = maxGirth(el[1] - 0.04, el[1] - 0.12, side(s, /forearm|elbow|cubital/));
  girths[`thigh_${s}`] = girth((hp[1] + kn[1]) / 2, side(s, /thigh|femoral/));
  girths[`calf_${s}`] = maxGirth(kn[1] - 0.06, an[1] + 0.2, side(s, /region_of_leg|knee|popliteal/));
}
const levels = { navel: round(navel[1]), nipple: round(nipple[1]), thyroid: round(thyroid[1]) };
const measures: Record<string, number> = Object.fromEntries(Object.entries(measured).map(([k, v]) => [k, round((v[0] + v[1]) / 2)]));
measures.shoulderWidth = lengths.shoulderWidth;
measures.armSpan = lengths.armSpan;
measures.height = lengths.height;

const out = {
  note: 'Measured from the built atlas layers by scripts/build-landmarks.ts. Metres; y up, face +z, left +x.',
  joints: Object.fromEntries(Object.entries(joints).map(([k, v]) => [k, r3(v)])),
  axes: Object.fromEntries(Object.entries(axes).map(([k, v]) => {
    const n = Math.hypot(...v);
    return [k, r3([v[0] / n, v[1] / n, v[2] / n])];
  })),
  lengths,
  measures,
  girths,
  levels,
};
writeFileSync(join(root, 'src', 'anatomy', 'landmarks.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ lengths, measures }, null, 1));
for (const k of ['hip_l', 'knee_l', 'ankle_l', 'shoulder_l', 'elbow_l', 'wrist_l', 'neck', 'pelvis', 'head_top']) console.log(k, r3(joints[k]));
