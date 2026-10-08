// The fundamental movement patterns, the muscle groups each one uses (tagged
// with their role and the joint whose torque drives them), the options that
// change their leverage, and the exercise names that belong to them.
import type { JointId, ModelId } from './biomech';
import type { GroupId } from './groups';

export type PatternId = 'squat' | 'hinge' | 'lunge' | 'pushH' | 'pushV' | 'pullH' | 'pullV' | 'carry' | 'rotation' | 'gait';
export type Role = 'prime' | 'synergist' | 'stabiliser';

export interface GroupTag {
  group: GroupId;
  role: Role;
  /** The joint torque that drives the group (sign 1 = the joint's `positive` action, -1 = the opposite). */
  driver?: { joint: JointId; sign: 1 | -1 };
  /** Effort when the driver is zero, or constant effort for undriven stabilisers (0–1). */
  base?: number;
  /** Scales the driven effort (e.g. hamstrings contribute less hip extension than glutes in a squat). */
  share?: number;
}

export interface Choice {
  value: string;
  label: string;
}

export interface OptionDef {
  id: string;
  label: string;
  choices: Choice[];
  default: string;
  hint?: string;
}

export interface AxisDef {
  joint: JointId;
  /** Landmark names where the axis passes (one per side). */
  at: string[];
  /** Axis direction on the standing body: x = side to side, y = vertical, z = front to back. */
  dir: 'x' | 'y' | 'z';
}

export interface PatternDef {
  id: PatternId;
  name: string;
  short: string;
  description: string;
  model: ModelId;
  variants: (Choice & { load: number | 'none' })[];
  options: OptionDef[];
  groups: GroupTag[];
  loadLabel: string;
  loadMax: number;
  phase: [string, string];
  axes: AxisDef[];
}

const bilateral = (n: string) => [`${n}_l`, `${n}_r`];

export const PATTERNS: PatternDef[] = [
  {
    id: 'squat',
    name: 'Squat',
    short: 'Squat',
    description: 'Knees and hips bend together with the torso fairly upright. Knee-dominant: the quads do much of the work, with the glutes.',
    model: 'squat',
    variants: [
      { value: 'highbar', label: 'High-bar back squat', load: 80 },
      { value: 'lowbar', label: 'Low-bar back squat', load: 90 },
      { value: 'front', label: 'Front squat', load: 60 },
      { value: 'goblet', label: 'Goblet squat', load: 24 },
    ],
    options: [
      { id: 'depth', label: 'Depth', default: 'parallel', choices: [{ value: 'half', label: 'Half' }, { value: 'parallel', label: 'Parallel' }, { value: 'deep', label: 'Deep' }] },
      { id: 'ankle', label: 'Ankle mobility', default: '38', hint: 'How far your shins can tilt forward. Less mobility pushes the hips back.', choices: [{ value: '28', label: 'Stiff' }, { value: '38', label: 'Typical' }, { value: '48', label: 'Mobile' }] },
    ],
    groups: [
      { group: 'quads', role: 'prime', driver: { joint: 'knee', sign: 1 } },
      { group: 'glutes', role: 'prime', driver: { joint: 'hip', sign: 1 } },
      { group: 'adductors', role: 'synergist', driver: { joint: 'hip', sign: 1 }, share: 0.8 },
      { group: 'hamstrings', role: 'synergist', driver: { joint: 'hip', sign: 1 }, share: 0.45 },
      { group: 'erectors', role: 'stabiliser', driver: { joint: 'lumbar', sign: 1 } },
      { group: 'calves', role: 'stabiliser', driver: { joint: 'ankle', sign: 1 } },
      { group: 'deepCore', role: 'stabiliser', base: 0.4 },
      { group: 'abs', role: 'stabiliser', base: 0.25 },
      { group: 'obliques', role: 'stabiliser', base: 0.3 },
      { group: 'midTraps', role: 'stabiliser', base: 0.2 },
    ],
    loadLabel: 'Load',
    loadMax: 300,
    phase: ['Standing', 'Bottom'],
    axes: [
      { joint: 'ankle', at: bilateral('ankle'), dir: 'x' },
      { joint: 'knee', at: bilateral('knee'), dir: 'x' },
      { joint: 'hip', at: bilateral('hip'), dir: 'x' },
      { joint: 'lumbar', at: ['l5s1'], dir: 'x' },
    ],
  },
  {
    id: 'hinge',
    name: 'Hinge',
    short: 'Hinge',
    description: 'The hips travel back and the torso tips forward with the knees only slightly bent. Hip-dominant: glutes, hamstrings and spinal erectors.',
    model: 'hinge',
    variants: [
      { value: 'conventional', label: 'Deadlift (from the floor)', load: 120 },
      { value: 'rdl', label: 'Romanian deadlift', load: 80 },
    ],
    options: [],
    groups: [
      { group: 'glutes', role: 'prime', driver: { joint: 'hip', sign: 1 } },
      { group: 'hamstrings', role: 'prime', driver: { joint: 'hip', sign: 1 } },
      { group: 'erectors', role: 'prime', driver: { joint: 'lumbar', sign: 1 } },
      { group: 'adductors', role: 'synergist', driver: { joint: 'hip', sign: 1 }, share: 0.7 },
      { group: 'quads', role: 'synergist', driver: { joint: 'knee', sign: 1 } },
      { group: 'lats', role: 'stabiliser', base: 0.35, driver: { joint: 'lumbar', sign: 1 }, share: 0.4 },
      { group: 'forearmFlexors', role: 'stabiliser', base: 0.45, driver: { joint: 'lumbar', sign: 1 }, share: 0.5 },
      { group: 'upperTraps', role: 'stabiliser', base: 0.3 },
      { group: 'midTraps', role: 'stabiliser', base: 0.3 },
      { group: 'deepCore', role: 'stabiliser', base: 0.4 },
    ],
    loadLabel: 'Bar load',
    loadMax: 350,
    phase: ['Lockout', 'Bottom'],
    axes: [
      { joint: 'knee', at: bilateral('knee'), dir: 'x' },
      { joint: 'hip', at: bilateral('hip'), dir: 'x' },
      { joint: 'lumbar', at: ['l5s1'], dir: 'x' },
    ],
  },
  {
    id: 'lunge',
    name: 'Lunge & split squat',
    short: 'Lunge',
    description: 'One leg at a time. The front leg does most of the work while the hips stay level, so the hip abductors join in.',
    model: 'lunge',
    variants: [
      { value: 'knee', label: 'Upright, knee forward (quad bias)', load: 20 },
      { value: 'hip', label: 'Lean forward, vertical shin (glute bias)', load: 20 },
    ],
    options: [],
    groups: [
      { group: 'quads', role: 'prime', driver: { joint: 'knee', sign: 1 } },
      { group: 'glutes', role: 'prime', driver: { joint: 'hip', sign: 1 } },
      { group: 'gluteMed', role: 'stabiliser', base: 0.45 },
      { group: 'adductors', role: 'synergist', driver: { joint: 'hip', sign: 1 }, share: 0.6 },
      { group: 'hamstrings', role: 'synergist', driver: { joint: 'hip', sign: 1 }, share: 0.4 },
      { group: 'calves', role: 'stabiliser', driver: { joint: 'ankle', sign: 1 } },
      { group: 'erectors', role: 'stabiliser', driver: { joint: 'lumbar', sign: 1 } },
      { group: 'obliques', role: 'stabiliser', base: 0.3 },
      { group: 'deepCore', role: 'stabiliser', base: 0.3 },
      { group: 'forearmFlexors', role: 'stabiliser', base: 0.3 },
    ],
    loadLabel: 'Dumbbells (total)',
    loadMax: 120,
    phase: ['Standing', 'Bottom'],
    axes: [
      { joint: 'ankle', at: ['ankle_l'], dir: 'x' },
      { joint: 'knee', at: ['knee_l'], dir: 'x' },
      { joint: 'hip', at: ['hip_l'], dir: 'x' },
      { joint: 'lumbar', at: ['l5s1'], dir: 'x' },
    ],
  },
  {
    id: 'pushH',
    name: 'Horizontal push',
    short: 'Push →',
    description: 'Pressing away from the chest. Pecs and front delts move the arm; the triceps straighten the elbow.',
    model: 'bench',
    variants: [
      { value: 'bench', label: 'Bench press', load: 70 },
      { value: 'pushup', label: 'Push-up', load: 'none' },
    ],
    options: [
      { id: 'grip', label: 'Grip', default: 'medium', choices: [{ value: 'narrow', label: 'Narrow' }, { value: 'medium', label: 'Medium' }, { value: 'wide', label: 'Wide' }] },
      { id: 'elbows', label: 'Elbows', default: 'tucked', choices: [{ value: 'tucked', label: 'Tucked 45°' }, { value: 'flared', label: 'Flared 75°' }] },
      { id: 'touch', label: 'Touch point', default: 'mid', choices: [{ value: 'high', label: 'High chest' }, { value: 'mid', label: 'Mid chest' }, { value: 'low', label: 'Low chest' }] },
    ],
    groups: [
      { group: 'pecs', role: 'prime', driver: { joint: 'shoulder', sign: 1 } },
      { group: 'triceps', role: 'prime', driver: { joint: 'elbow', sign: 1 } },
      { group: 'frontDelts', role: 'synergist', driver: { joint: 'shoulder', sign: 1 } },
      { group: 'serratus', role: 'stabiliser', base: 0.3 },
      { group: 'rotatorCuff', role: 'stabiliser', base: 0.3, driver: { joint: 'shoulder', sign: 1 }, share: 0.5 },
      { group: 'abs', role: 'stabiliser', base: 0.15 },
    ],
    loadLabel: 'Bar load',
    loadMax: 250,
    phase: ['Arms locked', 'Bar on chest'],
    axes: [
      { joint: 'shoulder', at: bilateral('shoulder'), dir: 'y' },
      { joint: 'elbow', at: bilateral('elbow'), dir: 'x' },
    ],
  },
  {
    id: 'pushV',
    name: 'Vertical push',
    short: 'Push ↑',
    description: 'Pressing overhead. Delts lift the arm, the triceps lock the elbow out, and the traps and serratus rotate the shoulder blade up.',
    model: 'press',
    variants: [
      { value: 'strict', label: 'Standing overhead press', load: 40 },
      { value: 'seated', label: 'Seated dumbbell press', load: 30 },
    ],
    options: [{ id: 'grip', label: 'Grip', default: 'medium', choices: [{ value: 'narrow', label: 'Narrow' }, { value: 'medium', label: 'Medium' }, { value: 'wide', label: 'Wide' }] }],
    groups: [
      { group: 'frontDelts', role: 'prime', driver: { joint: 'shoulder', sign: 1 } },
      { group: 'triceps', role: 'prime', driver: { joint: 'elbow', sign: 1 } },
      { group: 'sideDelts', role: 'synergist', driver: { joint: 'shoulder', sign: 1 } },
      { group: 'upperTraps', role: 'synergist', base: 0.25, driver: { joint: 'shoulder', sign: 1 }, share: 0.6 },
      { group: 'serratus', role: 'synergist', base: 0.25, driver: { joint: 'shoulder', sign: 1 }, share: 0.6 },
      { group: 'rotatorCuff', role: 'stabiliser', base: 0.3 },
      { group: 'abs', role: 'stabiliser', base: 0.3 },
      { group: 'obliques', role: 'stabiliser', base: 0.3 },
      { group: 'glutes', role: 'stabiliser', base: 0.2 },
    ],
    loadLabel: 'Load',
    loadMax: 150,
    phase: ['Bar at chin', 'Lockout'],
    axes: [
      { joint: 'shoulder', at: bilateral('shoulder'), dir: 'x' },
      { joint: 'elbow', at: bilateral('elbow'), dir: 'x' },
      { joint: 'lumbar', at: ['l5s1'], dir: 'x' },
    ],
  },
  {
    id: 'pullH',
    name: 'Horizontal pull',
    short: 'Pull →',
    description: 'Rowing towards the torso. Lats, mid traps and rear delts pull the arm back; the biceps bend the elbow while the hips and back hold the hinge.',
    model: 'row',
    variants: [{ value: 'barbell', label: 'Bent-over row', load: 60 }],
    options: [{ id: 'torso', label: 'Torso angle', default: '45', choices: [{ value: '30', label: '30°' }, { value: '45', label: '45°' }, { value: '70', label: '70°' }], hint: 'From vertical. A flatter back is more upper-back work and more load on the lower back.' }],
    groups: [
      { group: 'lats', role: 'prime', driver: { joint: 'shoulder', sign: 1 } },
      { group: 'midTraps', role: 'prime', driver: { joint: 'shoulder', sign: 1 } },
      { group: 'rearDelts', role: 'synergist', driver: { joint: 'shoulder', sign: 1 } },
      { group: 'biceps', role: 'synergist', driver: { joint: 'elbow', sign: 1 } },
      { group: 'lowerTraps', role: 'synergist', driver: { joint: 'shoulder', sign: 1 }, share: 0.6 },
      { group: 'erectors', role: 'stabiliser', driver: { joint: 'lumbar', sign: 1 } },
      { group: 'hamstrings', role: 'stabiliser', driver: { joint: 'hip', sign: 1 }, share: 0.6 },
      { group: 'glutes', role: 'stabiliser', driver: { joint: 'hip', sign: 1 }, share: 0.6 },
      { group: 'forearmFlexors', role: 'stabiliser', base: 0.4 },
    ],
    loadLabel: 'Bar load',
    loadMax: 200,
    phase: ['Arms hanging', 'Bar at torso'],
    axes: [
      { joint: 'shoulder', at: bilateral('shoulder'), dir: 'x' },
      { joint: 'elbow', at: bilateral('elbow'), dir: 'x' },
      { joint: 'hip', at: bilateral('hip'), dir: 'x' },
      { joint: 'lumbar', at: ['l5s1'], dir: 'x' },
    ],
  },
  {
    id: 'pullV',
    name: 'Vertical pull',
    short: 'Pull ↑',
    description: 'Pulling down from overhead, or pulling yourself up. The lats bring the arms down to the sides; the biceps help bend the elbows.',
    model: 'pullup',
    variants: [
      { value: 'pullup', label: 'Pull-up / chin-up', load: 'none' },
      { value: 'pulldown', label: 'Lat pulldown', load: 55 },
    ],
    options: [{ id: 'grip', label: 'Grip', default: 'wide', choices: [{ value: 'chin', label: 'Chin-up (palms in)' }, { value: 'medium', label: 'Medium' }, { value: 'wide', label: 'Wide' }] }],
    groups: [
      { group: 'lats', role: 'prime', driver: { joint: 'shoulder', sign: 1 } },
      { group: 'biceps', role: 'synergist', driver: { joint: 'elbow', sign: 1 } },
      { group: 'lowerTraps', role: 'synergist', driver: { joint: 'shoulder', sign: 1 }, share: 0.6 },
      { group: 'midTraps', role: 'synergist', driver: { joint: 'shoulder', sign: 1 }, share: 0.5 },
      { group: 'rearDelts', role: 'synergist', driver: { joint: 'shoulder', sign: 1 }, share: 0.5 },
      { group: 'pecs', role: 'stabiliser', driver: { joint: 'shoulder', sign: 1 }, share: 0.35 },
      { group: 'forearmFlexors', role: 'stabiliser', base: 0.55 },
      { group: 'rotatorCuff', role: 'stabiliser', base: 0.3 },
      { group: 'abs', role: 'stabiliser', base: 0.25 },
    ],
    loadLabel: 'Stack weight',
    loadMax: 150,
    phase: ['Arms straight', 'Chin over bar'],
    axes: [
      { joint: 'shoulder', at: bilateral('shoulder'), dir: 'z' },
      { joint: 'elbow', at: bilateral('elbow'), dir: 'x' },
    ],
  },
  {
    id: 'carry',
    name: 'Loaded carry',
    short: 'Carry',
    description: 'Walking with weight. On each step one hip holds the pelvis level, and an uneven load makes the trunk resist bending sideways.',
    model: 'carry',
    variants: [
      { value: 'suitcase', label: 'Suitcase carry (load in the right hand)', load: 24 },
      { value: 'farmer', label: 'Farmer’s carry (both hands)', load: 48 },
      { value: 'suitcaseSame', label: 'Load on the standing side', load: 24 },
      { value: 'walk', label: 'Walking, no load', load: 'none' },
    ],
    options: [],
    groups: [
      { group: 'gluteMed', role: 'prime', driver: { joint: 'hipFrontal', sign: 1 } },
      { group: 'deepCore', role: 'prime', driver: { joint: 'spineLateral', sign: 1 } },
      { group: 'obliques', role: 'synergist', driver: { joint: 'spineLateral', sign: 1 } },
      { group: 'forearmFlexors', role: 'prime', base: 0.65 },
      { group: 'upperTraps', role: 'synergist', base: 0.45 },
      { group: 'adductors', role: 'stabiliser', base: 0.25 },
      { group: 'erectors', role: 'stabiliser', base: 0.25 },
      { group: 'calves', role: 'stabiliser', base: 0.3 },
    ],
    loadLabel: 'Load',
    loadMax: 120,
    phase: ['Both feet down', 'On the left leg'],
    axes: [
      { joint: 'hipFrontal', at: ['hip_l'], dir: 'z' },
      { joint: 'spineLateral', at: ['l4l5'], dir: 'z' },
    ],
  },
  {
    id: 'rotation',
    name: 'Rotation & anti-rotation',
    short: 'Rotate',
    description: 'Resisting (or producing) twist through the trunk. The further the hands are from the spine, the longer the lever and the harder the obliques work.',
    model: 'pallof',
    variants: [{ value: 'pallof', label: 'Pallof press (band from the right)', load: 10 }],
    options: [],
    groups: [
      { group: 'obliques', role: 'prime', driver: { joint: 'spineAxial', sign: 1 } },
      { group: 'deepCore', role: 'synergist', driver: { joint: 'spineAxial', sign: 1 } },
      { group: 'abs', role: 'synergist', driver: { joint: 'spineAxial', sign: 1 }, share: 0.5 },
      { group: 'pecs', role: 'stabiliser', driver: { joint: 'shoulder', sign: 1 } },
      { group: 'frontDelts', role: 'stabiliser', driver: { joint: 'shoulder', sign: 1 } },
      { group: 'rotatorCuff', role: 'stabiliser', base: 0.25 },
      { group: 'glutes', role: 'stabiliser', base: 0.25 },
      { group: 'gluteMed', role: 'stabiliser', base: 0.25 },
    ],
    loadLabel: 'Band tension',
    loadMax: 40,
    phase: ['Hands at chest', 'Arms extended'],
    axes: [
      { joint: 'spineAxial', at: ['t12l1'], dir: 'y' },
      { joint: 'shoulder', at: bilateral('shoulder'), dir: 'y' },
    ],
  },
  {
    id: 'gait',
    name: 'Gait (running stance)',
    short: 'Run',
    description: 'One foot on the ground while running. The calves and quads absorb and return a force of over twice your body weight.',
    model: 'gait',
    variants: [{ value: 'run', label: 'Easy run (~3.5 m/s)', load: 'none' }],
    options: [],
    groups: [
      { group: 'calves', role: 'prime', driver: { joint: 'ankle', sign: 1 } },
      { group: 'quads', role: 'prime', driver: { joint: 'knee', sign: 1 } },
      { group: 'glutes', role: 'synergist', driver: { joint: 'hip', sign: 1 } },
      { group: 'hamstrings', role: 'synergist', driver: { joint: 'hip', sign: 1 }, share: 0.7 },
      { group: 'hipFlexors', role: 'synergist', driver: { joint: 'hip', sign: -1 } },
      { group: 'tibialis', role: 'stabiliser', driver: { joint: 'ankle', sign: -1 }, base: 0.15 },
      { group: 'gluteMed', role: 'stabiliser', base: 0.45 },
      { group: 'deepCore', role: 'stabiliser', base: 0.25 },
      { group: 'obliques', role: 'stabiliser', base: 0.2 },
    ],
    loadLabel: '',
    loadMax: 0,
    phase: ['Foot lands', 'Toe-off'],
    axes: [
      { joint: 'ankle', at: ['ankle_l'], dir: 'x' },
      { joint: 'knee', at: ['knee_l'], dir: 'x' },
      { joint: 'hip', at: ['hip_l'], dir: 'x' },
    ],
  },
];

export const PATTERN_BY_ID = new Map(PATTERNS.map((p) => [p.id, p])) as Map<PatternId, PatternDef>;

// ---------------------------------------------------------------- exercises

export interface ExerciseMatch {
  pattern?: PatternId;
  variant?: string;
  /** Isolation work credited straight to groups. */
  groups?: { group: GroupId; role: Role }[];
}

/** First match wins, so specific names come before general ones. */
const RULES: [RegExp, ExerciseMatch][] = [
  [/front squat/, { pattern: 'squat', variant: 'front' }],
  [/goblet/, { pattern: 'squat', variant: 'goblet' }],
  [/low[- ]?bar/, { pattern: 'squat', variant: 'lowbar' }],
  [/split squat|bulgarian|lunge|step[- ]?up|pistol|skater squat/, { pattern: 'lunge', variant: 'knee' }],
  [/squat|leg press|hack|belt squat/, { pattern: 'squat', variant: 'highbar' }],
  [/romanian|\brdl\b|stiff[- ]?leg|good ?morning|single[- ]leg deadlift|hip thrust|glute bridge|swing|back extension|hyperextension|reverse hyper/, { pattern: 'hinge', variant: 'rdl' }],
  [/deadlift|clean|snatch|rack pull|trap bar|jefferson/, { pattern: 'hinge', variant: 'conventional' }],
  [/push[- ]?up|press[- ]?up/, { pattern: 'pushH', variant: 'pushup' }],
  [/bench|chest press|floor press|\bdips?\b|fly|flye|pec deck|svend/, { pattern: 'pushH', variant: 'bench' }],
  [/overhead press|\bohp\b|military|shoulder press|push press|jerk|landmine press|arnold|handstand|pike/, { pattern: 'pushV', variant: 'strict' }],
  [/pull[- ]?up|chin[- ]?up|muscle[- ]?up/, { pattern: 'pullV', variant: 'pullup' }],
  [/pulldown|pull[- ]?down|lat pull/, { pattern: 'pullV', variant: 'pulldown' }],
  [/upright row/, { groups: [{ group: 'sideDelts', role: 'prime' }, { group: 'upperTraps', role: 'prime' }] }],
  [/row|face pull|pull[- ]?apart|seal/, { pattern: 'pullH', variant: 'barbell' }],
  [/carry|farmer|suitcase|yoke|waiter/, { pattern: 'carry', variant: 'farmer' }],
  [/pallof|wood ?chop|chop\b|russian twist|rotation|anti[- ]?rotation|cable twist|landmine twist/, { pattern: 'rotation', variant: 'pallof' }],
  [/\brun|jog|sprint|tempo|interval|marathon|\b(5|10)k\b|strides|track|trail/, { pattern: 'gait', variant: 'run' }],
  [/leg curl|nordic|hamstring curl|glute[- ]ham/, { groups: [{ group: 'hamstrings', role: 'prime' }] }],
  [/curl/, { groups: [{ group: 'biceps', role: 'prime' }, { group: 'forearmFlexors', role: 'synergist' }] }],
  [/tricep|pushdown|push[- ]?down|skull ?crusher|kickback|french press|overhead extension/, { groups: [{ group: 'triceps', role: 'prime' }] }],
  [/lateral raise|side raise/, { groups: [{ group: 'sideDelts', role: 'prime' }] }],
  [/front raise/, { groups: [{ group: 'frontDelts', role: 'prime' }] }],
  [/rear delt|reverse fly|reverse flye/, { groups: [{ group: 'rearDelts', role: 'prime' }, { group: 'midTraps', role: 'synergist' }] }],
  [/shrug/, { groups: [{ group: 'upperTraps', role: 'prime' }] }],
  [/calf raise|calf/, { groups: [{ group: 'calves', role: 'prime' }] }],
  [/leg extension|sissy/, { groups: [{ group: 'quads', role: 'prime' }] }],
  [/adduct|copenhagen/, { groups: [{ group: 'adductors', role: 'prime' }] }],
  [/abduct|clamshell|band walk|monster walk|lateral walk/, { groups: [{ group: 'gluteMed', role: 'prime' }] }],
  [/side plank/, { groups: [{ group: 'obliques', role: 'prime' }, { group: 'deepCore', role: 'synergist' }] }],
  [/crunch|sit[- ]?up|leg raise|hollow|ab wheel|rollout|plank|dead ?bug|v[- ]?up/, { groups: [{ group: 'abs', role: 'prime' }, { group: 'deepCore', role: 'synergist' }] }],
  [/knee raise|hip flexor|psoas march/, { groups: [{ group: 'hipFlexors', role: 'prime' }] }],
  [/wrist|grip|dead ?hang/, { groups: [{ group: 'forearmFlexors', role: 'prime' }] }],
  [/neck/, { groups: [{ group: 'neck', role: 'prime' }] }],
  [/tibialis|toe raise/, { groups: [{ group: 'tibialis', role: 'prime' }] }],
  [/external rotation|internal rotation|cuban|rotator/, { groups: [{ group: 'rotatorCuff', role: 'prime' }] }],
  [/\bwalk|hike|ruck/, { pattern: 'carry', variant: 'walk' }],
];

/** Which pattern (or muscle groups) an exercise name trains. */
export function classifyExercise(name: string): ExerciseMatch | null {
  const n = name.toLowerCase();
  for (const [re, m] of RULES) if (re.test(n)) return m;
  return null;
}

/** Variant for a pattern from an exercise name (e.g. "Chin-up" → the chin grip). */
export function optionsForExercise(name: string, pattern: PatternId): Record<string, string> {
  const n = name.toLowerCase();
  if (pattern === 'pullV' && /chin/.test(n)) return { grip: 'chin' };
  if (pattern === 'pushH' && /close/.test(n)) return { grip: 'narrow' };
  if (pattern === 'pushH' && /incline/.test(n)) return { touch: 'high' };
  if (pattern === 'squat' && /pause|deep|atg/.test(n)) return { depth: 'deep' };
  return {};
}
