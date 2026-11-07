// 包装後の Electron の起動制限と、smoke の CI への結線を確認する。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const configPath = path.join(root, 'electron-builder.config.cjs');
const loaded = spawnSync(process.execPath, ['--input-type=module', '-e', `
  import { createRequire } from 'node:module';
  const require = createRequire(${JSON.stringify(import.meta.url)});
  const config = require(${JSON.stringify(configPath)});
  console.log(JSON.stringify({ electronFuses: config.electronFuses, asar: config.asar }));
`], {
  cwd: root,
  env: { PATH: process.env.PATH, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  encoding: 'utf8',
});
assert.equal(loaded.status, 0, `設定の読込に失敗: ${loaded.stderr}`);
const config = JSON.parse(loaded.stdout);
assert.deepEqual(config.electronFuses, {
  runAsNode: false,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
}, 'fuse は指定した 5 つの鍵と値に一致する');
assert.equal(config.asar, true, 'ASAR 限定の読込には ASAR 包装が必要');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.scripts['smoke:electron-fuses'], 'node scripts/electron-fuses-smoke.mjs');
console.log('Electron fuse: 5 つの値・ASAR 包装・smoke の結線がすべて成功');
