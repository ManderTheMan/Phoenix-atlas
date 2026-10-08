// A minimal ZIP writer and reader for backups that include photos and videos.
// Media files are stored as they are (already compressed), and both sides work
// on Blobs, so a large video is never copied into memory: writing only streams
// it once for its checksum, and reading hands back slices of the file.
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

async function blobCrc32(b: Blob): Promise<number> {
  let crc = 0;
  const r = b.stream().getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) return crc;
    crc = crc32(value, crc);
  }
}

export interface ZipEntry {
  name: string;
  data: Blob | Uint8Array;
  /** Deflate this entry (for text; media is stored as is). */
  compress?: boolean;
}

const u8 = (a: Uint8Array): Uint8Array<ArrayBuffer> => a as Uint8Array<ArrayBuffer>;

export async function makeZip(entries: ZipEntry[], onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const name = strToU8(e.name);
    let body: Blob | Uint8Array, crc: number, size: number, method: number;
    if (e.data instanceof Uint8Array) {
      crc = crc32(e.data);
      size = e.data.length;
      body = e.compress ? deflateSync(e.data, { level: 6 }) : e.data;
      method = e.compress ? 8 : 0;
    } else {
      crc = await blobCrc32(e.data);
      size = e.data.size;
      body = e.data;
      method = 0;
    }
    const csize = body instanceof Uint8Array ? body.length : body.size;
    if (offset + csize + 30 + name.length > 0xffffffff) throw new Error('The backup is over 4 GB. Delete some videos or back them up separately.');
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // names are UTF-8
    lv.setUint16(8, method, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, csize, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, csize, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(u8(local), body instanceof Uint8Array ? u8(body) : body);
    central.push(cen);
    offset += local.length + csize;
    onProgress?.(i + 1, entries.length);
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central.map(u8), u8(end)], { type: 'application/zip' });
}

export async function isZip(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4;
}

/** Every entry of a ZIP file, as Blobs (stored entries are slices of the file). */
export async function readZip(file: Blob): Promise<Map<string, Blob>> {
  const tailLen = Math.min(file.size, 22 + 0xffff);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--)
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('This ZIP file is damaged or incomplete.');
  const count = tail.getUint16(eocd + 10, true);
  const cenSize = tail.getUint32(eocd + 12, true);
  const cenOff = tail.getUint32(eocd + 16, true);
  const cen = new DataView(await file.slice(cenOff, cenOff + cenSize).arrayBuffer());
  const out = new Map<string, Blob>();
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cen.byteLength; i++) {
    if (cen.getUint32(p, true) !== 0x02014b50) break;
    const method = cen.getUint16(p + 10, true);
    const csize = cen.getUint32(p + 20, true);
    const nameLen = cen.getUint16(p + 28, true);
    const extraLen = cen.getUint16(p + 30, true);
    const commentLen = cen.getUint16(p + 32, true);
    const localOff = cen.getUint32(p + 42, true);
    const name = strFromU8(new Uint8Array(cen.buffer, cen.byteOffset + p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const lh = new DataView(await file.slice(localOff, localOff + 30).arrayBuffer());
    const start = localOff + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    const raw = file.slice(start, start + csize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, new Blob([u8(inflateSync(new Uint8Array(await raw.arrayBuffer())))]));
  }
  return out;
}
