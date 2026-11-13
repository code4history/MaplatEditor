import { onUnmounted } from "vue";
import type { Router } from "vue-router";

// hash の書き換え（openHash）で画面を移ったとき、書き換えが取りこぼされるのを防ぐ。
//
// vue-router は初期遷移が完了するまで履歴のリスナを登録しないため、その間の hash の
// 書き換えは画面遷移に反映されない。さらに初期遷移の確定が URL を初期ターゲットへ
// 書き戻すため、書き換えは丸ごと失われ、前の画面（タブの強調とスクロール位置を含む）が
// 残る。初期遷移より前の書き換えの行き先を控えておき、初期遷移の完了後に控えた行き先へ
// 寄せ直すことで、書き換えは必ず行き先に着く。
//
// 行き先は書き換えの時点の値で控える。
// - popstate は書き換えと同期に届く（URL がまだ書き戻されていない）ので、その時点の
//   location.hash が行き先になる。hashchange は非同期で、初期遷移の確定の後に届くことが
//   ある（その時点の location.hash は書き戻された後の値）ので、行き先は event.newURL から取る。
// - 初期遷移の前に書き換えがあれば、少なくとも同期の popstate で控えられる。初期遷移の
//   確定の後に届く hashchange はそのどちらか（控え済みの書き換え、または vue-router 自身が
//   popstate で反映する書き換え）なので、ここでは動かさない（二重の遷移にしない）。
// 書き換えが無ければ何もしない（通常の起動で replace は走らない）。
function hashPath(url: string): string | null {
  const index = url.indexOf("#");
  if (index < 0) return null;
  const target = url.slice(index + 1);
  return target.startsWith("/") ? target : null;
}

export function useHashRouteSync(router: Router): void {
  let ready = false;
  let pendingTarget: string | null = null;

  const remember = (target: string | null): void => {
    if (ready || target === null) return;
    pendingTarget = target;
  };
  const onPopState = (): void => remember(hashPath(location.href));
  const onHashChange = (event: HashChangeEvent): void => remember(hashPath(event.newURL));

  const sync = async (): Promise<void> => {
    await router.isReady();
    ready = true;
    const target = pendingTarget;
    pendingTarget = null;
    if (target === null || router.currentRoute.value.fullPath === target) return;
    await router.replace(target).catch(() => undefined);
  };

  // setup の同期中に登録する（初期遷移の待ち時間を取りこぼさない）
  window.addEventListener("popstate", onPopState);
  window.addEventListener("hashchange", onHashChange);
  onUnmounted(() => {
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("hashchange", onHashChange);
  });
  void sync();
}
