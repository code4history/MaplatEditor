/* global URL, console */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

assert.ok(existsSync(new URL('./editor-ui-grammar-check.mjs', import.meta.url)), 'UI 文法の検査器が必要');
const { inspectSource, applyAllowlist } = await import('./editor-ui-grammar-check.mjs');
const vue = (template, script = '') => `<template>${template}</template><script setup lang="ts">${script}</script>`;
const rules = (source, file = 'src/Test.vue') => inspectSource(file, source).map((v) => v.rule);
for (const [markup, rule] of [
  ['<p class="form-text">説明</p>', 'help.form-text'],
  ['<p class="text-muted small">{{ t("x_help") }}</p>', 'help.muted-text'],
  ['<p>{{ t("x_desc") }}</p>', 'help.key-outside-contexthelp'],
  ['<EditorField><template #help><span>説明</span></template></EditorField>', 'help.slot-misuse'],
  ['<ContextHelp text="説明" aria-label=""/>', 'help.aria-label'],
  ['<div :class="[\'text-danger\']">{{ error }}</div>', 'diag.inline-text'],
  ['<p class="alert alert-danger">失敗</p>', 'diag.raw-alert'],
  ['<div class="modal show">確認</div>', 'dialog.ad-hoc-modal'],
  ['<div class="text-center text-muted">{{t("x.empty")}}</div>', 'empty.ad-hoc'],
  ['<div class="modal-footer"><button class="btn btn-secondary">{{t("common.cancel")}}</button></div>', 'button.variant'],
  ['<div class="modal-footer"><button class="btn btn-primary btn-sm">OK</button></div>', 'button.variant'],
]) {
  assert.ok(rules(vue(markup)).includes(rule), rule);
}
assert.ok(rules('window.confirm("削除")', 'src/test.ts').includes('dialog.native-browser'));
assert.ok(rules(vue('', 'window.alert("失敗")')).includes('dialog.native-browser'));
assert.ok(rules(vue('', 'window.dialog.showMessageBox({buttons: ["OK"], message: "通知"})')).includes('dialog.notify-only'));
assert.deepEqual(rules(vue('<ContextHelp :text="t(\'x_help\')" :ariaLabel="t(\'label\')"/><span class="text-danger">*</span>')), []);
assert.deepEqual(rules(vue('', '// confirm("コメント")\nconst text = "alert(1)"')), []);
assert.deepEqual(rules(vue('', 'emit("confirm")')), []);
assert.deepEqual(rules(vue('<div class="text-muted">{{t("x.empty")}}</div>')), []);
const violations = inspectSource('src/Test.vue', vue('<p data-testid="notice" class="form-text">状態</p>'));
const entry = {rule:'help.form-text', file:'src/Test.vue', testid:'notice', reason:'状態の表示', source:'docs/ui-grammar.md#23-状態の表示は説明ではない'};
assert.equal(applyAllowlist(violations, [entry]).violations.length, 0);
assert.equal(applyAllowlist(violations, [{...entry, source:''}]).errors.length, 1);
assert.equal(applyAllowlist(violations, [{...entry, file:'src/*.vue'}]).errors.length, 1);
assert.equal(applyAllowlist([], [entry]).warnings.length, 1);
assert.equal(applyAllowlist(violations, [{...entry, testid:'different'}]).violations.length, 1);
// 同じキーの新規違反を既存の例外が黙って隠さない。
assert.ok(applyAllowlist([...violations, ...violations], [entry]).errors.length > 0);
console.log('UI grammar fixtures: PASS');
