// Synthetic squat clips: the atlas body, posed by the squat model and filmed
// side-on. Because the pose is generated, the true joint positions and angles
// are known in every frame, which makes these clips a test of the pose
// tracker (how far are its angles from the truth?) as well as realistic demo
// footage. The body is posed with linear-blend skinning: every vertex follows
// up to three skeleton segments, each rotated about its joint in the sagittal
// plane.
import { AmbientLight, Color, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer, type BufferAttribute } from 'three';
import landmarks from '../anatomy/landmarks.json';
import { buildLayerModel, type LayerModel } from '../model/atlasModel';
import { bodyDims, SKELETON, vertexWeights, type V3 } from '../model/bodyShape';
import { createLayerMaterial } from '../model/layerMaterial';
import { runModel, type P2 } from '../movement/biomech';

const J = (landmarks as unknown as { joints: Record<string, V3> }).joints;

export interface SquatSpec {
  depth: 'half' | 'parallel' | 'deep';
  /** Ankle mobility option of the squat model (degrees of shin tilt allowed). */
  ankle: string;
  reps: number;
  /** Seconds per rep (down and up). */
  rep: number;
  /** Seconds standing before the first and after the last rep. */
  stand: number;
}

export const squatDuration = (s: SquatSpec) => 2 * s.stand + s.reps * s.rep;

/** Where in the squat (0 standing … 1 bottom) the body is at time t. */
export function squatPhase(s: SquatSpec, t: number): number {
  const x = t - s.stand;
  if (x <= 0 || x >= s.reps * s.rep) return 0;
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / s.rep);
}

/** True rep timings: start, bottom, end. */
export function squatReps(s: SquatSpec): { start: number; bottom: number; end: number }[] {
  return Array.from({ length: s.reps }, (_, i) => ({ start: s.stand + i * s.rep, bottom: s.stand + (i + 0.5) * s.rep, end: s.stand + (i + 1) * s.rep }));
}

// ---------------------------------------------------------------- posing

type M3 = number[];
const rotX = (a: number): M3 => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const apply = (R: M3, v: V3): V3 => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** Angle of a direction in the sagittal (y up, z forward) plane. */
const sag = (y: number, z: number) => Math.atan2(z, y);
/** Rotation about x taking the reference direction (b − a) to a target sagittal direction (forward, up). */
const turn = (a: V3, b: V3, target: P2) => rotX(sag(target[1], target[0]) - sag(b[1] - a[1], b[2] - a[2]));

export interface Pose {
  /** Per segment (skeleton order): rotation, reference pivot and posed pivot. */
  segs: { R: M3; a: V3; a2: V3 }[];
  /** Posed joint positions (same names as the reference landmarks). */
  joints: Record<string, V3>;
}

/** The body posed at a point in a squat, from the squat model's 2D figure. Arms reach forward, as in a bodyweight squat. */
export function squatPose(spec: SquatSpec, phase: number): Pose {
  const dims = bodyDims({});
  const v = runModel('squat', { phase, dims, mass: 75, load: 0, options: { variant: 'goblet', depth: spec.depth, ankle: spec.ankle } }).views[0].points;
  const d = (a: string, b: string): P2 => [v[b][0] - v[a][0], v[b][1] - v[a][1]];
  const Rs = turn(J.knee_l, J.ankle_l, d('knee', 'ankle'));
  const Rt = turn(J.hip_l, J.knee_l, d('hip', 'knee'));
  const Rb = turn(J.pelvis, J.neck, d('hip', 'shoulder'));
  const Ra = turn(J.shoulder_l, J.elbow_l, [0.97, -0.24]);
  const I = rotX(0);
  const joints: Record<string, V3> = {};
  for (const s of ['l', 'r']) {
    const ankle = J[`ankle_${s}`];
    joints[`ankle_${s}`] = ankle;
    joints[`heel_${s}`] = J[`heel_${s}`];
    joints[`toe_${s}`] = J[`toe_${s}`];
    joints[`knee_${s}`] = add(ankle, apply(Rs, sub(J[`knee_${s}`], ankle)));
    joints[`hip_${s}`] = add(joints[`knee_${s}`], apply(Rt, sub(J[`hip_${s}`], J[`knee_${s}`])));
  }
  const hipMid = (p: Record<string, V3>): V3 => [(p.hip_l[0] + p.hip_r[0]) / 2, (p.hip_l[1] + p.hip_r[1]) / 2, (p.hip_l[2] + p.hip_r[2]) / 2];
  joints.pelvis = add(hipMid(joints), apply(Rb, sub(J.pelvis, hipMid(J))));
  const trunk = (n: string) => (joints[n] = add(joints.pelvis, apply(Rb, sub(J[n], J.pelvis))));
  for (const n of ['neck', 'head_top', 'shoulder_l', 'shoulder_r', 'acromion_l', 'acromion_r']) trunk(n);
  for (const s of ['l', 'r']) {
    joints[`elbow_${s}`] = add(joints[`shoulder_${s}`], apply(Ra, sub(J[`elbow_${s}`], J[`shoulder_${s}`])));
    joints[`wrist_${s}`] = add(joints[`elbow_${s}`], apply(Ra, sub(J[`wrist_${s}`], J[`elbow_${s}`])));
    joints[`fingertip_${s}`] = add(joints[`wrist_${s}`], apply(Ra, sub(J[`fingertip_${s}`], J[`wrist_${s}`])));
  }
  const rot: Record<string, M3> = { torso: Rb, head: Rb, thigh: Rt, shank: Rs, foot: I, upper: Ra, fore: Ra, hand: Ra };
  const segs = SKELETON.map(([name, a]) => ({ R: rot[name.replace(/_[lr]$/, '')], a: J[a], a2: joints[a] }));
  return { segs, joints };
}

/** Writes a posed copy of the layer into its geometry (positions and normals). */
export function applyPose(m: LayerModel, pose: Pose): void {
  const g = m.geometry;
  const struct = g.getAttribute('aStruct');
  const w = vertexWeights(m.base, (i) => m.ids[struct.getX(i)]);
  const pos = g.getAttribute('position') as BufferAttribute;
  const out = pos.array as Float32Array;
  const base = m.base;
  const S = pose.segs;
  for (let i = 0; i < base.length / 3; i++) {
    let x = 0, y = 0, z = 0;
    const px = base[i * 3], py = base[i * 3 + 1], pz = base[i * 3 + 2];
    for (let k = 0; k < 3; k++) {
      const wt = w.w[i * 3 + k];
      if (!wt) continue;
      const sg = S[w.seg[i * 3 + k]];
      const dx = px - sg.a[0], dy = py - sg.a[1], dz = pz - sg.a[2];
      const R = sg.R;
      x += wt * (sg.a2[0] + R[0] * dx + R[1] * dy + R[2] * dz);
      y += wt * (sg.a2[1] + R[3] * dx + R[4] * dy + R[5] * dz);
      z += wt * (sg.a2[2] + R[6] * dx + R[7] * dy + R[8] * dz);
    }
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
}

// ---------------------------------------------------------------- filming

export type TruthJoint = 'shoulder' | 'hip' | 'knee' | 'ankle' | 'heel' | 'toe';

export interface Truth {
  t: number;
  phase: number;
  /** Near-side (left) joints in the picture, as fractions of width and height. */
  image: Record<TruthJoint, [number, number]>;
}

export interface Studio {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Poses the body, renders a frame and returns where the joints appear. */
  frame(spec: SquatSpec, t: number): Truth;
  dispose(): void;
}

/** A side-on "phone camera" pointed at the body, at hip height, about 3.6 m away. */
export async function openStudio(width = 540, height = 960): Promise<Studio> {
  const res = await fetch(`${import.meta.env.BASE_URL}atlas/skin.bin`);
  if (!res.ok) throw new Error('Could not load the body model');
  const m = buildLayerModel(new Uint8Array(await res.arrayBuffer()));
  const canvas = document.createElement('canvas');
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  const scene = new Scene();
  scene.background = new Color('#cfd3da');
  scene.add(new HemisphereLight('#ffffff', '#9a948e', 1.1));
  scene.add(new AmbientLight('#ffffff', 0.25));
  const key = new DirectionalLight('#fff4ea', 1.6);
  key.position.set(3, 3.5, 2);
  scene.add(key);
  const fill = new DirectionalLight('#e6eeff', 0.6);
  fill.position.set(-2, 2, -3);
  scene.add(fill);
  const floor = new Mesh(new PlaneGeometry(12, 12), new MeshStandardMaterial({ color: '#8d9099', roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const lm = createLayerMaterial('skin', m.ids.length);
  const shorts = /(gluteal|anal|urogenital|inguinal|femoral_triangle|hip_region|sacral|hypogastric)/;
  lm.setStates(m.ids.length, (i) => ({ visible: true, color: shorts.test(m.ids[i]) ? '#2a3140' : undefined }));
  lm.uniforms.uNeutral.value.set('#c99b82');
  lm.setOpacity(1);
  const body = new Mesh(m.geometry, lm.material);
  body.frustumCulled = false;
  scene.add(body);
  // aimed a little in front of the feet so the reaching arms stay in frame
  const cam = new PerspectiveCamera(42, width / height, 0.1, 40);
  cam.position.set(3.6, 0.92, 0.22);
  cam.lookAt(0, 0.84, 0.22);
  cam.updateMatrixWorld();
  const project = (p: V3): [number, number] => {
    const v = new Vector3(p[0], p[1], p[2]).project(cam);
    return [Math.round(((v.x + 1) / 2) * 1e4) / 1e4, Math.round(((1 - v.y) / 2) * 1e4) / 1e4];
  };
  return {
    canvas,
    width,
    height,
    frame(spec, t) {
      const phase = squatPhase(spec, t);
      const pose = squatPose(spec, phase);
      applyPose(m, pose);
      renderer.render(scene, cam);
      const j = pose.joints;
      return {
        t,
        phase,
        image: { shoulder: project(j.shoulder_l), hip: project(j.hip_l), knee: project(j.knee_l), ankle: project(j.ankle_l), heel: project(j.heel_l), toe: project(j.toe_l) },
      };
    },
    dispose() {
      lm.dispose();
      m.geometry.dispose();
      floor.geometry.dispose();
      (floor.material as MeshStandardMaterial).dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

/** True angles from where the joints appear in the picture (the same way the tracker's angles are measured). */
export function truthAngles(tr: Truth, width: number, height: number): Record<'knee' | 'hip' | 'torsoLean' | 'shinAngle', number> {
  const P = (k: keyof Truth['image']): [number, number] => [tr.image[k][0] * width, tr.image[k][1] * height];
  const ang = (a: [number, number], b: [number, number], c: [number, number]) => {
    const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]];
    return (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]))))) * 180) / Math.PI;
  };
  const lean = (a: [number, number], b: [number, number]) => (Math.atan2(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) * 180) / Math.PI;
  return { knee: ang(P('hip'), P('knee'), P('ankle')), hip: ang(P('shoulder'), P('hip'), P('knee')), torsoLean: lean(P('hip'), P('shoulder')), shinAngle: lean(P('ankle'), P('knee')) };
}
