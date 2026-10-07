// Renders front/back images of the colour-coded body for reports, using an
// offscreen three.js renderer and the same meshes as the live viewer.
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  WebGLRenderer,
} from 'three';
import { STRUCTURES } from '../anatomy/catalog';
import { SURFACE_REGIONS } from '../anatomy/skin';
import type { LayerId } from '../anatomy/types';
import { baseColor } from '../analysis/colors';
import type { Note } from '../db/db';
import { feelingColor, hexRgb } from '../lib/feeling';
import { loadAtlasModel } from '../model/atlasModel';

export type SnapshotKind = 'surface' | 'deep';

export interface SnapshotOptions {
  colors: Map<string, string>;
  notes: Note[];
  kind: SnapshotKind;
  width?: number;
  height?: number;
  background?: string;
}

const LAYERS: Record<SnapshotKind, { layer: LayerId; opacity: number; deep?: boolean }[]> = {
  surface: [
    { layer: 'skeletal', opacity: 1 },
    { layer: 'muscular', opacity: 1, deep: false },
    { layer: 'skin', opacity: 0.12 },
  ],
  deep: [
    { layer: 'skeletal', opacity: 1 },
    { layer: 'organs', opacity: 1 },
    { layer: 'nerves', opacity: 1 },
    { layer: 'muscular', opacity: 1, deep: true },
  ],
};

/** Returns [front, back] PNG data URLs. */
export async function renderBodySnapshots(o: SnapshotOptions): Promise<[string, string]> {
  const model = await loadAtlasModel();
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
  for (const spec of LAYERS[o.kind]) {
    if (spec.layer === 'skin') {
      const base = model.geometries.get('skin');
      if (!base) continue;
      const g = new BufferGeometry();
      g.setAttribute('position', base.getAttribute('position'));
      g.setAttribute('normal', base.getAttribute('normal'));
      g.setIndex(base.getIndex());
      const regions = model.skinRegions;
      const n = base.getAttribute('position').count;
      const col = new Float32Array(n * 3);
      const baseRgb = hexRgb(baseColor('skin', 'feeling'));
      const regionRgb = SURFACE_REGIONS.map((r) => (o.colors.get(r.id) ? hexRgb(o.colors.get(r.id)!) : baseRgb).map((v) => (v / 255) ** 2.2));
      for (let i = 0; i < n; i++) col.set(regionRgb[regions ? regions[i] : 0], i * 3);
      g.setAttribute('color', new BufferAttribute(col, 3));
      const m = new MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: spec.opacity, depthWrite: false, side: DoubleSide, roughness: 0.7 });
      const mesh = new Mesh(g, m);
      mesh.renderOrder = 20;
      scene.add(mesh);
      disposables.push(g, m);
      for (const r of SURFACE_REGIONS) included.add(r.id);
      continue;
    }
    for (const def of STRUCTURES) {
      if (def.layer !== spec.layer) continue;
      if (spec.deep !== undefined && !!def.deep !== spec.deep) continue;
      const g = model.geometries.get(def.id);
      if (!g) continue;
      const m = new MeshStandardMaterial({
        color: o.colors.get(def.id) ?? baseColor(def.layer, 'feeling'),
        roughness: def.layer === 'skeletal' ? 0.55 : 0.62,
        transparent: spec.opacity < 1,
        opacity: spec.opacity,
      });
      scene.add(new Mesh(g, m));
      disposables.push(m);
      included.add(def.id);
    }
  }

  // pins for notes in the period
  const pinGeo = new SphereGeometry(0.009, 14, 10);
  disposables.push(pinGeo);
  for (const n of o.notes)
    for (const l of n.locations) {
      if (!l.point || !included.has(l.structureId)) continue;
      const m = new MeshStandardMaterial({ color: feelingColor(n.feeling), roughness: 0.3, emissive: '#ffffff', emissiveIntensity: 0.12 });
      const s = new Mesh(pinGeo, m);
      const nn = l.normal ?? [0, 0, 1];
      s.position.set(l.point[0] + nn[0] * 0.004, l.point[1] + nn[1] * 0.004, l.point[2] + nn[2] * 0.004);
      s.renderOrder = 30;
      scene.add(s);
      disposables.push(m);
    }

  const cam = new PerspectiveCamera(24, width / height, 0.1, 30);
  const shots: string[] = [];
  for (const dir of [1, -1]) {
    cam.position.set(0.0, 0.95, 4.6 * dir);
    cam.lookAt(0, 0.89, 0);
    renderer.render(scene, cam);
    shots.push(canvas.toDataURL('image/png'));
  }
  for (const d of disposables) d.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return [shots[0], shots[1]];
}
