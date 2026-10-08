// Puts the pose-tracking runtime and model in public/vision/ so the app serves
// them itself (works offline, nothing is fetched from third parties at run time).
//  - WebAssembly runtime: copied from @mediapipe/tasks-vision (Apache-2.0)
//  - Model: MediaPipe Pose Landmarker (full), pinned version, checked by SHA-256
// Runs before `dev` and `build`. Failure to download only warns: the app then
// says pose tracking is unavailable.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'vision');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const WASM = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'];
export const MODEL = {
  file: 'pose_landmarker_full.task',
  url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  sha256: '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1',
};

const exists = (p) => stat(p).then(() => true, () => false);
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

await mkdir(join(out, 'wasm'), { recursive: true });
for (const f of WASM) {
  const src = join(wasmSrc, f), dst = join(out, 'wasm', f);
  if (!(await exists(src))) {
    console.warn(`[vision] ${f} not found in node_modules; run npm install`);
    continue;
  }
  const [a, b] = await Promise.all([stat(src), stat(dst).catch(() => null)]);
  if (!b || b.size !== a.size) await copyFile(src, dst);
}

const modelPath = join(out, MODEL.file);
if ((await exists(modelPath)) && sha(await readFile(modelPath)) === MODEL.sha256) {
  console.log('[vision] runtime and model ready');
} else {
  try {
    const res = await fetch(MODEL.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha(buf) !== MODEL.sha256) throw new Error('checksum mismatch');
    await writeFile(modelPath + '.tmp', buf);
    await rename(modelPath + '.tmp', modelPath);
    console.log(`[vision] downloaded ${MODEL.file} (${(buf.length / 1e6).toFixed(1)} MB)`);
  } catch (e) {
    console.warn(`[vision] could not get the pose model (${e.message}). Pose tracking will be unavailable in this build.`);
  }
}
