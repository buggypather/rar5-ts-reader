// rar5-ts-reader: lists what's inside a RAR 5 archive by reading only its headers, so even a
// huge archive lists quickly and nothing is unpacked. Works in browsers and Node: give it the
// bytes, or a function that reads a range of the file. It extracts files saved without
// compression ("Store"); compressed files need unrar, 7-Zip or libarchive. Archives whose file
// list is password-protected can't be listed.

export interface Rar5Link {
  /** What kind of link: a Unix symlink, a Windows symlink or junction, a hard link, or a copy of another file in the archive. */
  type: 'symlink' | 'windows-symlink' | 'junction' | 'hardlink' | 'copy' | 'unknown';
  /** Where it points (for a hard link or copy, another entry's name in the archive). */
  target: string;
  /** The link points to a folder. */
  toFolder: boolean;
}

export interface Rar5Owner {
  user?: string;
  group?: string;
  uid?: number;
  gid?: number;
}

export interface Rar5Entry {
  /** Path inside the archive, with "/" between folders. */
  name: string;
  isFolder: boolean;
  /** Size once unpacked, in bytes. */
  size: number;
  /** Size inside the archive, in bytes (in this volume only, unless merged by readRar5Volumes). */
  packedSize: number;
  /** Last change, in milliseconds since 1970, or 0 if the archive didn't store it. */
  modified: number;
  /** Creation time, in milliseconds since 1970, if stored. */
  created?: number;
  /** Last access, in milliseconds since 1970, if stored. */
  accessed?: number;
  /** CRC32 of the unpacked data, if stored (for a split file, only its last part has the whole file's). */
  crc32?: number;
  /** BLAKE2sp hash of the unpacked data (64 hex digits), if the archive used it instead of CRC32. */
  blake2sp?: string;
  /** 0 = stored, 1–5 = faster to better compression. */
  method: number;
  /** The file is encrypted (its name is still readable). */
  encrypted: boolean;
  /** The operating system that made it. */
  hostOs: 'windows' | 'unix' | 'other';
  /**
   * File attributes as stored: on Windows, bits like 1 read-only, 2 hidden, 4 system, 16 folder,
   * 32 archive; on Unix, the mode (e.g. 0o100644).
   */
  attributes: number;
  /** A symlink, junction, hard link or file copy, with its target. */
  link?: Rar5Link;
  /** Owner names and ids (Unix), if stored. */
  owner?: Rar5Owner;
  /** File version number, for archives made with RAR's "keep file versions" option. */
  version?: number;
  /** The file's data starts in an earlier volume. */
  splitBefore: boolean;
  /** The file's data continues in the next volume. */
  splitAfter: boolean;
  /** Where the file's packed data starts in this volume (for tools that extract). */
  dataOffset: number;
}

export interface Rar5Archive {
  entries: Rar5Entry[];
  /** Split into volumes (.part1.rar, .part2.rar…). */
  multiVolume: boolean;
  /** Which volume this is, from 0 (only for multi-volume archives). */
  volumeNumber: number;
  /** Solid archive (files compressed together). */
  solid: boolean;
  /** The archive has a recovery record. */
  hasRecovery: boolean;
  /** The archive is locked (can't be changed by RAR). */
  locked: boolean;
  /** Bytes before the archive starts: more than 0 for a self-extracting (.exe) archive. */
  sfxOffset: number;
  /** The archive's comment, if any (only when stored uncompressed). */
  comment?: string;
}

/** Reads bytes [start, end) of the file. */
export type ReadRange = (start: number, end: number) => Promise<Uint8Array>;

/** The whole file, or a ReadRange plus the file's size. */
export type Rar5Source = Uint8Array | { read: ReadRange; size: number };

export interface Rar5Options {
  /** Check each header's CRC32 and report a mismatch as damage. Default true. */
  checkCrc?: boolean;
  /** With a ReadRange, read at least this many bytes at a time (fewer, larger reads). Default 65536. */
  chunkSize?: number;
  /** How far into a self-extracting .exe to look for the archive. Default 4 MiB. */
  sfxSearchLimit?: number;
}

export class Rar5Error extends Error {
  readonly code: 'not-rar' | 'rar4' | 'encrypted' | 'damaged' | 'unsupported';
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

const startsWith = (bytes: Uint8Array, at: number, sig: number[]) => sig.every((b, i) => bytes[at + i] === b);

// ---- CRC32 (the zip/PNG one), for header checks ----

let crcTable: Uint32Array | undefined;
/** CRC32 of the bytes. */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
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
    if (n < 0 || this.at + n > this.bytes.length) throw new Rar5Error('damaged', 'The archive ends in the middle of a header.');
    const out = this.bytes.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }

  text(): string {
    return utf8.decode(this.take(this.vint()));
  }
}

const utf8 = new TextDecoder();

/** Windows FILETIME (100 ns since 1601) to milliseconds since 1970. */
const fileTime = (low: number, high: number) => Math.round((high * 2 ** 32 + low) / 10_000 - 11_644_473_600_000);

const LINK_TYPES: Rar5Link['type'][] = ['unknown', 'symlink', 'windows-symlink', 'junction', 'hardlink', 'copy'];

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

/** Reads the extra records of a file header: encryption, hash, times, version, link, owner. */
function readExtra(extra: Uint8Array, entry: Rar5Entry) {
  const c = new Cursor(extra);
  while (c.at < extra.length) {
    const size = c.vint();
    const end = c.at + size;
    if (size === 0 || end > extra.length) throw new Rar5Error('damaged', 'A file header’s extra area is broken.');
    const type = c.vint();
    if (type === 1) entry.encrypted = true;
    else if (type === 2) {
      // Hash record: 0 = BLAKE2sp, 32 bytes.
      if (c.vint() === 0) entry.blake2sp = hex(c.take(32));
    } else if (type === 3) {
      // Time record: flag 1 = Unix times (else Windows FILETIME); 2, 4, 8 = modified, created,
      // accessed present; 16 = Unix nanoseconds follow.
      const flags = c.vint();
      const unix = !!(flags & 1);
      const present = (['modified', 'created', 'accessed'] as const).filter((_, i) => flags & (2 << i));
      const times: number[] = present.map(() => {
        if (unix) return c.u32() * 1000;
        const low = c.u32();
        return fileTime(low, c.u32());
      });
      if (unix && flags & 16) times.forEach((t, i) => (times[i] = t + Math.floor(c.u32() / 1_000_000)));
      present.forEach((key, i) => (entry[key] = times[i]));
    } else if (type === 4) {
      c.vint(); // flags
      entry.version = c.vint();
    } else if (type === 5) {
      const linkType = c.vint();
      const flags = c.vint();
      entry.link = { type: LINK_TYPES[linkType] ?? 'unknown', toFolder: !!(flags & 1), target: c.text() };
    } else if (type === 6) {
      const flags = c.vint();
      const owner: Rar5Owner = {};
      if (flags & 1) owner.user = c.text();
      if (flags & 2) owner.group = c.text();
      if (flags & 4) owner.uid = c.vint();
      if (flags & 8) owner.gid = c.vint();
      entry.owner = owner;
    }
    c.at = end;
  }
}

/** Reads through a small cache, so a ReadRange is asked for fewer, larger pieces. */
function cachedReader(read: ReadRange, size: number, chunk: number): ReadRange {
  let bufStart = 0;
  let buf: Uint8Array = new Uint8Array(0);
  return async (start, end) => {
    end = Math.min(end, size);
    if (start >= bufStart && end <= bufStart + buf.length) return buf.subarray(start - bufStart, end - bufStart);
    const got = await read(start, Math.min(size, Math.max(end, start + chunk)));
    bufStart = start;
    buf = got;
    return got.subarray(0, end - start);
  };
}

/** Where the archive starts: 0, or further on in a self-extracting .exe (Windows or Linux). */
async function findStart(read: ReadRange, size: number, limit: number): Promise<number> {
  const first = await read(0, Math.min(size, 8));
  if (startsWith(first, 0, RAR5_SIGNATURE)) return 0;
  if (startsWith(first, 0, RAR4_SIGNATURE)) throw new Rar5Error('rar4', 'This is an older RAR 4 archive, not RAR 5.');
  const exe = (first[0] === 0x4d && first[1] === 0x5a) || startsWith(first, 0, [0x7f, 0x45, 0x4c, 0x46]);
  if (exe) {
    const step = 65_536;
    for (let at = 0; at < Math.min(size, limit); at += step - 8) {
      const piece = await read(at, Math.min(size, at + step));
      for (let i = 0; i + 8 <= piece.length; i++) {
        if (piece[i] !== 0x52) continue;
        if (startsWith(piece, i, RAR5_SIGNATURE)) return at + i;
        if (startsWith(piece, i, RAR4_SIGNATURE)) throw new Rar5Error('rar4', 'This is a self-extracting RAR 4 archive, not RAR 5.');
      }
      if (piece.length < step) break;
    }
  }
  throw new Rar5Error('not-rar', 'This isn’t a RAR archive.');
}

/**
 * Lists a RAR 5 archive. `source` is the whole file, or a ReadRange plus the file's size (only
 * the headers are read: a few KB for most archives). Self-extracting .exe archives work too.
 */
export async function readRar5(source: Rar5Source, options: Rar5Options = {}): Promise<Rar5Archive> {
  const { checkCrc = true, chunkSize = 65_536, sfxSearchLimit = 4 * 1024 * 1024 } = options;
  const size = source instanceof Uint8Array ? source.length : source.size;
  const read: ReadRange =
    source instanceof Uint8Array ? async (s, e) => source.subarray(s, Math.min(e, source.length)) : cachedReader(source.read, size, chunkSize);

  const sfxOffset = await findStart(read, size, sfxSearchLimit);
  const archive: Rar5Archive = { entries: [], multiVolume: false, volumeNumber: 0, solid: false, hasRecovery: false, locked: false, sfxOffset };
  let pos = sfxOffset + 8;
  let ended = false;
  while (pos + 7 <= size) {
    // CRC32 (4 bytes), then the header size as a variable-length integer (at most 3 bytes).
    const lead = new Cursor(await read(pos, Math.min(size, pos + 7)));
    const headerCrc = lead.u32();
    const headerSize = lead.vint();
    const bodyStart = pos + lead.at;
    if (headerSize < 2 || headerSize > 2 * 1024 * 1024 || bodyStart + headerSize > size) throw new Rar5Error('damaged', 'A header runs past the end of the file.');
    const whole = await read(pos, bodyStart + headerSize);
    if (checkCrc && crc32(whole.subarray(4)) !== headerCrc) throw new Rar5Error('damaged', 'A header’s checksum doesn’t match (the archive is damaged).');
    const body = new Cursor(whole.subarray(bodyStart - pos));

    const type = body.vint();
    const flags = body.vint();
    const extraSize = flags & 1 ? body.vint() : 0;
    const dataSize = flags & 2 ? body.vint() : 0;
    const dataOffset = bodyStart + headerSize;

    if (type === HEADER_ENCRYPTION) throw new Rar5Error('encrypted', 'The archive’s file list is protected by a password.');
    if (type === HEADER_MAIN) {
      const archiveFlags = body.vint();
      archive.multiVolume = !!(archiveFlags & 1);
      if (archiveFlags & 2) archive.volumeNumber = body.vint();
      archive.solid = !!(archiveFlags & 4);
      archive.hasRecovery = !!(archiveFlags & 8);
      archive.locked = !!(archiveFlags & 16);
    } else if (type === HEADER_FILE || type === HEADER_SERVICE) {
      const fileFlags = body.vint();
      const unpacked = body.vint();
      const attributes = body.vint();
      const entry: Rar5Entry = {
        name: '',
        isFolder: !!(fileFlags & 1),
        size: unpacked,
        packedSize: dataSize,
        modified: 0,
        method: 0,
        encrypted: false,
        hostOs: 'other',
        attributes,
        splitBefore: !!(flags & 8),
        splitAfter: !!(flags & 16),
        dataOffset,
      };
      if (fileFlags & 2) entry.modified = body.u32() * 1000;
      if (fileFlags & 4) entry.crc32 = body.u32();
      const compression = body.vint();
      entry.method = (compression >> 7) & 7;
      const host = body.vint();
      entry.hostOs = host === 0 ? 'windows' : host === 1 ? 'unix' : 'other';
      const name = utf8.decode(body.take(body.vint()));
      if (extraSize) readExtra(body.take(Math.min(extraSize, body.bytes.length - body.at)), entry);
      if (type === HEADER_FILE) {
        entry.name = name.replace(/\\/g, '/');
        archive.entries.push(entry);
      } else if (name === 'CMT' && entry.method === 0 && dataSize > 0 && dataSize < 1_000_000) {
        // An archive comment stored without compression.
        archive.comment = utf8.decode(await read(dataOffset, dataOffset + dataSize));
      }
    } else if (type === HEADER_END) {
      ended = true;
      break;
    }

    const next = dataOffset + dataSize;
    if (next <= pos) throw new Rar5Error('damaged', 'The archive’s headers loop back on themselves.');
    pos = next;
  }
  // Bytes left over that are too few for a header mean the file was cut short.
  if (pos < size && !ended) throw new Rar5Error('damaged', 'The archive is cut short (it may not have finished downloading).');
  return archive;
}

/**
 * Lists a multi-volume archive (.part1.rar, .part2.rar…) as one: give every volume, in any
 * order. A file split across volumes appears once, with its packed sizes added up and the whole
 * file's CRC32 or hash. If a volume is missing, the last part found keeps `splitAfter` true.
 */
export async function readRar5Volumes(volumes: Rar5Source[], options: Rar5Options = {}): Promise<Rar5Archive> {
  const lists = await Promise.all(volumes.map(v => readRar5(v, options)));
  lists.sort((a, b) => a.volumeNumber - b.volumeNumber);
  const first = lists[0];
  if (!first) throw new Rar5Error('not-rar', 'No volumes were given.');
  const entries: Rar5Entry[] = [];
  for (const list of lists) {
    for (const e of list.entries) {
      const prev = entries[entries.length - 1];
      if (e.splitBefore && prev && prev.splitAfter && prev.name === e.name) {
        prev.packedSize += e.packedSize;
        prev.splitAfter = e.splitAfter;
        // Only the last part's checksum covers the whole file.
        if (!e.splitAfter) {
          prev.crc32 = e.crc32;
          prev.blake2sp = e.blake2sp;
        }
      } else {
        const copy = { ...e };
        // A first part's checksum covers only that part's packed data.
        if (copy.splitAfter) {
          delete copy.crc32;
          delete copy.blake2sp;
        }
        entries.push(copy);
      }
    }
  }
  return {
    ...first,
    entries,
    volumeNumber: 0,
    hasRecovery: lists.some(l => l.hasRecovery),
    comment: lists.find(l => l.comment !== undefined)?.comment,
  };
}

/** Why an entry can't be extracted by extractStored, or null if it can. */
export function cantExtract(entry: Rar5Entry): string | null {
  if (entry.isFolder) return 'It’s a folder.';
  if (entry.link) return 'It’s a link, not a file with data.';
  if (entry.encrypted) return 'It’s encrypted.';
  if (entry.method !== 0) return 'It’s compressed (only files saved with "Store" can be extracted).';
  if (entry.splitBefore || entry.splitAfter) return 'It’s split across volumes.';
  if (entry.packedSize !== entry.size) return 'Its stored size doesn’t match its size.';
  return null;
}

/**
 * Extracts a file saved without compression ("Store" in RAR), from the same source the entry
 * was listed from, and checks it against its CRC32 when the archive has one (BLAKE2sp hashes
 * aren't checked yet). Throws Rar5Error 'unsupported' for compressed, encrypted, split or link
 * entries (see cantExtract), and 'damaged' if the data doesn't match its CRC32.
 */
export async function extractStored(source: Rar5Source, entry: Rar5Entry, options: { checkCrc?: boolean } = {}): Promise<Uint8Array> {
  const why = cantExtract(entry);
  if (why) throw new Rar5Error('unsupported', `${entry.name} can’t be extracted here: ${why}`);
  const size = source instanceof Uint8Array ? source.length : source.size;
  const end = entry.dataOffset + entry.packedSize;
  if (end > size) throw new Rar5Error('damaged', `${entry.name}’s data runs past the end of the file.`);
  const data = source instanceof Uint8Array ? source.slice(entry.dataOffset, end) : await source.read(entry.dataOffset, end);
  if (data.length !== entry.packedSize) throw new Rar5Error('damaged', `${entry.name}’s data is cut short.`);
  if (options.checkCrc !== false && entry.crc32 !== undefined && crc32(data) !== entry.crc32) {
    throw new Rar5Error('damaged', `${entry.name} doesn’t match its checksum (the archive is damaged).`);
  }
  return data;
}

/**
 * A safe place for an entry inside a folder you extract to: its path with "/" between parts, or
 * null if the name tries to leave that folder (an absolute path, a drive letter or "..").
 */
export function safePath(name: string): string | null {
  const parts = name.replace(/\\/g, '/').split('/').filter(p => p !== '' && p !== '.');
  if (/^([a-zA-Z]:|\/)/.test(name) || parts.some(p => p === '..') || parts.length === 0) return null;
  return parts.join('/');
}
