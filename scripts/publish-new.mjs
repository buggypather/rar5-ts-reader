// Publishes each package whose version isn't on npm yet (the library first, then rar5ls).
// Used by .github/workflows/release.yml; also works by hand after `npm login`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const ci = !!process.env.GITHUB_ACTIONS;
for (const dir of ['packages/rar5-ts-reader', 'packages/rar5ls']) {
  const { name, version } = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
  let published = '';
  try {
    published = execFileSync(npm, ['view', `${name}@${version}`, 'version'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
  } catch {
    // Not on npm yet (or the package doesn't exist yet).
  }
  if (published === version) {
    console.log(`${name}@${version} is already on npm; skipped.`);
    continue;
  }
  console.log(`Publishing ${name}@${version}`);
  execFileSync(npm, ['publish', '--workspace', dir, '--access', 'public', ...(ci ? ['--provenance'] : [])], { stdio: 'inherit', shell: process.platform === 'win32' });
}
