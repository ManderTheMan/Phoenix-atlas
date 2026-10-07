// Nervous system layer: nerves are tubes along hand-placed paths. Each nerve
// also gets a fatter invisible proxy so it is easy to tap on a phone.
import { canalPoint, handPt, ribPath, ribSpecs } from './body';
import type { MeshData } from './mc';
import { type V3 } from './sdf';
import { mergeMeshes, mirrorMesh, tube } from './tube';
import type { StructureDef, StructureMesh } from './types';

export interface NervePartSpec {
  def: StructureDef;
  make: () => Omit<StructureMesh, 'id'>;
}

const nv = (id: string, name: string, group: string, side?: 'L' | 'R', info?: string): StructureDef => ({
  id,
  name,
  layer: 'nerves',
  group,
  side,
  info,
});

interface Path {
  pts: V3[];
  r: number;
  r2?: number; // radius at the end (tapers)
}

function build(paths: Path[], hitR = 0.009): Omit<StructureMesh, 'id'> {
  const vis = mergeMeshes(
    paths.map((p) => tube(p.pts, { radius: p.r2 ? (t) => p.r + (p.r2! - p.r) * t : p.r, radial: 6 })),
  );
  const hit = mergeMeshes(paths.map((p) => tube(p.pts, { radius: Math.max(hitR, p.r * 2), radial: 5, tubular: 24 })));
  return { ...vis, hitPositions: hit.positions, hitIndices: hit.indices };
}

function mirrorBuilt(m: Omit<StructureMesh, 'id'>): Omit<StructureMesh, 'id'> {
  const vis = mirrorMesh(m);
  const hit = mirrorMesh({ positions: m.hitPositions!, normals: new Float32Array(m.hitPositions!.length), indices: m.hitIndices! });
  return { ...vis, hitPositions: hit.positions, hitIndices: hit.indices };
}

function pairN(base: string, name: string, group: string, paths: () => Path[], info?: string): NervePartSpec[] {
  let cache: Omit<StructureMesh, 'id'> | null = null;
  const left = () => (cache ??= build(paths()));
  return [
    { def: nv(`${base}-l`, `Left ${name}`, group, 'L', info), make: left },
    { def: nv(`${base}-r`, `Right ${name}`, group, 'R', info), make: () => mirrorBuilt(left()) },
  ];
}

const AXILLA: V3 = [0.15, 1.385, -0.012];
const POPLITEAL: V3 = [0.1, 0.56, -0.034];

export function nerveParts(): NervePartSpec[] {
  const cord: V3[] = [];
  for (let y = 1.63; y >= 1.13; y -= 0.025) cord.push(y > 1.6 ? [0, y, -0.023] : canalPoint(y));
  const cauda: V3[] = [];
  for (let y = 1.13; y >= 0.96; y -= 0.02) cauda.push(canalPoint(y));
  cauda.push([0, 0.93, -0.074], [0, 0.9, -0.085]);

  const parts: NervePartSpec[] = [
    {
      def: nv('spinal-cord', 'Spinal cord', 'Central', undefined, 'Runs inside the vertebral canal from the brainstem to about L1.'),
      make: () => {
        const m = build([{ pts: cord, r: 0.0048, r2: 0.0042 }, { pts: cauda, r: 0.0034, r2: 0.0022 }], 0.011);
        return m;
      },
    },
    ...pairN('brachial-plexus', 'brachial plexus', 'Arm', () => [
      { pts: [[0.012, 1.505, -0.032], [0.05, 1.47, -0.02], [0.1, 1.43, -0.012], AXILLA], r: 0.0042 },
      { pts: [[0.012, 1.475, -0.04], [0.06, 1.455, -0.022], [0.11, 1.415, -0.014], AXILLA], r: 0.0035 },
      { pts: [[0.165, 1.385, -0.03], [0.192, 1.375, -0.035], [0.205, 1.37, -0.01]], r: 0.0022 },
    ], 'Network of nerves from the neck into the arm; can cause arm tingling when irritated.'),
    ...pairN('median-nerve', 'median nerve', 'Arm', () => [
      { pts: [AXILLA, [0.205, 1.27, 0.004], [0.248, 1.13, 0.006], [0.292, 1.0, 0.022], [0.322, 0.89, 0.026], handPt(0.05, 0.004, 0.012), handPt(0.09, 0.012, 0.012)], r: 0.0028, r2: 0.002 },
    ], 'Passes through the carpal tunnel; numbness in the thumb-side fingers.'),
    ...pairN('ulnar-nerve', 'ulnar nerve', 'Arm', () => [
      { pts: [AXILLA, [0.2, 1.27, -0.022], [0.226, 1.14, -0.046], [0.27, 1.02, -0.008], [0.305, 0.9, 0.012], handPt(0.05, -0.02, 0.01), handPt(0.09, -0.024, 0.008)], r: 0.0026, r2: 0.0019 },
    ], 'The "funny bone" nerve; tingling in the ring and little fingers.'),
    ...pairN('radial-nerve', 'radial nerve', 'Arm', () => [
      { pts: [AXILLA, [0.19, 1.31, -0.045], [0.235, 1.23, -0.038], [0.27, 1.14, -0.006], [0.305, 1.02, -0.004], [0.335, 0.9, 0.0], handPt(0.04, 0.02, -0.012)], r: 0.0026, r2: 0.0019 },
    ]),
    ...pairN('intercostal-nerves', 'intercostal nerves', 'Thorax', () =>
      ribSpecs()
        .slice(2, 11)
        .map((s) => ({ pts: ribPath(s, 14).map((p): V3 => [p[0] * 0.96, p[1] - 0.009, p[2] * 0.96]), r: 0.0015 })),
    ),
    ...pairN('femoral-nerve', 'femoral & saphenous nerve', 'Leg', () => [
      { pts: [[0.022, 1.06, -0.035], [0.05, 0.98, -0.01], [0.075, 0.91, 0.04], [0.09, 0.84, 0.056], [0.094, 0.76, 0.052]], r: 0.0034, r2: 0.0028 },
      { pts: [[0.088, 0.84, 0.05], [0.07, 0.7, 0.01], [0.072, 0.52, -0.012], [0.084, 0.3, -0.005], [0.085, 0.09, 0.006]], r: 0.0018 },
    ], 'Front of the thigh; supplies the quadriceps.'),
    ...pairN('sciatic-nerve', 'sciatic nerve', 'Leg', () => [
      { pts: [[0.022, 0.97, -0.07], [0.06, 0.925, -0.064], [0.092, 0.87, -0.058], [0.1, 0.78, -0.048], [0.1, 0.66, -0.042], POPLITEAL], r: 0.0055, r2: 0.0048 },
    ], 'Largest nerve in the body; sciatica radiates from the buttock down the back of the leg.'),
    ...pairN('tibial-nerve', 'tibial nerve', 'Leg', () => [
      { pts: [POPLITEAL, [0.1, 0.42, -0.034], [0.096, 0.25, -0.03], [0.086, 0.08, -0.026], [0.092, 0.03, 0.01], [0.1, 0.022, 0.07]], r: 0.0034, r2: 0.0022 },
    ]),
    ...pairN('fibular-nerve', 'common fibular (peroneal) nerve', 'Leg', () => [
      { pts: [POPLITEAL, [0.125, 0.5, -0.026], [0.137, 0.455, -0.012], [0.124, 0.32, 0.016], [0.11, 0.12, 0.03], [0.1, 0.05, 0.065]], r: 0.0028, r2: 0.002 },
    ], 'Wraps around the fibular head below the knee; foot drop or shin numbness.'),
    ...pairN('trigeminal-nerve', 'trigeminal nerve', 'Head', () => [
      { pts: [[0.012, 1.628, -0.022], [0.032, 1.63, 0.0], [0.04, 1.638, 0.02]], r: 0.0028 },
      { pts: [[0.04, 1.638, 0.02], [0.038, 1.67, 0.055], [0.03, 1.7, 0.084]], r: 0.0016 },
      { pts: [[0.04, 1.638, 0.02], [0.045, 1.63, 0.055], [0.04, 1.626, 0.084]], r: 0.0016 },
      { pts: [[0.04, 1.638, 0.02], [0.046, 1.6, 0.03], [0.038, 1.565, 0.062]], r: 0.0016 },
    ], 'Sensation of the face; involved in facial pain and some headaches.'),
    ...pairN('facial-nerve', 'facial nerve', 'Head', () => {
      const o: V3 = [0.062, 1.625, -0.006];
      return [
        { pts: [o, [0.068, 1.66, 0.02], [0.062, 1.69, 0.05]], r: 0.0014 },
        { pts: [o, [0.066, 1.64, 0.035], [0.055, 1.645, 0.075]], r: 0.0014 },
        { pts: [o, [0.064, 1.605, 0.04], [0.05, 1.6, 0.078]], r: 0.0014 },
        { pts: [o, [0.058, 1.575, 0.03], [0.04, 1.565, 0.066]], r: 0.0014 },
        { pts: [o, [0.055, 1.56, 0.0], [0.05, 1.52, 0.03]], r: 0.0014 },
      ];
    }),
    ...pairN('occipital-nerve', 'greater occipital nerve', 'Head', () => [
      { pts: [[0.012, 1.57, -0.052], [0.022, 1.62, -0.088], [0.03, 1.69, -0.1], [0.032, 1.74, -0.082]], r: 0.0017 },
    ], 'Back of the head; occipital neuralgia and tension-type headaches.'),
    ...pairN('vagus-nerve', 'vagus nerve', 'Central', () => [
      { pts: [[0.02, 1.615, -0.016], [0.026, 1.53, 0.008], [0.022, 1.45, 0.006], [0.018, 1.36, -0.012], [0.012, 1.25, -0.02], [0.016, 1.18, -0.01], [0.03, 1.12, 0.01]], r: 0.0021 },
    ], 'Rest-and-digest nerve linking brain, heart and gut; relevant to HRV and stress.'),
  ];
  return parts;
}

export type { MeshData };
