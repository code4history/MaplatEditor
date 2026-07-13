import { nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import { clampScrollTop, mergeMasterDetailQuery } from "../utils/masterDetailRouteState";

const stateKey = (path: string) => `maplat-master-detail-scroll:${path}`;

export function useMasterDetailRouteState() {
  const route = useRoute();
  const router = useRouter();

  const select = async (uid: string, isNew = false) => {
    if (route.query.uid === uid && Boolean(route.query.new) === isNew) return;
    await router.push({ query: mergeMasterDetailQuery(route.query, { uid, isNew }) });
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

  return { select, clearSelection, saveScroll, restoreScroll };
}
