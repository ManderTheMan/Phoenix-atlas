// Renders front/back images of the colour-coded body for reports, using an
// offscreen three.js renderer and the same layer meshes as the live viewer.
import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  WebGLRenderer,
} from 'three';
import { STRUCTURE_BY_ID } from '../anatomy/catalog';
import { LAYER_BY_ID, type LayerId } from '../anatomy/types';
import type { Note } from '../db/db';
import { feelingColor } from '../lib/feeling';
import { applyShape, loadLayers } from '../model/atlasModel';
import type { BodyShape } from '../model/bodyShape';
import { createLayerMaterial } from '../model/layerMaterial';

export type SnapshotKind = 'surface' | 'deep';

export interface SnapshotOptions {
  colors: Map<string, string>;
  notes: Note[];
  kind: SnapshotKind;
  width?: number;
  height?: number;
  background?: string;
  /** Fit the body to the profile's measurements. */
  shape?: BodyShape | null;
}

interface LayerSpec {
  layer: LayerId;
  opacity: number;
  /** Muscles only: true = deep muscles only (superficial ones peeled away). */
  deepOnly?: boolean;
  /** Only drawn when a note in the report is on this layer. */
  ifUsed?: boolean;
}

const LAYERS: Record<SnapshotKind, LayerSpec[]> = {
  surface: [
    { layer: 'skeletal', opacity: 1 },
    { layer: 'muscular', opacity: 1 },
    { layer: 'skin', opacity: 0.12 },
  ],
  deep: [
    { layer: 'skeletal', opacity: 1 },
    { layer: 'organs', opacity: 1 },
    { layer: 'nerves', opacity: 1, ifUsed: true },
    { layer: 'vascular', opacity: 1, ifUsed: true },
    { layer: 'muscular', opacity: 1, deepOnly: true },
  ],
};

const RENDER_ORDER: Record<LayerId, number> = { organs: 1, skeletal: 2, vascular: 3, nerves: 3, muscular: 4, skin: 20 };

/** Returns [front, back] PNG data URLs. */
export async function renderBodySnapshots(o: SnapshotOptions): Promise<[string, string]> {
  const used = new Set<LayerId>();
  for (const n of o.notes) for (const id of n.structureIds) {
    const l = STRUCTURE_BY_ID.get(id)?.layer;
    if (l) used.add(l);
  }
  const specs = LAYERS[o.kind].filter((s) => !s.ifUsed || used.has(s.layer));
  const models = await loadLayers(specs.map((s) => s.layer));

  const width = o.width ?? 520;
  const height = o.height ?? 860;
  const canvas = document.createElement('canvas');
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  const scene = new Scene();
  scene.background = new Color(o.background ?? '#f2f3f6');
  scene.add(new HemisphereLight('#ffffff', '#c8bfb8', 1.1));
  scene.add(new AmbientLight('#ffffff', 0.25));
  const key = new DirectionalLight('#ffffff', 1.5);
  key.position.set(1.5, 3, 2.5);
  scene.add(key);
  const back = new DirectionalLight('#fff0e6', 1.0);
  back.position.set(-1.5, 2.5, -2.5);
  scene.add(back);
  const disposables: { dispose: () => void }[] = [];

  const included = new Set<string>();
  specs.forEach((spec, k) => {
    const m = models[k];
    applyShape(m, o.shape ?? null);
    const lm = createLayerMaterial(spec.layer, m.ids.length);
    lm.setStates(m.ids.length, (i) => {
      const id = m.ids[i];
      const visible = !(spec.deepOnly && !STRUCTURE_BY_ID.get(id)?.deep);
      if (visible) included.add(id);
      return { visible, color: o.colors.get(id) };
    });
    lm.uniforms.uNeutral.value.set(LAYER_BY_ID[spec.layer].color);
    lm.setOpacity(spec.opacity);
    const mesh = new Mesh(m.geometry, lm.material);
    mesh.renderOrder = RENDER_ORDER[spec.layer];
    mesh.frustumCulled = false;
    scene.add(mesh);
    disposables.push(lm);
  });

  // pins for notes in the period
  const pinGeo = new SphereGeometry(0.009, 14, 10);
  disposables.push(pinGeo);
  for (const n of o.notes)
    for (const l of n.locations) {
      if (!l.point || !included.has(l.structureId)) continue;
      const m = new MeshStandardMaterial({ color: feelingColor(n.feeling), roughness: 0.3, emissive: '#ffffff', emissiveIntensity: 0.12 });
      const s = new Mesh(pinGeo, m);
      const pt = o.shape ? o.shape.deformPoint(l.point, l.structureId) : l.point;
      const nn = (l.normal && o.shape ? o.shape.deformNormal(l.point, l.normal, l.structureId) : l.normal) ?? [0, 0, 1];
      s.position.set(pt[0] + nn[0] * 0.004, pt[1] + nn[1] * 0.004, pt[2] + nn[2] * 0.004);
      s.renderOrder = 30;
      scene.add(s);
      disposables.push(m);
    }

  const cam = new PerspectiveCamera(24, width / height, 0.1, 30);
  const shots: string[] = [];
  for (const dir of [1, -1]) {
    cam.position.set(0, 0.92, 0.05 + 4.6 * dir);
    cam.lookAt(0, 0.87, 0.05);
    renderer.render(scene, cam);
    shots.push(canvas.toDataURL('image/png'));
  }
  for (const d of disposables) d.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return [shots[0], shots[1]];
}
