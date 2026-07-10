import { ref, type Ref } from "vue";

// maps/apps/poi_sources 共通の revision 楽観ロック保存フロー (Phase 4 Task 1, ADR-0007)。
// MapEdit.vue / AppEdit.vue の performSave（conflict → 読み直す/上書き、部分成功 Error{revision}
// の引き継ぎ）を挙動不変で共通化する。画面固有の処理（status 更新・router.replace・
// ダイアログ表示等）は send / applySuccess / onFailure クロージャに残す。
// この composable は i18next に依存しない: messages には呼び出し側で t() 済みの
// 「表示文字列」を渡す（i18n キーを渡さない）。

/** maps/apps/poi_sources 共通の保存結果 union（各画面の TResult はこれの部分集合+拡張） */
export type RevisionedSaveResult =
  | { result: "Success"; uid: string; slug: string; revision: number }
  | { result: "Exist" }
  | { result: "Invalid"; issues?: unknown }
  | { result: "ReadOnly" }
  | { result: "Error"; code?: string; message?: string; uid?: string; slug?: string; revision?: number | null }
  | { error: "revision-conflict"; current: number };

export interface RevisionedAssetSaveOptions<TResult extends RevisionedSaveResult> {
  /** IPC 送信。expectedRevision === undefined は「上書き」再送を意味する */
  send: (ctx: { uid: string | undefined; expectedRevision: number | undefined }) => Promise<TResult | null>;
  /** Success: composable が uid/revision/confirmedSlug を更新した**後**に呼ばれる（router.replace・status 更新・resetHistoryBase はここ） */
  applySuccess: (r: Extract<TResult, { result: "Success" }>) => void | Promise<void>;
  /** 「読み直す」: 編集破棄して最新版を再読込 */
  reloadFromStore: () => Promise<void>;
  isDirty: () => boolean;
  /** Exist（→onlyOne=false は各画面）/ Invalid / ReadOnly / Error の画面別処理。
   * Error に revision!=null が載る部分成功（maps のみ）は composable が uid/revision/confirmedSlug を
   * 先に取り込んでから渡す（次リトライへの引き継ぎ、MapEdit performSave の移植） */
  onFailure: (r: Exclude<TResult, { result: "Success" } | { error: "revision-conflict" }>) => void | Promise<void>;
  /** t() 済みの表示文字列（i18n キーではない）。
   * conflict = common.revision_conflict / discard = 各画面の confirm_no_save /
   * reload = common.reload / overwrite = common.overwrite（conflict ダイアログのボタンラベル。
   * 現行 MapEdit/AppEdit のボタン順 [読み直す, 上書き]・cancelId:0 を踏襲するために必要） */
  messages: { conflict: string; discard: string; reload: string; overwrite: string };
}

export interface RevisionedAssetSaveHandle {
  uid: Ref<string | undefined>;
  revision: Ref<number | undefined>;
  confirmedSlug: Ref<string | undefined>;
  saving: Ref<boolean>; // 再入防止（二重クリック）
  /** 読込成功時に呼ぶ */
  adoptLoaded(v: { uid: string; slug: string; revision: number }): void;
  /** 保存本体。conflict → showMessageBox(読み直す/上書き) → 上書きは expectedRevision:undefined で再送、
   * 読み直すは isDirty なら discard 確認後 reloadFromStore。再帰でなくループで実装。
   * expectedRevision 省略時は revision.value（MapEdit の copy 保存は {expectedRevision:undefined} を明示） */
  performSave(initial?: { expectedRevision: number | undefined }): Promise<void>;
}

type MessageBoxOptions = {
  type: "info";
  buttons: string[];
  cancelId: number;
  message: string;
};

// preload で公開される window.dialog（electron.d.ts に型宣言なしのため any 経由。
// MapEdit/AppEdit の (window as any).dialog.showMessageBox と同じアクセス方法）
function showMessageBox(opts: MessageBoxOptions): Promise<{ response: number }> {
  return (window as unknown as { dialog: { showMessageBox: (o: MessageBoxOptions) => Promise<{ response: number }> } })
    .dialog.showMessageBox(opts);
}

export function useRevisionedAssetSave<TResult extends RevisionedSaveResult>(
  options: RevisionedAssetSaveOptions<TResult>,
): RevisionedAssetSaveHandle {
  const uid: Ref<string | undefined> = ref(undefined);
  const revision: Ref<number | undefined> = ref(undefined);
  const confirmedSlug: Ref<string | undefined> = ref(undefined);
  const saving: Ref<boolean> = ref(false);

  function adoptLoaded(v: { uid: string; slug: string; revision: number }): void {
    uid.value = v.uid;
    revision.value = v.revision;
    confirmedSlug.value = v.slug;
  }

  async function performSave(initial?: { expectedRevision: number | undefined }): Promise<void> {
    if (saving.value) return; // 再入防止（二重クリック）
    saving.value = true;
    try {
      // {expectedRevision: undefined} の明示指定（copy 保存等）は revision.value より優先する
      let expectedRevision = initial !== undefined ? initial.expectedRevision : revision.value;
      // conflict の「上書き」再送は再帰ではなくループで処理する
      for (;;) {
        const result = await options.send({ uid: uid.value, expectedRevision });
        // IPC 不達など send が null を返した場合は安全に終了する（例外にしない。
        // saving は finally で確実に戻る）。null は結果 union 外なので onFailure にも渡さない
        if (result == null) return;
        const r: RevisionedSaveResult = result;

        if ("error" in r) {
          // 他ウィンドウで先に更新されている: 読み直す or 上書き
          const conflictChoice = await showMessageBox({
            type: "info",
            buttons: [options.messages.reload, options.messages.overwrite],
            cancelId: 0,
            message: options.messages.conflict,
          });
          if (conflictChoice.response === 1) {
            // 上書き: expectedRevision なしで再送
            expectedRevision = undefined;
            continue;
          }
          // 読み直す: ローカルの編集内容を破棄して最新版を再読込
          if (options.isDirty()) {
            const discard = await showMessageBox({
              type: "info",
              buttons: ["OK", "Cancel"],
              cancelId: 1,
              message: options.messages.discard,
            });
            if (discard.response !== 0) return;
          }
          await options.reloadFromStore();
          return;
        }

        if (r.result === "Success") {
          // 保存結果から uid/revision/slug を正本として反映してから applySuccess に渡す
          uid.value = r.uid;
          revision.value = r.revision;
          confirmedSlug.value = r.slug;
          await options.applySuccess(result as Extract<TResult, { result: "Success" }>);
          return;
        }

        // DBコミット後のファイル操作失敗はuid/slug/revision付きで返る (ADR-0007)。
        // 確定値へ補正してから onFailure に渡し、再試行が偽のrevision-conflictや'Exist'に
        // ならないようにする（MapEdit performSave の部分成功引き継ぎの移植）
        if (r.result === "Error" && r.revision != null) {
          if (r.uid) uid.value = r.uid;
          revision.value = r.revision;
          if (r.slug) confirmedSlug.value = r.slug;
        }
        await options.onFailure(result as Exclude<TResult, { result: "Success" } | { error: "revision-conflict" }>);
        return;
      }
    } finally {
      saving.value = false;
    }
  }

  return { uid, revision, confirmedSlug, saving, adoptLoaded, performSave };
}
