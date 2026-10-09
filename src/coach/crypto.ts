// End-to-end encrypted files between you and your coach. Pairing (a QR code
// scanned in person) gives both devices the same 256-bit secret; every file is
// encrypted on the sending device with a key derived from it, so the file can
// travel by any route (email, Drive, a messaging app, a USB stick) and only the
// paired device can open it. No server is involved.
//
// File layout (.phx):
//   "PHX1" | header length (u32 LE) | header JSON | chunks…
//   chunk = ciphertext length (u32 LE) | AES-256-GCM ciphertext (4 MB of plaintext, or less for the last)
// Each file has a random salt; its key is HKDF-SHA256(pairing secret, salt). Chunk i uses the IV
// nonce(8 bytes) ‖ i (u32 BE) and authenticates SHA-256(header) ‖ i ‖ last-chunk flag, so chunks
// can't be swapped between files, reordered, dropped or cut short without the file failing to open.

const MAGIC = new TextEncoder().encode('PHX1');
export const CHUNK = 4 * 1024 * 1024;

export interface PhxHeader {
  v: 1;
  kind: 'share' | 'feedback';
  /** Pairing id: which pairing's secret opens it. */
  pair: string;
  created: number;
  salt: string;
  nonce: string;
  chunk: number;
  size: number;
}

const subtle = () => globalThis.crypto.subtle;

export function b64uEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

export const newSecret = () => random(32);
export const newPairId = () => hex(random(8));

/** A short code both screens show after pairing, to check they hold the same secret. */
export async function fingerprint(secret: Uint8Array): Promise<string> {
  const h = new Uint8Array(await subtle().digest('SHA-256', secret as BufferSource));
  const s = hex(h.subarray(0, 4)).toUpperCase();
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

async function fileKey(secret: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', secret as BufferSource, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: new TextEncoder().encode('phoenix-atlas share v1') }, base, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

function iv(nonce: Uint8Array, i: number): Uint8Array {
  const out = new Uint8Array(12);
  out.set(nonce, 0);
  new DataView(out.buffer).setUint32(8, i, false);
  return out;
}

function aad(headerHash: Uint8Array, i: number, last: boolean): Uint8Array {
  const out = new Uint8Array(37);
  out.set(headerHash, 0);
  new DataView(out.buffer).setUint32(32, i, false);
  out[36] = last ? 1 : 0;
  return out;
}

const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};

/** Encrypts a payload into a .phx file. */
export async function encryptFile(payload: Blob, meta: { kind: PhxHeader['kind']; pair: string }, secret: Uint8Array, onProgress?: (p: number) => void): Promise<Blob> {
  const salt = random(16), nonce = random(8);
  const header: PhxHeader = { v: 1, kind: meta.kind, pair: meta.pair, created: Date.now(), salt: b64uEncode(salt), nonce: b64uEncode(nonce), chunk: CHUNK, size: payload.size };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const headerHash = new Uint8Array(await subtle().digest('SHA-256', headerBytes as BufferSource));
  const key = await fileKey(secret, salt);
  const parts: BlobPart[] = [MAGIC as BlobPart, u32(headerBytes.length) as BlobPart, headerBytes as BlobPart];
  const count = Math.max(1, Math.ceil(payload.size / CHUNK));
  for (let i = 0; i < count; i++) {
    const plain = new Uint8Array(await payload.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer());
    const sealed = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv(nonce, i) as BufferSource, additionalData: aad(headerHash, i, i === count - 1) as BufferSource }, key, plain as BufferSource));
    parts.push(u32(sealed.length) as BlobPart, sealed as BlobPart);
    onProgress?.((i + 1) / count);
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}

/** The unencrypted header: which pairing a file is for, and what it holds. */
export async function readHeader(file: Blob): Promise<{ header: PhxHeader; headerBytes: Uint8Array; offset: number }> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (head.length < 8 || MAGIC.some((b, i) => head[i] !== b)) throw new Error('This isn’t a Phoenix Atlas share file.');
  const len = new DataView(head.buffer).getUint32(4, true);
  if (len > 64 * 1024) throw new Error('This share file is damaged.');
  const headerBytes = new Uint8Array(await file.slice(8, 8 + len).arrayBuffer());
  let header: PhxHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(headerBytes));
  } catch {
    throw new Error('This share file is damaged.');
  }
  if (header.v !== 1 || !header.pair || !header.salt || !header.nonce) throw new Error('This share file is from a newer version of the app.');
  return { header, headerBytes, offset: 8 + len };
}

/** Decrypts a .phx file with the pairing secret. Throws if it was changed, cut short or is for another pairing. */
export async function decryptFile(file: Blob, secret: Uint8Array, onProgress?: (p: number) => void): Promise<{ header: PhxHeader; payload: Blob }> {
  const { header, headerBytes, offset } = await readHeader(file);
  const headerHash = new Uint8Array(await subtle().digest('SHA-256', headerBytes as BufferSource));
  const key = await fileKey(secret, b64uDecode(header.salt));
  const nonce = b64uDecode(header.nonce);
  const count = Math.max(1, Math.ceil(header.size / header.chunk));
  const out: BlobPart[] = [];
  let pos = offset;
  for (let i = 0; i < count; i++) {
    const lenBytes = new Uint8Array(await file.slice(pos, pos + 4).arrayBuffer());
    if (lenBytes.length < 4) throw new Error('This share file is incomplete (it may not have finished downloading).');
    const len = new DataView(lenBytes.buffer).getUint32(0, true);
    const sealed = new Uint8Array(await file.slice(pos + 4, pos + 4 + len).arrayBuffer());
    if (sealed.length < len) throw new Error('This share file is incomplete (it may not have finished downloading).');
    let plain: ArrayBuffer;
    try {
      plain = await subtle().decrypt({ name: 'AES-GCM', iv: iv(nonce, i) as BufferSource, additionalData: aad(headerHash, i, i === count - 1) as BufferSource }, key, sealed as BufferSource);
    } catch {
      throw new Error('This file couldn’t be opened: it was changed, or it’s for a different pairing.');
    }
    out.push(plain);
    pos += 4 + len;
    onProgress?.((i + 1) / count);
  }
  if (pos !== file.size) throw new Error('This share file has extra data at the end and wasn’t opened.');
  return { header, payload: new Blob(out) };
}

// ---------------------------------------------------------------- pairing codes

export interface PairCode {
  pair: string;
  secret: Uint8Array;
  /** The athlete's name, so the coach knows who paired. */
  name: string;
}

export function makePairCode(c: PairCode): string {
  return `v1.${c.pair}.${b64uEncode(c.secret)}.${b64uEncode(new TextEncoder().encode(c.name.slice(0, 60)))}`;
}

/** Reads a pairing code, or a pairing link containing one. */
export function parsePairCode(text: string): PairCode | null {
  const m = /(?:^|[/#\s])(v1\.([0-9a-f]{16})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]*))\s*$/.exec(text.trim());
  if (!m) return null;
  const secret = b64uDecode(m[3]);
  if (secret.length !== 32) return null;
  let name = '';
  try {
    name = new TextDecoder().decode(b64uDecode(m[4]));
  } catch {
    name = '';
  }
  return { pair: m[2], secret, name };
}
