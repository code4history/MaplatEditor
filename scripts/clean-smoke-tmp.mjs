/**
 * `.tmp-smoke/` の中身を消す保守コマンド（`smoke:clean`）。
 *
 * smoke 試験は scripts/smoke-scratch.mjs 経由で作業フォルダを終了時に消すが、
 * 打ち切り（SIGKILL）などで消せなかった分が `.tmp-smoke/` に残ることがある。
 * その溜まった分をここでまとめて消す。消すのは `.tmp-smoke/` の中だけ。
 *
 * 使い方: node scripts/clean-smoke-tmp.mjs（または pnpm run smoke:clean）
 * 注意: smoke 試験の実行中は使わない（他プロセスの作業フォルダごと消える）。
 */
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { smokeScratchRoot } from './smoke-scratch.mjs';

const target = smokeScratchRoot;

if (path.basename(target) !== '.tmp-smoke') {
  console.error(`[clean-smoke-tmp] 対象が .tmp-smoke ではないため中止: ${target}`);
  process.exit(1);
}

let entries;
try {
  entries = await readdir(target);
} catch (e) {
  if (e.code === 'ENOENT') {
    console.log(`[clean-smoke-tmp] ${target} は存在しない（消すものなし）`);
    process.exit(0);
  }
  throw e;
}

if (entries.length === 0) {
  console.log(`[clean-smoke-tmp] ${target} は空（消すものなし）`);
  process.exit(0);
}

let bytes = 0;
async function sizeOf(p) {
  const s = await stat(p);
  if (!s.isDirectory()) return s.size;
  let total = 0;
  for (const name of await readdir(p)) total += await sizeOf(path.join(p, name));
  return total;
}

for (const name of entries) {
  const p = path.join(target, name);
  try {
    bytes += await sizeOf(p);
  } catch {
    // 見えなくなったら容積の集計だけ諦める
  }
}

for (const name of entries) {
  await rm(path.join(target, name), { recursive: true, force: true });
}

console.log(
  `[clean-smoke-tmp] ${target} の中身 ${entries.length} 件（約 ${(bytes / 1024 / 1024).toFixed(1)} MB）を消した`
);
