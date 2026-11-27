/**
 * `.tmp-smoke/` の中身を消す保守コマンド（`smoke:clean`）。
 *
 * smoke 試験は scripts/smoke-scratch.mjs 経由で作業フォルダを終了時に消すが、
 * 打ち切り（SIGKILL）などで消せなかった分が `.tmp-smoke/` に残ることがある。
 * その溜まった分をここでまとめて消す。消すのは `.tmp-smoke/` の中だけで、
 * symlink は中へたどらない（外を指すリンク・循環リンクがあっても外を消さない・終わる）。
 *
 * 使い方: node scripts/clean-smoke-tmp.mjs（または pnpm run smoke:clean）
 * 注意: smoke 試験の実行中は使わない（他プロセスの作業フォルダごと消える）。
 */
import { lstat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { smokeScratchRoot } from './smoke-scratch.mjs';

const target = smokeScratchRoot;

if (path.basename(target) !== '.tmp-smoke') {
  console.error(`[clean-smoke-tmp] 対象が .tmp-smoke ではないため中止: ${target}`);
  process.exit(1);
}

// .tmp-smoke 自体が symlink やディレクトリ以外なら、リンク越しに消さないために何もせず止まる
let rootStat;
try {
  rootStat = await lstat(target);
} catch (e) {
  if (e.code === 'ENOENT') {
    console.log(`[clean-smoke-tmp] ${target} は存在しない（消すものなし）`);
    process.exit(0);
  }
  throw e;
}
if (!rootStat.isDirectory()) {
  console.error(`[clean-smoke-tmp] ${target} がディレクトリではない（symlink 等）ため何もせず止まる`);
  process.exit(1);
}

const entries = await readdir(target);
if (entries.length === 0) {
  console.log(`[clean-smoke-tmp] ${target} は空（消すものなし）`);
  process.exit(0);
}

// lstat で数える。symlink は中へたどらずリンク自体の大きさだけ数える（循環しても終わる）
async function sizeOf(p) {
  const s = await lstat(p);
  if (s.isSymbolicLink() || !s.isDirectory()) return s.size;
  let total = 0;
  for (const name of await readdir(p)) total += await sizeOf(path.join(p, name));
  return total;
}

let bytes = 0;
for (const name of entries) {
  try {
    bytes += await sizeOf(path.join(target, name));
  } catch {
    // 見えなくなったら容積の集計だけ諦める
  }
}

// rm は symlink を中へたどらないため、外を指すリンク・循環リンクもリンクだけが消える
for (const name of entries) {
  await rm(path.join(target, name), { recursive: true, force: true });
}

console.log(
  `[clean-smoke-tmp] ${target} の中身 ${entries.length} 件（約 ${(bytes / 1024 / 1024).toFixed(1)} MB）を消した`
);
