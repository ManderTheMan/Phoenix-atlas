// Compact binary container for the generated atlas meshes.
// Layout: "PHXA" | u32 headerBytes | header JSON | deflated payload.
// Positions are quantised to u16 within the model bounds; normals are
// recomputed on load.
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { computeNormals } from './mc';
import type { StructureMesh } from './types';

interface ItemHeader {
  id: string;
  nv: number;
  ni: number;
  regions?: boolean;
  hnv?: number;
  hni?: number;
}

interface Header {
  version: number;
  hash: string;
  min: [number, number, number];
  max: [number, number, number];
  items: ItemHeader[];
}

export const FORMAT_VERSION = 1;

export function encodeModel(meshes: StructureMesh[], hash: string): Uint8Array {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    for (const arr of [m.positions, m.hitPositions]) {
      if (!arr) continue;
      for (let i = 0; i < arr.length; i += 3)
        for (let a = 0; a < 3; a++) {
          if (arr[i + a] < min[a]) min[a] = arr[i + a];
          if (arr[i + a] > max[a]) max[a] = arr[i + a];
        }
    }
  }
  const chunks: Uint8Array[] = [];
  const quant = (arr: Float32Array) => {
    const q = new Uint16Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      const a = i % 3;
      q[i] = Math.round(((arr[i] - min[a]) / (max[a] - min[a])) * 65535);
    }
    return new Uint8Array(q.buffer);
  };
  // Indices are delta + zigzag encoded into u32, which deflates far better.
  const idx = (arr: Uint32Array) => {
    const out = new Uint32Array(arr.length);
    let prev = 0;
    for (let i = 0; i < arr.length; i++) {
      const d = arr[i] - prev;
      out[i] = d >= 0 ? d * 2 : -d * 2 - 1;
      prev = arr[i];
    }
    return new Uint8Array(out.buffer);
  };
  const items: ItemHeader[] = meshes.map((m) => {
    chunks.push(quant(m.positions), idx(m.indices));
    if (m.regions) chunks.push(m.regions);
    if (m.hitPositions && m.hitIndices) chunks.push(quant(m.hitPositions), idx(m.hitIndices));
    return {
      id: m.id,
      nv: m.positions.length / 3,
      ni: m.indices.length,
      regions: m.regions ? true : undefined,
      hnv: m.hitPositions ? m.hitPositions.length / 3 : undefined,
      hni: m.hitIndices ? m.hitIndices.length : undefined,
    };
  });
  let total = 0;
  for (const c of chunks) total += c.length;
  const payload = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { payload.set(c, o); o += c.length; }
  const header: Header = { version: FORMAT_VERSION, hash, min, max, items };
  const hb = strToU8(JSON.stringify(header));
  const comp = deflateSync(payload, { level: 9 });
  const out = new Uint8Array(8 + hb.length + comp.length);
  out.set(strToU8('PHXA'), 0);
  new DataView(out.buffer).setUint32(4, hb.length, true);
  out.set(hb, 8);
  out.set(comp, 8 + hb.length);
  return out;
}

export function readModelHeader(buf: Uint8Array): Header | null {
  if (buf.length < 8 || strFromU8(buf.subarray(0, 4)) !== 'PHXA') return null;
  const hl = new DataView(buf.buffer, buf.byteOffset).getUint32(4, true);
  return JSON.parse(strFromU8(buf.subarray(8, 8 + hl))) as Header;
}

export function decodeModel(buf: Uint8Array): StructureMesh[] {
  const header = readModelHeader(buf);
  if (!header) throw new Error('Not a Phoenix Atlas model file');
  const hl = new DataView(buf.buffer, buf.byteOffset).getUint32(4, true);
  const payload = inflateSync(buf.subarray(8 + hl));
  let o = 0;
  const { min, max } = header;
  const take = (bytes: number) => {
    const c = payload.slice(o, o + bytes);
    o += bytes;
    return c;
  };
  const dequant = (n: number) => {
    const q = new Uint16Array(take(n * 3 * 2).buffer);
    const f = new Float32Array(n * 3);
    for (let i = 0; i < f.length; i++) {
      const a = i % 3;
      f[i] = min[a] + (q[i] / 65535) * (max[a] - min[a]);
    }
    return f;
  };
  const undelta = (n: number) => {
    const z = new Uint32Array(take(n * 4).buffer);
    const out = new Uint32Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const v = z[i];
      prev += v & 1 ? -((v + 1) / 2) : v / 2;
      out[i] = prev;
    }
    return out;
  };
  return header.items.map((it) => {
    const positions = dequant(it.nv);
    const indices = undelta(it.ni);
    const m: StructureMesh = { id: it.id, positions, indices, normals: computeNormals(positions, indices) };
    if (it.regions) m.regions = take(it.nv);
    if (it.hnv && it.hni) {
      m.hitPositions = dequant(it.hnv);
      m.hitIndices = undelta(it.hni);
    }
    return m;
  });
}
