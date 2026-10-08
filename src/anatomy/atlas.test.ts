import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Note } from '../db/db';
import { migrateNoteIds } from '../db/migrate';
import { buildLayerModel, nearestOnLayer, nearestOnStructure, pointFacing, raycastLayer, structureCentroid, type LayerModel } from '../model/atlasModel';
import { readLayerHeader } from './atlasFile';
import { searchStructures, sidedName, STRUCTURE_BY_ID, STRUCTURES } from './catalog';
import { INFO_IDS } from './info';
import { legacyToAtlas } from './legacy';
import { LAYERS, type LayerId } from './types';

const layerFile = (id: LayerId) => new Uint8Array(readFileSync(join(__dirname, '../../public/atlas', `${id}.bin`)));
const models = new Map<LayerId, LayerModel>();
const model = (id: LayerId) => {
  if (!models.has(id)) models.set(id, buildLayerModel(layerFile(id)));
  return models.get(id)!;
};

// every structure id used by the first (procedural) body model
const SIDED =
  'skin-chest skin-abdomen skin-upper-back skin-lower-back skin-shoulder skin-upper-arm skin-elbow skin-forearm skin-hand skin-hip skin-glute ' +
  'skin-thigh-front skin-thigh-back skin-knee skin-shin skin-calf skin-ankle skin-foot frontalis temporalis masseter scm scalenes upper-trapezius ' +
  'mid-trapezius deltoid-anterior deltoid-lateral deltoid-posterior infraspinatus pectoralis-major serratus-anterior rectus-abdominis ' +
  'external-oblique latissimus-dorsi erector-spinae biceps triceps brachioradialis forearm-flexors forearm-extensors gluteus-maximus ' +
  'gluteus-medius tfl-it-band rectus-femoris vastus-lateralis vastus-medialis adductors sartorius biceps-femoris semitendinosus ' +
  'tibialis-anterior fibularis gastrocnemius soleus rhomboids levator-scapulae supraspinatus quadratus-lumborum iliopsoas rib-1 rib-2 rib-3 ' +
  'rib-4 rib-5 rib-6 rib-7 rib-8 rib-9 rib-10 rib-11 rib-12 clavicle scapula humerus radius ulna hand-bones hip-bone femur patella tibia ' +
  'fibula foot-bones brachial-plexus median-nerve ulnar-nerve radial-nerve intercostal-nerves femoral-nerve sciatic-nerve tibial-nerve ' +
  'fibular-nerve trigeminal-nerve facial-nerve occipital-nerve vagus-nerve lung kidney';
const SINGLE =
  'skin-head skin-face skin-neck skin-groin diaphragm pelvic-floor skull mandible c1 c2 c3 c4 c5 c6 c7 t1 t2 t3 t4 t5 t6 t7 t8 t9 t10 t11 ' +
  't12 l1 l2 l3 l4 l5 sacrum coccyx sternum spinal-cord brain eyes thyroid airway esophagus heart liver gallbladder stomach spleen pancreas ' +
  'small-intestine large-intestine bladder';
const LEGACY_IDS = [...SIDED.split(' ').flatMap((b) => [`${b}-l`, `${b}-r`]), ...SINGLE.split(' ')];

describe('catalog', () => {
  it('has unique ids and a known layer for every structure', () => {
    expect(STRUCTURES.length).toBeGreaterThan(2500);
    expect(STRUCTURE_BY_ID.size).toBe(STRUCTURES.length);
    const layers = new Set(LAYERS.map((l) => l.id));
    for (const s of STRUCTURES) {
      expect(layers.has(s.layer)).toBe(true);
      expect(s.name).toMatch(/^[A-Z0-9]/);
      expect(s.name).not.toMatch(/\?|\/\/|''/);
    }
  });

  it('names sided structures', () => {
    expect(sidedName('Vastus medialis muscle', 'L')).toBe('Left vastus medialis muscle');
    expect(sidedName('Right testicular artery', 'R')).toBe('Right testicular artery');
    expect(STRUCTURE_BY_ID.get('skeletal.patella_r')?.name).toBe('Right patella');
  });

  it('marks deep muscles and the approximated cerebrum', () => {
    expect(STRUCTURE_BY_ID.get('muscular.psoas_major_l')?.deep).toBe(true);
    expect(STRUCTURE_BY_ID.get('muscular.gluteus_maximus_muscle_l')?.deep).toBeFalsy();
    expect(STRUCTURE_BY_ID.get('approx.cerebral_hemisphere_l')?.approx).toBe(true);
  });

  it('finds structures by everyday words', () => {
    expect(searchStructures('hamstring', 6).every((s) => /biceps femoris|semitendinosus|semimembranosus/i.test(s.name))).toBe(true);
    expect(searchStructures('achilles', 2)[0]?.id).toBe('muscular.calcaneal_tendon_l');
    expect(searchStructures('left femur', 1)[0]?.id).toBe('skeletal.femur_l');
  });

  it('only has reference notes for real structures', () => {
    for (const k of INFO_IDS) expect(STRUCTURE_BY_ID.has(k) || STRUCTURE_BY_ID.has(`${k}_l`)).toBe(true);
  });
});

describe('layer files', () => {
  for (const { id } of LAYERS) {
    it(`${id}: matches the catalog and keeps triangles within their structure`, () => {
      const buf = layerFile(id);
      const h = readLayerHeader(buf);
      expect(h.layer).toBe(id);
      expect(new Set(h.ids)).toEqual(new Set(STRUCTURES.filter((s) => s.layer === id).map((s) => s.id)));
      const m = model(id);
      const idx = m.geometry.getIndex()!;
      const struct = m.geometry.getAttribute('aStruct');
      let next = 0;
      for (const [v0, vc] of m.ranges) {
        expect(v0).toBe(next);
        next = v0 + vc;
      }
      expect(next).toBe(m.geometry.getAttribute('position').count);
      for (let t = 0; t < idx.count; t += 3) {
        const s = struct.getX(idx.getX(t));
        if (struct.getX(idx.getX(t + 1)) !== s || struct.getX(idx.getX(t + 2)) !== s) throw new Error(`triangle ${t / 3} spans structures`);
      }
    });
  }

  it('puts the left side of the body at +x, facing +z', () => {
    const skin = model('skin');
    const c = structureCentroid(skin, skin.indexOf.get('regions.anterior_region_of_thigh_l')!);
    expect(c.x).toBeGreaterThan(0.03);
    const p = pointFacing(skin, skin.indexOf.get('regions.anterior_region_of_thigh_l')!, [0, 0, 1]);
    expect(p.normal[2]).toBeGreaterThan(0.3);
  });

  it('picks the structure under a ray, skipping hidden ones', () => {
    const skin = model('skin');
    const thigh = skin.indexOf.get('regions.anterior_region_of_thigh_l')!;
    const c = structureCentroid(skin, thigh);
    const ray = new Ray(new Vector3(c.x, c.y, 2), new Vector3(0, 0, -1));
    const hit = raycastLayer(skin, ray, () => true)!;
    expect(hit.structureId).toBe('regions.anterior_region_of_thigh_l');
    expect(hit.normal.z).toBeGreaterThan(0);
    // hide it: the ray then reaches the back of the thigh
    const behind = raycastLayer(skin, ray, (i) => i !== thigh);
    expect(behind?.structureId).not.toBe('regions.anterior_region_of_thigh_l');
  });

  it('snaps points onto structures and finds skin regions', () => {
    const muscles = model('muscular');
    const i = muscles.indexOf.get('muscular.rectus_femoris_muscle_l')!;
    const c = structureCentroid(muscles, i);
    const s = nearestOnStructure(muscles, i, [c.x, c.y, c.z + 0.5]);
    expect(s.point[2]).toBeGreaterThan(c.z);
    const skin = model('skin');
    const r = nearestOnLayer(skin, [c.x, c.y, c.z + 0.1]);
    expect(skin.ids[r.index]).toMatch(/thigh_l$|femoral_triangle_l$/);
  });
});

describe('legacy ids', () => {
  it('maps every id of the first body model to an atlas structure', () => {
    expect(LEGACY_IDS.length).toBe(246);
    const missing = LEGACY_IDS.filter((id) => !STRUCTURE_BY_ID.has(legacyToAtlas(id) ?? ''));
    expect(missing).toEqual([]);
    expect(legacyToAtlas('rib-7-r')).toBe('skeletal.seventh_rib_r');
    expect(legacyToAtlas('l4')).toBe('skeletal.vertebra_l4');
    expect(legacyToAtlas('muscular.soleus_muscle_l')).toBeUndefined();
  });

  it('migrates notes and flags old tap points', () => {
    const n = {
      locations: [{ structureId: 'vastus-medialis-l', point: [0.1, 0.5, 0.05] }, { structureId: 'heart' }],
      structureIds: ['vastus-medialis-l', 'heart'],
    } as unknown as Note;
    expect(migrateNoteIds(n)).toBe(true);
    expect(n.structureIds).toEqual(['muscular.vastus_medialis_muscle_l', 'cardiovascular.left_ventricle']);
    expect(n.locations[0].legacyPoint).toBe(true);
    expect(n.locations[1].legacyPoint).toBeUndefined();
    expect(migrateNoteIds(n)).toBe(false);
  });
});

describe('snapping to thin shells', () => {
  it('lands on the outer face of a skin region', () => {
    const skin = model('skin');
    const r = nearestOnLayer(skin, [-0.1, 0.7, 0.1]);
    expect(skin.ids[r.index]).toBe('regions.anterior_region_of_thigh_r');
    expect(r.normal[2]).toBeGreaterThan(0.5);
  });
});
