/**
 * m6-t6 hotfix H-A: 出荷成果物バンドル鮮度ガード smoke
 *
 * 実装レビュー round2 で H-A が再オープンされた原因は、MaplatCore/src の修正が
 * 出荷成果物（プレビュー/書き出しが実際に読み込む @maplat/ui 同梱 UMD バンドル）へ
 * 届いていなかったこと。伝播鎖の各ホップに同じ手法（scripts/m19-t1-preview-bundle-
 * namespaceID-smoke.mjs の「出荷バンドルを修正シグネチャで grep する」手法）を適用し、
 * 全ホップで修正が到達していることを固定する。
 *
 * 修正シグネチャについて: MaplatCore/src/source_ex.ts に追加した isProviderMapType は
 * ローカル定数関数のため、各リポジトリの build（minify）で識別子が変わる
 * （実測: MaplatCore単体ビルドでは `Vs`、Maplat 経由の再ビルドでは `n1` 等、識別子は
 * ビルドのたびに変わり得る）。そのため関数名の literal grep ではなく、URL 自動補完の
 * ガード節という *構造* を identifier-agnostic な正規表現で検出する:
 *   /&&\s*!\w+\(\w+\.maptype\)\s*&&\s*\(\w+\.url\s*=/
 * この正規表現は、ガード対象の2箇所（WMTS 分岐×2）でのみ一致し、ガード対象外の
 * 3箇所目（genuine maplat map 用の自動補完）では一致しない（識別子非依存で確認済み）。
 * 実装レビュー round3 Minor M-1: 当初 `\s*` を含めず minify（空白除去）済み UMD しか
 * 想定していなかったため、空白を保持する ESM ビルド（`dist/maplat_core.js`）を検査できて
 * いなかった。`\s*` を演算子の前後へ足し、UMD/ESM いずれの空白有無でも一致するよう強化した
 * （UMD/ESM 両方で2件一致することを実測確認済み）。
 *
 * AC1: MaplatCore/dist/maplat_core.umd.js に signature が2箇所
 * AC2: node_modules/@maplat/ui/dist/maplat_ui.umd.js に signature が2箇所
 * AC3: public/preview/maplat_ui.umd.js に signature が2箇所
 * AC4: dist/preview/maplat_ui.umd.js に signature が2箇所（pnpm build 成果物）
 * AC5: MaplatCore/dist/maplat_core.js（ESM・空白保持ビルド）に signature が2箇所
 *      （round3 M-1 是正 — 当初 UMD のみ検査していた）
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);

const GUARD_SIGNATURE = /&&\s*!\w+\(\w+\.maptype\)\s*&&\s*\(\w+\.url\s*=/g;
const EXPECTED_COUNT = 2;

async function grepCount(filePath) {
  const content = await readFile(filePath, "utf8");
  const matches = content.match(GUARD_SIGNATURE);
  return matches ? matches.length : 0;
}

let passed = 0;
const checks = [
  {
    id: "AC1",
    label: "MaplatCore/dist/maplat_core.umd.js",
    filePath: path.join(projectRoot, "../MaplatCore/dist/maplat_core.umd.js"),
  },
  {
    id: "AC2",
    label: "node_modules/@maplat/ui/dist/maplat_ui.umd.js",
    filePath: path.join(projectRoot, "node_modules/@maplat/ui/dist/maplat_ui.umd.js"),
  },
  {
    id: "AC3",
    label: "public/preview/maplat_ui.umd.js",
    filePath: path.join(projectRoot, "public/preview/maplat_ui.umd.js"),
  },
  {
    id: "AC4",
    label: "dist/preview/maplat_ui.umd.js（pnpm build 成果物。ビルド未実行だと存在しない）",
    filePath: path.join(projectRoot, "dist/preview/maplat_ui.umd.js"),
  },
  {
    id: "AC5",
    label: "MaplatCore/dist/maplat_core.js（ESM・空白保持ビルド）",
    filePath: path.join(projectRoot, "../MaplatCore/dist/maplat_core.js"),
  },
];

for (const check of checks) {
  const count = await grepCount(check.filePath);
  assert.equal(
    count,
    EXPECTED_COUNT,
    `[${check.id}] ${check.label} の guard signature 出現数が ${EXPECTED_COUNT} ではありません（実測: ${count}）。\n` +
      `  0件の場合、この階層で H-A の修正が欠落しています（MaplatCore build → Maplat build →\n` +
      `  pnpm install（workspace symlink 解決）→ scripts/m1-t8-sync-preview-bundle.mjs → pnpm build\n` +
      `  の該当ステップを再実行してください）。ファイルが存在しない場合は、対象リポジトリで\n` +
      `  pnpm build が未実行、または対象リポジトリ（Maplat 等）が本 worktree に未チェックアウトです。`,
  );
  console.log(`✅ ${check.id}: ${check.label} に guard signature が${EXPECTED_COUNT}箇所（H-A 到達確認）`);
  passed++;
}

console.log(`\n結果: ${passed}/${checks.length} AC パス`);
