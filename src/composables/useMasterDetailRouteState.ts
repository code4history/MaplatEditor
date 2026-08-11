import { nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import { clampScrollTop, mergeMasterDetailQuery } from "../utils/masterDetailRouteState";

const stateKey = (path: string) => `maplat-master-detail-scroll:${path}`;

export function useMasterDetailRouteState() {
  const route = useRoute();
  const router = useRouter();

  const select = async (uid: string, isNew = false) => {
    if (route.query.uid === uid && Boolean(route.query.new) === isNew && !route.query.duplicateFrom) return;
    await router.push({ query: mergeMasterDetailQuery(route.query, { uid, isNew }) });
  };

  // M11-T10: 複製オープン(BaseMap/Asset の master-detail 共通)。reserveCopySlug の結果を
  // 受け、duplicateFrom/slug ワンショットクエリ付きの new 選択として遷移する。
  const selectDuplicate = async (sourceUid: string, reserved: { uid: string; slug: string }) => {
    await router.push({
      query: mergeMasterDetailQuery(route.query, {
        uid: reserved.uid,
        isNew: true,
        duplicate: { sourceUid, slug: reserved.slug },
      }),
    });
  };

  const clearSelection = async () => {
    await router.push({ query: mergeMasterDetailQuery(route.query, { uid: null }) });
  };

  const saveScroll = (element: HTMLElement | null) => {
    if (!element || typeof history === "undefined") return;
    history.replaceState(
      { ...history.state, [stateKey(route.path)]: element.scrollTop },
      "",
      location.href,
    );
  };

  const restoreScroll = async (element: HTMLElement | null) => {
    if (!element || typeof history === "undefined") return;
    await nextTick();
    const requested = Number(history.state?.[stateKey(route.path)] ?? 0);
    element.scrollTop = clampScrollTop(requested, element.clientHeight, element.scrollHeight);
  };

  return { select, selectDuplicate, clearSelection, saveScroll, restoreScroll };
}
