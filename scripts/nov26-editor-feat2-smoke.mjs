// nov26-editor-feat2 smoke: 画像を指定した直後の一次表示と Undo/Redo 追随のソース契約。
// 設計書 `.nayuta/2026-10-21-nov26-editor-feat2-design.md` §4.6/§4.3 と、
// 設計レビュー（NOV26-DR-EDITOR-FEATURES-0456 追補）の指示（連番で古い非同期結果を捨てる）に追随する。
//
//   (a) アプリ編集: performUndo/performRedo の末尾で hydrateAssetPreviews() を呼ぶ  -> AC8
//   (b) アプリ編集: hydrateAssetPreviews が連番で古い解決結果を捨てる（後着上書き防止）
//   (c) アプリ編集: スプラッシュ/PWA アイコンのプレビューに e2e 用の testid がある
//
// 実挙動は e2e（tests/e2e/nov26-editor-feat2-app-preview.spec.ts）が担う。ここは
// 「呼び忘れ・ガード抜け」を安いコストで常時検出するためのソーステキスト検査である。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const readSrc = (rel) => readFile(path.join(projectRoot, rel), "utf8");

// 関数本体（`function name(...)` から次のトップレベル `\n}` まで）を取り出す
function bodyOf(source, name) {
  const match = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(source);
  assert.ok(match, `${name}() がソースに見つからない`);
  return match[1];
}

const appEdit = await readSrc("src/views/AppEdit.vue");

// (a) AC8: undo/redo でプレビューを追随させる
for (const name of ["performUndo", "performRedo"]) {
  const body = bodyOf(appEdit, name);
  assert.match(
    body,
    /void\s+hydrateAssetPreviews\(\)/,
    `${name}() が hydrateAssetPreviews() を呼んでいない（画像が Undo/Redo に追随しない）`,
  );
}
console.log("ok: (a) performUndo/performRedo がプレビューを再解決する（AC8）");

// (b) 連番ガード: 古い非同期結果が新しい表示を上書きしない
const hydrate = bodyOf(appEdit, "hydrateAssetPreviews");
// 世代番号はコンポーネント（setup）スコープで宣言する
assert.match(appEdit, /let\s+\w*previewGeneration\w*\s*=\s*0/, "世代番号（連番）の宣言がない");
assert.match(
  hydrate,
  /\+\+\s*\w*previewGeneration\w*|\w*previewGeneration\w*\s*\+\+/,
  "hydrateAssetPreviews() で世代番号を進めていない",
);
assert.match(
  hydrate,
  /if\s*\(\s*\w+\s*!==\s*\w*previewGeneration\w*\s*\)\s*return/,
  "hydrateAssetPreviews() に「古い結果を捨てる」判定がない",
);
console.log("ok: (b) hydrateAssetPreviews は連番で古い解決結果を捨てる");

// (c) e2e のフック
for (const testId of ["appedit-splash-preview", "appedit-icon-preview", "appedit-splash-upload", "appedit-icon-upload", "app-pwa-toggle"]) {
  assert.match(appEdit, new RegExp(`data-testid="${testId}"`), `AppEdit に data-testid="${testId}" がない`);
}
console.log("ok: (c) スプラッシュ/PWA アイコンのプレビューとボタンに testid がある");

console.log("nov26-editor-feat2 smoke: ALL PASS");
