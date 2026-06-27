import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

const requiredFiles = [
  'electrobun.config.ts',
  'electrobun/bun/index.ts',
  'electrobun/bun/m2-smoke.ts',
  'electrobun/shared/rpc.ts',
  'electrobun/view/index.html',
  'electrobun/view/index.ts',
  'dist/index.html',
];

for (const file of requiredFiles) {
  await access(path.join(projectRoot, file));
}

const config = await readFile(path.join(projectRoot, 'electrobun.config.ts'), 'utf8');
assert.match(config, /entrypoint: 'electrobun\/bun\/index\.ts'/);
assert.match(config, /views:\/\/maplat-editor\/index\.html/);
assert.match(config, /artifactFolder: 'artifacts-electrobun'/);

const rpcTypes = await readFile(path.join(projectRoot, 'electrobun/shared/rpc.ts'), 'utf8');
assert.match(rpcTypes, /type M2ElectrobunRPC/);
assert.match(rpcTypes, /storageSaveMock/);
assert.match(rpcTypes, /writeTextFile/);

const { stdout, stderr } = await execFileAsync('bun', ['electrobun/bun/m2-smoke.ts'], {
  cwd: projectRoot,
  timeout: 20000,
});

process.stdout.write(stdout);
process.stderr.write(stderr);
assert.match(stdout, /M2 Electrobun PoC core smoke passed/);
