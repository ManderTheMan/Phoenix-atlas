// Functional muscle groups: the units coaches and lifters talk about
// ("quads", "lats"), mapped onto the atlas's individual muscles. Movement
// patterns tag these groups with a role, and training volume is counted per
// group.
import { STRUCTURE_BY_ID } from '../anatomy/catalog';

export type GroupId =
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'gluteMed'
  | 'adductors'
  | 'hipFlexors'
  | 'calves'
  | 'tibialis'
  | 'erectors'
  | 'abs'
  | 'obliques'
  | 'deepCore'
  | 'lats'
  | 'upperTraps'
  | 'midTraps'
  | 'lowerTraps'
  | 'frontDelts'
  | 'sideDelts'
  | 'rearDelts'
  | 'rotatorCuff'
  | 'pecs'
  | 'serratus'
  | 'biceps'
  | 'triceps'
  | 'forearmFlexors'
  | 'forearmExtensors'
  | 'neck';

export type Region = 'lower' | 'core' | 'upper';

export interface MuscleGroup {
  id: GroupId;
  name: string;
  region: Region;
  /** What the group mainly does. */
  action: string;
  /** Muscle id stems (without the muscular. prefix and the _l/_r side). */
  members: string[];
}

export const GROUPS: MuscleGroup[] = [
  { id: 'quads', name: 'Quadriceps', region: 'lower', action: 'Knee extension; rectus femoris also flexes the hip', members: ['rectus_femoris_muscle', 'vastus_lateralis_muscle', 'vastus_medialis_muscle', 'vastus_intermedius_muscle'] },
  { id: 'hamstrings', name: 'Hamstrings', region: 'lower', action: 'Hip extension and knee flexion', members: ['long_head_of_biceps_femoris', 'short_head_of_biceps_femoris', 'semitendinosus_muscle', 'semimembranosus_muscle'] },
  { id: 'glutes', name: 'Gluteus maximus', region: 'lower', action: 'Hip extension and external rotation', members: ['gluteus_maximus_muscle'] },
  { id: 'gluteMed', name: 'Hip abductors', region: 'lower', action: 'Hip abduction; keep the pelvis level on one leg', members: ['gluteus_medius_muscle', 'gluteus_minimus_muscle', 'tensor_fasciae_latae'] },
  { id: 'adductors', name: 'Adductors', region: 'lower', action: 'Hip adduction; adductor magnus also extends the hip', members: ['adductor_longus', 'adductor_brevis', 'adductor_magnus', 'adductor_minimus', 'gracilis_muscle', 'pectineus_muscle'] },
  { id: 'hipFlexors', name: 'Hip flexors', region: 'lower', action: 'Hip flexion', members: ['psoas_major', 'iliacus_muscle', 'sartorius_muscle'] },
  { id: 'calves', name: 'Calves', region: 'lower', action: 'Ankle plantarflexion; gastrocnemius also flexes the knee', members: ['medial_head_of_gastrocnemius', 'lateral_head_of_gastrocnemius', 'soleus_muscle', 'plantaris_muscle'] },
  { id: 'tibialis', name: 'Shin muscles', region: 'lower', action: 'Ankle dorsiflexion and inversion', members: ['tibialis_anterior_muscle', 'extensor_digitorum_longus', 'extensor_hallucis_longus'] },
  { id: 'erectors', name: 'Spinal erectors', region: 'core', action: 'Spine extension; resist forward bending', members: ['longissimus_thoracis_muscle', 'iliocostalis_lumborum_muscle', 'iliocostalis_thoracis_muscle', 'spinalis_thoracis_muscle', 'multifidus_lumborum_muscle', 'multifidus_thoracis_muscle', 'semispinalis_thoracis_muscle'] },
  { id: 'abs', name: 'Rectus abdominis', region: 'core', action: 'Trunk flexion; resist extension', members: ['rectus_abdominis_muscle', 'pyramidalis_muscle'] },
  { id: 'obliques', name: 'Obliques', region: 'core', action: 'Trunk rotation and side bending; resist both', members: ['external_abdominal_oblique_muscle', 'internal_abdominal_oblique_muscle'] },
  { id: 'deepCore', name: 'Deep core', region: 'core', action: 'Brace the trunk; side-bend and stabilise the lumbar spine', members: ['transversus_abdominis_muscle', 'quadratus_lumborum_muscle', 'diaphragm'] },
  { id: 'lats', name: 'Lats', region: 'upper', action: 'Shoulder extension and adduction', members: ['latissimus_dorsi_muscle', 'teres_major_muscle'] },
  { id: 'upperTraps', name: 'Upper traps', region: 'upper', action: 'Shoulder blade elevation and upward rotation', members: ['descending_part_of_trapezius_muscle', 'levator_scapulae'] },
  { id: 'midTraps', name: 'Mid traps & rhomboids', region: 'upper', action: 'Shoulder blade retraction', members: ['transverse_part_of_trapezius_muscle', 'rhomboid_major_muscle', 'rhomboid_minor_muscle'] },
  { id: 'lowerTraps', name: 'Lower traps', region: 'upper', action: 'Shoulder blade depression and upward rotation', members: ['ascending_part_of_trapezius_muscle'] },
  { id: 'frontDelts', name: 'Front delts', region: 'upper', action: 'Shoulder flexion', members: ['clavicular_part_of_deltoid_muscle'] },
  { id: 'sideDelts', name: 'Side delts', region: 'upper', action: 'Shoulder abduction', members: ['acromial_part_of_deltoid_muscle'] },
  { id: 'rearDelts', name: 'Rear delts', region: 'upper', action: 'Shoulder horizontal abduction and extension', members: ['scapular_spinal_part_of_deltoid_muscle'] },
  { id: 'rotatorCuff', name: 'Rotator cuff', region: 'upper', action: 'Centre the humeral head; rotate the arm', members: ['supraspinatus_muscle', 'infraspinatus_muscle', 'teres_minor_muscle', 'subscapularis_muscle'] },
  { id: 'pecs', name: 'Pecs', region: 'upper', action: 'Shoulder horizontal adduction and flexion', members: ['clavicular_head_of_pectoralis_major_muscle', 'sternocostal_head_of_pectoralis_major_muscle', 'abdominal_part_of_pectoralis_major_muscle', 'pectoralis_minor_muscle'] },
  { id: 'serratus', name: 'Serratus anterior', region: 'upper', action: 'Shoulder blade protraction and upward rotation', members: ['serratus_anterior_muscle'] },
  { id: 'biceps', name: 'Elbow flexors', region: 'upper', action: 'Elbow flexion; biceps also supinates', members: ['long_head_of_biceps_brachii', 'short_head_of_biceps_brachii', 'brachialis_muscle', 'brachioradialis_muscle', 'coracobrachialis_muscle'] },
  { id: 'triceps', name: 'Triceps', region: 'upper', action: 'Elbow extension; the long head also extends the shoulder', members: ['long_head_of_triceps_brachii', 'lateral_head_of_triceps_brachii', 'medial_head_of_triceps_brachii', 'anconeus_muscle'] },
  { id: 'forearmFlexors', name: 'Grip & wrist flexors', region: 'upper', action: 'Grip and wrist flexion', members: ['flexor_carpi_radialis', 'humeral_head_of_flexor_carpi_ulnaris', 'ulnar_head_of_flexor_carpi_ulnaris', 'humero_ulnar_head_of_flexor_digitorum_superficialis', 'radial_head_of_flexor_digitorum_superficialis', 'flexor_digitorum_profundus', 'flexor_pollicis_longus', 'palmaris_longus_muscle'] },
  { id: 'forearmExtensors', name: 'Wrist extensors', region: 'upper', action: 'Wrist extension', members: ['extensor_carpi_radialis_longus', 'extensor_carpi_radialis_brevis', 'humeral_head_of_extensor_carpi_ulnaris', 'ulnar_head_of_extensor_carpi_ulnaris', 'extensor_digitorum'] },
  { id: 'neck', name: 'Neck', region: 'upper', action: 'Head and neck movement and stability', members: ['sternocleidomastoid_muscle', 'scalenus_anterior_muscle', 'scalenus_medius_muscle', 'splenius_capitis_muscle', 'longus_colli_muscle'] },
];

export const GROUP_BY_ID = new Map(GROUPS.map((g) => [g.id, g])) as Map<GroupId, MuscleGroup>;

const ids = new Map<GroupId, string[]>();

/** Atlas structure ids of a group (both sides; midline muscles once). */
export function groupStructures(id: GroupId): string[] {
  let out = ids.get(id);
  if (!out) {
    out = [];
    for (const m of GROUP_BY_ID.get(id)?.members ?? [])
      for (const sfx of ['_l', '_r', ''])
        if (STRUCTURE_BY_ID.has(`muscular.${m}${sfx}`)) out.push(`muscular.${m}${sfx}`);
    ids.set(id, out);
  }
  return out;
}

let memberOf: Map<string, GroupId[]> | null = null;

/** The groups a structure belongs to. */
export function groupsOfStructure(structureId: string): GroupId[] {
  if (!memberOf) {
    memberOf = new Map();
    for (const g of GROUPS) for (const s of groupStructures(g.id)) memberOf.set(s, [...(memberOf.get(s) ?? []), g.id]);
  }
  return memberOf.get(structureId) ?? [];
}
