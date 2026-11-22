#!/usr/bin/env node
// The rar5ls command: runs cli.ts's run() with the command line's arguments.
import { createInterface } from 'node:readline/promises';
import { run } from './cli.js';

const result = await run(process.argv.slice(2));
if (result.out.length) console.log(result.out.join('\n'));
if (result.err.length) console.error(result.err.join('\n'));
process.exitCode = result.code;

// The downloadable Windows program, opened by double-clicking it or dropping a .rar on it, gets a
// window that would close at once: keep it open until Enter. (Not in cmd.exe, which sets PROMPT,
// nor when the output goes to a file or another program.)
const fromExplorer = process.platform === 'win32' && !!process.versions.bun && process.stdin.isTTY && process.stdout.isTTY && !process.env.PROMPT;
if (fromExplorer) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('\nPress Enter to close.');
  rl.close();
}
