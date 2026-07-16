// M11-T10: 共通削除 flow composable（5資産種の一覧で共用）。
// 確認 dialog の状態・参照一覧の取得・削除実行・失敗診断を一元化する。
import { reactive, ref } from "vue";

export interface DeleteReference {
  kind: string;
  slug: string;
  title?: string;
}

export interface DeleteDialogState {
  visible: boolean;
  title: string;
  references: DeleteReference[];
  refsUnavailable: boolean;
}

export function useResourceDelete(options: {
  // i18n 済みの確認タイトル（resource_list.delete_confirm_title）を返す
  confirmTitle: (title: string) => string;
  // 参照一覧（Asset/POI など被参照があり得る資産のみ指定）
  references?: (uid: string) => Promise<DeleteReference[]>;
  // 破壊的実処理（backend delete + draft remove まで）
  onDelete: (uid: string) => Promise<void>;
  // 成功後の一覧更新
  onDeleted: (uid: string) => void | Promise<void>;
  // 失敗表示（未指定なら error ref のみ）
  onError?: (uid: string, message: string) => void;
}) {
  const dialog = reactive<DeleteDialogState>({ visible: false, title: "", references: [], refsUnavailable: false });
  const deleting = ref(false);
  // 削除・複製など一覧操作の失敗診断（DiagnosticFeedback 表示用）
  const error = ref<string | null>(null);
  let pendingUid = "";

  async function request(target: { uid: string; title: string }): Promise<void> {
    pendingUid = target.uid;
    dialog.title = options.confirmTitle(target.title);
    dialog.references = [];
    dialog.refsUnavailable = false;
    if (options.references) {
      try {
        dialog.references = await options.references(target.uid);
      } catch (cause) {
        console.error("Failed to resolve delete references", cause);
        dialog.refsUnavailable = true;
      }
    }
    dialog.visible = true;
  }

  async function confirm(): Promise<void> {
    dialog.visible = false;
    deleting.value = true;
    try {
      await options.onDelete(pendingUid);
      await options.onDeleted(pendingUid);
    } catch (e: any) {
      const message = e?.message || String(e);
      error.value = message;
      options.onError?.(pendingUid, message);
      console.error("Delete failed", e);
    } finally {
      deleting.value = false;
    }
  }

  function cancel(): void {
    dialog.visible = false;
  }

  return { dialog, deleting, error, request, confirm, cancel };
}
