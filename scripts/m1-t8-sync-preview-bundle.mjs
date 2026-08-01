/**
 * m1-t8: preview viewer bundle の同期スクリプト
 *
 * `node_modules/@maplat/ui/dist`（= Maplat submodule の dist）から
 * `public/preview/` へ4項目を同一ビルド由来でコピーする。
 *
 * 契約:
 *  - 鮮度ガード: コピー元に heightGetter が残っていれば同期を拒否して非ゼロ終了する
 *  - 冪等性: 2回実行しても差分が出ない
 *  - 自己検査: コピー後に MD5 一致を確認し、不一致なら非ゼロ終了する
 *  - 来歴出力: 由来の Maplat commit・実行日時を標準出力へ出す
 *
 * 使い方:
 *   node scripts/m1-t8-sync-preview-bundle.mjs
 */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const srcDir = path.join(projectRoot, "node_modules/@maplat/ui/dist");
const dstDir = path.join(projectRoot, "public/preview");

// 同期対象ファイル（srcDir からの相対パス）
const FILES = ["maplat_ui.umd.js", "maplat_ui.css", "service-worker.js"];

// locales の srcDir 側パス（assets/locales → public/preview/locales へ変換）
const LOCALES_SRC_DIR = path.join(srcDir, "assets", "locales");
const LOCALES_DST_DIR = path.join(dstDir, "locales");

async function md5(filePath) {
  const buf = await readFile(filePath);
  return crypto.createHash("md5").update(buf).digest("hex");
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyFile(src, dst) {
  const buf = await readFile(src);
  await writeFile(dst, buf);
}

async function copyDir(srcDir, dstDir) {
  await mkdir(dstDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, dstPath);
    } else {
      await copyFile(srcPath, dstPath);
    }
  }
}

// ── 鮮度ガード ──────────────────────────────────────────────
console.log("🔍 鮮度ガード: コピー元に heightGetter が残っていないか確認...");
const srcUmd = path.join(srcDir, "maplat_ui.umd.js");
const srcUmdContent = await readFile(srcUmd, "utf8");
const heightGetterCount = (srcUmdContent.match(/heightGetter/g) ?? []).length;
assert.equal(
  heightGetterCount,
  0,
  `[鮮度ガード失敗] コピー元（node_modules/@maplat/ui/dist/maplat_ui.umd.js）に heightGetter が ${heightGetterCount} 件残っています。\n` +
    `  これは m1-t5-hotfix-1（dist 再生成）が完了していないことを意味します。\n` +
    `  注意: node_modules/@maplat/ui が workspace の symlink ではなく registry の公開版（0.12.2）に\n` +
    `  解決されている場合、m9 の publish まで必ず失敗します。単独 clone 環境ではこの状態が継続します。`
);
console.log("✅ 鮮度ガード PASS: heightGetter は 0 件");

// ── 由来情報の取得 ───────────────────────────────────────────
// node_modules/@maplat/ui は workspace では Maplat submodule への symlink。
// 由来は symlink 先の実体（Maplat submodule の HEAD）とする。
let maplatCommit = "unknown";
try {
  const maplatDir = path.resolve(projectRoot, "..", "Maplat");
  maplatCommit = execSync("git rev-parse HEAD", { cwd: maplatDir })
    .toString()
    .trim();
} catch {
  // 由来が取得できない場合は "unknown" のまま
}
const executedAt = new Date().toISOString();

// ── 同期処理 ────────────────────────────────────────────────
console.log(`\n📦 同期開始: ${srcDir} → ${dstDir}`);
console.log(`   由来 Maplat commit: ${maplatCommit}`);
console.log(`   実行日時: ${executedAt}`);

// ファイルのコピー（MD5 一致ならスキップ）
for (const file of FILES) {
  const srcPath = path.join(srcDir, file);
  const dstPath = path.join(dstDir, file);

  if (!(await fileExists(srcPath))) {
    throw new Error(`コピー元が存在しません: ${srcPath}`);
  }

  const srcMd5 = await md5(srcPath);
  const dstExists = await fileExists(dstPath);
  let dstMd5 = null;
  if (dstExists) {
    dstMd5 = await md5(dstPath);
  }

  if (dstExists && srcMd5 === dstMd5) {
    console.log(`   ✅ ${file}: MD5 一致（スキップ）`);
  } else {
    await copyFile(srcPath, dstPath);
    const newDstMd5 = await md5(dstPath);
    assert.equal(
      newDstMd5,
      srcMd5,
      `コピー後 MD5 不一致: ${file}（コピー元=${srcMd5}, コピー先=${newDstMd5}）`
    );
    console.log(`   📄 ${file}: コピー完了（MD5=${srcMd5.slice(0, 12)}…）`);
  }
}

// locales のコピー（assets/locales → locales へ階層変換）
if (await fileExists(LOCALES_SRC_DIR)) {
  // 既存 locales ディレクトリのクリーンアップ（冪等性のため）
  if (await fileExists(LOCALES_DST_DIR)) {
    await rm(LOCALES_DST_DIR, { recursive: true, force: true });
  }
  await copyDir(LOCALES_SRC_DIR, LOCALES_DST_DIR);
  console.log(`   📄 locales/: コピー完了（assets/locales → locales）`);
} else {
  throw new Error(`コピー元 locales ディレクトリが存在しません: ${LOCALES_SRC_DIR}`);
}

// ── 自己検査 ────────────────────────────────────────────────
console.log("\n🔍 自己検査: コピー後の MD5 一致を確認...");
for (const file of FILES) {
  const srcPath = path.join(srcDir, file);
  const dstPath = path.join(dstDir, file);
  const srcMd5 = await md5(srcPath);
  const dstMd5 = await md5(dstPath);
  assert.equal(
    srcMd5,
    dstMd5,
    `自己検査失敗: ${file}（コピー元=${srcMd5}, コピー先=${dstMd5}）`
  );
  console.log(`   ✅ ${file}: MD5 一致（${srcMd5.slice(0, 12)}…）`);
}

// locales のファイル単位で全数比較
const srcLocales = await readdir(LOCALES_SRC_DIR, { withFileTypes: true });
for (const entry of srcLocales) {
  if (entry.isFile()) {
    const srcPath = path.join(LOCALES_SRC_DIR, entry.name);
    const dstPath = path.join(LOCALES_DST_DIR, entry.name);
    const srcMd5 = await md5(srcPath);
    const dstMd5 = await md5(dstPath);
    assert.equal(
      srcMd5,
      dstMd5,
      `自己検査失敗: locales/${entry.name}（コピー元=${srcMd5}, コピー先=${dstMd5}）`
    );
  }
}
console.log(`   ✅ locales/: 全ファイル MD5 一致`);

console.log(`\n✅ 同期完了: ${FILES.length} ファイル + locales を同期しました`);
console.log(`   由来: Maplat commit ${maplatCommit}`);
console.log(`   実行日時: ${executedAt}`);
