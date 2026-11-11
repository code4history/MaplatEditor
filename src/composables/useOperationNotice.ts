import { ref } from 'vue';
import type { DiagnosticItem } from '../components/editor-ui/editorUiTypes';

// 操作の結果（成功・失敗）を画面上部のバナーに出す共通の状態（docs/ui-grammar.md §5.3）。
// 失敗を知らせて一覧に戻る操作でも遷移先で読めるよう、通知は次の画面遷移を 1 回だけ越えて残す。
// その次の遷移で消す（成功の通知が別の画面に残り続けないように）。
const operationNotices = ref<DiagnosticItem[]>([]);
const operationNoticeHosts = ref(0);
let navigationsToKeep = 0;

export function useOperationNotice() {
  function notifyOperation(notice: { type: 'info' | 'success' | 'warning' | 'error'; message: string; detail?: string }): void {
    const severity = notice.type === 'error' ? 'danger' : notice.type;
    // detail は警告の並び（1 行 1 件）のことがあるので、行ごとに分けて箇条にする
    operationNotices.value = [notice.message, ...(notice.detail ?? '').split('\n')]
      .filter((message) => message.trim())
      .map((message, index) => ({ key: `operation-notice-${index}`, severity, message }));
    navigationsToKeep = 1;
  }
  function clearOperationNotice(): void {
    operationNotices.value = [];
    navigationsToKeep = 0;
  }
  /** 画面（route の path）が変わったときに呼ぶ。 */
  function onOperationNoticeNavigation(): void {
    if (navigationsToKeep > 0) navigationsToKeep--;
    else operationNotices.value = [];
  }
  return { operationNotices, operationNoticeHosts, notifyOperation, clearOperationNotice, onOperationNoticeNavigation };
}
