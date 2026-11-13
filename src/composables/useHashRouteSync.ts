import { onUnmounted } from "vue";
import type { Router } from "vue-router";

// hash の書き換え（openHash）で画面を移ったとき、書き換えが取りこぼされるのを防ぐ。
//
// vue-router は初期遷移が完了するまで履歴のリスナを登録しないため、その間に届いた
// hashchange は画面遷移に反映されない。さらに初期遷移の確定が URL を初期ターゲットへ
// 書き戻すため、書き換えは丸ごと失われ、前の画面（タブの強調とスクロール位置を含む）が
// 残る。初期遷移より前に届いた行き先を控えておき、初期遷移の完了後に控えた行き先へ
// 寄せ直すことで、書き換えは必ず行き先に着く。初期遷移の後は vue-router 自身が
// hash の変更を画面遷移に反映するため、ここでは動かさない。
export function useHashRouteSync(router: Router): void {
  let ready = false;
  let pendingTarget: string | null = null;

  const onHashChange = (): void => {
    if (ready) return;
    const target = location.hash.replace(/^#/, "");
    if (!target.startsWith("/")) return;
    pendingTarget = target;
  };

  const sync = async (): Promise<void> => {
    await router.isReady();
    ready = true;
    const target = pendingTarget;
    pendingTarget = null;
    if (target === null || router.currentRoute.value.fullPath === target) return;
    await router.replace(target).catch(() => undefined);
  };

  // setup の同期中に登録する（初期遷移の待ち時間を取りこぼさない）
  window.addEventListener("hashchange", onHashChange);
  onUnmounted(() => window.removeEventListener("hashchange", onHashChange));
  void sync();
}
