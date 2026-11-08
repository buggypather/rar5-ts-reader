# rar5-ts-reader

Lists what's inside a **RAR 5** archive (names, folders, sizes, dates, CRCs, comment) by reading
only its headers, so even a multi-gigabyte archive lists in a moment. TypeScript, no
dependencies, works in browsers and Node.

It does **not** extract files: RAR 5's compression has no small open-source decoder. Use it to
show an archive's contents, then hand extraction to `unrar` or another app.

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

Each entry has `name` (with `/` between folders), `isFolder`, `size`, `packedSize`, `modified`
(ms since 1970, or 0), `crc32`, `method` (0 = stored, 1–5 = compression level), `encrypted`
and `hostOs`. The archive also says `solid`, `multiVolume`, `hasRecovery` and its `comment`
(when stored uncompressed).

## Errors

`Rar5Error` with a `code`:

- `not-rar`: not a RAR file
- `rar4`: an older RAR 4 archive (use a RAR 4 library such as junrar)
- `encrypted`: the file list itself is password-protected
- `damaged`: the headers are cut short or broken

## Develop

```sh
npm install
npm test
npm run build
```
