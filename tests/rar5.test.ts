import { describe, expect, it } from 'vitest';
import { isRar5, RAR5_SIGNATURE, readRar5, Rar5Error } from '../src/index';

// Builds small RAR 5 archives by hand, following the format's headers (CRCs are left at 0;
// the reader doesn't check them).

function vint(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
}
const u32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

function block(type: number, flags: number, fields: number[], opts: { extra?: number[]; data?: number[] } = {}): number[] {
  let f = flags;
  if (opts.extra) f |= 1;
  if (opts.data) f |= 2;
  const body = [...vint(type), ...vint(f), ...(opts.extra ? vint(opts.extra.length) : []), ...(opts.data ? vint(opts.data.length) : []), ...fields, ...(opts.extra ?? [])];
  return [...u32(0), ...vint(body.length), ...body, ...(opts.data ?? [])];
}

function fileBlock(name: string, o: { folder?: boolean; size?: number; mtime?: number; crc?: number; data?: number[]; extra?: number[]; type?: number; method?: number } = {}): number[] {
  const nameBytes = [...new TextEncoder().encode(name)];
  let fileFlags = o.folder ? 1 : 0;
  const fields: number[] = [];
  if (o.mtime !== undefined) fileFlags |= 2;
  if (o.crc !== undefined) fileFlags |= 4;
  fields.push(...vint(fileFlags), ...vint(o.size ?? 0), ...vint(0x20));
  if (o.mtime !== undefined) fields.push(...u32(o.mtime));
  if (o.crc !== undefined) fields.push(...u32(o.crc));
  fields.push(...vint((o.method ?? 3) << 7), ...vint(1), ...vint(nameBytes.length), ...nameBytes);
  return block(o.type ?? 2, 0, fields, { data: o.data ?? [1, 2, 3], extra: o.extra });
}

function archive(...blocks: number[][]): Uint8Array {
  return new Uint8Array([...RAR5_SIGNATURE, ...block(1, 0, vint(4 | 8)), ...blocks.flat(), ...block(5, 0, vint(0))]);
}

describe('readRar5', () => {
  it('lists files and folders with sizes, times and CRCs', async () => {
    const bytes = archive(
      fileBlock('docs', { folder: true, data: [] }),
      fileBlock('docs\\readme.txt', { size: 1234, mtime: 1_700_000_000, crc: 0xdeadbeef, data: [9, 9, 9, 9] }),
      fileBlock('photo.jpg', { size: 99, method: 0, data: new Array(99).fill(7) }),
    );
    expect(isRar5(bytes)).toBe(true);
    const r = await readRar5(bytes);
    expect(r.solid).toBe(true);
    expect(r.hasRecovery).toBe(true);
    expect(r.multiVolume).toBe(false);
    expect(r.entries.map(e => e.name)).toEqual(['docs', 'docs/readme.txt', 'photo.jpg']);
    expect(r.entries[0].isFolder).toBe(true);
    expect(r.entries[1]).toMatchObject({ size: 1234, packedSize: 4, modified: 1_700_000_000_000, crc32: 0xdeadbeef, method: 3, hostOs: 'unix' });
    expect(r.entries[2]).toMatchObject({ size: 99, packedSize: 99, method: 0 });
  });

  it('reads Windows file times from the extra area and flags encryption', async () => {
    // 2024-01-01T00:00:00Z as FILETIME
    const ft = BigInt(Date.UTC(2024, 0, 1)) * 10_000n + 116_444_736_000_000_000n;
    const low = Number(ft & 0xffffffffn);
    const high = Number(ft >> 32n);
    const timeRecord = [...vint(3), ...vint(2), ...u32(low), ...u32(high)];
    const cryptRecord = [...vint(1), ...vint(0)];
    const extra = [...vint(timeRecord.length), ...timeRecord, ...vint(cryptRecord.length), ...cryptRecord];
    const r = await readRar5(archive(fileBlock('secret.bin', { size: 5, extra })));
    expect(r.entries[0].modified).toBe(Date.UTC(2024, 0, 1));
    expect(r.entries[0].encrypted).toBe(true);
  });

  it('reads an uncompressed archive comment and skips other service headers', async () => {
    const comment = [...new TextEncoder().encode('Hello from the comment')];
    const r = await readRar5(archive(fileBlock('CMT', { type: 3, method: 0, size: comment.length, data: comment }), fileBlock('QO', { type: 3, data: [0, 0] }), fileBlock('a.txt')));
    expect(r.comment).toBe('Hello from the comment');
    expect(r.entries.map(e => e.name)).toEqual(['a.txt']);
  });

  it('only reads headers when given a range reader', async () => {
    const big = new Array(200_000).fill(1);
    const bytes = archive(fileBlock('big.bin', { size: big.length, data: big }), fileBlock('after.txt'));
    let read = 0;
    const r = await readRar5({
      size: bytes.length,
      read: async (s, e) => {
        read += e - s;
        return bytes.subarray(s, e);
      },
    });
    expect(r.entries.map(e => e.name)).toEqual(['big.bin', 'after.txt']);
    expect(read).toBeLessThan(1000);
  });

  it('explains what it can’t read', async () => {
    await expect(readRar5(new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, 0x00]))).rejects.toMatchObject({ code: 'rar4' });
    await expect(readRar5(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toMatchObject({ code: 'not-rar' });
    const locked = new Uint8Array([...RAR5_SIGNATURE, ...block(4, 0, vint(0))]);
    await expect(readRar5(locked)).rejects.toBeInstanceOf(Rar5Error);
    await expect(readRar5(locked)).rejects.toMatchObject({ code: 'encrypted' });
    const cut = archive(fileBlock('x.txt')).subarray(0, 20);
    await expect(readRar5(cut)).rejects.toMatchObject({ code: 'damaged' });
  });
});
