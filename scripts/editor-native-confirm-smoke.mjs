/* global console, URL, setTimeout */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parse, compileScript } from 'vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer } from 'vue';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';

const require = createRequire(import.meta.url);
await i18next.init({ lng: 'ja', resources: { ja: { translation: JSON.parse(fs.readFileSync(new URL('../public/locales/ja/translation.json', import.meta.url), 'utf8')) } } });
// 親子だけを持つ最小の木。要素を描く template でも mount と unmount が通る
const node = (type) => ({ type, parent: null, children: [] });
const renderer = createRenderer({
  patchProp() {},
  insert(child, parent, anchor) {
    child.parent?.children.splice(child.parent.children.indexOf(child), 1);
    const at = anchor ? parent.children.indexOf(anchor) : -1;
    if (at === -1) parent.children.push(child); else parent.children.splice(at, 0, child);
    child.parent = parent;
  },
  remove(child) {
    if (!child.parent) return;
    child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = null;
  },
  createElement: () => node('element'), createText: () => node('text'), createComment: () => node('comment'),
  setText() {}, setElementText() {},
  parentNode: (child) => child.parent,
  nextSibling: (child) => child.parent ? child.parent.children[child.parent.children.indexOf(child) + 1] ?? null : null,
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
async function component(file) {
  const { descriptor } = parse(fs.readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8'));
  const compiled = compileScript(descriptor, { id: file, inlineTemplate: true });
  const code = ts.transpileModule(compiled.content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/from (["'])(vue|i18next-vue)\1/g, (_match, _quote, name) => `from '${pathToFileURL(require.resolve(name)).href}'`);
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
}
const DeleteConfirm = await component('resource-list/DeleteConfirmDialog.vue');
const DraftConflict = await component('editor-ui/DraftConflictDialog.vue');
for (const [Component, label, props, events] of [
  [DeleteConfirm, '削除', { visible: true, deleting: false, title: '確認', references: [{kind:'map', slug:'walk', title:'散歩'}], referencesUnavailable: true }, ['confirm','cancel']],
  [DraftConflict, '下書き競合', { visible:true }, ['discard','apply']],
]) {
  for (const response of [0,1]) {
    let options;
    let answer;
    const emitted=[];
    globalThis.window={dialog:{showMessageBox: (value) => { options=value; return new Promise((resolve) => { answer=resolve; }); }}};
    const handlers=Object.fromEntries(events.map((event) => [`on${event[0].toUpperCase()+event.slice(1)}`, () => emitted.push(event)]));
    const app=renderer.createApp(Component,{...props,...handlers});
    app.use(I18NextVue,{i18next});
    app.mount(node('root'));
    await flush();
    assert.equal(options.buttons.length,2,label);
    assert.equal(options.cancelId,1,label);
    assert.equal(options.defaultId,1,label);
    if (label==='削除') {
      assert.ok(options.detail.includes('散歩'));
      assert.ok(options.detail.includes(i18next.t('resource_list.delete_references_unavailable')));
    }
    answer({response});
    await flush();
    assert.deepEqual(emitted,[events[response]],label);
    app.unmount();
  }
  // ダイアログ待ちの間に画面が閉じたら、その後の応答で削除・上書きしない。
  let answer;
  let emitted=false;
  globalThis.window={dialog:{showMessageBox: () => new Promise((resolve) => { answer=resolve; })}};
  const app=renderer.createApp(Component,{...props,onConfirm:()=>{emitted=true;},onDiscard:()=>{emitted=true;}});
  app.use(I18NextVue,{i18next});
  app.mount(node('root'));
  await flush();
  app.unmount();
  answer({response:0});
  await flush();
  assert.equal(emitted,false,label);
}
// ダイアログを出せなかったときは、壊さない側（cancelId と同じ）を選ぶ。
for (const [Component, props, safe] of [
  [DeleteConfirm, { visible: true, deleting: false, title: '確認' }, 'cancel'],
  [DraftConflict, { visible: true }, 'apply'],
]) {
  const emitted = [];
  globalThis.window = { dialog: { showMessageBox: () => Promise.reject(new Error('dialog unavailable')) } };
  const quiet = console.error;
  console.error = () => {};
  const app = renderer.createApp(Component, { ...props, onConfirm: () => emitted.push('confirm'), onCancel: () => emitted.push('cancel'), onDiscard: () => emitted.push('discard'), onApply: () => emitted.push('apply') });
  app.use(I18NextVue, { i18next });
  app.mount(node('root'));
  await flush();
  console.error = quiet;
  assert.deepEqual(emitted, [safe]);
  app.unmount();
}
console.log('Native confirmation unit tests: PASS');
