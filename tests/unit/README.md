# Update signature unit tests

Run from the repository root:

```sh
node_modules/.bin/vitest run tests/unit/windows-update-signature.test.ts
```

This checkout does not declare Vitest in `package.json` or `pnpm-lock.yaml`.
To reproduce the tests without changing either file, install the tested runner
(Vitest 5.1.0, Node 22.22.3) only under the ignored `node_modules` directory:

```sh
npm --cache node_modules/.npm-cache install --prefix node_modules/.vitest-runner --no-package-lock --ignore-scripts --no-audit --no-fund vitest@5.1.0
ln -s .vitest-runner/node_modules/vitest node_modules/vitest
ln -s ../vitest/vitest.mjs node_modules/.bin/vitest
```

The symlink commands are for an installation without those links. The separate
`vitest.config.ts` avoids the Electron startup plugin in `vite.config.ts`.
Tests stub `execFile`; they do not launch PowerShell, Electron, or a web server.
They cover the verifier installed by `configureUpdater()`, including the
Windows-only guard, timeout/process failures, invalid signatures, path handling,
and publisher matching against the installed upstream DN parser.

Real signed-installer verification and timing still need to be checked on Windows
arm64 and x64. The hook retains NsisUpdater's existing requirement for
`publisherName` in `app-update.yml`; the update-foundation smoke checks that
packaging configuration separately.
