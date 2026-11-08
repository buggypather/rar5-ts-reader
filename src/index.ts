// rar5-ts-reader: lists what's inside a RAR 5 archive by reading only its headers, so even a
// huge archive lists quickly and nothing is unpacked. Works in browsers and Node: give it the
// bytes, or a function that reads a range of the file. It does not extract files (RAR 5's
// compression has no small open-source decoder), and archives whose file list is
// password-protected can't be listed.

export interface Rar5Entry {
  /** Path inside the archive, with "/" between folders. */
  name: string;
  isFolder: boolean;
  /** Size once unpacked, in bytes. */
  size: number;
  /** Size inside the archive, in bytes. */
  packedSize: number;
  /** Last change, in milliseconds since 1970, or 0 if the archive didn't store it. */
  modified: number;
  /** CRC32 of the unpacked data, if stored. */
  crc32?: number;
  /** 0 = stored, 1–5 = faster to better compression. */
  method: number;
  /** The file is encrypted (its name is still readable). */
  encrypted: boolean;
  /** The operating system that made it. */
  hostOs: 'windows' | 'unix' | 'other';
}

export interface Rar5Archive {
  entries: Rar5Entry[];
  /** Split into volumes (.part1.rar, .part2.rar…). */
  multiVolume: boolean;
  /** Solid archive (files compressed together). */
  solid: boolean;
  /** The archive has a recovery record. */
  hasRecovery: boolean;
  /** The archive's comment, if any (only when stored uncompressed). */
  comment?: string;
}

/** Reads bytes [start, end) of the file. */
export type ReadRange = (start: number, end: number) => Promise<Uint8Array>;

export class Rar5Error extends Error {
  readonly code: 'not-rar' | 'rar4' | 'encrypted' | 'damaged';
  constructor(code: Rar5Error['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'Rar5Error';
  }
}

export const RAR5_SIGNATURE = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00];
const RAR4_SIGNATURE = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00];

const HEADER_MAIN = 1;
const HEADER_FILE = 2;
const HEADER_SERVICE = 3;
const HEADER_ENCRYPTION = 4;
const HEADER_END = 5;

/** Whether the bytes start like a RAR 5 archive (8 bytes are enough). */
export function isRar5(start: Uint8Array): boolean {
  return RAR5_SIGNATURE.every((b, i) => start[i] === b);
}

/** A little cursor over a header's bytes, reading RAR 5's variable-length integers. */
class Cursor {
  at = 0;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  vint(): number {
    let value = 0;
    let scale = 1;
    for (let i = 0; i < 10; i++) {
      if (this.at >= this.bytes.length) throw new Rar5Error('damaged', 'The archive ends in the middle of a header.');
      const b = this.bytes[this.at++];
      value += (b & 0x7f) * scale;
      if (!(b & 0x80)) return value;
      scale *= 128;
    }
    throw new Rar5Error('damaged', 'A number in a header is too long.');
  }

  u32(): number {
    if (this.at + 4 > this.bytes.length) throw new Rar5Error('damaged', 'The archive ends in the middle of a header.');
    const b = this.bytes;
    const v = (b[this.at] | (b[this.at + 1] << 8) | (b[this.at + 2] << 16) | (b[this.at + 3] << 24)) >>> 0;
    this.at += 4;
    return v;
  }

  take(n: number): Uint8Array {
    if (this.at + n > this.bytes.length) throw new Rar5Error('damaged', 'The archive ends in the middle of a header.');
    const out = this.bytes.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }
}

/** Windows FILETIME (100 ns since 1601) to milliseconds since 1970. */
const fileTime = (low: number, high: number) => Math.round((high * 2 ** 32 + low) / 10_000 - 11_644_473_600_000);

/** Reads the extra records of a file header; only the modification time matters here. */
function readExtra(extra: Uint8Array, entry: Rar5Entry) {
  const c = new Cursor(extra);
  while (c.at < extra.length) {
    const size = c.vint();
    const end = c.at + size;
    const type = c.vint();
    if (type === 1) entry.encrypted = true;
    if (type === 3) {
      // Time record: flag 1 = Unix times (else Windows FILETIME), 2 = mtime present.
      const flags = c.vint();
      if (flags & 2) {
        if (flags & 1) entry.modified = c.u32() * 1000;
        else {
          const low = c.u32();
          const high = c.u32();
          entry.modified = fileTime(low, high);
        }
      }
    }
    c.at = end;
  }
}

/**
 * Lists a RAR 5 archive. `source` is the whole file, or a ReadRange plus the file's size (only
 * the headers are read: a few KB for most archives).
 */
export async function readRar5(source: Uint8Array | { read: ReadRange; size: number }): Promise<Rar5Archive> {
  const size = source instanceof Uint8Array ? source.length : source.size;
  const read: ReadRange = source instanceof Uint8Array ? async (s, e) => source.subarray(s, Math.min(e, source.length)) : source.read;

  const start = await read(0, 8);
  if (!isRar5(start)) {
    if (RAR4_SIGNATURE.every((b, i) => start[i] === b)) throw new Rar5Error('rar4', 'This is an older RAR 4 archive, not RAR 5.');
    throw new Rar5Error('not-rar', 'This isn’t a RAR archive.');
  }

  const archive: Rar5Archive = { entries: [], multiVolume: false, solid: false, hasRecovery: false };
  let pos = 8;
  let ended = false;
  while (pos + 7 <= size) {
    // CRC32 (4 bytes), then the header size as a variable-length integer (at most 3 bytes).
    const head = await read(pos, Math.min(size, pos + 7));
    const lead = new Cursor(head);
    lead.u32();
    const headerSize = lead.vint();
    const bodyStart = pos + lead.at;
    if (headerSize < 2 || bodyStart + headerSize > size) throw new Rar5Error('damaged', 'A header runs past the end of the file.');
    const body = new Cursor(await read(bodyStart, bodyStart + headerSize));

    const type = body.vint();
    const flags = body.vint();
    const extraSize = flags & 1 ? body.vint() : 0;
    const dataSize = flags & 2 ? body.vint() : 0;

    if (type === HEADER_ENCRYPTION) throw new Rar5Error('encrypted', 'The archive’s file list is protected by a password.');
    if (type === HEADER_MAIN) {
      const archiveFlags = body.vint();
      archive.multiVolume = !!(archiveFlags & 1);
      archive.solid = !!(archiveFlags & 4);
      archive.hasRecovery = !!(archiveFlags & 8);
    } else if (type === HEADER_FILE || type === HEADER_SERVICE) {
      const fileFlags = body.vint();
      const unpacked = body.vint();
      body.vint(); // attributes
      const entry: Rar5Entry = { name: '', isFolder: !!(fileFlags & 1), size: unpacked, packedSize: dataSize, modified: 0, method: 0, encrypted: false, hostOs: 'other' };
      if (fileFlags & 2) entry.modified = body.u32() * 1000;
      if (fileFlags & 4) entry.crc32 = body.u32();
      const compression = body.vint();
      entry.method = (compression >> 7) & 7;
      const host = body.vint();
      entry.hostOs = host === 0 ? 'windows' : host === 1 ? 'unix' : 'other';
      const nameLength = body.vint();
      const name = new TextDecoder().decode(body.take(nameLength));
      if (extraSize) readExtra(body.take(Math.min(extraSize, body.bytes.length - body.at)), entry);
      if (type === HEADER_FILE) {
        entry.name = name.replace(/\\/g, '/');
        archive.entries.push(entry);
      } else if (name === 'CMT' && entry.method === 0 && dataSize > 0 && dataSize < 1_000_000) {
        // An archive comment stored without compression.
        const at = bodyStart + headerSize;
        archive.comment = new TextDecoder().decode(await read(at, at + dataSize));
      }
    } else if (type === HEADER_END) {
      ended = true;
      break;
    }

    const next = bodyStart + headerSize + dataSize;
    if (next <= pos) throw new Rar5Error('damaged', 'The archive’s headers loop back on themselves.');
    pos = next;
  }
  // Bytes left over that are too few for a header mean the file was cut short.
  if (pos < size && !ended) throw new Rar5Error('damaged', 'The archive is cut short (it may not have finished downloading).');
  return archive;
}
