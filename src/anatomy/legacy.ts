// Structure ids from the first (procedural) body model, mapped to the closest
// structure in the anatomical atlas. Used to migrate notes saved before the
// upgrade and backups made with older versions.

/** Old base id (without the -l / -r suffix) → new id stem (without _l / _r). */
const SIDED: Record<string, string> = {
  // muscles
  biceps: 'muscular.long_head_of_biceps_brachii',
  triceps: 'muscular.long_head_of_triceps_brachii',
  'erector-spinae': 'muscular.longissimus_thoracis_muscle',
  'forearm-flexors': 'muscular.humero_ulnar_head_of_flexor_digitorum_superficialis',
  'forearm-extensors': 'muscular.extensor_digitorum',
  adductors: 'muscular.adductor_longus',
  semitendinosus: 'muscular.semitendinosus_muscle',
  scm: 'muscular.sternocleidomastoid_muscle',
  scalenes: 'muscular.scalenus_medius_muscle',
  'rectus-abdominis': 'muscular.rectus_abdominis_muscle',
  'external-oblique': 'muscular.external_abdominal_oblique_muscle',
  'serratus-anterior': 'muscular.serratus_anterior_muscle',
  frontalis: 'muscular.frontalis_muscle',
  temporalis: 'muscular.temporalis_muscle',
  masseter: 'muscular.superficial_part_of_masseter',
  'levator-scapulae': 'muscular.levator_scapulae',
  supraspinatus: 'muscular.supraspinatus_muscle',
  rhomboids: 'muscular.rhomboid_major_muscle',
  'quadratus-lumborum': 'muscular.quadratus_lumborum_muscle',
  iliopsoas: 'muscular.psoas_major',
  'upper-trapezius': 'muscular.descending_part_of_trapezius_muscle',
  'mid-trapezius': 'muscular.transverse_part_of_trapezius_muscle',
  'deltoid-anterior': 'muscular.clavicular_part_of_deltoid_muscle',
  'deltoid-lateral': 'muscular.acromial_part_of_deltoid_muscle',
  'deltoid-posterior': 'muscular.scapular_spinal_part_of_deltoid_muscle',
  infraspinatus: 'muscular.infraspinatus_muscle',
  'pectoralis-major': 'muscular.sternocostal_head_of_pectoralis_major_muscle',
  'latissimus-dorsi': 'muscular.latissimus_dorsi_muscle',
  brachioradialis: 'muscular.brachioradialis_muscle',
  'gluteus-maximus': 'muscular.gluteus_maximus_muscle',
  'gluteus-medius': 'muscular.gluteus_medius_muscle',
  'tfl-it-band': 'muscular.iliotibial_tract',
  'rectus-femoris': 'muscular.rectus_femoris_muscle',
  'vastus-lateralis': 'muscular.vastus_lateralis_muscle',
  'vastus-medialis': 'muscular.vastus_medialis_muscle',
  sartorius: 'muscular.sartorius_muscle',
  'biceps-femoris': 'muscular.long_head_of_biceps_femoris',
  'tibialis-anterior': 'muscular.tibialis_anterior_muscle',
  fibularis: 'muscular.fibularis_longus_muscle',
  gastrocnemius: 'muscular.medial_head_of_gastrocnemius',
  soleus: 'muscular.soleus_muscle',
  // bones
  clavicle: 'skeletal.clavicle',
  scapula: 'skeletal.scapula',
  humerus: 'skeletal.humerus',
  radius: 'skeletal.radius',
  ulna: 'skeletal.ulna',
  'hand-bones': 'skeletal.third_metacarpal_bone',
  'hip-bone': 'skeletal.hip_bone',
  femur: 'skeletal.femur',
  patella: 'skeletal.patella',
  tibia: 'skeletal.tibia',
  fibula: 'skeletal.fibula',
  'foot-bones': 'skeletal.talus',
  // nerves
  'brachial-plexus': 'nervous.posterior_cord_of_brachial_plexus',
  'median-nerve': 'nervous.median_nerve',
  'ulnar-nerve': 'nervous.ulnar_nerve',
  'radial-nerve': 'nervous.radial_nerve',
  'intercostal-nerves': 'nervous.intercostal_nerves',
  'femoral-nerve': 'nervous.femoral_nerve',
  'sciatic-nerve': 'nervous.sciatic_nerve',
  'tibial-nerve': 'nervous.tibial_nerve',
  'fibular-nerve': 'nervous.common_fibular_nerve',
  'trigeminal-nerve': 'nervous.trigeminal_nerve_v',
  'facial-nerve': 'nervous.facial_nerve_vii',
  // The atlas has no greater occipital nerve; the skin of the occipital region is where it is felt.
  'occipital-nerve': 'regions.occipital_region',
  'vagus-nerve': 'nervous.vagus_nerve_x',
  // organs
  lung: 'visceral.superior_lobe_of',
  kidney: 'visceral.fibrous_capsule_of_kidney',
  // skin
  'skin-chest': 'regions.pectoral_region',
  'skin-abdomen': 'regions.umbilical_region',
  'skin-upper-back': 'regions.scapular_region',
  'skin-lower-back': 'regions.lumbar_region',
  'skin-shoulder': 'regions.deltoid_region',
  'skin-upper-arm': 'regions.anterior_region_of_arm',
  'skin-elbow': 'regions.posterior_region_of_elbow',
  'skin-forearm': 'regions.anterior_region_of_forearm',
  'skin-hand': 'regions.dorsum_of_hand',
  'skin-hip': 'regions.hip_region',
  'skin-glute': 'regions.gluteal_region',
  'skin-thigh-front': 'regions.anterior_region_of_thigh',
  'skin-thigh-back': 'regions.posterior_region_of_thigh',
  'skin-knee': 'regions.anterior_region_of_knee',
  'skin-shin': 'regions.anterior_region_of_leg',
  'skin-calf': 'regions.posterior_region_of_leg',
  'skin-ankle': 'regions.anterior_region_of_ankle',
  'skin-foot': 'regions.dorsum_of_foot',
};

/** Old ids without a side → new id. */
const SINGLE: Record<string, string> = {
  diaphragm: 'muscular.diaphragm',
  'pelvic-floor': 'muscular.pubococcygeus_muscle_l',
  skull: 'skeletal.frontal_bone',
  mandible: 'skeletal.mandible',
  c1: 'skeletal.atlas_c1',
  c2: 'skeletal.axis_c2',
  sacrum: 'skeletal.sacrum',
  coccyx: 'skeletal.coccyx',
  sternum: 'skeletal.body_of_sternum',
  'spinal-cord': 'nervous.white_matter_of_spinal_cord_2',
  brain: 'approx.cerebral_hemisphere_l',
  eyes: 'nervous.posterior_segment_of_eyeball_l',
  thyroid: 'visceral.thyroid_gland',
  airway: 'visceral.trachea',
  esophagus: 'visceral.oesophagus',
  heart: 'cardiovascular.left_ventricle',
  liver: 'visceral.liver',
  gallbladder: 'visceral.gallbladder',
  stomach: 'visceral.stomach',
  spleen: 'lymphoid.spleen',
  pancreas: 'visceral.pancreas',
  'small-intestine': 'visceral.jejunum',
  'large-intestine': 'visceral.transverse_colon',
  bladder: 'visceral.urinary_bladder',
  'skin-head': 'regions.parietal_region_l',
  'skin-face': 'regions.buccal_region_l',
  'skin-neck': 'regions.lateral_region_of_neck_l',
  'skin-groin': 'regions.inguinal_region_l',
};

const RIB_ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];

/** Is this an id from the first body model? */
export function isLegacyId(id: string): boolean {
  return !id.includes('.');
}

/** The atlas structure that replaces an old id (undefined when the id is not a legacy one). */
export function legacyToAtlas(id: string): string | undefined {
  if (!isLegacyId(id)) return undefined;
  if (SINGLE[id]) return SINGLE[id];
  const m = /^(.*)-([lr])$/.exec(id);
  if (m) {
    const [, base, side] = m;
    const rib = /^rib-(\d+)$/.exec(base);
    if (rib) return `skeletal.${RIB_ORDINALS[Number(rib[1]) - 1]}_rib_${side}`;
    if (base === 'lung') return `visceral.superior_lobe_of_${side === 'l' ? 'left' : 'right'}_lung`;
    if (SIDED[base]) return `${SIDED[base]}_${side}`;
  }
  const v = /^([ctl])(\d+)$/.exec(id);
  if (v) return `skeletal.vertebra_${v[1]}${v[2]}`;
  return undefined;
}
