// Feeling scale, sensations and note categories — the vocabulary of a note.

export const FEELING_MIN = -5;
export const FEELING_MAX = 5;

const FEELING_LABELS: Record<number, string> = {
  [-5]: 'Severe',
  [-4]: 'Very bad',
  [-3]: 'Bad',
  [-2]: 'Uncomfortable',
  [-1]: 'Slightly off',
  0: 'Neutral',
  1: 'Okay',
  2: 'Good',
  3: 'Very good',
  4: 'Great',
  5: 'Excellent',
};

export function feelingLabel(v: number): string {
  return FEELING_LABELS[Math.round(Math.max(FEELING_MIN, Math.min(FEELING_MAX, v)))] ?? '';
}

export function formatFeeling(v: number): string {
  const r = Math.round(v * 10) / 10;
  return r > 0 ? `+${r}` : `${r}`;
}

// Diverging palette: red (worse) ← neutral grey → blue (better). Each arm is a
// single hue stepping light→dark (validated against the dark UI surface), and
// warm/cool poles stay distinguishable for the common colour-vision types.
const STOPS: [number, [number, number, number]][] = [
  [-5, [196, 42, 60]],
  [-3, [228, 96, 75]],
  [-1.5, [244, 165, 130]],
  [0, [163, 170, 181]],
  [1.5, [163, 207, 233]],
  [3, [79, 157, 211]],
  [5, [43, 111, 192]],
];

export function feelingRgb(v: number): [number, number, number] {
  const x = Math.max(FEELING_MIN, Math.min(FEELING_MAX, v));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [a, ca] = STOPS[i];
    const [b, cb] = STOPS[i + 1];
    if (x <= b) {
      const t = (x - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export function rgbHex([r, g, b]: [number, number, number]): string {
  const h = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}

export function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function feelingColor(v: number): string {
  return rgbHex(feelingRgb(v));
}

/** Sequential "ember" palette for note density. t in [0,1]. */
export function heatRgb(t: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [72, 52, 92],
    [176, 58, 94],
    [244, 109, 67],
    [253, 196, 92],
  ];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mixRgb(stops[i], stops[i + 1], x - i);
}

export interface Sensation {
  id: string;
  label: string;
  polarity: -1 | 0 | 1;
}

export const SENSATIONS: Sensation[] = [
  { id: 'pain', label: 'Pain', polarity: -1 },
  { id: 'ache', label: 'Ache', polarity: -1 },
  { id: 'sore', label: 'Sore (DOMS)', polarity: 0 },
  { id: 'tight', label: 'Tight', polarity: -1 },
  { id: 'stiff', label: 'Stiff', polarity: -1 },
  { id: 'weak', label: 'Weak', polarity: -1 },
  { id: 'fatigued', label: 'Fatigued', polarity: -1 },
  { id: 'numb', label: 'Numb', polarity: -1 },
  { id: 'tingling', label: 'Tingling', polarity: -1 },
  { id: 'burning', label: 'Burning', polarity: -1 },
  { id: 'swollen', label: 'Swollen', polarity: -1 },
  { id: 'cramping', label: 'Cramping', polarity: -1 },
  { id: 'pumped', label: 'Pumped', polarity: 1 },
  { id: 'strong', label: 'Strong', polarity: 1 },
  { id: 'mobile', label: 'Mobile / loose', polarity: 1 },
  { id: 'stable', label: 'Stable', polarity: 1 },
  { id: 'relaxed', label: 'Relaxed', polarity: 1 },
  { id: 'energized', label: 'Energized', polarity: 1 },
  { id: 'recovered', label: 'Recovered', polarity: 1 },
];

export const SENSATION_BY_ID = new Map(SENSATIONS.map((s) => [s.id, s]));

export type CategoryId = 'workout' | 'symptom' | 'movement' | 'energy' | 'health' | 'recovery' | 'other';

export interface Category {
  id: CategoryId;
  label: string;
  color: string;
  icon: string; // short glyph
  hint: string;
}

export const CATEGORIES: Category[] = [
  { id: 'workout', label: 'Workout', color: '#f4a261', icon: '🏋', hint: 'Training sessions, exercises, sets and how the body responded' },
  { id: 'symptom', label: 'Symptom', color: '#e76f51', icon: '⚡', hint: 'Pain, discomfort, numbness or anything that feels off' },
  { id: 'movement', label: 'Movement', color: '#2a9d8f', icon: '↻', hint: 'Mobility, range of motion, posture, how a movement felt' },
  { id: 'energy', label: 'Energy', color: '#e9c46a', icon: '☀', hint: 'Energy, fatigue, mood, focus' },
  { id: 'health', label: 'General health', color: '#8ab17d', icon: '✚', hint: 'Sleep, illness, appointments, medication, measurements' },
  { id: 'recovery', label: 'Recovery', color: '#5fa8d3', icon: '❄', hint: 'Massage, stretching, rest days, physio' },
  { id: 'other', label: 'Other', color: '#a3aab5', icon: '•', hint: 'Anything else' },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c])) as Map<CategoryId, Category>;

/** Normalise a free-form tag: lowercase, no leading '#', spaces to dashes. */
export function normalizeTag(t: string): string {
  return t
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_\-/]/gu, '')
    .slice(0, 40);
}

/** Stable colour per tag. */
export function tagColor(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 62%)`;
}
