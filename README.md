# rar5-ts-reader

Read **RAR 5** archives without unrar: list what's inside by reading only the headers (fast even
for huge or remote files), and extract the files saved without compression. Handles
self-extracting `.exe` archives and multi-volume sets. Tested against libarchive's real RAR 5
archives.

## Which one do you want?

| You want | Get | How |
| --- | --- | --- |
| A program to list and extract, no setup | **rar5ls** download | [Latest release](https://github.com/buggypather/rar5-ts-reader/releases/latest): `rar5ls-windows-x64.exe`, `rar5ls-mac-arm64`, `rar5ls-mac-x64`, `rar5ls-linux-x64`, `rar5ls-linux-arm64` |
| The command, with Node.js | **[rar5ls](packages/rar5ls)** on npm | `npx rar5ls archive.rar` or `npm install -g rar5ls` |
| A library for your own code | **[rar5-ts-reader](packages/rar5-ts-reader)** on npm | `npm install rar5-ts-reader` |

```
$ rar5ls archive.rar
Size  Modified          Kind     Name
 5 B  2019-04-17 20:31  stored   file.txt
 8 B  2019-04-17 20:32  symlink  symlink.txt -> file.txt
 3 B  2019-04-17 21:10  symlink  dirlink -> dir
      2019-04-17 21:10  folder   dir
4 entries, 16 B
```

```ts
import { readRar5 } from 'rar5-ts-reader';

const archive = await readRar5(bytes);
for (const e of archive.entries) console.log(e.name, e.size);
```

Full details: [the library's README](packages/rar5-ts-reader#readme) and
[rar5ls's README](packages/rar5ls#readme).

## Develop

```sh
npm install     # links the two packages together
npm test        # all tests, on the libarchive archives in tests/fixtures
npm run build   # both packages
npm run binaries  # the standalone programs, into release/ (needs Bun: https://bun.sh)
```

Releasing: see [RELEASING.md](RELEASING.md).

The test archives in `tests/fixtures/libarchive` come from
[libarchive](https://github.com/libarchive/libarchive) and are used under its licence (see the
COPYING file there).

## Licence

MIT
