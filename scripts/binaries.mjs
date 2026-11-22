// Builds rar5ls as standalone programs (no Node needed) for Windows, Mac and Linux, into
// release/. Needs Bun (https://bun.sh), which compiles for every platform from any one.
// Run `npm run build` first. Used by .github/workflows/release.yml.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const targets = [
  ['bun-windows-x64', 'rar5ls-windows-x64.exe'],
  ['bun-linux-x64', 'rar5ls-linux-x64'],
  ['bun-linux-arm64', 'rar5ls-linux-arm64'],
  ['bun-darwin-arm64', 'rar5ls-mac-arm64'],
  ['bun-darwin-x64', 'rar5ls-mac-x64'],
];
const only = process.argv[2];
mkdirSync('release', { recursive: true });
for (const [target, name] of targets) {
  if (only && !target.includes(only)) continue;
  console.log(`Building ${name}`);
  execFileSync('bun', ['build', 'packages/rar5ls/src/main.ts', '--compile', '--minify', `--target=${target}`, `--outfile=release/${name}`], { stdio: 'inherit' });
}
