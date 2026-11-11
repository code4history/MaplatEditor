/* global URL, console */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
assert.ok(existsSync(new URL('../src/composables/useOperationNotice.ts', import.meta.url)), '通知の共通状態が必要');
const { useOperationNotice } = await import('../src/composables/useOperationNotice.ts');
const first = useOperationNotice();
const destination = useOperationNotice();
first.notifyOperation({ type: 'error', message: '失敗', detail: '原因' });
assert.deepEqual(destination.operationNotices.value.map(({severity,message}) => ({severity,message})), [{ severity:'danger', message:'失敗' }, { severity:'danger', message:'原因' }]);
first.notifyOperation({ type: 'success', message: '保存完了' });
assert.equal(destination.operationNotices.value.length, 1);
assert.equal(destination.operationNotices.value[0].severity, 'success');
destination.clearOperationNotice();
assert.deepEqual(first.operationNotices.value, []);
// 複数行の detail は 1 行ずつの箇条になる
first.notifyOperation({ type: 'warning', message: '完了', detail: '警告 1\n\n警告 2' });
assert.deepEqual(destination.operationNotices.value.map(({ message }) => message), ['完了', '警告 1', '警告 2']);
destination.clearOperationNotice();
// 既定: 通知は次の画面遷移で消える（成功の通知が別の画面に残らない）。
first.notifyOperation({ type: 'success', message: '保存完了' });
first.onOperationNoticeNavigation();
assert.deepEqual(destination.operationNotices.value, [], '既定では遷移で消える');
// 失敗を知らせて一覧へ戻る（keepAcrossNavigation を明示）: 次の遷移 1 回は残り、その次の遷移で消える。
first.notifyOperation({ type: 'warning', message: '受け取れませんでした', keepAcrossNavigation: true });
first.onOperationNoticeNavigation();
assert.equal(destination.operationNotices.value.length, 1, '遷移先で読める');
first.onOperationNoticeNavigation();
assert.deepEqual(destination.operationNotices.value, [], '別の画面に残り続けない');
// 残す指定の後に出した既定の通知は、残す指定を引き継がない。
first.notifyOperation({ type: 'warning', message: '受け取れませんでした', keepAcrossNavigation: true });
first.notifyOperation({ type: 'success', message: '保存完了' });
first.onOperationNoticeNavigation();
assert.deepEqual(destination.operationNotices.value, [], '前の残す指定を引き継がない');
// 閉じる・操作の開始で消すと、残す指定も解ける。
first.notifyOperation({ type: 'warning', message: '受け取れませんでした', keepAcrossNavigation: true });
first.clearOperationNotice();
first.notifyOperation({ type: 'success', message: '保存完了' });
first.onOperationNoticeNavigation();
assert.deepEqual(destination.operationNotices.value, []);
// 保存を始めると前の通知が消える（前の成功と今回の失敗が並ばない）。
{
  const { useRevisionedAssetSave } = await import('../src/composables/useRevisionedAssetSave.ts');
  first.notifyOperation({ type: 'success', message: '保存完了' });
  let seenAtSend = null;
  const handle = useRevisionedAssetSave({
    send: async () => { seenAtSend = destination.operationNotices.value.length; return { result: 'Error', code: 'x' }; },
    applySuccess: () => {}, reloadFromStore: async () => {}, isDirty: () => false, onFailure: () => {},
    messages: { conflict: 'c', discard: 'd', reload: 'r', overwrite: 'o' },
    onStart: first.clearOperationNotice,
  });
  await handle.performSave();
  assert.equal(seenAtSend, 0, '保存の開始で前の成功の通知が消えている');
}
// 画面の側: 3 つの編集画面は保存の開始で通知を消す。遷移を越えて残すのは「受け取れずに一覧へ戻す」2 か所だけ。
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
for (const view of ['src/views/MapEdit.vue', 'src/views/AppEdit.vue', 'src/views/PoiEdit.vue']) {
  assert.match(read(view), /onStart: clearOperationNotice,/, `${view}: 保存の開始で通知を消す`);
}
assert.match(read('src/views/MapEdit.vue'), /const onMapClick = async[^]*?clearOperationNotice\(\);[^]*?tinObject\.value/, '試しのクリックの冒頭で通知を消す');
const keepCount = ['src/views/MapEdit.vue', 'src/views/AppEdit.vue', 'src/views/PoiEdit.vue', 'src/views/Settings.vue']
  .reduce((count, view) => count + (read(view).match(/keepAcrossNavigation: true/g) ?? []).length, 0);
assert.equal(keepCount, 2, '遷移を越えて残すのは一覧へ戻す 2 か所だけ');
console.log('Operation notices: PASS');
