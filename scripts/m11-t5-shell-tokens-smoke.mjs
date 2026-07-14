import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => readFile(path.join(projectRoot, rel), "utf8");
const exists = (rel) => access(path.join(projectRoot, rel)).then(() => true, () => false);

// --- Part 1: S1 token 正本 ---
const tokens = await read("src/assets/scss/editor-ui-tokens.scss");
const REQUIRED_TOKENS = [
  "--editor-ui-font-base", "--editor-ui-font-mono",
  "--editor-ui-font-size-sm", "--editor-ui-font-size-base",
  "--editor-ui-space-1", "--editor-ui-space-2", "--editor-ui-space-3", "--editor-ui-space-4", "--editor-ui-space-5",
  "--editor-ui-control-height", "--editor-ui-control-height-compact",
  "--editor-ui-border-width", "--editor-ui-radius", "--editor-ui-focus-ring",
  "--editor-ui-color-neutral", "--editor-ui-color-info", "--editor-ui-color-success", "--editor-ui-color-warning", "--editor-ui-color-danger",
  "--editor-ui-diag-info-fg", "--editor-ui-diag-success-fg", "--editor-ui-diag-warning-fg", "--editor-ui-diag-danger-fg",
  "--editor-ui-diag-info-border", "--editor-ui-diag-success-border", "--editor-ui-diag-warning-border", "--editor-ui-diag-danger-border",
  "--editor-ui-diag-summary-bg-info", "--editor-ui-diag-summary-bg-success", "--editor-ui-diag-summary-bg-warning", "--editor-ui-diag-summary-bg-danger",
  "--editor-ui-diag-summary-padding",
  "--editor-ui-header-height", "--editor-ui-header-bg", "--editor-ui-header-fg", "--editor-ui-header-fg-active", "--editor-ui-header-bg-active",
  "--editor-ui-overlay-bg",
  "--editor-ui-z-action-header", "--editor-ui-z-overlay",
];
for (const token of REQUIRED_TOKENS) {
  assert.match(tokens, new RegExp(`${token}\\s*:`), `token missing: ${token}`);
}
// 取込点は main.scss 冒頭の import のみ
const mainScss = await read("src/assets/scss/main.scss");
assert.match(mainScss, /^@import\s+["']\.\/editor-ui-tokens(\.scss)?["'];/m, "main.scss must import editor-ui-tokens");
// main.ts には token import を追加しない
const mainTs = await read("src/main.ts");
assert.doesNotMatch(mainTs, /editor-ui-tokens/, "main.ts must not import token file");

// --- Part 1b: T1 部品が token を参照する ---
const actionHeader = await read("src/components/editor-ui/EditorActionHeader.vue");
assert.match(actionHeader, /var\(--editor-ui-z-action-header\)/, "EditorActionHeader must use z-action-header token");
const busyOverlay = await read("src/components/editor-ui/EditorBusyOverlay.vue");
assert.match(busyOverlay, /var\(--editor-ui-z-overlay\)/, "EditorBusyOverlay must use z-overlay token");
assert.match(busyOverlay, /var\(--editor-ui-overlay-bg\)/, "EditorBusyOverlay must use overlay-bg token");

console.log("m11-t5 smoke Part 1: OK");

// --- Part 2: S2 OS標準 font ---
const appVue = await read("src/App.vue");
assert.match(appVue, /var\(--editor-ui-font-base\)/, "App.vue #app must use font-base token");
// src 全域から Inter / Avenir 指定が消えていること
for (const rel of ["src/App.vue", "src/assets/scss/main.scss", "src/assets/scss/editor-ui-tokens.scss"]) {
  const text = await read(rel);
  assert.doesNotMatch(text, /\bInter\b/, `${rel} still references Inter`);
  assert.doesNotMatch(text, /\bAvenir\b/, `${rel} still references Avenir`);
}
// .editor-ui-mono が mono token を参照する
assert.match(tokens, /\.editor-ui-mono\s*\{[^}]*var\(--editor-ui-font-mono\)/s, ".editor-ui-mono must use font-mono token");

console.log("m11-t5 smoke Part 2: OK");

// --- Part 3: S3 style.css 撤去 ---
assert.equal(await exists("src/style.css"), false, "src/style.css must be deleted");
assert.doesNotMatch(mainTs, /['"]\.\/style\.css['"]/, "main.ts must not import ./style.css");
// #app サイズ規則が App.vue へ移設されている
assert.match(appVue, /#app\s*\{[^}]*width:\s*100%/s, "App.vue must own #app width rule");
assert.match(appVue, /#app\s*\{[^}]*height:\s*100%/s, "App.vue must own #app height rule");

console.log("m11-t5 smoke Part 3: OK");

// --- Part 4: S4 Header 語彙・token・header-height ---
const headerVue = await read("src/components/Header.vue");
assert.match(headerVue, /var\(--editor-ui-header-height\)/, "Header must use header-height token");
assert.match(headerVue, /var\(--editor-ui-header-bg\)/, "Header must use header-bg token");
assert.match(headerVue, /var\(--editor-ui-header-fg\)/, "Header must use header-fg token");
// route / nav 順序 / sticky logic 不変（navigate 関数と route push が残る）
assert.match(headerVue, /navigate\('MapList'\)/);
assert.match(headerVue, /router\.push\('\/basemaps'\)/);
assert.match(headerVue, /currentRoute\.value === 'MapEdit'/, "sticky logic must remain");
// F1: アプリ nav は Map/POI と同型の section 判定（AppList + AppEdit）で active になる
assert.match(headerVue, /isAppSection/, "Header must define isAppSection for F1");
assert.match(headerVue, /currentRoute\.value === 'AppList' \|\| currentRoute\.value === 'AppEdit'/, "isAppSection must cover AppList + AppEdit");
assert.match(headerVue, /:class="\{ active: isAppSection \}"/, "app nav-link must bind active to isAppSection");
// .main-content offset が token
assert.match(appVue, /\.main-content\s*\{[^}]*var\(--editor-ui-header-height\)/s, "main-content must use header-height token");

const LOCALES = ["de", "en", "es", "fr", "id", "ja", "ko", "th", "vi", "zh", "zh-TW"];
const NAVBAR_KEYS = ["edit_map", "edit_poi", "add_basemap", "edit_app", "assets", "settings"];
const translations = {};
for (const loc of LOCALES) {
  translations[loc] = JSON.parse(await read(`public/locales/${loc}/translation.json`));
  for (const key of NAVBAR_KEYS) {
    assert.ok(translations[loc].navbar?.[key], `navbar.${key} missing in ${loc}`);
  }
}
// ja 確定語彙
assert.equal(translations.ja.navbar.edit_map, "地図管理");
assert.equal(translations.ja.navbar.edit_poi, "POI管理");
assert.equal(translations.ja.navbar.add_basemap, "ベースマップ管理");
assert.equal(translations.ja.navbar.edit_app, "アプリ管理");
assert.equal(translations.ja.navbar.assets, "アセット管理");
assert.equal(translations.ja.navbar.settings, "設定");

console.log("m11-t5 smoke Part 4: OK");

// --- Part 5: S5 画像アセット→アセット 文言移行 ---
// 画像修飾の複合語が「表示値」から消えていること。キー名は英語識別子なので walk 対象外。
const IMAGE_QUALIFIED = {
  ja: "画像アセット",
  ko: "이미지 에셋",
  vi: "Tài nguyên ảnh",
  zh: "图片素材",
  "zh-TW": "圖片素材",
};
const collectStringValues = (node, out = []) => {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object") for (const v of Object.values(node)) collectStringValues(v, out);
  return out;
};
for (const [loc, term] of Object.entries(IMAGE_QUALIFIED)) {
  const parsed = JSON.parse(await read(`public/locales/${loc}/translation.json`));
  const offenders = collectStringValues(parsed).filter((value) => value.includes(term));
  assert.equal(offenders.length, 0, `${loc}: image-qualified asset term "${term}" remains in ${offenders.length} value(s)`);
}
// i18n キー名の不変（キー名に該当語を含まないので、キーが残っていること = 名称不変を担保）
const jaParsed = JSON.parse(await read("public/locales/ja/translation.json"));
assert.ok("assets" in jaParsed.navbar, "navbar.assets key name must remain");
assert.ok("tab_assets" in (jaParsed.poiedit?.picker ?? jaParsed.assetlist ?? {}) || JSON.stringify(jaParsed).includes('"tab_assets"'), "tab_assets key name must remain");

console.log("m11-t5 smoke Part 5: OK");

// --- Part 6: S6 primitives 契約 ---
const uiTypes = await read("src/components/editor-ui/editorUiTypes.ts");
assert.match(uiTypes, /export type DiagnosticSeverity = 'info' \| 'success' \| 'warning' \| 'danger';/);
assert.match(uiTypes, /export type DiagnosticScope = 'field' \| 'section' \| 'operation';/);
assert.match(uiTypes, /export interface DiagnosticItem/);

const field = await read("src/components/editor-ui/EditorField.vue");
assert.match(field, /label/); assert.match(field, /labelFor/);
assert.match(field, /required/); assert.match(field, /hint/);
assert.match(field, /diagnostics/);
assert.match(field, /name="help"/, "EditorField must expose help slot");
assert.match(field, /DiagnosticFeedback/, "EditorField must render DiagnosticFeedback for field scope");

const diag = await read("src/components/editor-ui/DiagnosticFeedback.vue");
// severity icon の正本は editorUiTypes.ts の DIAGNOSTIC_SEVERITY_ICON（設計 §7.3）。
// DiagnosticFeedback はそれを import して利用する（SSOT 二重定義を避ける）。
for (const icon of ["bi-info-circle", "bi-check-circle", "bi-exclamation-triangle", "bi-exclamation-octagon"]) {
  assert.match(uiTypes, new RegExp(icon), `DIAGNOSTIC_SEVERITY_ICON must map ${icon}`);
}
assert.match(diag, /DIAGNOSTIC_SEVERITY_ICON/, "DiagnosticFeedback must wire to severity icon map");
// role は danger→alert / それ以外→status を dynamic bind で割り当てる（設計 §7.3）
assert.match(diag, /:role="[^"]*'alert'[^"]*'status'[^"]*"/, "DiagnosticFeedback must bind role danger→alert else→status");
assert.match(diag, /dismissible/); assert.match(diag, /dismiss/);
assert.match(diag, /var\(--editor-ui-diag-/, "DiagnosticFeedback must use diag tokens");
assert.match(diag, /var\(--editor-ui-diag-summary-padding\)/);

const help = await read("src/components/editor-ui/ContextHelp.vue");
assert.match(help, /bi-question-circle/);
// v3: Tooltip/Popover の 2 mode を廃止し、Popover を trigger 'hover focus' で単一化する
assert.doesNotMatch(help, /\bTooltip\b/, "ContextHelp v3 must not use Tooltip");
assert.doesNotMatch(help, /mode\s*[:?]/, "ContextHelp v3 must not declare a mode prop");
assert.doesNotMatch(help, /Escape/, "ContextHelp v3 must not have an Escape handler");
assert.doesNotMatch(help, /onOutsideClick|outsideClick/, "ContextHelp v3 must not have an outside-click handler");
assert.match(help, /new Popover\(/, "ContextHelp v3 must wrap Bootstrap Popover");
assert.match(help, /trigger:\s*["']hover focus["']/, "ContextHelp v3 Popover must use trigger 'hover focus'");
assert.match(help, /customClass:\s*["']editor-ui-help-popover["']/, "ContextHelp v3 must set customClass editor-ui-help-popover");
assert.match(help, /dispose\(\)/, "ContextHelp must dispose on unmount");
// token 準拠カードの見た目は tokens ファイルへ非 scoped で定義する
assert.match(tokens, /\.editor-ui-help-popover/, "tokens must define .editor-ui-help-popover card");
assert.match(tokens, /\.editor-ui-help-popover[^{]*\{[^}]*var\(--editor-ui-radius\)/s, "help popover card must use --editor-ui-radius");
assert.match(tokens, /\.editor-ui-help-popover[\s\S]*var\(--editor-ui-font-size-sm\)/, "help popover card must use --editor-ui-font-size-sm");

// primitive 用新キー（全 locale）
for (const loc of LOCALES) {
  const t = translations[loc] ?? JSON.parse(await read(`public/locales/${loc}/translation.json`));
  assert.ok(t.editor_ui?.slug_format_help, `editor_ui.slug_format_help missing in ${loc}`);
}

console.log("m11-t5 smoke Part 6: OK");

// --- Part 7: S7 pilot 統合 + F2〜F7 ---
for (const rel of ["src/components/basemap/BaseMapEdit.vue", "src/components/assets/AssetEdit.vue"]) {
  const src = await read(rel);
  assert.match(src, /EditorField/, `${rel} must use EditorField`);
  assert.match(src, /DiagnosticFeedback/, `${rel} must use DiagnosticFeedback`);
  // M11-T7 移行後: slug 欄は共通 SlugField(ContextHelp/editor-ui-mono/is-invalid 内蔵)へ寄せた。
  // 内蔵の各不変条件は m11-t7 smoke Part C と SlugField source 自体が担保する。
  assert.match(src, /ContextHelp|SlugField/, `${rel} must use ContextHelp (directly or via SlugField)`);
  assert.match(src, /editor-ui-mono|SlugField/, `${rel} slug input must use editor-ui-mono (directly or via SlugField)`);
  assert.match(src, /scope="operation"/, `${rel} save error must be operation-scope diagnostic`);
  // F3: 黄色バナー撤去 → section scope summary へ置換（全項目即時 = dirty ゲートなし）
  assert.match(src, /scope="section"/, `${rel} validation summary must be section-scope diagnostic`);
  assert.doesNotMatch(src, /alert alert-warning[^"]*"\s*>\s*<ul/, `${rel} must not keep the yellow validation banner`);
  assert.match(src, /sectionDiagnostics/, `${rel} must expose sectionDiagnostics`);
  // F2: field 診断がある入力へ is-invalid（赤枠）を連動付与(slug 欄は SlugField 内蔵)
  assert.match(src, /('is-invalid':\s*slugDiagnostics\.length)|SlugField/, `${rel} slug input must bind is-invalid (directly or via SlugField)`);
  assert.match(src, /titleDiagnostics/, `${rel} must wire title field diagnostics`);
  assert.match(src, /:invalid="titleDiagnostics\.length > 0"/, `${rel} title input must bind is-invalid via LangResourceInput invalid`);
  // F6: ContextHelp から mode 指定を除去
  assert.doesNotMatch(src, /mode="tooltip"|mode="popover"/, `${rel} must not pass mode to ContextHelp (v3)`);
  // F7: master-detail ホストから back を非表示にできるよう backVisible を受け取り転送する
  assert.match(src, /backVisible/, `${rel} must accept backVisible prop`);
  assert.match(src, /:back-visible="backVisible"/, `${rel} must forward backVisible to EditorActionHeader`);
  // F5: 新規 draft でも「下書きを破棄」を表示（isNew && dirty）
  assert.match(src, /isNew && dirty/, `${rel} discard-draft must be visible for new drafts (F5)`);
  // F8: dirty 変化を親へ通知する draft-state イベント
  assert.match(src, /"draft-state"/, `${rel} must emit draft-state for live badge (F8)`);
  // F8 Major-1: flush 完了後に List のバッジ再照会契機を作る flushed イベント
  assert.match(src, /flushed:\s*\[\]/, `${rel} must declare flushed emit (F8 Major-1)`);
  assert.match(src, /emit\("flushed"\)/, `${rel} must emit flushed after flush/discard (F8 Major-1)`);
  // F8 Major-1: uid 切替中は旧 session の dirty を新 uid へ流さない
  assert.match(src, /establishDraftState/, `${rel} must establish draft-state per session (F8 Major-1)`);
}
// BaseMap は URL / zoom も field 診断 + is-invalid（F3 全項目）
const baseMapEdit = await read("src/components/basemap/BaseMapEdit.vue");
assert.match(baseMapEdit, /'is-invalid':\s*urlDiagnostics\.length/, "BaseMapEdit url must bind is-invalid");
assert.match(baseMapEdit, /minZoomDiagnostics/, "BaseMapEdit min zoom must have field diagnostics");
assert.match(baseMapEdit, /maxZoomDiagnostics/, "BaseMapEdit max zoom must have field diagnostics");
// BaseMapEdit の 存在範囲 help は v3 で title 付き（mode なし）
assert.match(baseMapEdit, /basemap\.coverage_help/, "BaseMapEdit coverage must use ContextHelp with coverage_help");
// EditorActionHeader は backVisible prop（後方互換 default true）を持つ
const actionHeaderSrc = await read("src/components/editor-ui/EditorActionHeader.vue");
assert.match(actionHeaderSrc, /backVisible\?:\s*boolean/, "EditorActionHeader must add optional backVisible prop");
assert.match(actionHeaderSrc, /backVisible:\s*true/, "EditorActionHeader backVisible must default to true");
assert.match(actionHeaderSrc, /v-if="backVisible"/, "EditorActionHeader back button must gate on backVisible");
// F7: master-detail ホストが back を非表示にする
for (const rel of ["src/views/BaseMapList.vue", "src/views/AssetList.vue"]) {
  const src = await read(rel);
  assert.match(src, /:back-visible="false"/, `${rel} must hide back button in master-detail (F7)`);
  // F8: live draft override を効かせる
  assert.match(src, /@draft-state="onDraftState"/, `${rel} must handle draft-state (F8)`);
  assert.match(src, /effectiveDraftUids/, `${rel} must expose effectiveDraftUids override (F8)`);
  assert.match(src, /:draft-uids="effectiveDraftUids"/, `${rel} master list must use effectiveDraftUids (F8)`);
  // F8 Major-1: 行切替を跨いで override を保持する Map と、store 一致分の回収、flush 後の即時再照会
  assert.match(src, /liveDraftOverrides/, `${rel} must keep per-uid draft overrides (F8 Major-1)`);
  assert.match(src, /reconcileDraftOverrides/, `${rel} must reconcile overrides with store (F8 Major-1)`);
  assert.match(src, /@flushed="refreshDraftsNow"/, `${rel} must refresh badges right after flush (F8 Major-1)`);
  assert.doesNotMatch(src, /setTimeout\([^)]*, 900\)/, `${rel} must not refresh before persist delay (F8 Major-1)`);
}
// basemap.coverage_help を 11 locale へ追加
for (const loc of LOCALES) {
  const t = translations[loc] ?? JSON.parse(await read(`public/locales/${loc}/translation.json`));
  assert.ok(t.basemap?.coverage_help, `basemap.coverage_help missing in ${loc}`);
}

console.log("m11-t5 smoke Part 7: OK");
console.log("m11-t5 smoke: ALL OK");
