# Changelog

## 0.3.0

- Extracts files saved without compression (`extractStored`, checked against their CRC32), with
  `cantExtract` to say why another can't be and `safePath` to keep names inside a folder.
- New error code `unsupported`, for entries `extractStored` can't extract.
- The command is its own package now: [rar5ls](https://www.npmjs.com/package/rar5ls)
  (`npx rar5ls archive.rar`), also as downloadable programs on the GitHub releases page.

## 0.2.0

- Self-extracting archives (.exe, Windows or Linux) are found and listed (`sfxOffset`).
- `readRar5Volumes` lists a multi-volume archive as one; entries say `splitBefore` / `splitAfter`.
- New entry fields: `created`, `accessed`, `blake2sp`, `attributes`, `link` (symlinks, junctions,
  hard links, copies), `owner`, `version`, `dataOffset`. Unix times keep their milliseconds.
- New archive fields: `volumeNumber`, `locked`, `sfxOffset`.
- Header checksums are checked (`checkCrc` option); a mismatch is reported as `damaged`.
- Range readers are asked for 64 KB pieces (`chunkSize` option), so remote archives list in few
  requests.
- Tested against libarchive's real RAR 5 archives, including its deliberately broken ones.
- Ready to publish to npm (no longer marked private).

## 0.1.0

- First version: lists names, sizes, dates, CRC32s and the comment of a RAR 5 archive.
