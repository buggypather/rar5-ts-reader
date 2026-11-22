# Changelog

## 0.2.1

- Stored-file extraction (`extractStored`, `cantExtract`, `safePath`) and the `rar5ls` command,
  which missed the 0.2.0 that went to npm.

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
