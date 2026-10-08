// The text files that make a folder of photos and videos into a dataset other
// people can use: the metadata table, a dataset card (README, in the format
// Hugging Face and others read), a datasheet that answers the standard
// questions about how and why the data was collected, the license and a
// schema. Pure functions, so the exported files can be tested.
import type { MediaItem, MediaMark } from '../db/db';
import { markName, markValue } from '../media/media';
import { JOINTS, LANDMARKS, type JointId, type PoseTrack, type RepSummary } from '../vision/analysis';
import type { Check } from '../vision/quality';

export type License = 'CC-BY-4.0' | 'CC-BY-NC-4.0' | 'CC0-1.0';
export type DatePrecision = 'exact' | 'day' | 'relative';

export const LICENSES: Record<License, { name: string; url: string; hf: string; summary: string }> = {
  'CC-BY-4.0': { name: 'Creative Commons Attribution 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', hf: 'cc-by-4.0', summary: 'Anyone may use and adapt the data, including commercially, if they credit you.' },
  'CC-BY-NC-4.0': { name: 'Creative Commons Attribution-NonCommercial 4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/', hf: 'cc-by-nc-4.0', summary: 'Anyone may use and adapt the data for non-commercial purposes, if they credit you.' },
  'CC0-1.0': { name: 'CC0 1.0 (public domain)', url: 'https://creativecommons.org/publicdomain/zero/1.0/', hf: 'cc0-1.0', summary: 'No conditions at all: you waive your rights.' },
};

export interface CardInfo {
  name: string;
  creator: string;
  description: string;
  license: License;
  dates: DatePrecision;
  facesPixelated: boolean;
  measurements: boolean;
  notes: boolean;
  createdAt: number;
  /** Results of testing the pose tracker on synthetic squats, if run. */
  validation?: { joint: string; mae: number; bias: number }[];
  appUrl: string;
}

export interface Entry {
  item: MediaItem;
  /** Id in the dataset (e.g. form-squat-003). */
  id: string;
  file: string;
  track?: PoseTrack | null;
  reps?: RepSummary | null;
  checks?: Check[];
  facesPixelated: boolean;
}

/** Ids that say what a file is without revealing anything: purpose, pose or movement, and a number. */
export function datasetIds(items: MediaItem[]): Map<string, string> {
  const counters = new Map<string, number>();
  const out = new Map<string, string>();
  for (const m of [...items].sort((a, b) => a.date - b.date)) {
    const what = m.purpose === 'progress' ? (m.pose ?? 'other') : m.purpose === 'form' ? (m.pattern ?? 'movement') : m.kind;
    const key = `${m.purpose}-${what}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    out.set(m.id, `${key}-${String(n).padStart(3, '0')}`);
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** A date at the chosen precision: exact time, calendar day, or days since the first file. */
export function formatWhen(t: number, precision: DatePrecision, first: number): string | number {
  if (precision === 'exact') return new Date(t).toISOString();
  if (precision === 'day') return localDay(t);
  const day = (x: number) => {
    const d = new Date(x);
    d.setHours(12, 0, 0, 0);
    return d.getTime();
  };
  return Math.round((day(t) - day(first)) / 86_400_000);
}

export interface Row {
  id: string;
  file: string;
  kind: string;
  purpose: string;
  pose: string;
  pattern: string;
  variant: string;
  load_kg: number | '';
  reps_logged: number | '';
  camera_angle: string;
  date: string | number;
  width: number;
  height: number;
  duration_s: number | '';
  source_fps: number | '';
  synthetic: boolean;
  faces_pixelated: boolean;
  tags: string;
  hand_marks: number;
  pose_tracked: boolean;
  person_found: number | '';
  reps_detected: number | '';
  deepest_angle_mean: number | '';
  quality: string;
  quality_notes: string;
  notes?: string;
}

const round = (x: number | undefined, k = 1) => (x === undefined || !Number.isFinite(x) ? '' : Math.round(x * 10 ** k) / 10 ** k);

export function metadataRows(entries: Entry[], info: Pick<CardInfo, 'dates' | 'notes'>): Row[] {
  const first = Math.min(...entries.map((e) => e.item.date));
  return entries.map((e) => {
    const m = e.item;
    const found = e.track ? e.track.frames.filter((f) => f.lm).length / Math.max(1, e.track.frames.length) : undefined;
    const issues = (e.checks ?? []).filter((c) => c.status === 'warn' || c.status === 'fail');
    const row: Row = {
      id: e.id,
      file: e.file,
      kind: m.kind,
      purpose: m.purpose,
      pose: m.pose ?? '',
      pattern: m.pattern ?? '',
      variant: m.variant ?? '',
      load_kg: m.load ?? '',
      reps_logged: m.reps ?? '',
      camera_angle: m.camera ?? '',
      date: formatWhen(m.date, info.dates, first),
      width: m.width,
      height: m.height,
      duration_s: m.duration !== undefined ? round(m.duration, 2) : '',
      source_fps: round(e.track?.sourceFps, 1),
      synthetic: m.tags.includes('synthetic'),
      faces_pixelated: e.facesPixelated,
      tags: m.tags.filter((t) => t !== 'demo').join(';'),
      hand_marks: (m.marks ?? []).filter((k) => k.source !== 'pose').length,
      pose_tracked: !!e.track,
      person_found: found === undefined ? '' : round(found, 3),
      reps_detected: e.reps ? e.reps.reps.length : '',
      deepest_angle_mean: round(e.reps?.meanMin, 1),
      quality: !e.checks ? 'not checked' : issues.some((c) => c.status === 'fail') ? 'problems' : issues.length ? 'improvable' : 'good',
      quality_notes: issues.map((c) => c.label).join(';'),
    };
    if (info.notes) row.notes = m.notes ?? '';
    return row;
  });
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
}

/** Measurements drawn on a file, with their values, in the dataset's format. */
export function marksFile(e: Entry, first: number, precision: DatePrecision) {
  const m = e.item;
  return {
    id: e.id,
    file: e.file,
    width: m.width,
    height: m.height,
    date: formatWhen(m.date, precision, first),
    phase_start_s: m.phase0 !== undefined ? Math.round(m.phase0 * 1000) / 1000 : null,
    phase_end_s: m.phase1 !== undefined ? Math.round(m.phase1 * 1000) / 1000 : null,
    marks: (m.marks ?? []).map((k: MediaMark) => {
      const v = markValue(k, m.width, m.height);
      return {
        type: k.type,
        label: markName(k),
        source: k.source === 'pose' ? 'pose_tracker' : 'hand',
        points: k.points,
        time_s: k.t ?? null,
        times_s: k.times ?? null,
        value: v ? Math.round(v.value * 10) / 10 : null,
        unit: v?.unit === '%' ? 'percent_of_travel' : 'degrees',
      };
    }),
  };
}

export function poseFile(e: Entry) {
  const t = e.track!;
  return {
    id: e.id,
    file: e.file,
    model: t.model,
    width: t.width,
    height: t.height,
    analysed_fps: t.fps,
    source_fps: t.sourceFps ?? null,
    landmark_names: LANDMARKS,
    coordinates: 'x and y are fractions of the frame width and height (0 at the top left); visibility is the model’s 0–1 confidence; world is the model’s 3D guess in metres around the hips',
    frames: t.frames.map((f) => ({
      t: f.t,
      people: f.people ?? (f.lm ? 1 : 0),
      landmarks: f.lm ? Array.from({ length: 33 }, (_, i) => [f.lm![i * 3], f.lm![i * 3 + 1], f.lm![i * 3 + 2]]) : null,
      world: f.world ? Array.from({ length: 33 }, (_, i) => [f.world![i * 3], f.world![i * 3 + 1], f.world![i * 3 + 2]]) : null,
    })),
  };
}

// ---------------------------------------------------------------- documents

function counts(entries: Entry[]) {
  const by = (f: (e: Entry) => string | undefined) => {
    const m = new Map<string, number>();
    for (const e of entries) {
      const k = f(e);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([k, n]) => `${k} ${n}`).join(', ');
  };
  const progress = entries.filter((e) => e.item.purpose === 'progress');
  const form = entries.filter((e) => e.item.purpose === 'form');
  const other = entries.filter((e) => e.item.purpose === 'other');
  const seconds = entries.reduce((s, e) => s + (e.item.kind === 'video' ? (e.item.duration ?? 0) : 0), 0);
  return {
    progress: progress.length,
    progressBy: by((e) => (e.item.purpose === 'progress' ? e.item.pose : undefined)),
    form: form.length,
    formBy: by((e) => (e.item.purpose === 'form' ? e.item.pattern ?? 'unspecified' : undefined)),
    other: other.length,
    videos: entries.filter((e) => e.item.kind === 'video').length,
    photos: entries.filter((e) => e.item.kind === 'photo').length,
    seconds,
    handMarked: entries.filter((e) => (e.item.marks ?? []).some((k) => k.source !== 'pose')).length,
    tracked: entries.filter((e) => e.track).length,
    synthetic: entries.filter((e) => e.item.tags.includes('synthetic')).length,
  };
}

export function readme(entries: Entry[], info: CardInfo): string {
  const c = counts(entries);
  const lic = LICENSES[info.license];
  const first = Math.min(...entries.map((e) => e.item.date)), last = Math.max(...entries.map((e) => e.item.date));
  const span = Math.round((last - first) / 86_400_000);
  const size = entries.length < 1000 ? 'n<1K' : 'n<10K';
  const v = info.validation;
  return `---
license: ${lic.hf}
pretty_name: ${JSON.stringify(info.name)}
language:
- en
task_categories:
- keypoint-detection
- video-classification
tags:
- human-pose-estimation
- fitness
- strength-training
- biomechanics
- progress-photos
- phoenix-atlas
size_categories:
- ${size}
---

# ${info.name}

${info.description.trim() || 'Photos and videos of one person training and tracking their body over time, with joint positions found by a pose model, hand-drawn joint angles, rep timings and capture-quality checks.'}

Made by ${info.creator || 'the person in it'} with [Phoenix Atlas](${info.appUrl}), exported ${localDay(info.createdAt)}.

## At a glance

| | |
| --- | --- |
| Progress photos | ${c.progress}${c.progressBy ? ` (${c.progressBy})` : ''} |
| Form videos and photos | ${c.form}${c.formBy ? ` (${c.formBy})` : ''} |
| Other photos and videos | ${c.other} |
| Files | ${c.photos} photos, ${c.videos} videos (${Math.round(c.seconds)} s of video) |
| With hand-drawn measurements | ${c.handMarked} |
| With pose tracks | ${c.tracked} |
| Synthetic (rendered) files | ${c.synthetic} |
| Time span | ${span} days |

## Files

\`\`\`
README.md            this card
DATASHEET.md         how and why the data was collected (Datasheets for Datasets)
LICENSE.txt
metadata.csv         one row per file (also metadata.jsonl)
schema.json          what every field means
media/photos/        JPEG
media/videos/        WebM or MP4
annotations/marks/   hand-drawn and tracker-placed measurements, with values
annotations/pose/    33 body landmarks per analysed frame
annotations/reps/    rep start, deepest point and end, from the joint angles
annotations/quality/ capture-quality checks
${info.measurements ? 'measurements.csv     body measurements over time\n' : ''}\`\`\`

## How it was captured

Phone camera, following the Phoenix Atlas dataset guide: lifts filmed side-on at hip height from 3–4 m on a tripod, with head and feet in frame; progress photos front, side and back from the same spot and light. Each file's \`camera_angle\` and quality checks say how closely it followed that. Videos recorded in the app are WebM (or MP4 on Safari); imported files keep their format.

${c.synthetic ? 'Files tagged `synthetic` are not photographs: they are renders of a 3D anatomical body (Z-Anatomy / BodyParts3D, CC BY-SA 4.0) posed by a squat model, with their true joint angles marked. They are included as a known-answer test for pose tracking.\n\n' : ''}## Annotations

- **Measurements** (\`annotations/marks\`): joint angles (three points: one end, the joint, the other end), leans from vertical (two points) and paths (one point per frame). Points are fractions of the frame; angles are computed in the frame's real proportions. \`source\` is \`hand\` (drawn by a person) or \`pose_tracker\`.
- **Pose** (\`annotations/pose\`): ${entries.find((e) => e.track)?.track?.model ?? 'MediaPipe Pose Landmarker'} run on the device, ${entries.find((e) => e.track && e.item.kind === 'video')?.track?.fps ?? 15} frames per second for videos. 33 landmarks (\`landmark_names\`) with visibility, plus the model's 3D estimate (\`world\`).
- **Reps** (\`annotations/reps\`): found from the main joint angle of each movement (knee for squats and lunges, hip for hinges, elbow for presses and pulls); a rep is a dip of at least 25°.
- **Quality** (\`annotations/quality\`): resolution, frame rate, framing, body size, camera angle, steadiness, joint confidence, lighting and sharpness, each with what was measured and why it matters.

## How accurate is the pose tracking?

${
  v?.length
    ? `Tested on synthetic squats whose joint angles are known, filmed side-on:\n\n| Joint | Mean error | Bias |\n| --- | --- | --- |\n${v.map((x) => `| ${JOINTS[x.joint as JointId]?.label ?? x.joint} | ${x.mae.toFixed(1)}° | ${x.bias > 0 ? '+' : ''}${x.bias.toFixed(1)}° |`).join('\n')}\n\nBias below zero means the tracker reads smaller angles than the truth (it does most near straight knees and hips).`
    : 'Compare tracker angles with the hand-drawn ones in `annotations/marks` (same label, same time) to see how far they differ on this footage.'
} Angles are 2D: they are only comparable between files filmed from the same side-on position.

## Privacy

- Published by the person shown, who chose what to include.
- Location and device metadata removed from every file.
- Faces ${info.facesPixelated ? `pixelated in every photo and video of the person${c.synthetic ? ' (synthetic renders are left as they are)' : ''}` : 'not hidden'}.
- Dates: ${info.dates === 'exact' ? 'exact times' : info.dates === 'day' ? 'calendar day only' : 'days since the first file only'}.
- Body measurements ${info.measurements ? 'included (measurements.csv)' : 'not included'}; personal notes ${info.notes ? 'included' : 'not included'}.

## Intended uses

Learning and teaching pose estimation and form analysis, testing pose models on real training footage, studying how technique and body shape change over time, and as an example for building your own dataset.

Please don't use it to identify the person, to make health or medical judgements about them, or to train systems that rate or rank bodies.

## License

${lic.name} (${lic.url}). ${lic.summary}

## Citation

\`\`\`bibtex
@misc{${(info.creator || 'phoenix').split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '') || 'phoenix'}${new Date(info.createdAt).getFullYear()}atlas,
  title  = {${info.name}},
  author = {${info.creator || 'Anonymous'}},
  year   = {${new Date(info.createdAt).getFullYear()}},
  note   = {Made with Phoenix Atlas}
}
\`\`\`

## Loading it

\`\`\`python
import json, pandas as pd

meta = pd.read_csv("metadata.csv")
squats = meta[(meta.pattern == "squat") & meta.pose_tracked]
track = json.load(open(f"annotations/pose/{squats.iloc[0].id}.json"))
knee = track["landmark_names"].index("left_knee")
print([f["landmarks"][knee] if f["landmarks"] else None for f in track["frames"]][:5])
\`\`\`
`;
}

export function datasheet(entries: Entry[], info: CardInfo): string {
  const c = counts(entries);
  const todo = '_(to be completed by the creator)_';
  return `# Datasheet: ${info.name}

Answers to the questions in *Datasheets for Datasets* (Gebru et al., 2021). Items marked ${todo} need your words.

## Motivation

**Why was the dataset created?** To track one person's body and lifting technique over time, and to share it so others can learn how such data is captured, measured and checked, and build their own.
**Who created it?** ${info.creator || todo}
**Funding?** ${todo}

## Composition

**What do the instances represent?** Photos and videos of one adult: progress photos (front, side, back) and form-check videos of strength exercises${c.other ? ', plus other body photos' : ''}.
**How many?** ${entries.length} files: ${c.photos} photos and ${c.videos} videos (${Math.round(c.seconds)} s).
**Is it a sample of a larger set?** It contains the files the creator chose to share from their personal collection; private files were left out.
**What does each instance consist of?** The media file, a metadata row, and where available pose landmarks, measurements, rep timings and quality checks.
**Labels?** Movement pattern, variation, load, reps and camera angle were entered by the creator; measurements are hand-drawn or tracker-placed (see \`source\`).
**Missing information?** Not every file has a pose track or measurements (see \`pose_tracked\` and \`hand_marks\`).
**Relationships between instances?** All files show the same person; files of the same pose or movement form time series.
**Recommended splits?** None; for evaluating pose models, use the hand-marked files as the reference.
**Errors, noise, redundancy?** Pose landmarks come from a model and can be wrong, especially for joints hidden by equipment or clothing. Synthetic files (${c.synthetic}) are renders, not photographs.
**Self-contained?** Yes.
**Confidential data?** No. Location metadata was removed; faces ${info.facesPixelated ? 'were pixelated' : 'were left visible by the creator’s choice'}.
**Offensive content?** Some photos show the body in fitted clothing or swimwear.
**Does it identify people?** It shows one person, who chose to publish it${info.facesPixelated ? ' with their face hidden' : ''}. Do not attempt to identify them.
**Sensitive data?** Body shape${info.measurements ? ' and body measurements' : ''} over time. Health information may be inferred; please don't.

## Collection process

**How was it acquired?** Phone camera, in the Phoenix Atlas app or imported from the phone's library.
**Procedure?** The Phoenix Atlas dataset guide: tripod, side-on at hip height for lifts, same spot and light for photos.
**Over what timeframe?** ${Math.round((Math.max(...entries.map((e) => e.item.date)) - Math.min(...entries.map((e) => e.item.date))) / 86_400_000)} days.
**Ethical review?** ${todo}
**Consent?** The person shown is the creator and consented by publishing it. ${todo}
**Others in frame?** ${todo}

## Preprocessing, cleaning, labelling

Photos were re-encoded as JPEG when saved (which removes EXIF data, including GPS). MP4/MOV videos had their metadata boxes cleared. ${info.facesPixelated ? 'Faces were pixelated using the pose model’s face landmarks; videos were re-recorded to do so, which drops their sound. ' : ''}Pose tracking used ${entries.find((e) => e.track)?.track?.model ?? 'MediaPipe Pose Landmarker'} on the device. The raw files are not distributed separately.

## Uses

**Used for?** Personal progress tracking and form analysis in Phoenix Atlas.
**Other possible uses?** Teaching computer vision for sport, testing pose models on real training footage, examples for building personal datasets.
**Uses to avoid?** Identifying the person; medical or health judgements; training systems that rate or rank bodies; any use the license doesn't allow.

## Distribution

**License:** ${LICENSES[info.license].name}.
**Where?** ${todo}
**Export controls or other restrictions?** None known.

## Maintenance

**Who maintains it, and how to contact them?** ${todo}
**Will it be updated?** ${todo}
**Can people ask to have data removed?** It contains only the creator; contact them.
`;
}

export function licenseText(info: CardInfo): string {
  const lic = LICENSES[info.license];
  return `${info.name}
Copyright (c) ${new Date(info.createdAt).getFullYear()} ${info.creator || 'the dataset creator'}

Licensed under the ${lic.name} license.
${lic.summary}
Full legal text: ${lic.url}

Synthetic files (tagged "synthetic") are renders of the Z-Anatomy model, based on BodyParts3D (c) The Database Center for Life Science, licensed CC BY-SA 4.0.
`;
}

export const SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Phoenix Atlas dataset',
  description: 'Fields of metadata.csv / metadata.jsonl and the annotation files.',
  metadata: {
    id: 'Dataset id: purpose-what-number (e.g. form-squat-003).',
    file: 'Path of the media file.',
    kind: 'photo or video.',
    purpose: 'progress (body photos taken the same way over time), form (a movement filmed to check technique) or other.',
    pose: 'front, side, back or other (progress photos).',
    pattern: 'Movement pattern: squat, hinge, lunge, pushH, pushV, pullH, pullV, carry, rotation or gait.',
    variant: 'Variation of the pattern, e.g. highbar, rdl, bench.',
    load_kg: 'External load in kilograms, if logged.',
    reps_logged: 'Reps logged by the creator.',
    camera_angle: 'side, front, back or angle, as tagged.',
    date: 'ISO time, calendar day, or days since the first file, depending on the export.',
    width: 'Pixels.',
    height: 'Pixels.',
    duration_s: 'Seconds (videos).',
    source_fps: 'The video’s frame rate, as measured.',
    synthetic: 'true for rendered (not photographed) files.',
    faces_pixelated: 'true if the face was pixelated.',
    tags: 'Semicolon-separated tags.',
    hand_marks: 'Number of hand-drawn measurements.',
    pose_tracked: 'Whether annotations/pose has a track.',
    person_found: 'Share of analysed frames where a person was found.',
    reps_detected: 'Reps found automatically.',
    deepest_angle_mean: 'Mean of the main joint angle at the deepest point of each rep, degrees.',
    quality: 'good, improvable, problems or not checked.',
    quality_notes: 'Checks that weren’t passed.',
    notes: 'The creator’s notes (only if they chose to include them).',
  },
  annotations: {
    marks: 'annotations/marks/<id>.json: { marks: [{ type: angle|line|path, label, source: hand|pose_tracker, points: [[x, y]] as frame fractions, time_s, times_s, value, unit }], phase_start_s, phase_end_s }',
    pose: 'annotations/pose/<id>.json: { model, analysed_fps, landmark_names[33], frames: [{ t, people, landmarks: [[x, y, visibility]] | null, world: [[x, y, z]] | null }] }',
    reps: 'annotations/reps/<id>.json: { joint, side, reps: [{ start_s, bottom_s, end_s, deepest_deg, range_deg, down_s, up_s }], mean_deepest_deg, sd_deepest_deg, mean_down_s, mean_up_s }',
    quality: 'annotations/quality/<id>.json: [{ id, label, status: pass|warn|fail|info, value, why, fix }]',
  },
};

/** Rep timings rounded for sharing (seconds to the millisecond, degrees to a tenth). */
export function repsFile(r: RepSummary) {
  const t = (x: number) => Math.round(x * 1000) / 1000;
  const a = (x: number | undefined) => (x === undefined ? null : Math.round(x * 10) / 10);
  return {
    joint: r.joint,
    side: r.side,
    reps: r.reps.map((p) => ({ start_s: t(p.start), bottom_s: t(p.bottom), end_s: t(p.end), deepest_deg: a(p.min), range_deg: a(p.rom), down_s: t(p.down), up_s: t(p.up) })),
    mean_deepest_deg: a(r.meanMin),
    sd_deepest_deg: a(r.sdMin),
    mean_down_s: r.meanDown === undefined ? null : t(r.meanDown),
    mean_up_s: r.meanUp === undefined ? null : t(r.meanUp),
  };
}
