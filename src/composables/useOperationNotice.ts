import { ref } from 'vue';
import type { DiagnosticItem } from '../components/editor-ui/editorUiTypes';

// 操作の結果（成功・失敗）を画面上部のバナーに出す共通の状態（docs/ui-grammar.md §5.3）。
// 通知は画面遷移で消す。遷移を越えて残すのは、呼び出し側が keepAcrossNavigation を明示したとき
// だけ（失敗を知らせて一覧へ戻す操作。遷移先で読めるよう、次の遷移を 1 回だけ越える）。
// 成功の通知が別の画面に残ったり、後の失敗と並んだりしないように、操作を始めるときにも消す
// （clearOperationNotice）。
const operationNotices = ref<DiagnosticItem[]>([]);
const operationNoticeHosts = ref(0);
let navigationsToKeep = 0;
// 今出している通知の出どころ。clearOperationNotice(origin) は同じ出どころの通知だけを消す
let currentOrigin: string | undefined;

export interface OperationNoticeInput {
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  detail?: string;
  /** 次の画面遷移を 1 回だけ越えて残す。通知の直後に別の画面へ移る操作だけが付ける */
  keepAcrossNavigation?: boolean;
  /** 出どころ。付けると clearOperationNotice(同じ値) でだけ消える（地図の試しのクリックなど、繰り返す操作が自分の通知だけを消すため） */
  origin?: string;
}

export function useOperationNotice() {
  function notifyOperation(notice: OperationNoticeInput): void {
    const severity = notice.type === 'error' ? 'danger' : notice.type;
    // detail は警告の並び（1 行 1 件）のことがあるので、行ごとに分けて箇条にする
    operationNotices.value = [notice.message, ...(notice.detail ?? '').split('\n')]
      .filter((message) => message.trim())
      .map((message, index) => ({ key: `operation-notice-${index}`, severity, message }));
    navigationsToKeep = notice.keepAcrossNavigation ? 1 : 0;
    currentOrigin = notice.origin;
  }
  /**
   * 閉じるボタン・操作の開始（保存など）で呼ぶ。origin を渡したときは、同じ出どころの通知だけを消す
   * （地図の試しのクリックやプレビューの描き直しが、下書きの復元や書き出しの通知を消さないように）
   */
  function clearOperationNotice(origin?: string): void {
    if (origin !== undefined && currentOrigin !== origin) return;
    operationNotices.value = [];
    navigationsToKeep = 0;
    currentOrigin = undefined;
  }
  /** 画面（route の path）が変わったときに呼ぶ。 */
  function onOperationNoticeNavigation(): void {
    if (navigationsToKeep > 0) navigationsToKeep--;
    else {
      operationNotices.value = [];
      currentOrigin = undefined;
    }
  }
  return { operationNotices, operationNoticeHosts, notifyOperation, clearOperationNotice, onOperationNoticeNavigation };
}
