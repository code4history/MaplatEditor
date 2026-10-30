// nov26-editor-feat2 smoke: 画像を指定した直後の一次表示と Undo/Redo 追随のソース契約。
// 設計書 `.nayuta/2026-10-21-nov26-editor-feat2-design.md` §4.6/§4.3 と、
// 設計レビュー（NOV26-DR-EDITOR-FEATURES-0456 追補）の指示（連番で古い非同期結果を捨てる）に追随する。
//
//   (a) アプリ編集: performUndo/performRedo の末尾で hydrateAssetPreviews() を呼ぶ  -> AC8
//   (b) アプリ編集: hydrateAssetPreviews が連番で古い解決結果を捨てる（後着上書き防止）
//   (c) アプリ編集: スプラッシュ/PWA アイコンのプレビューに e2e 用の testid がある
//   (d) token 方式の一次画像読み出し（main が選ばれたファイルにだけ発行する）の純関数
//   (e) 一次画像の data: URL 化（renderer）
//   (f) アセット編集: refreshPreview の優先順（picked → duplicate → 保存済み）と連番ガード
//   (g) 新 IPC の配線（runGuarded・removeHandler・ipc-guard 対象表）と CSP 不変
//   (h) 11 言語の文言
//
// 実挙動は e2e（tests/e2e/nov26-editor-feat2-app-preview.spec.ts）が担う。ここは
// 「呼び忘れ・ガード抜け」を安いコストで常時検出するためのソーステキスト検査である。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

// electron 非依存の純粋モジュール（node の型ストリップで直接読む）
import {
  PICK_TOKEN_MAX,
  PICK_TOKEN_TTL_MS,
  PREVIEW_MAX_BYTES,
  createPickedPathStore,
  mimeForPreviewExt,
  validatePreviewRequest,
} from "../electron/utils/pickedPreviewSource.ts";
// renderer 側の data: URL 化（純関数）
import { bytesToDataUrl } from "../src/utils/previewDataUrl.ts";

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


// --- (d) token 方式の一次画像読み出し（純関数） ---------------------------------
// AC9: main が「利用者がそのセッションで選んだファイル」にだけ発行する token を解決する。
{
  let clock = 1_000;
  const store = createPickedPathStore({ now: () => clock, ttlMs: PICK_TOKEN_TTL_MS, max: PICK_TOKEN_MAX });
  const tokenA = store.register("/tmp/a.png");
  const tokenB = store.register("/tmp/b.jpg");
  assert.notEqual(tokenA, tokenB, "同じパスでも毎回新しい token を発行する");
  assert.deepEqual(store.resolve(tokenA), { ok: true, filePath: "/tmp/a.png" });
  assert.deepEqual(store.resolve(tokenB), { ok: true, filePath: "/tmp/b.jpg" });
  // 未知 token
  assert.deepEqual(store.resolve("not-a-token"), { ok: false, code: "unknown-token" });
  // 期限切れ（TTL 経過）→ 解決しない
  clock += PICK_TOKEN_TTL_MS - 1;
  assert.deepEqual(store.resolve(tokenA), { ok: true, filePath: "/tmp/a.png" }, "TTL 内は解決できる");
  clock += 2;
  assert.deepEqual(store.resolve(tokenA), { ok: false, code: "expired" });
  // 上限で最古を追い出す
  store.clear();
  const tokens = [];
  for (let index = 0; index < PICK_TOKEN_MAX + 1; index += 1) tokens.push(store.register(`/tmp/${index}.png`));
  assert.equal(store.size(), PICK_TOKEN_MAX, "保持数は上限で頭打ちになる");
  assert.deepEqual(store.resolve(tokens[0]), { ok: false, code: "unknown-token" }, "最古の token は追い出される");
  assert.deepEqual(store.resolve(tokens[PICK_TOKEN_MAX]), { ok: true, filePath: `/tmp/${PICK_TOKEN_MAX}.png` });
  store.clear();
  assert.deepEqual(store.resolve(tokens[PICK_TOKEN_MAX]), { ok: false, code: "unknown-token" });
}
console.log("ok: (d) token は選ばれたファイルにだけ解決する（AC9）");

// AC10: 拡張子の許容集合は既存ピッカのフィルタ（png/jpg/jpeg/gif）と一致する
for (const ext of ["png", "jpg", "jpeg", "gif", "PNG", "JPEG"]) {
  assert.deepEqual(validatePreviewRequest({ ext, byteSize: 1024 }), { ok: true }, `${ext} は表示対象`);
  assert.match(mimeForPreviewExt(ext), /^image\//, `${ext} の MIME が引ける`);
}
assert.equal(mimeForPreviewExt("png"), "image/png");
assert.equal(mimeForPreviewExt("jpg"), "image/jpeg");
assert.equal(mimeForPreviewExt("jpeg"), "image/jpeg");
assert.equal(mimeForPreviewExt("gif"), "image/gif");
for (const ext of ["svg", "webp", "bmp", "", "txt"]) {
  assert.deepEqual(validatePreviewRequest({ ext, byteSize: 1024 }), { ok: false, code: "unsupported" }, `${ext} は非対応`);
  assert.equal(mimeForPreviewExt(ext), null);
}
// 20 MB: ちょうどは表示でき、1 バイト超は表示しない（保存できる上限と一致させる）
assert.deepEqual(validatePreviewRequest({ ext: "png", byteSize: PREVIEW_MAX_BYTES }), { ok: true });
assert.deepEqual(validatePreviewRequest({ ext: "png", byteSize: PREVIEW_MAX_BYTES + 1 }), { ok: false, code: "too-large" });
console.log("ok: (d2) 拡張子 allowlist と 20 MB 上限（AC6/AC10）");

// --- (e) 一次画像の data: URL 化（renderer） -----------------------------------
{
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const url = bytesToDataUrl(png, "image/png");
  assert.match(url, /^data:image\/png;base64,/, "data: URL の形で返す（CSP の img-src が data: を許可済み）");
  const encoded = url.slice("data:image/png;base64,".length);
  assert.deepEqual(Uint8Array.from(Buffer.from(encoded, "base64")), png, "base64 はバイト列と一致する");
  assert.equal(bytesToDataUrl(new Uint8Array(0), "image/gif"), "data:image/gif;base64,");
  // 大きめ（チャンク分割）でも壊れない
  const big = Uint8Array.from({ length: 70_000 }, (_, index) => index % 251);
  const bigUrl = bytesToDataUrl(big, "image/jpeg");
  assert.deepEqual(Uint8Array.from(Buffer.from(bigUrl.split(",")[1], "base64")), big);
}
console.log("ok: (e) 一次画像を data: URL へ変換できる");

// --- (f) アセット編集: refreshPreview の優先順と連番ガード ----------------------
const assetEdit = await readSrc("src/components/assets/AssetEdit.vue");
{
  // VolatileSource は previewKind で分岐する（picked は token・duplicate は元 uid）
  assert.match(assetEdit, /previewKind:\s*"picked"\s*\|\s*"duplicate"/, "VolatileSource に previewKind がない");
  assert.match(assetEdit, /duplicateFromUid\??:\s*string/, "VolatileSource に duplicateFromUid がない");
  assert.match(assetEdit, /previewKind:\s*"duplicate",\s*duplicateFromUid/, "複製 prefill が duplicate を名乗っていない");
  assert.match(assetEdit, /previewKind:\s*"picked",\s*sourcePath:\s*picked\.filePath/, "選択時に picked を名乗っていない");

  const body = bodyOf(assetEdit, "refreshPreview");
  // 優先順: picked（token で一次画像）→ duplicate（元 uid の実体）→ 保存済み（自分の uid）
  const order = [
    ["picked", body.indexOf('previewKind === "picked"')],
    ["token 読み出し", body.indexOf("readPickedSource(")],
    ["duplicate", body.indexOf('previewKind === "duplicate"')],
    ["duplicateFromUid", body.indexOf("getFilePath(source.duplicateFromUid)")],
    ["保存済み", body.indexOf("getFilePath(document.value.uid)")],
  ];
  for (const [label, index] of order) {
    assert.ok(index >= 0, `refreshPreview() に ${label} の経路がない`);
  }
  const positions = order.map(([, index]) => index);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), "refreshPreview() の優先順が picked → duplicate → 保存済みになっていない");
  // 連番: 古い非同期結果を捨てる
  assert.match(assetEdit, /let\s+\w*previewGeneration\w*\s*=\s*0/, "refreshPreview の世代番号がない");
  assert.match(body, /\++\s*\w*previewGeneration\w*/, "refreshPreview() が世代番号を進めていない");
  assert.match(body, /if\s*\(\s*\w+\s*!==\s*\w*previewGeneration\w*\s*\)\s*return/, "refreshPreview() に後着破棄の判定がない");
  // 一次画像は data: URL（main のバイトを renderer で URL 化する）
  assert.match(body, /bytesToDataUrl\(/, "refreshPreview() が一次画像を data: URL にしていない");
  // どれも無ければ null（枠を出さない）
  assert.match(body, /next:\s*string\s*\|\s*null\s*=\s*null/, "refreshPreview() の既定値が null でない");
  // 20 MB 超は表示せず理由文
  assert.match(assetEdit, /too-large/, "20 MB 超の理由（too-large）を扱っていない");

  // 履歴復元・選択時に再解決する
  assert.match(bodyOf(assetEdit, "applyHistory"), /void\s+refreshPreview\(\)/, "applyHistory() が refreshPreview() を呼んでいない");
  assert.match(bodyOf(assetEdit, "resetSession"), /previewGeneration\+\+/, "resetSession() が進行中の解決を無効化していない");
  // 既存 smoke（m6-t3）が字面を固定している null ガードは変えない
  assert.match(assetEdit, /pickImageFile\(\);\s*\n\s*if\s*\(\s*!picked\s*\)\s*return/, "pickImageFile の null ガードの字面が変わっている");

  for (const testId of ["asset-source-preview", "asset-preview-unsaved", "asset-preview-issue"]) {
    assert.match(assetEdit, new RegExp(`data-testid="${testId}"`), `AssetEdit に data-testid="${testId}" がない`);
  }
}
console.log("ok: (f) refreshPreview の優先順（picked→duplicate→保存済み）と連番ガード");

// --- (g) 新 IPC の配線と CSP 不変 ----------------------------------------------
const assetsImages = await readSrc("electron/ipc/assets-images.ts");
{
  assert.match(assetsImages, /runGuarded\(\s*['"]imageassets:readPickedSource['"]/, "新 IPC が runGuarded で wrap されていない");
  assert.match(assetsImages, /ipc\.handle\(\s*['"]imageassets:readPickedSource['"]\s*,\s*\(_\s*,\s*token\)/, "新 IPC がパスではなく token を受け取っていない");
  assert.match(assetsImages, /const token = \w+\.register\(filePath\)/, "pickImageFile が token を発行していない");
  // renderer からパスを受け取る形になっていない（任意パス読み出しの禁止）
  assert.doesNotMatch(assetsImages, /readPickedSource['"][^\n]*filePath/, "readPickedSource がパス文字列を受け取っている");


  const guardSmoke = await readSrc("scripts/oct26-m4-t2-ipc-guard-smoke.mjs");
  assert.match(guardSmoke, /"imageassets:readPickedSource"/, "ipc-guard smoke の対象表に新 IPC がない");

  const preload = await readSrc("electron/preload.ts");
  assert.match(preload, /readPickedSource:\s*\(token:\s*string\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]imageassets:readPickedSource['"]/, "preload に readPickedSource がない");
  assert.match(preload, /token:\s*string\s*\|\s*null\s*>,?\s*$|pickImageFile/, "preload の pickImageFile が token を返さない");

  const dts = await readSrc("src/electron.d.ts");
  assert.match(dts, /readPickedSource\(token:\s*string\)/, "型定義に readPickedSource がない");
  assert.match(dts, /token:\s*string\s*\}/, "型定義の pickImageFile が token を返さない");

  // AC11: CSP は変えない（img-src に data: があり blob: は無い）
  const appScheme = await readSrc("electron/utils/appScheme.ts");
  const csp = /RENDERER_CSP\s*=[\s\S]*?;/.exec(appScheme);
  assert.ok(csp, "RENDERER_CSP が見つからない");
  const imgSrc = /img-src([^;]*)/.exec(csp[0]);
  assert.ok(imgSrc, "CSP に img-src がない");
  assert.match(imgSrc[1], /\bdata:/, "CSP の img-src に data: がない");
  assert.doesNotMatch(imgSrc[1], /\bblob:/, "CSP の img-src に blob: を足している");
}
console.log("ok: (g) 新 IPC は token 方式・runGuarded・removeHandler 登録済み、CSP は不変（AC11/AC12）");

// --- (h) 11 言語の文言 ----------------------------------------------------------
{
  const locales = ["de", "en", "es", "fr", "id", "ja", "ko", "th", "vi", "zh", "zh-TW"];
  const keys = ["preview_unsaved", "preview_too_large", "preview_unavailable"];
  for (const lang of locales) {
    const json = JSON.parse(await readSrc(`public/locales/${lang}/translation.json`));
    const group = json?.assetlist?.master_detail ?? {};
    for (const key of keys) {
      assert.equal(typeof group[key], "string", `${lang} に assetlist.master_detail.${key} がない`);
      assert.ok(group[key].trim().length > 0, `${lang} の assetlist.master_detail.${key} が空`);
    }
  }
}
console.log("ok: (h) 3 つの文言が 11 言語にある（AC14）");

console.log("nov26-editor-feat2 smoke: ALL PASS");
