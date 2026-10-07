// Generates public/atlas-model.bin from the procedural anatomy in src/anatomy.
// Regenerates only when the anatomy sources change (hash stored in the file).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptSimplifier } from 'meshoptimizer';
import { buildModel } from '../src/anatomy/build';
import { STRUCTURE_BY_ID } from '../src/anatomy/catalog';
import type { StructureMesh } from '../src/anatomy/types';
import { encodeModel, readModelHeader } from '../src/anatomy/modelFile';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'atlas-model.bin');
const srcDir = join(root, 'src', 'anatomy');

const h = createHash('sha256');
for (const f of readdirSync(srcDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort()) {
  h.update(f);
  h.update(readFileSync(join(srcDir, f)));
}
const hash = h.digest('hex').slice(0, 16);

const force = process.argv.includes('--force');
if (!force && existsSync(out)) {
  const header = readModelHeader(new Uint8Array(readFileSync(out)));
  if (header?.hash === hash) {
    console.log(`atlas model up to date (${hash})`);
    process.exit(0);
  }
}

console.log('generating atlas model…');
const t = performance.now();
const raw = buildModel((m) => console.log('  ' + m));
await MeshoptSimplifier.ready;

/** Simplify within an absolute error (metres) and drop unused vertices. */
function simplify(m: StructureMesh): StructureMesh {
  const layer = m.id === 'skin' ? 'skin' : STRUCTURE_BY_ID.get(m.id)?.layer;
  if (layer === 'nerves' || m.indices.length < 600) return m;
  const err = layer === 'skin' ? 0.0004 : layer === 'muscular' ? 0.0005 : 0.00035;
  const [idx] = MeshoptSimplifier.simplify(m.indices, m.positions, 3, 0, err, ['ErrorAbsolute']);
  const nv = m.positions.length / 3;
  const remap = new Int32Array(nv).fill(-1);
  let n = 0;
  for (const i of idx) if (remap[i] < 0) remap[i] = n++;
  const positions = new Float32Array(n * 3);
  const regions = m.regions ? new Uint8Array(n) : undefined;
  for (let v = 0; v < nv; v++) {
    const r = remap[v];
    if (r < 0) continue;
    positions[r * 3] = m.positions[v * 3];
    positions[r * 3 + 1] = m.positions[v * 3 + 1];
    positions[r * 3 + 2] = m.positions[v * 3 + 2];
    if (regions) regions[r] = m.regions![v];
  }
  const indices = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) indices[i] = remap[idx[i]];
  return { ...m, positions, normals: new Float32Array(positions.length), indices, regions };
}
const meshes = raw.map(simplify);
let verts = 0, tris = 0;
for (const m of meshes) { verts += m.positions.length / 3; tris += m.indices.length / 3; }
const bin = encodeModel(meshes, hash);
writeFileSync(out, bin);
console.log(`wrote ${out}: ${meshes.length} structures, ${verts} verts, ${tris} tris, ${(bin.length / 1024 / 1024).toFixed(2)} MB in ${((performance.now() - t) / 1000).toFixed(1)}s`);
