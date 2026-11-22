import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cantExtract, crc32, extractStored, readRar5, Rar5Error, safePath } from '../packages/rar5-ts-reader/src/index';
import { humanSize, run } from '../packages/rar5ls/src/cli';

const dir = join(import.meta.dirname, 'fixtures', 'libarchive');
const path = (name: string) => join(dir, name);
const file = (name: string) => new Uint8Array(readFileSync(path(name)));

describe('extractStored', () => {
  it('extracts stored files and checks them against their CRC32', async () => {
    const bytes = file('stored_manyfiles.rar');
    const archive = await readRar5(bytes);
    for (const e of archive.entries) {
      const data = await extractStored(bytes, e);
      expect(data.length).toBe(e.size);
      expect(crc32(data)).toBe(e.crc32);
    }
    const first = new TextDecoder().decode(await extractStored(bytes, archive.entries[0]));
    expect(first.startsWith('#!/usr/bin/env tclsh')).toBe(true);
  });

  it('works through a range reader, reading only the file', async () => {
    const bytes = file('stored.rar');
    const source = { size: bytes.length, read: async (s: number, e: number) => bytes.subarray(s, e) };
    const [entry] = (await readRar5(source)).entries;
    expect(new TextDecoder().decode(await extractStored(source, entry))).toBe('hello libarchive test suite!\n');
  });

  it('extracts from a self-extracting .exe', async () => {
    const bytes = file('sfx.exe');
    const [entry] = (await readRar5(bytes)).entries;
    expect(cantExtract(entry)).toBeNull();
    expect((await extractStored(bytes, entry)).length).toBe(entry.size);
  });

  it('says why a file can’t be extracted', async () => {
    const compressed = (await readRar5(file('compressed.rar'))).entries[0];
    expect(cantExtract(compressed)).toMatch(/compressed/);
    await expect(extractStored(file('compressed.rar'), compressed)).rejects.toMatchObject({ code: 'unsupported' });
    const links = (await readRar5(file('symlink.rar'))).entries;
    expect(cantExtract(links.find(e => e.name === 'symlink.txt')!)).toMatch(/link/);
    expect(cantExtract(links.find(e => e.name === 'dir')!)).toMatch(/folder/);
    const encrypted = (await readRar5(file('encrypted.rar'))).entries.find(e => e.encrypted)!;
    expect(cantExtract(encrypted)).toMatch(/encrypted/);
  });

  it('notices damaged data', async () => {
    const bytes = file('stored.rar').slice();
    const [entry] = (await readRar5(bytes)).entries;
    bytes[entry.dataOffset] ^= 0xff;
    await expect(extractStored(bytes, entry)).rejects.toBeInstanceOf(Rar5Error);
    await expect(extractStored(bytes, entry)).rejects.toMatchObject({ code: 'damaged' });
    expect((await extractStored(bytes, entry, { checkCrc: false })).length).toBe(entry.size);
  });
});

describe('safePath', () => {
  it('keeps names inside the folder', () => {
    expect(safePath('docs/readme.txt')).toBe('docs/readme.txt');
    expect(safePath('./a//b/./c.txt')).toBe('a/b/c.txt');
    expect(safePath('../evil.sh')).toBeNull();
    expect(safePath('a/../../evil.sh')).toBeNull();
    expect(safePath('/etc/passwd')).toBeNull();
    expect(safePath('C:/Windows/evil.dll')).toBeNull();
    expect(safePath('')).toBeNull();
  });
});

describe('rar5ls', () => {
  it('lists an archive as a table', async () => {
    const r = await run([path('symlink.rar')]);
    expect(r.code).toBe(0);
    expect(r.out.join('\n')).toContain('symlink.txt -> file.txt');
    expect(r.out[r.out.length - 1]).toBe('4 entries, 16 B');
  });

  it('prints JSON', async () => {
    const r = await run(['--json', path('stored.rar')]);
    expect(JSON.parse(r.out[0]).entries[0].name).toBe('helloworld.txt');
  });

  it('extracts stored files and skips compressed ones', async () => {
    const out = mkdtempSync(join(tmpdir(), 'rar5ls-'));
    const r = await run(['-x', '-o', out, path('stored_manyfiles.rar')]);
    expect(r.code).toBe(0);
    expect(readFileSync(join(out, 'cebula.txt')).length).toBe(814);
    const out2 = mkdtempSync(join(tmpdir(), 'rar5ls-'));
    const r2 = await run(['-x', '-o', out2, path('compressed.rar')]);
    expect(r2.code).toBe(1);
    expect(r2.err[0]).toMatch(/Skipped test\.bin: .*compressed/);
    expect(existsSync(join(out2, 'test.bin'))).toBe(false);
  });

  it('lists multi-volume archives as one and explains errors', async () => {
    const parts = ['01', '02', '03', '04', '05', '06', '07', '08'].map(n => path(`multiarchive.part${n}.rar`));
    const r = await run(parts);
    expect(r.out[r.out.length - 1]).toMatch(/^2 entries, .*multi-volume/);
    expect((await run(['missing.rar'])).err[0]).toMatch(/no such file/);
    expect((await run([path('encrypted_filenames.rar')])).err[0]).toMatch(/password/);
    expect((await run(['--nope'])).code).toBe(2);
    expect((await run(['--help'])).out[0]).toMatch(/^rar5ls/);
  });

  it('writes sizes for people', () => {
    expect(humanSize(5)).toBe('5 B');
    expect(humanSize(1536)).toBe('1.5 KB');
    expect(humanSize(500 * 1024 * 1024)).toBe('500 MB');
  });
});
