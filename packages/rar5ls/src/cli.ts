// rar5ls: lists a RAR 5 archive from the command line, and extracts the files saved without
// compression. Run `rar5ls --help`.

import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cantExtract, extractStored, readRar5, readRar5Volumes, Rar5Error, safePath, type Rar5Archive, type Rar5Source } from 'rar5-ts-reader';

const HELP = `rar5ls: list what's inside a RAR 5 archive (and extract stored files)

Usage:
  rar5ls [options] archive.rar [more.part2.rar ...]

Options:
  --json          print the list as JSON
  -x, --extract   extract the files saved without compression into a folder
  -o, --out DIR   the folder to extract into (default: the archive's name)
  -h, --help      show this help

Give every part of a multi-volume archive to list it as one.
Compressed files can't be extracted yet: use unrar or 7-Zip for those.`;

export interface CliResult {
  code: number;
  out: string[];
  err: string[];
}

/** A file as a ReadRange source, reading only what's needed. */
async function fileSource(path: string): Promise<{ source: Rar5Source; close: () => Promise<void> }> {
  const handle = await open(path, 'r');
  const { size } = await handle.stat();
  return {
    source: {
      size,
      read: async (start, end) => {
        const buf = new Uint8Array(end - start);
        const { bytesRead } = await handle.read(buf, 0, buf.length, start);
        return buf.subarray(0, bytesRead);
      },
    },
    close: () => handle.close(),
  };
}

const units = ['B', 'KB', 'MB', 'GB', 'TB'];
export function humanSize(n: number): string {
  let i = 0;
  while (n >= 1024 && i < units.length - 1) (n /= 1024), i++;
  return i === 0 ? `${n} B` : `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

const date = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '');

/** The archive as a table, like `unrar l`. */
export function formatList(a: Rar5Archive): string[] {
  const rows = a.entries.map(e => {
    const kind = e.isFolder ? 'folder' : e.link ? e.link.type : e.method === 0 ? 'stored' : `m${e.method}`;
    const name = e.link ? `${e.name} -> ${e.link.target}` : e.name;
    return [e.isFolder ? '' : humanSize(e.size), date(e.modified), `${kind}${e.encrypted ? ', encrypted' : ''}`, name];
  });
  const widths = [0, 1, 2].map(i => Math.max(...rows.map(r => r[i].length), 4));
  const line = (r: string[]) => `${r[0].padStart(widths[0])}  ${r[1].padEnd(widths[1])}  ${r[2].padEnd(widths[2])}  ${r[3]}`;
  const notes = [a.solid && 'solid', a.multiVolume && 'multi-volume', a.locked && 'locked', a.hasRecovery && 'recovery record', a.sfxOffset && 'self-extracting'].filter(Boolean);
  const total = a.entries.reduce((n, e) => n + (e.isFolder ? 0 : e.size), 0);
  return [
    line(['Size', 'Modified', 'Kind', 'Name']),
    ...rows.map(line),
    `${a.entries.length} ${a.entries.length === 1 ? "entry" : "entries"}, ${humanSize(total)}${notes.length ? ` (${notes.join(', ')})` : ''}`,
    ...(a.comment ? ['', 'Comment:', a.comment] : []),
  ];
}

/** Runs the command with these arguments (without "node rar5ls"). */
export async function run(args: string[]): Promise<CliResult> {
  const out: string[] = [];
  const err: string[] = [];
  let json = false;
  let extract = false;
  let outDir: string | undefined;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') return { code: 0, out: [HELP], err };
    else if (a === '--json') json = true;
    else if (a === '-x' || a === '--extract') extract = true;
    else if (a === '-o' || a === '--out') outDir = args[++i];
    else if (a.startsWith('-')) return { code: 2, out, err: [`Unknown option ${a}`, '', HELP] };
    else files.push(a);
  }
  if (!files.length) return { code: 2, out, err: [HELP] };

  const opened: Awaited<ReturnType<typeof fileSource>>[] = [];
  try {
    for (const f of files) {
      try {
        opened.push(await fileSource(f));
      } catch (e) {
        err.push(`Can’t open ${f}: ${(e as { code?: string }).code === 'ENOENT' ? 'no such file' : String(e)}`);
        return { code: 1, out, err };
      }
    }
    const archive = files.length > 1 ? await readRar5Volumes(opened.map(o => o.source)) : await readRar5(opened[0].source);
    if (json) out.push(JSON.stringify(archive, null, 2));
    else out.push(...formatList(archive));
    if (!extract) return { code: 0, out, err };

    if (files.length > 1) {
      err.push('Extracting from multi-volume archives isn’t supported yet.');
      return { code: 1, out, err };
    }
    const dir = outDir ?? files[0].replace(/(\.part0*1)?\.(rar|exe)$/i, '') + '_files';
    let written = 0;
    let skipped = 0;
    for (const e of archive.entries) {
      let rel = safePath(e.name);
      if (!rel) {
        err.push(`Skipped ${e.name}: its name points outside the folder.`);
        skipped++;
        continue;
      }
      if (process.platform === 'win32') rel = rel.replace(/[:*?"<>|]/g, '_');
      const target = join(dir, rel);
      if (e.isFolder) {
        await mkdir(target, { recursive: true });
        continue;
      }
      const why = cantExtract(e);
      if (why) {
        err.push(`Skipped ${e.name}: ${why}`);
        skipped++;
        continue;
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await extractStored(opened[0].source, e));
      written++;
    }
    out.push('', `Extracted ${written} file${written === 1 ? '' : 's'} to ${dir}${skipped ? `; skipped ${skipped}` : ''}.`);
    return { code: skipped && !written ? 1 : 0, out, err };
  } catch (e) {
    err.push(e instanceof Rar5Error ? `${files.join(', ')}: ${e.message}` : String(e));
    return { code: 1, out, err };
  } finally {
    await Promise.all(opened.map(o => o.close()));
  }
}
