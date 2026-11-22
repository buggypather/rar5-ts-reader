# rar5-ts-reader

Lists what's inside a **RAR 5** archive by reading only its headers, so even a multi-gigabyte
archive lists in a moment. TypeScript, no dependencies, works in browsers and Node.

- Names, folders, sizes, dates (modified, created, accessed), CRC32 or BLAKE2sp hashes,
  attributes, owners, file versions and the archive comment
- Symlinks, junctions and hard links, with their targets
- Self-extracting `.exe` archives
- Multi-volume archives (`.part1.rar`, `.part2.rar`…), merged into one list
- Header checksums checked, so damage is reported instead of giving a wrong list
- Tested against the real RAR 5 archives in libarchive's test suite, including the deliberately
  broken ones (each gives a clear error, never a crash or a hang)

It extracts files saved **without compression** ("Store" in WinRAR, common for photos, videos
and other files that don't shrink), checked against their CRC32. Compressed files can't be
extracted yet: hand those to `unrar`, 7-Zip or libarchive.

There's also a small command, `rar5ls`, to list and extract from a terminal.

## From the command line

```sh
npx rar5-ts-reader archive.rar          # list it, without installing anything
npm install -g rar5-ts-reader           # or install the rar5ls command
rar5ls archive.rar                      # list
rar5ls --json archive.rar               # list as JSON, for scripts
rar5ls -x archive.rar                   # extract the stored files to archive_files/
rar5ls -x -o out archive.rar            # ... or to out/
rar5ls movie.part1.rar movie.part2.rar  # list a multi-volume archive as one
```

```
Size  Modified          Kind     Name
 5 B  2019-04-17 20:31  stored   file.txt
 8 B  2019-04-17 20:32  symlink  symlink.txt -> file.txt
 3 B  2019-04-17 21:10  symlink  dirlink -> dir
      2019-04-17 21:10  folder   dir
4 entries, 16 B
```

Files whose names would land outside the folder (`../`, absolute paths) are skipped, as are
compressed, encrypted, split and link entries, each with a message saying why.

## Install

```sh
npm install rar5-ts-reader
```

## Use

```ts
import { readRar5 } from 'rar5-ts-reader';

// The whole file in memory:
const archive = await readRar5(bytes);

// Or only the parts it needs, for big files (here in a browser, from a File):
const archive2 = await readRar5({
  size: file.size,
  read: async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()),
});

for (const e of archive.entries) console.log(e.name, e.isFolder ? '(folder)' : e.size);
```

In Node, read ranges from a file handle:

```ts
import { open } from 'node:fs/promises';

const handle = await open('big.rar');
const { size } = await handle.stat();
const archive = await readRar5({
  size,
  read: async (start, end) => {
    const buf = new Uint8Array(end - start);
    await handle.read(buf, 0, buf.length, start);
    return buf;
  },
});
await handle.close();
```

Over HTTP, `read` can send a `Range: bytes=start-(end-1)` request. Reads are gathered into
64 KB pieces (`chunkSize` option), so listing a remote archive takes few requests.

### Extracting stored files

```ts
import { cantExtract, extractStored, readRar5, safePath } from 'rar5-ts-reader';

const archive = await readRar5(source);
for (const e of archive.entries) {
  const why = cantExtract(e); // null, or why not: compressed, encrypted, folder, link, split
  const path = safePath(e.name); // null if the name tries to leave the folder you extract to
  if (why || !path) continue;
  const data = await extractStored(source, e); // checked against its CRC32
  // write `data` to `path` inside your folder
}
```

`extractStored` reads just that file's bytes (with a range reader too) and throws a `Rar5Error`
with code `unsupported` for entries it can't extract, or `damaged` if the data doesn't match its
CRC32 (BLAKE2sp hashes aren't checked yet). It returns the whole file in memory.

### Multi-volume archives

```ts
import { readRar5Volumes } from 'rar5-ts-reader';

const archive = await readRar5Volumes([part1Bytes, part2Bytes, part3Bytes]); // any order
```

A file split across volumes appears once, with its packed sizes added up. If a volume is missing,
the last part found keeps `splitAfter: true`. `readRar5` on a single volume lists just that
volume, with `splitBefore` / `splitAfter` on the files that continue in other volumes.

## What you get

`readRar5` returns an archive with `entries`, and `solid`, `multiVolume`, `volumeNumber`,
`hasRecovery`, `locked`, `sfxOffset` (bytes before the archive in a self-extracting .exe, else 0)
and `comment` (when stored uncompressed).

Each entry has:

| Field | |
| --- | --- |
| `name` | Path inside the archive, with `/` between folders |
| `isFolder` | |
| `size`, `packedSize` | Unpacked and packed size, in bytes |
| `modified`, `created`, `accessed` | Milliseconds since 1970 (`modified` is 0 if not stored; the others are left out) |
| `crc32` or `blake2sp` | Checksum of the unpacked data (BLAKE2sp as 64 hex digits) |
| `method` | 0 = stored, 1–5 = faster to better compression |
| `encrypted` | The file's data is encrypted (its name is still readable) |
| `hostOs` | `'windows'`, `'unix'` or `'other'` |
| `attributes` | As stored: Windows attribute bits (1 read-only, 2 hidden, 4 system, 16 folder) or the Unix mode |
| `link` | `{ type, target, toFolder }` for a symlink, Windows symlink, junction, hard link or file copy |
| `owner` | `{ user, group, uid, gid }`, whichever are stored |
| `version` | File version, for archives made with RAR's "keep previous file versions" |
| `splitBefore`, `splitAfter` | The data continues from or into another volume |
| `dataOffset` | Where the file's packed data starts in this volume |

## Options

```ts
readRar5(source, {
  checkCrc: true, // check each header's CRC32 (default true)
  chunkSize: 65536, // with a range reader, read at least this much at a time
  sfxSearchLimit: 4 * 1024 * 1024, // how far into a self-extracting .exe to look
});
```

## Errors

`Rar5Error` with a `code`:

- `not-rar`: not a RAR file
- `rar4`: an older RAR 4 archive (use a RAR 4 library such as junrar)
- `encrypted`: the file list itself is password-protected
- `damaged`: the headers are cut short, broken, or fail their checksum, or extracted data
  doesn't match its CRC32
- `unsupported`: `extractStored` was given an entry it can't extract (see `cantExtract`)

## Develop

```sh
npm install
npm test
npm run build
```

The test archives in `tests/fixtures/libarchive` come from
[libarchive](https://github.com/libarchive/libarchive) and are used under its licence (see the
COPYING file there).

## Licence

MIT
