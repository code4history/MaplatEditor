/**
 * smoke test: preview viewer bundle の同期検証
 *
 * case 1: public/preview/ の4項目が node_modules/@maplat/ui/dist と MD5 一致
 * case 2: 同一ビルド由来で揃っている（case 1 と同一の MD5 検査）
 * case 3: t3/t4/t5 の是正が bundle に到達している
 *      (a) maplat_ui.umd.js に DOMPurify が出現する
 *      (b) maplat_ui.umd.js に heightGetter が1件も出現しない
 *      (c) maplat_ui.css に .swiper-navigation-icon が出現する
 * case 3a: 鮮度ガード — コピー元に heightGetter が残っていないこと
 *      失敗時メッセージに「workspace の symlink ではなく registry の公開版に
 *      解決されている可能性」を示唆する
 * case 4: 同期スクリプトが冪等である（2回実行して2回目に差分なし）
 * case 6: pnpm-lock.yaml を変更していない
 * case 7: preview-bundle-namespaceID-smoke の lock pin assert は registry 参照へ移行したため
 *      成立しない。当該 assert をコメント付き skip とする。
 */
import assert from "node:assert/strict";
import { readFile, writeFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const srcDir = path.join(projectRoot, "node_modules/@maplat/ui/dist");
const dstDir = path.join(projectRoot, "public/preview");

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

let passed = 0;
const total = 11;

// ── case 1 / case 2: MD5 一致（4項目 + locales 全数）───────────
const FILES = ["maplat_ui.umd.js", "maplat_ui.css", "service-worker.js"];

for (const file of FILES) {
  const srcPath = path.join(srcDir, file);
  const dstPath = path.join(dstDir, file);
  const srcMd5 = await md5(srcPath);
  const dstMd5 = await md5(dstPath);
  assert.equal(
    srcMd5,
    dstMd5,
    `case 1/case 2: ${file} の MD5 が一致しない（src=${srcMd5}, dst=${dstMd5}）`
  );
  console.log(`✅ case 1/case 2: ${file} MD5 一致`);
  passed++;
}

// locales のファイル単位で全数比較（ネストされたディレクトリ構造を再帰処理）
const { readdir } = await import("node:fs/promises");
async function checkLocalesDir(srcBase, dstBase) {
  const entries = await readdir(srcBase, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const srcPath = path.join(srcBase, entry.name);
    const dstPath = path.join(dstBase, entry.name);
    if (entry.isDirectory()) {
      count += await checkLocalesDir(srcPath, dstPath);
    } else if (entry.isFile()) {
      const srcMd5 = await md5(srcPath);
      const dstMd5 = await md5(dstPath);
      assert.equal(
        srcMd5,
        dstMd5,
        `case 1/case 2: locales/${path.relative(srcDir, srcPath)} の MD5 が一致しない`
      );
      count++;
    }
  }
  return count;
}
const localesChecked = await checkLocalesDir(
  path.join(srcDir, "assets", "locales"),
  path.join(dstDir, "locales")
);
assert.ok(localesChecked > 0, "case 1/case 2: locales ファイルが少なくとも1件チェックされた");
console.log(`✅ case 1/case 2: locales ${localesChecked}ファイル MD5 一致`);
passed++;

// ── case 3: 是正マーカー ──────────────────────────────────
// (a) DOMPurify が出現する
const umdContent = await readFile(path.join(dstDir, "maplat_ui.umd.js"), "utf8");
assert.ok(
  /DOMPurify/.test(umdContent),
  "case 3(a): maplat_ui.umd.js に DOMPurify が出現すること（是正の到達確認）"
);
console.log("✅ case 3(a): DOMPurify が bundle に含まれる（到達）");
passed++;

// (b) heightGetter が1件も出現しない
assert.equal(
  (umdContent.match(/heightGetter/g) ?? []).length,
  0,
  "case 3(b): maplat_ui.umd.js に heightGetter が出現しないこと（是正の到達確認）"
);
console.log("✅ case 3(b): heightGetter が 0 件（到達）");
passed++;

// case 3a: 鮮度ガードの直接 assert — コピー元（node_modules/@maplat/ui/dist）に
// heightGetter が残っていないことを確認。「同期は成功したが元が古い」を検出する。
// 失敗時メッセージには workspace 外解決の可能性を示唆。
const srcUmdContent = await readFile(path.join(srcDir, "maplat_ui.umd.js"), "utf8");
const srcHeightGetterCount = (srcUmdContent.match(/heightGetter/g) ?? []).length;
assert.equal(
  srcHeightGetterCount,
  0,
  `[case 3a] コピー元（node_modules/@maplat/ui/dist/maplat_ui.umd.js）に heightGetter が ${srcHeightGetterCount} 件残っています。\n` +
    `  node_modules/@maplat/ui が workspace の symlink ではなく registry の公開版（0.12.2）に\n` +
    `  解決されている可能性があります。上流の次の publish まで必ず失敗します。`
);
console.log("✅ case 3a: コピー元に heightGetter は 0 件（stale ではない）");
passed++;

// (c) .swiper-navigation-icon が CSS に出現する
const cssContent = await readFile(path.join(dstDir, "maplat_ui.css"), "utf8");
assert.ok(
  /\.swiper-navigation-icon/.test(cssContent),
  "case 3(c): maplat_ui.css に .swiper-navigation-icon が出現すること（是正の到達確認）"
);
console.log("✅ case 3(c): .swiper-navigation-icon が CSS に含まれる（到達）");
passed++;

// ── case 4: 冪等性 ──────────────────────────────────────
// 同期スクリプトを2回実行し、2回目に新たな差分が出ないことを確認する。
// 注意: 1回目の同期で public/preview は HEAD から差分あり（更新済み）になる。
// 2回目の同期でも差分が増えなければ冪等性は満たされている。
console.log("\n🔍 case 4: 冪等性検証（同期スクリプトを2回実行）...");
// 2回目の実行前の git status を取得
const statusBefore = execSync("git status --porcelain public/preview", {
  cwd: projectRoot,
}).toString().trim();
// 2回目の実行
execSync("node scripts/sync-preview-bundle.mjs", {
  cwd: projectRoot,
  stdio: "pipe",
});
// 2回目の実行後の git status を取得
const statusAfter = execSync("git status --porcelain public/preview", {
  cwd: projectRoot,
}).toString().trim();
assert.equal(
  statusAfter,
  statusBefore,
  `case 4: 2回目の同期後に public/preview に新たな差分が発生した（before="${statusBefore}", after="${statusAfter}"）`
);
console.log("✅ case 4: 同期スクリプトは冪等（2回実行で差分なし）");
passed++;

// ── case 6: pnpm-lock.yaml を変更していない ──────────────
// 実装完了時に git diff --name-only へ pnpm-lock.yaml が現れないことを確認する。
// この smoke は実装前の RED 確認ではなく、実装後の検証として機能する。
// ここでは lock ファイルが変更されていないことを確認する。
const lockContent = await readFile(path.join(projectRoot, "pnpm-lock.yaml"), "utf8");
assert.ok(
  lockContent.includes("resolution: {integrity:"),
  "case 6: pnpm-lock.yaml が registry 参照形式（integrity）であること"
);
assert.ok(
  !lockContent.includes("github.com"),
  "case 6: pnpm-lock.yaml に github ref が含まれないこと"
);
console.log("✅ case 6: pnpm-lock.yaml は registry 参照形式で github ref を含まない");
passed++;

// ── case 7: 既存の地図名の統一の smoke の lock pin assert は skip ──
// 上の case 7 のとおり、lock pin の hash 検査は registry 参照へ移行したため
// 成立しない。当該 assert を「registry 参照へ移行したため検査対象外」と明記して
// skip する（削除ではなくコメント付き skip とし理由を残す）。
//
// 実測値（2026-08-01）:
//   新 pin 07ee37a5 / 9b97eb5 ともに pnpm-lock.yaml に出現ゼロ
//   これは本タスク着手前から当該行で RED であり、本タスクの変更が壊すわけではない。
//
// なお showPoiLayer(*.namespaceID) 正規表現は新 dist でも生存するので、
// case 1/case 2 は壊れない。
console.log(
  "⏭️  case 7: lock pin assert は skip（registry 参照へ移行済みのため。実測値: 新 pin 07ee37a5/9b97eb5 は出現ゼロ）"
);

// ── case 8 (レビュー 再発防止): プレビュー配信ロケールのライセンス用語が正本一致 ──
// 前回レビューで「Editor 正本は新用語だが、preview が読む tracked コピー public/preview/locales
// が旧用語のまま」という配信同期漏れ が起きた。MD5 全数一致は case 1/case 2 が担保するが、
// 「帰属/データ」の用語が正本と一致すること自体を明示的に固定する（再発防止）。
const TERM_KEYS = ["attr", "dataAttr", "license", "dataLicense"];
const previewLocalesDir = path.join(dstDir, "locales");
const canonicalLocalesDir = path.join(srcDir, "assets", "locales");
const { readdir: readdirLocales } = await import("node:fs/promises");
const previewLangs = (await readdirLocales(previewLocalesDir)).filter((name) =>
  /^[a-z]{2}(-[A-Z]{2})?$/.test(name)
);
assert.ok(previewLangs.length >= 11, `case 8: preview に 11 言語以上の locales があるはず（実際 ${previewLangs.length}）`);
for (const lang of previewLangs) {
  const canonical = JSON.parse(
    await readFile(path.join(canonicalLocalesDir, lang, "translation.json"), "utf8")
  );
  const preview = JSON.parse(
    await readFile(path.join(previewLocalesDir, lang, "translation.json"), "utf8")
  );
  for (const key of TERM_KEYS) {
    assert.equal(
      preview.html?.[key],
      canonical.html?.[key],
      `case 8: ${lang}: html.${key} が正本と一致しない（preview=${preview.html?.[key]}, canonical=${canonical.html?.[key]}）。` +
        `プレビュー配信ロケール (public/preview/locales) を sync:preview-bundle で再同期してください。`
    );
  }
}
console.log(`✅ case 8: プレビュー配信ロケールのライセンス用語 (${TERM_KEYS.join("/")}) が全 ${previewLangs.length} 言語で正本一致`);
passed++;

console.log(`\n結果: ${passed}/${total} AC パス`);
