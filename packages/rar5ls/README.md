# rar5ls

List what's inside a **RAR 5** archive from the command line, and extract the files saved without
compression. It reads only the archive's headers, so even a multi-gigabyte archive lists at once.
Handles self-extracting `.exe` archives and multi-volume sets.

## Get it

- **No Node.js?** Download the program for your computer from the
  [latest release](https://github.com/buggypather/rar5-ts-reader/releases/latest)
  (`rar5ls-windows-x64.exe`, `rar5ls-mac-arm64` for Apple-chip Macs, `rar5ls-mac-x64`,
  `rar5ls-linux-x64` or `rar5ls-linux-arm64`). On Windows you can drop a `.rar` file on it.
- **With Node.js 20 or later:** run it once without installing, or install it:

```sh
npx rar5ls archive.rar
npm install -g rar5ls
```

## Use

```sh
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

"Kind" says how each file is saved: `stored` files can be extracted; `m1` to `m5` are compressed
(use unrar or 7-Zip for those). Files whose names would land outside the folder (`../`, absolute
paths) are skipped, as are compressed, encrypted, split and link entries, each with a message
saying why.

The exit code is 0 when it worked, 1 for an error (or when nothing could be extracted), and 2 for
a wrong option.

## In your own code

rar5ls is built on [rar5-ts-reader](https://www.npmjs.com/package/rar5-ts-reader), the library,
for TypeScript and JavaScript in browsers and Node.

## Licence

MIT
