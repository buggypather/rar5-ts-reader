# Releasing

Two packages live here: `rar5-ts-reader` (the library) and `rar5ls` (the command, which depends on
the library). Each has its own version.

## Each release

1. Raise the version in `packages/rar5-ts-reader/package.json`, `packages/rar5ls/package.json`,
   or both, and add a line to that package's `CHANGELOG.md`. If the library's version changes in a
   way rar5ls needs, raise rar5ls's `"rar5-ts-reader": "^x.y.z"` too, then run `npm install`.
2. Merge to main, then make a release on GitHub (Releases → Draft a new release → a new tag like
   `v0.3.1` → Publish).
3. GitHub then tests everything, publishes to npm each package whose version is new, and attaches
   the rar5ls programs for Windows, Mac and Linux to the release. Watch it under Actions.

## Once: let GitHub publish to npm (trusted publishing, no token)

npm can only set this up for a package that already exists, so the very first time, publish by
hand from this folder:

```sh
npm install
npm login
npm run build
npm run publish-new     # publishes whichever packages' versions aren't on npm yet
```

Then on npmjs.com, for **each** package (rar5-ts-reader and rar5ls): the package's page →
Settings → Trusted publishing → GitHub Actions, with:

- Organization or user: `buggypather`
- Repository: `rar5-ts-reader`
- Workflow filename: `release.yml`

After that, releases publish themselves; no npm password or token is stored anywhere.
