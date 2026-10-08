// Binary container for one layer of the atlas (public/atlas/<layer>.bin).
// Layout: "PHX2" | u32 headerBytes | header JSON | deflated payload.
// The payload holds, for the whole layer: quantised u16 positions, delta+zigzag
// indices and a per-vertex material index. Structures occupy contiguous vertex
// and index ranges, so per-vertex structure ids are implied by the ranges.
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

export interface LayerHeader {
  version: 2;
  layer: string;
  min: [number, number, number];
  max: [number, number, number];
  /** Structure ids in range order. */
  ids: string[];
  /** Per structure: [vertexStart, vertexCount, indexStart, indexCount]. */
  ranges: [number, number, number, number][];
  /** Material palette (hex colours) referenced by the per-vertex material index. */
  materials: string[];
  vertexCount: number;
  indexCount: number;
}

export interface LayerData {
  header: LayerHeader;
  positions: Float32Array;
  indices: Uint32Array;
  materials: Uint8Array;
}

const MAGIC = 'PHX2';

export function encodeLayer(d: LayerData): Uint8Array {
  const { header, positions, indices, materials } = d;
  const { min, max } = header;
  const q = new Uint16Array(positions.length);
  for (let i = 0; i < positions.length; i++) {
    const a = i % 3;
    q[i] = Math.round(((positions[i] - min[a]) / (max[a] - min[a] || 1)) * 65535);
  }
  const z = new Uint32Array(indices.length);
  let prev = 0;
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i] - prev;
    z[i] = v >= 0 ? v * 2 : -v * 2 - 1;
    prev = indices[i];
  }
  const payload = new Uint8Array(q.byteLength + z.byteLength + materials.byteLength);
  payload.set(new Uint8Array(q.buffer), 0);
  payload.set(new Uint8Array(z.buffer), q.byteLength);
  payload.set(materials, q.byteLength + z.byteLength);
  const hb = strToU8(JSON.stringify(header));
  const comp = deflateSync(payload, { level: 9 });
  const out = new Uint8Array(8 + hb.length + comp.length);
  out.set(strToU8(MAGIC), 0);
  new DataView(out.buffer).setUint32(4, hb.length, true);
  out.set(hb, 8);
  out.set(comp, 8 + hb.length);
  return out;
}

export function readLayerHeader(buf: Uint8Array): LayerHeader {
  if (strFromU8(buf.subarray(0, 4)) !== MAGIC) throw new Error('Not a Phoenix Atlas layer file');
  const hl = new DataView(buf.buffer, buf.byteOffset).getUint32(4, true);
  return JSON.parse(strFromU8(buf.subarray(8, 8 + hl))) as LayerHeader;
}

export function decodeLayer(buf: Uint8Array): LayerData {
  const header = readLayerHeader(buf);
  const hl = new DataView(buf.buffer, buf.byteOffset).getUint32(4, true);
  const payload = inflateSync(buf.subarray(8 + hl));
  const nv = header.vertexCount, ni = header.indexCount;
  const q = new Uint16Array(payload.buffer.slice(payload.byteOffset, payload.byteOffset + nv * 6));
  const z = new Uint32Array(payload.buffer.slice(payload.byteOffset + nv * 6, payload.byteOffset + nv * 6 + ni * 4));
  const materials = payload.slice(nv * 6 + ni * 4, nv * 6 + ni * 4 + nv);
  const { min, max } = header;
  const positions = new Float32Array(nv * 3);
  for (let i = 0; i < positions.length; i++) {
    const a = i % 3;
    positions[i] = min[a] + (q[i] / 65535) * (max[a] - min[a]);
  }
  const indices = new Uint32Array(ni);
  let prev = 0;
  for (let i = 0; i < ni; i++) {
    const v = z[i];
    prev += v & 1 ? -((v + 1) / 2) : v / 2;
    indices[i] = prev;
  }
  return { header, positions, indices, materials };
}
