import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRar5, readRar5Volumes, Rar5Error } from '../src/index';

// Real archives made by RAR and WinRAR, from libarchive's test suite (tests/fixtures/libarchive).
const dir = join(import.meta.dirname, 'fixtures', 'libarchive');
const file = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
const list = async (name: string) => (await readRar5(file(name))).entries;

describe('real archives', () => {
  it('lists stored, compressed and solid archives', async () => {
    expect(await list('stored.rar')).toMatchObject([{ name: 'helloworld.txt', size: 29, packedSize: 29, method: 0, crc32: 2510308276 }]);
    expect((await list('compressed.rar'))[0]).toMatchObject({ name: 'test.bin', size: 1200 });
    const solid = await readRar5(file('solid.rar'));
    expect(solid.solid).toBe(true);
    expect(solid.entries.map(e => e.name)).toEqual(['test.bin', 'test1.bin', 'test2.bin', 'test3.bin', 'test4.bin', 'test5.bin', 'test6.bin']);
  });

  it('reads Unicode names and Windows archives with folders and attributes', async () => {
    expect((await list('unicode.rar')).map(e => e.name)).toEqual(['👋🌎.txt', 'Ⓗⓐⓡⓓ Ⓛⓘⓝⓚ.txt', '𝒮𝓎𝓂𝒷𝑜𝓁𝒾𝒸 𝐿𝒾𝓃𝓀.txt']);
    const win = await list('win32.rar');
    expect(win[0]).toMatchObject({ name: 'testdir', isFolder: true, hostOs: 'windows', attributes: 16 });
    const attrs = Object.fromEntries((await list('fileattr.rar')).map(e => [e.name, e.attributes]));
    expect(attrs).toMatchObject({ 'readonly.txt': 33, 'hidden.txt': 34, 'system.txt': 36, 'ro_hidden.txt': 35, dir_readonly: 17 });
  });

  it('reads links, owners, hashes and file versions', async () => {
    const sym = await list('symlink.rar');
    expect(sym.find(e => e.name === 'symlink.txt')?.link).toEqual({ type: 'symlink', target: 'file.txt', toFolder: false });
    expect(sym.find(e => e.name === 'dirlink')?.link).toEqual({ type: 'symlink', target: 'dir', toFolder: true });
    expect((await list('hardlink.rar'))[1].link).toEqual({ type: 'hardlink', target: 'file.txt', toFolder: false });
    expect((await list('unicode.rar'))[2].link).toMatchObject({ type: 'windows-symlink', target: '👋🌎.txt' });
    const owners = (await list('owner.rar')).map(e => e.owner);
    expect(owners).toEqual([{ user: 'root', group: 'wheel' }, { user: 'nobody', group: 'nogroup' }, { uid: 9999, gid: 8888 }]);
    expect((await list('blake2.rar'))[0].blake2sp).toBe('e67b86259a1cd0d51b6d6776ce10b5a5cf619559903c009ca8c346d6453853a5');
    expect((await list('extra_field_version.rar'))[0].version).toBe(1);
  });

  it('finds the archive inside a self-extracting .exe', async () => {
    const sfx = await readRar5(file('sfx.exe'));
    expect(sfx.sfxOffset).toBeGreaterThan(0);
    expect(sfx.entries.map(e => e.name)).toEqual(['test.txt.txt']);
  });

  it('merges a multi-volume archive, given its parts in any order', async () => {
    const parts = readdirSync(dir).filter(f => f.startsWith('multiarchive.part')).reverse();
    const one = await readRar5(file(parts[parts.length - 1]));
    expect(one.multiVolume).toBe(true);
    expect(one.entries[0].splitAfter).toBe(true);
    const all = await readRar5Volumes(parts.map(file));
    expect(all.entries.map(e => [e.name.split('/').pop(), e.size, e.splitBefore, e.splitAfter])).toEqual([
      ['bsdcat_test', 144608, false, false],
      ['bsdtar_test', 365672, false, false],
    ]);
    expect(all.entries[0].packedSize).toBeGreaterThan(one.entries[0].packedSize);
    const solid = await readRar5Volumes(readdirSync(dir).filter(f => f.startsWith('multiarchive_solid')).map(file));
    expect(solid.entries).toHaveLength(9);
  });

  it('says when the file list needs a password', async () => {
    await expect(readRar5(file('encrypted_filenames.rar'))).rejects.toMatchObject({ code: 'encrypted' });
    // Some files encrypted, names readable: lists fine, and says which.
    expect((await list('encrypted.rar')).map(e => [e.name, e.encrypted])).toEqual([
      ['a.txt', false],
      ['b.txt', true],
      ['c.txt', false],
      ['d.txt', true],
    ]);
  });

  it('turns every broken archive into a Rar5Error, never a crash or a hang', async () => {
    for (const name of readdirSync(dir).filter(f => /\.(rar|exe)$/.test(f))) {
      try {
        await readRar5(file(name));
      } catch (e) {
        expect(e, name).toBeInstanceOf(Rar5Error);
      }
    }
  });
});
