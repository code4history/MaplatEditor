// 製品に入る依存（package.json の dependencies）に、開発の道具だけが使う
// パッケージが紛れ込んでいないことを確かめる smoke。
//
// electron-builder は dependencies を app.asar に詰める。pwa-asset-generator は
// スプラッシュ画面の端末一覧を作る開発用のスクリプト（scripts/generate-pwa-splash-devices.mjs）
// だけが使い、puppeteer-core（ブラウザの自動操作）を連れてくる。実行時に要らないものを
// 製品に入れないため、次を断言する。
//   1. dependencies に pwa-asset-generator・puppeteer-core・puppeteer が無い
//   2. pwa-asset-generator は devDependencies にある（開発用スクリプトが動く）
//   3. electron/・src/ のコードが pwa-asset-generator・puppeteer を import / require しない
//
// 使い方: node scripts/runtime-deps-contract-smoke.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

const DEV_ONLY = ['pwa-asset-generator', 'puppeteer-core', 'puppeteer'];
const dependencies = pkg.dependencies ?? {};
const devDependencies = pkg.devDependencies ?? {};

const leaked = DEV_ONLY.filter((name) => Object.hasOwn(dependencies, name));
assert.deepEqual(leaked, [], '製品の依存に開発用のパッケージがある: ' + leaked.join(', '));
assert.ok(
  Object.hasOwn(devDependencies, 'pwa-asset-generator'),
  'pwa-asset-generator が devDependencies に無い（開発用スクリプトが動かない）',
);

// 実行時のコードからの読み込みが無いこと（コメントの言及は数えない）
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.vue']);
const IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"](pwa-asset-generator|puppeteer(?:-core)?)(?:\/[^'"]*)?['"]/;

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (SOURCE_EXT.has(path.extname(entry.name))) out.push(full);
  }
  return out;
};

const offenders = [];
let scanned = 0;
for (const sub of ['electron', 'src']) {
  for (const file of walk(path.join(projectRoot, sub))) {
    scanned += 1;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (IMPORT_RE.test(line)) offenders.push(`${path.relative(projectRoot, file)}:${i + 1}`);
    });
  }
}
assert.ok(scanned > 0, 'electron/・src/ のファイルを 1 件も読めていない');
assert.deepEqual(offenders, [], '実行時のコードが開発用のパッケージを読み込んでいる: ' + offenders.join(', '));

// 正規表現が実際の書き方を拾えることを確かめる（拾えないまま緑にならないように）
for (const sample of [
  "import { generateImages } from 'pwa-asset-generator';",
  'const p = require("puppeteer-core");',
  "await import('puppeteer/lib/cjs')",
]) {
  assert.ok(IMPORT_RE.test(sample), '読み込みの書き方を拾えない: ' + sample);
}
assert.ok(!IMPORT_RE.test('// pwa-asset-generator は favicon を PNG でしか出力しない'), 'コメントを読み込みと誤認した');

console.log(`runtime-deps-contract: ok（dependencies ${Object.keys(dependencies).length} 件・読んだファイル ${scanned} 件）`);
