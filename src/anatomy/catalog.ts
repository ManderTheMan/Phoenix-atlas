// Every tappable structure in the atlas. The list is generated from the
// anatomical dataset by scripts/build-atlas.ts (see catalog.json).
import data from './catalog.json';
import { infoFor } from './info';
import type { LayerId, Side, StructureDef } from './types';

interface RawStructure {
  id: string;
  name: string;
  latin?: string;
  layer: LayerId;
  group: string;
  side?: Side;
  deep?: boolean;
  approx?: boolean;
}

const raw = (data as { source: string; structures: RawStructure[] }).structures;

function lowerFirst(s: string): string {
  const w = s.split(' ')[0];
  // keep acronyms and labels with digits ("C1", "MCP") as they are
  if (w.length > 1 && (w === w.toUpperCase() || /\d/.test(w))) return s;
  return s[0].toLowerCase() + s.slice(1);
}

/** Display name including the side ("Left vastus medialis muscle"). */
export function sidedName(name: string, side?: Side): string {
  if (!side || /^(left|right)\b/i.test(name)) return name;
  return `${side === 'L' ? 'Left' : 'Right'} ${lowerFirst(name)}`;
}

export const STRUCTURES: StructureDef[] = raw.map((r) => ({
  ...r,
  name: sidedName(r.name, r.side),
  info: infoFor(r.id),
}));

export const STRUCTURE_BY_ID: Map<string, StructureDef> = new Map(STRUCTURES.map((s) => [s.id, s]));

export function structureName(id: string): string {
  return STRUCTURE_BY_ID.get(id)?.name ?? id;
}

export function structuresInLayer(layer: LayerId): StructureDef[] {
  return STRUCTURES.filter((s) => s.layer === layer);
}

// Everyday words people use for parts of the body, matched against atlas names.
const ALIASES: [RegExp, string][] = [
  [/biceps femoris|semitendinosus|semimembranosus/, 'hamstring hamstrings'],
  [/rectus femoris|vastus/, 'quadriceps quads'],
  [/gastrocnemius|soleus/, 'calf calves'],
  [/calcaneal tendon/, 'achilles tendon'],
  [/iliotibial|tensor fasciae/, 'it band itb tfl'],
  [/psoas|iliacus/, 'hip flexor hip flexors'],
  [/trapezius/, 'traps'],
  [/latissimus/, 'lats'],
  [/pectoralis/, 'pecs chest'],
  [/gluteus|gluteal/, 'glutes buttock'],
  [/deltoid/, 'delts shoulder'],
  [/rectus abdominis|oblique|transversus abdominis/, 'abs core'],
  [/longissimus|iliocostalis|spinalis|multifidus|quadratus lumborum|lumbar/, 'lower back'],
  [/adductor|gracilis|pectineus|inguinal/, 'groin'],
  [/scapula/, 'shoulder blade'],
  [/clavicle/, 'collarbone'],
  [/patella/, 'kneecap'],
  [/femur/, 'thigh bone'],
  [/coccyx/, 'tailbone'],
  [/sternum/, 'breastbone'],
  [/mandible|masseter|temporomandibular/, 'jaw tmj'],
  [/vertebra|intervertebral|sacrum|coccyx/, 'spine back'],
  [/calcaneus|heel/, 'heel'],
  [/carpal|radiocarpal|scaphoid|lunate/, 'wrist'],
  [/talus|malleol|talocrural|ankle/, 'ankle'],
  [/cerebral|cerebell|brainstem|pons|medulla/, 'brain head'],
  [/jejunum|duodenum|ileum|colon|caecum|rectum/, 'gut bowel intestine'],
  [/ventricle|atrium/, 'heart'],
  [/kidney|renal/, 'kidneys'],
  [/tibialis anterior|anterior region of leg/, 'shin'],
];
const aliasesFor = (name: string) =>
  ALIASES.filter(([re]) => re.test(name))
    .map(([, words]) => words)
    .join(' ');

const aliasWords = new Map(STRUCTURES.map((s) => [s.id, aliasesFor(s.name.toLowerCase()).split(' ').filter(Boolean)]));
const haystack = new Map(
  STRUCTURES.map((s) => [s.id, `${s.name} ${s.latin ?? ''} ${s.group} ${s.layer} ${aliasWords.get(s.id)!.join(' ')}`.toLowerCase()]),
);

/** Search names (English and Latin) and groups; best matches first. */
export function searchStructures(q: string, limit = 30): StructureDef[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits: { s: StructureDef; score: number }[] = [];
  for (const s of STRUCTURES) {
    const hay = haystack.get(s.id)!;
    if (!terms.every((t) => hay.includes(t))) continue;
    const name = s.name.toLowerCase();
    let score = 0;
    const aliases = aliasWords.get(s.id)!;
    for (const t of terms) {
      if (name.includes(t)) score += 2;
      if (new RegExp(`(^|[\\s(-])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(name)) score += 2;
      if (aliases.some((a) => a.startsWith(t))) score += 5;
    }
    // vessels have long, similar names; list them after muscles, bones and skin
    if (s.layer === 'vascular') score -= 3;
    // shorter names are usually the main structure ("Femur" before "Head of femur")
    score -= name.length / 80;
    if (s.deep) score -= 0.1;
    hits.push({ s, score });
  }
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((h) => h.s);
}
