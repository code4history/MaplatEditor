/**
 * m6-t12 (§2.3): post-build 署名後の auto-update メタデータ整合。
 *
 * eSigner による署名で Setup.exe のバイナリが変わるため、そのままだと
 *   (1) latest.yml の sha512/size 不一致 → electron-updater が更新自体に失敗する
 *   (2) .exe.blockmap が未署名バイナリ由来のまま → 差分更新が常時
 *       全量ダウンロードへフォールバックする（設計レビュー r1-m-2）
 * の2つが起きる。本スクリプトは対象ディレクトリの *.exe 全件について
 * blockmap を再生成し、latest.yml の sha512 / size / blockMapSize を書き戻す。
 *
 * 使い方: node scripts/m6-t12/resign-update-metadata.mjs <release/<version> ディレクトリ>
 * 冪等: 何度実行しても同じ結果に収束する（署名済みバイナリからの再計算のみ）。
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import yaml from 'js-yaml';

const require = createRequire(import.meta.url);
const { appBuilderPath } = require('app-builder-bin');

const dir = process.argv[2];
if (!dir || !existsSync(dir)) {
  console.error(`使い方: node scripts/m6-t12/resign-update-metadata.mjs <dir>（dir が存在しません: ${dir}）`);
  process.exit(2);
}

const sha512b64 = (file) => createHash('sha512').update(readFileSync(file)).digest('base64');

const exes = readdirSync(dir).filter((f) => f.endsWith('.exe'));
if (exes.length === 0) {
  console.error(`::error::${dir} に .exe がありません（署名対象の生成に失敗している疑い）`);
  process.exit(1);
}

// 1. blockmap 再生成（electron-builder と同じ app-builder-bin を使用）
const blockMapSizes = new Map();
for (const exe of exes) {
  const input = path.join(dir, exe);
  const output = `${input}.blockmap`;
  execFileSync(appBuilderPath, ['blockmap', '--input', input, '--output', output], { stdio: 'pipe' });
  blockMapSizes.set(exe, statSync(output).size);
  console.log(`blockmap 再生成: ${exe}.blockmap (${blockMapSizes.get(exe)} bytes)`);
}

// 2. latest.yml の sha512 / size / blockMapSize を署名済みバイナリから再計算
const latestPath = path.join(dir, 'latest.yml');
if (!existsSync(latestPath)) {
  console.error(`::error::${latestPath} がありません`);
  process.exit(1);
}
const latest = yaml.load(readFileSync(latestPath, 'utf8'));
for (const entry of latest.files ?? []) {
  const file = path.join(dir, entry.url);
  if (!existsSync(file)) {
    console.error(`::error::latest.yml の files に実在しないファイル: ${entry.url}`);
    process.exit(1);
  }
  entry.sha512 = sha512b64(file);
  entry.size = statSync(file).size;
  if ('blockMapSize' in entry && blockMapSizes.has(entry.url)) {
    entry.blockMapSize = blockMapSizes.get(entry.url);
  }
  console.log(`latest.yml 更新: ${entry.url} sha512/size${'blockMapSize' in entry ? '/blockMapSize' : ''}`);
}
// 旧 electron-updater 互換のトップレベル path/sha512
if (latest.path) {
  latest.sha512 = sha512b64(path.join(dir, latest.path));
}
writeFileSync(latestPath, yaml.dump(latest, { lineWidth: -1 }));
console.log(`latest.yml を書き戻しました（files ${latest.files?.length ?? 0} 件）`);
