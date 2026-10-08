// Removes personal metadata from MP4 and QuickTime (.mov) videos without
// re-encoding: the user-data and metadata boxes (where phones keep the GPS
// location, the device and sometimes the owner's name) are turned into
// zero-filled "free" boxes of the same size, so no other offset in the file
// changes. Optionally the creation dates in the movie, track and media headers
// are zeroed too.

const TEXT = new TextDecoder();
const typeAt = (v: DataView, o: number) => TEXT.decode(new Uint8Array(v.buffer, v.byteOffset + o, 4));
const FREE = [0x66, 0x72, 0x65, 0x65]; // 'free'
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'edts']);
const PRIVATE = new Set(['udta', 'meta', 'uuid']);
const DATED = new Set(['mvhd', 'tkhd', 'mdhd']);

interface Box {
  type: string;
  start: number;
  size: number;
  header: number;
}

function boxes(v: DataView, from: number, to: number): Box[] {
  const out: Box[] = [];
  let p = from;
  while (p + 8 <= to) {
    let size = v.getUint32(p);
    let header = 8;
    if (size === 1) {
      if (p + 16 > to) break;
      size = Number(v.getBigUint64(p + 8));
      header = 16;
    } else if (size === 0) size = to - p;
    if (size < header || p + size > to) break;
    out.push({ type: typeAt(v, p + 4), start: p, size, header });
    p += size;
  }
  return out;
}

export interface ScrubReport {
  removed: string[];
  datesCleared: boolean;
}

/** Scrubs a box tree in place. */
function scrubTree(bytes: Uint8Array, v: DataView, from: number, to: number, dates: boolean, report: ScrubReport, path: string) {
  for (const b of boxes(v, from, to)) {
    const here = `${path}/${b.type}`;
    if (PRIVATE.has(b.type)) {
      bytes.set(FREE, b.start + 4);
      bytes.fill(0, b.start + b.header, b.start + b.size);
      report.removed.push(here);
    } else if (CONTAINERS.has(b.type)) scrubTree(bytes, v, b.start + b.header, b.start + b.size, dates, report, here);
    else if (dates && DATED.has(b.type)) {
      const body = b.start + b.header;
      const version = bytes[body];
      bytes.fill(0, body + 4, body + 4 + (version === 1 ? 16 : 8));
      report.datesCleared = true;
    }
  }
}

export async function isMp4(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(4, 8).arrayBuffer());
  const t = TEXT.decode(head);
  return t === 'ftyp' || t === 'wide' || t === 'mdat' || t === 'moov' || t === 'free' || t === 'skip';
}

/** A copy of an MP4/MOV video without its personal metadata (other files are returned unchanged). */
export async function scrubVideo(blob: Blob, opts: { dates?: boolean } = {}): Promise<{ blob: Blob; report: ScrubReport }> {
  const report: ScrubReport = { removed: [], datesCleared: false };
  if (!(await isMp4(blob))) return { blob, report };
  // walk the top level with small reads; only metadata-bearing boxes are loaded
  const parts: BlobPart[] = [];
  let p = 0, last = 0;
  for (let guard = 0; guard < 10_000 && p + 8 <= blob.size; guard++) {
    const head = new DataView(await blob.slice(p, p + 16).arrayBuffer());
    let size = head.getUint32(0), header = 8;
    if (size === 1) {
      size = Number(head.getBigUint64(8));
      header = 16;
    } else if (size === 0) size = blob.size - p;
    if (size < header || p + size > blob.size) break;
    const type = typeAt(head, 4);
    if (type === 'moov' || PRIVATE.has(type)) {
      const bytes = new Uint8Array(await blob.slice(p, p + size).arrayBuffer());
      const v = new DataView(bytes.buffer);
      if (type === 'moov') scrubTree(bytes, v, header, size, !!opts.dates, report, '/moov');
      else {
        bytes.set(FREE, 4);
        bytes.fill(0, header);
        report.removed.push(`/${type}`);
      }
      parts.push(blob.slice(last, p), bytes);
      last = p + size;
    }
    p += size;
  }
  if (!report.removed.length && !report.datesCleared) return { blob, report };
  parts.push(blob.slice(last));
  return { blob: new Blob(parts, { type: blob.type }), report };
}
