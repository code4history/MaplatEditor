/* global URL, console */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
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
// 失敗を知らせて一覧へ戻る: 次の遷移 1 回は残り、その次の遷移で消える。
first.notifyOperation({ type: 'warning', message: '受け取れませんでした' });
first.onOperationNoticeNavigation();
assert.equal(destination.operationNotices.value.length, 1, '遷移先で読める');
first.onOperationNoticeNavigation();
assert.deepEqual(destination.operationNotices.value, [], '別の画面に残り続けない');
// 遷移の無い画面で出した通知も、次の遷移では残り、その次で消える。
first.notifyOperation({ type: 'success', message: '保存完了' });
first.onOperationNoticeNavigation();
first.onOperationNoticeNavigation();
assert.deepEqual(destination.operationNotices.value, []);
console.log('Operation notices: PASS');
