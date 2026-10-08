// Is this photo or video good enough to analyse (and to share in a dataset)?
// Each check says what was measured, why it matters for computer vision, and
// what to change next time. Pure functions over the pose track and a few image
// statistics, so they can be tested and explained.
import type { CameraAngle, MediaItem } from '../db/db';
import { landmark, nearSide, type PoseFrame, type PoseTrack } from './analysis';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  /** What was measured, in words. */
  value: string;
  /** Why it matters. */
  why: string;
  /** What to do differently. */
  fix?: string;
}

type Item = Pick<MediaItem, 'kind' | 'purpose' | 'width' | 'height' | 'duration' | 'camera' | 'pose' | 'pattern'>;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const visible = (f: PoseFrame, name: Parameters<typeof landmark>[1], min = 0.5) => {
  const p = landmark(f, name);
  return p && p.v >= min ? p : null;
};

/** Height of the person in the frame (top of head to feet) as a share of the frame height. */
export function bodyHeightShare(f: PoseFrame): number | null {
  if (!f.lm) return null;
  const top = ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear'].map((n) => visible(f, n as never, 0.3)?.y).filter((y): y is number => y !== undefined);
  const bottom = ['left_heel', 'right_heel', 'left_foot_index', 'right_foot_index', 'left_ankle', 'right_ankle'].map((n) => visible(f, n as never, 0.3)?.y).filter((y): y is number => y !== undefined);
  if (!top.length || !bottom.length) return null;
  // the top of the head sits about a head-height above the eyes
  return Math.max(...bottom) - Math.min(...top) + 0.06;
}

/**
 * How front-on the camera is: shoulder width divided by trunk length, both in
 * pixels. Side-on this is small (the shoulders overlap), front-on it is large.
 */
export function frontness(f: PoseFrame, w: number, h: number): number | null {
  const ls = visible(f, 'left_shoulder', 0.3), rs = visible(f, 'right_shoulder', 0.3), lh = visible(f, 'left_hip', 0.3), rh = visible(f, 'right_hip', 0.3);
  if (!ls || !rs || !lh || !rh) return null;
  const shoulders = Math.hypot((ls.x - rs.x) * w, (ls.y - rs.y) * h);
  const trunk = Math.hypot(((ls.x + rs.x - lh.x - rh.x) / 2) * w, ((ls.y + rs.y - lh.y - rh.y) / 2) * h);
  return trunk > 0 ? shoulders / trunk : null;
}

export function viewFromFrontness(r: number): CameraAngle {
  return r < 0.35 ? 'side' : r < 0.65 ? 'angle' : 'front';
}

const VIEW_WORD: Record<CameraAngle, string> = { side: 'side-on', front: 'front-on', back: 'from behind', angle: 'at an angle' };

export function qualityChecks(item: Item, track: PoseTrack | null, previous?: PoseTrack | null): Check[] {
  const out: Check[] = [];
  const isVideo = item.kind === 'video';
  const short = Math.min(item.width, item.height);
  const need = isVideo ? [720, 480] : [1080, 720];
  out.push({
    id: 'resolution',
    label: 'Resolution',
    status: short >= need[0] ? 'pass' : short >= need[1] ? 'warn' : 'fail',
    value: `${item.width}×${item.height}`,
    why: 'Pose models look at a small copy of the person, so more pixels on the body help them place joints precisely, and higher resolution keeps the dataset useful for other models later.',
    fix: `Record at ${isVideo ? '1080p (or at least 720p)' : 'full resolution'} in your camera settings.`,
  });
  if (isVideo) {
    const fps = track?.sourceFps;
    out.push({
      id: 'fps',
      label: 'Frame rate',
      status: fps === undefined ? 'info' : fps >= 29 ? 'pass' : fps >= 23 ? 'warn' : 'fail',
      value: fps === undefined ? 'not measured' : `${Math.round(fps)} fps`,
      why: 'Tempo and the bottom of a rep are timed between frames. At 30 fps a frame is 33 ms; 60 fps halves that and makes bar speed possible later.',
      fix: 'Set the camera to 60 fps (or at least 30).',
    });
    const d = item.duration ?? 0;
    out.push({
      id: 'duration',
      label: 'Length',
      status: d >= 3 && d <= 90 ? 'pass' : 'warn',
      value: `${d.toFixed(1)} s`,
      why: 'One set per clip, with a second of standing still before and after, keeps clips easy to analyse, label and share.',
      fix: d > 90 ? 'Trim to one set.' : 'Start recording a moment before the first rep.',
    });
  }
  if (!track) {
    out.push({ id: 'pose', label: 'Pose tracking', status: 'info', value: 'not run yet', why: 'Most checks need to know where your joints are.', fix: 'Run “Find joints”.' });
    return out;
  }
  const frames = track.frames;
  const seen = frames.filter((f) => f.lm);
  const found = frames.length ? seen.length / frames.length : 0;
  out.push({
    id: 'person',
    label: 'Person found',
    status: found >= 0.9 ? 'pass' : found >= 0.6 ? 'warn' : 'fail',
    value: isVideo ? `${pct(found)} of frames` : found ? 'yes' : 'no',
    why: 'The tracker must find you in every frame to follow a whole rep.',
    fix: 'Make sure your whole body is in frame and well lit, and nothing stands between you and the camera.',
  });
  if (!seen.length) return out;

  const crowded = frames.filter((f) => (f.people ?? 1) > 1).length / frames.length;
  if (crowded > 0.1)
    out.push({
      id: 'people',
      label: 'One person',
      status: 'warn',
      value: `someone else in ${pct(crowded)} of frames`,
      why: 'The tracker can jump to the other person, and anyone else in a public dataset needs to agree to be in it.',
      fix: 'Film when you’re alone in the frame, or crop the others out.',
    });

  const side = nearSide(track);
  const KEY = ['nose', `${side}_shoulder`, `${side}_hip`, `${side}_knee`, `${side}_ankle`, `${side}_heel`, `${side}_foot_index`] as const;
  const inFrame = (f: PoseFrame) => KEY.every((n) => {
    const p = visible(f, n as never);
    return p && p.x > 0.01 && p.x < 0.99 && p.y > 0.005 && p.y < 0.995;
  });
  const whole = seen.filter(inFrame).length / seen.length;
  out.push({
    id: 'framing',
    label: 'Whole body in frame',
    status: whole >= 0.9 ? 'pass' : whole >= 0.6 ? 'warn' : 'fail',
    value: isVideo ? `${pct(whole)} of frames` : whole ? 'yes' : 'no',
    why: 'Joint angles need both ends of every segment. A cropped head or feet means missing hip, knee or ankle angles.',
    fix: 'Move the phone further away so head and feet stay in frame for the whole set (and the bar, if you press overhead).',
  });

  const heights = seen.map(bodyHeightShare).filter((x): x is number => x !== null);
  const size = heights.length ? Math.max(...heights) : NaN;
  if (Number.isFinite(size))
    out.push({
      id: 'size',
      label: 'Body size in frame',
      status: size > 0.95 ? 'warn' : size >= 0.45 ? 'pass' : size >= 0.3 ? 'warn' : 'fail',
      value: `${pct(Math.min(1, size))} of the frame height`,
      why: 'Too small and each joint is only a few pixels; too big and you leave the frame when you move.',
      fix: size > 0.95 ? 'Step back a little.' : 'Move the phone closer (about 3 m for a lift, 2–2.5 m for photos).',
    });

  const fr = seen.map((f) => frontness(f, track.width, track.height)).filter((x): x is number => x !== null);
  if (fr.length) {
    // standing frames show the camera angle most clearly: use the upper quartile of trunk length (smallest ratios)
    const r = median(fr);
    const view = viewFromFrontness(r);
    const expected: CameraAngle | undefined =
      item.purpose === 'progress' ? (item.pose === 'side' ? 'side' : item.pose === 'front' || item.pose === 'back' ? 'front' : undefined) : item.purpose === 'form' ? (item.camera === 'back' ? 'front' : item.camera ?? 'side') : undefined;
    const ok = !expected || expected === view || (expected === 'angle' && view !== 'side');
    out.push({
      id: 'view',
      label: 'Camera angle',
      status: ok ? 'pass' : 'warn',
      value: `looks ${VIEW_WORD[view]} (shoulders ${r.toFixed(2)}× trunk length)`,
      why: 'Angles are measured flat in the picture. Side-on, knee, hip and torso angles are true to life; front-on they are foreshortened, but knee tracking (caving in) shows.',
      fix: ok ? undefined : `It’s tagged ${VIEW_WORD[expected!]}: turn ${expected === 'side' ? '90° so your side faces the camera' : 'to face the camera'}, or change the tag.`,
    });
  }

  const vis = seen.flatMap((f) => KEY.slice(1).map((n) => landmark(f, n as never)?.v ?? 0));
  const conf = vis.reduce((s, x) => s + x, 0) / vis.length;
  out.push({
    id: 'confidence',
    label: 'Joint confidence',
    status: conf >= 0.8 ? 'pass' : conf >= 0.6 ? 'warn' : 'fail',
    value: `${Math.round(conf * 100)}% average`,
    why: 'How sure the tracker is that it can see your near-side shoulder, hip, knee and ankle. Baggy clothes, plates, the rack or poor light lower it.',
    fix: 'Wear fitted clothes that contrast with the background, keep plates and uprights from hiding your joints, and light the room evenly.',
  });

  if (isVideo && item.pattern !== 'gait') {
    const feet = seen.map((f) => visible(f, `${side}_heel` as never)).filter(Boolean) as { x: number; y: number }[];
    if (feet.length > 5 && Number.isFinite(size)) {
      const spread = Math.max(sdOf(feet.map((p) => p.x * track.width)), sdOf(feet.map((p) => p.y * track.height))) / (size * track.height);
      out.push({
        id: 'steady',
        label: 'Steady camera',
        status: spread < 0.02 ? 'pass' : spread < 0.05 ? 'warn' : 'fail',
        value: `feet moved ${pct(spread)} of body height`,
        why: 'With planted feet, any movement of the feet in the picture means the camera moved, which shifts every angle and path.',
        fix: 'Prop the phone on a tripod or something solid; don’t hold it.',
      });
    }
  }

  const img = track.image;
  if (img) {
    out.push({
      id: 'light',
      label: 'Lighting',
      status: img.luma < 0.2 || img.luma > 0.85 ? 'warn' : img.contrast < 0.1 ? 'warn' : img.subjectLuma !== undefined && img.subjectLuma < img.luma - 0.12 ? 'warn' : 'pass',
      value: `brightness ${Math.round(img.luma * 100)}%, contrast ${Math.round(img.contrast * 100)}%${img.subjectLuma !== undefined && img.subjectLuma < img.luma - 0.12 ? ', you’re darker than the background' : ''}`,
      why: 'Dark or flat images hide the edges the tracker uses; a bright window behind you turns you into a silhouette.',
      fix: 'Face the light (or have it to the side), avoid windows behind you, and use a plain background.',
    });
    out.push({
      id: 'sharpness',
      label: 'Sharpness',
      status: img.sharpness >= 60 ? 'pass' : 'warn',
      value: `${Math.round(img.sharpness)} (edge strength)`,
      why: 'Motion blur smears joints across several pixels, especially at the fastest part of a rep.',
      fix: 'More light (so the camera uses a faster shutter), a steady phone, and 60 fps if your phone offers it.',
    });
  }

  const faces = seen.filter((f) => (visible(f, 'nose', 0.7) && (visible(f, 'left_eye', 0.7) || visible(f, 'right_eye', 0.7))) !== null).length / seen.length;
  if (faces > 0.3)
    out.push({
      id: 'face',
      label: 'Face visible',
      status: 'info',
      value: isVideo ? `in ${pct(faces)} of frames` : 'yes',
      why: 'Your face identifies you. That is fine for your own use; for a public dataset you can pixelate it when you export.',
    });

  if (previous && item.kind === 'photo') {
    const a = previous.frames.find((f) => f.lm), b = seen[0];
    const ha = a && bodyHeightShare(a), hb = bodyHeightShare(b);
    const cx = (f: PoseFrame) => {
      const l = landmark(f, 'left_hip'), r = landmark(f, 'right_hip');
      return l && r ? (l.x + r.x) / 2 : null;
    };
    const xa = a && cx(a), xb = cx(b);
    if (ha && hb && xa != null && xb != null) {
      const dh = Math.abs(hb - ha) / ha, dx = Math.abs(xb - xa);
      out.push({
        id: 'consistency',
        label: 'Same setup as last time',
        status: dh < 0.06 && dx < 0.05 ? 'pass' : 'warn',
        value: `size ${dh < 0.005 ? 'the same' : `${hb > ha ? '+' : '−'}${pct(dh)}`}, position ${dx < 0.005 ? 'the same' : `${pct(dx)} to the ${xb > xa ? 'right' : 'left'}`}`,
        why: 'Photos only compare well when taken from the same distance and spot; otherwise you see the camera move, not your body.',
        fix: 'Mark where the phone and your feet go (tape on the floor) and use the ghost overlay to line up.',
      });
    }
  }
  return out;
}

function sdOf(a: number[]): number {
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
}

/** A one-line verdict for lists. */
export function qualitySummary(checks: Check[]): { status: CheckStatus; text: string } {
  const fails = checks.filter((c) => c.status === 'fail'), warns = checks.filter((c) => c.status === 'warn');
  if (fails.length) return { status: 'fail', text: `${fails.length} problem${fails.length > 1 ? 's' : ''}: ${fails.map((c) => c.label.toLowerCase()).join(', ')}` };
  if (warns.length) return { status: 'warn', text: `${warns.length} to improve: ${warns.map((c) => c.label.toLowerCase()).join(', ')}` };
  if (checks.some((c) => c.id === 'pose' && c.status === 'info')) return { status: 'info', text: 'Joints not found yet' };
  return { status: 'pass', text: 'Ready to analyse and share' };
}
