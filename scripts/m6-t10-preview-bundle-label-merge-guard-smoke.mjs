/**
 * m6-t10 (AC26): 出荷成果物バンドル鮮度ガード smoke
 *
 * 設計 §3.10 / 設計レビュー round2 r2-M-1 の対応。
 *
 * §3.5.2 の修正（`source_ex.ts:125` が `label: undefined` を実体化しないようにする）は
 * MaplatCore/src に入るが、プレビューと書き出しが実際に読み込む viewer は src ではない:
 *
 *   MaplatCore/src → MaplatCore/dist → Maplat/dist(@maplat/ui) → public/preview → dist/preview
 *
 * src だけ直して dist を再生成し忘れると、E2E と人間検証が **欠陥入りの旧バンドル**で走り、
 * 修正そのものが検証をすり抜ける（m6-t6 H-A で実装レビューが再オープンした事故と同型）。
 * ∴ 伝搬鎖の全ホップに修正が到達していることを固定する。
 *
 * 修正シグネチャについて（m6-t6 の知見を踏襲）:
 * ローカル変数はビルドのたび minify で識別子が変わる（実測: ESM は `e`、UMD も `e` だが
 * 保証は無い）。∴ 変数名の literal grep ではなく、**構造**を identifier-agnostic な
 * 正規表現で検出する:
 *   <v> = <o>.label || <o>.year ; if ( <v> !== void 0 && ( <o>.label = <v> ) )
 * `\s*` を演算子の前後へ入れることで、空白を除去する UMD と保持する ESM の**両方**に
 * 一致させる（m6-t6 実装レビュー round3 Minor M-1: `\s*` を欠いて ESM を検査できて
 * いなかった前例がある）。
 *
 * AC26-1: MaplatCore/dist/maplat_core.umd.js
 * AC26-2: MaplatCore/dist/maplat_core.js（ESM・空白保持ビルド）
 * AC26-3: node_modules/@maplat/ui/dist/maplat_ui.umd.js
 * AC26-4: public/preview/maplat_ui.umd.js
 * AC26-5: dist/preview/maplat_ui.umd.js（pnpm build 成果物。未ビルドならスキップし理由を出す）
 *
 * NOTE (rule-0006): AC26-3 は node_modules/@maplat/ui の **実体**を読む。partial-submodule
 * worktree では registry の公開版へ解決され得るため、失敗しても原因調査へ入らず
 * rule-0006 の手順（マージ後に root で実走して確定）に従うこと。
 */
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);

// <v> = <o>.label || <o>.year ; if ( <v> !== void 0 && ( <o>.label = <v> ) )
const SIGNATURE =
  /\w+\s*=\s*\w+\.label\s*\|\|\s*\w+\.year\s*;\s*if\s*\(\s*\w+\s*!==\s*void 0\s*&&\s*\(\s*\w+\.label\s*=\s*\w+\s*\)/;

// NOTE: 「修正前の形が残っていないこと」を追加で検査することは**できない**。
// 設計 §3.5.2 のとおり `source_ex.ts:189`（settingFile 読み込み後のフォールバック）は
// 意図的に修正していないため、`X.label = X.label || Y.year` という旧形と同型のコードは
// 修正後のバンドルにも正当に残る。∴ 否定形の検査は判別力を持たず、書けば必ず誤検出する。
// 上の SIGNATURE（正の検査）だけで必要十分である — 実測で、修正前のバンドル
// （HEAD~1 の MaplatCore/dist）には SIGNATURE が **一致しない**ことを確認済み。

const HOPS = [
  { ac: "AC26-1", rel: "../MaplatCore/dist/maplat_core.umd.js", required: true },
  { ac: "AC26-2", rel: "../MaplatCore/dist/maplat_core.js", required: true },
  { ac: "AC26-3", rel: "node_modules/@maplat/ui/dist/maplat_ui.umd.js", required: true },
  { ac: "AC26-4", rel: "public/preview/maplat_ui.umd.js", required: true },
  { ac: "AC26-5", rel: "dist/preview/maplat_ui.umd.js", required: false },
];

let checked = 0;
let skipped = 0;

for (const hop of HOPS) {
  const file = path.resolve(projectRoot, hop.rel);
  try {
    await access(file);
  } catch {
    if (hop.required) {
      throw new Error(
        `${hop.ac}: 検査対象が存在しません: ${hop.rel}\n` +
          `  伝搬鎖の再生成が必要です（設計 §3.10）:\n` +
          `    pnpm -C ../MaplatCore run build && pnpm -C ../Maplat run build && pnpm run sync:preview-bundle`,
      );
    }
    console.log(`skip: ${hop.ac} ${hop.rel}（未ビルド。pnpm build 後に再実行すると検査される）`);
    skipped++;
    continue;
  }
  const source = await readFile(file, "utf8");
  assert.ok(
    SIGNATURE.test(source),
    `${hop.ac}: ${hop.rel} に m6-t10 の label マージ修正が到達していません。\n` +
      `  伝搬鎖の再生成が必要です（設計 §3.10）。src だけ直しても E2E と人間検証は\n` +
      `  旧バンドルで走ります（m6-t6 H-A と同型の事故）。`,
  );
  console.log(`ok: ${hop.ac} ${hop.rel}`);
  checked++;
}

console.log(`\nm6-t10 preview-bundle label-merge guard: ${checked} ホップ検査 / ${skipped} スキップ`);
