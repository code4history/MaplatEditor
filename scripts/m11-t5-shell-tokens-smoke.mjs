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
