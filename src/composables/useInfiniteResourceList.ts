import { computed, ref, shallowRef, type ComputedRef, type Ref } from "vue";
import type {
  ResourceDataAdapter,
  ResourceListFilter,
  ResourceListState,
} from "../components/resource-list/resourceListTypes";

export interface InfiniteResourceListSources {
  filter: () => ResourceListFilter;
  activeLang: () => string;
}

export interface InfiniteResourceListOptions {
  limit?: number;
}

export interface UseInfiniteResourceList<T extends { uid: string }> {
  items: Ref<T[]>;
  total: Ref<number | null>;
  loaded: ComputedRef<number>;
  batchesLoaded: Ref<number>;
  state: Ref<ResourceListState>;
  loadFirst: () => Promise<void>;
  loadMore: () => Promise<void>;
  retry: () => Promise<void>;
  restore: (targetBatches: number) => Promise<void>;
  applyDeletion: (uid: string) => Promise<void>;
  anchorFor: (uid: string) => number;
  dispose: () => void;
}

export function useInfiniteResourceList<T extends { uid: string }, Cursor = string>(
  adapter: ResourceDataAdapter<T, Cursor>,
  sources: InfiniteResourceListSources,
  options: InfiniteResourceListOptions = {},
): UseInfiniteResourceList<T> {
  const limit = options.limit ?? 30;
  const items = shallowRef<T[]>([]);
  const total = ref<number | null>(null);
  const batchesLoaded = ref(0);
  const state = ref<ResourceListState>("idle");
  const loaded = computed(() => items.value.length);

  const nextCursor = ref<Cursor | null>(null) as Ref<Cursor | null>;
  const consumedCursors = ref<Array<Cursor | null>>([]) as Ref<Array<Cursor | null>>;
  let generation = 0;
  let loadingCursorKey: string | null = null; // 同一cursor多重取得禁止のガード
  let controller: AbortController | null = null;

  const cursorKey = (cursor: Cursor | null): string => (cursor == null ? "@first" : JSON.stringify(cursor));

  const dedupeAppend = (base: T[], incoming: T[]): T[] => {
    const seen = new Set(base.map((item) => item.uid));
    const additions = incoming.filter((item) => !seen.has(item.uid));
    return additions.length ? [...base, ...additions] : base;
  };

  const settleState = (): void => {
    if (items.value.length === 0) state.value = "empty";
    else if (nextCursor.value == null) state.value = "end";
    else state.value = "idle";
  };

  async function loadFirst(): Promise<void> {
    const gen = ++generation;
    controller?.abort();
    controller = new AbortController();
    state.value = "loading";
    loadingCursorKey = cursorKey(null);
    try {
      const batch = await adapter.load({ filter: sources.filter(), cursor: null, limit, signal: controller.signal });
      if (gen !== generation) return; // 古い応答は破棄（AC6）
      items.value = dedupeAppend([], batch.items);
      total.value = batch.total;
      nextCursor.value = batch.nextCursor;
      consumedCursors.value = [null];
      batchesLoaded.value = 1;
      settleState();
    } catch {
      if (gen !== generation) return;
      state.value = "error";
    } finally {
      if (gen === generation) loadingCursorKey = null;
    }
  }

  async function loadMore(): Promise<void> {
    if (state.value !== "idle" && state.value !== "append-error") return;
    if (nextCursor.value == null) return;
    const cursor = nextCursor.value;
    const key = cursorKey(cursor);
    if (loadingCursorKey === key) return; // 同一cursor多重取得禁止（AC6）
    loadingCursorKey = key;
    const gen = generation;
    state.value = "appending";
    try {
      const batch = await adapter.load({ filter: sources.filter(), cursor, limit, signal: controller?.signal ?? new AbortController().signal });
      if (gen !== generation) return;
      items.value = dedupeAppend(items.value, batch.items); // UID dedupe（AC6）
      if (batch.total != null) total.value = batch.total;
      nextCursor.value = batch.nextCursor;
      consumedCursors.value = [...consumedCursors.value, cursor];
      batchesLoaded.value += 1;
      settleState();
    } catch {
      if (gen !== generation) return;
      state.value = "append-error"; // 取得済み item は保持（AC7）
    } finally {
      if (gen === generation && loadingCursorKey === key) loadingCursorKey = null;
    }
  }

  async function retry(): Promise<void> {
    if (state.value === "error") await loadFirst();
    else if (state.value === "append-error") await loadMore();
  }

  // D9: 削除成功後、UID を除去し最終取得済み cursor を再取得して繰上りズレを dedupe 回収する。
  // 再取得 batch には削除済み uid が（backend 反映遅延等で）残り得るため除外する。
  // client-side batch 系（master）は host 側が loadFirst で再スライスするため本メソッドを使わない。
  async function applyDeletion(uid: string): Promise<void> {
    const idx = items.value.findIndex((item) => item.uid === uid);
    if (idx !== -1) {
      const next = items.value.slice();
      next.splice(idx, 1);
      items.value = next;
      if (total.value != null) total.value = Math.max(0, total.value - 1);
    }
    const lastCursor = consumedCursors.value.at(-1) ?? null;
    const gen = ++generation;
    // in-flight loadMore の finally は gen 不一致で解放しないため、ここで明示解放する
    // （残置すると同一 cursor の loadMore が恒久ブロックされる）。
    loadingCursorKey = null;
    try {
      const batch = await adapter.load({ filter: sources.filter(), cursor: lastCursor, limit, signal: new AbortController().signal });
      if (gen !== generation) return;
      const incoming = batch.items.filter((item) => item.uid !== uid); // 削除済み uid の再追加を防ぐ
      items.value = dedupeAppend(items.value, incoming);
      if (batch.total != null) total.value = batch.total;
      nextCursor.value = batch.nextCursor;
      settleState();
    } catch {
      if (gen !== generation) return;
      settleState();
    }
  }

  // P6/D12: Back 復元。保存 batch 数まで loadFirst→loadMore を再生する。
  async function restore(targetBatches: number): Promise<void> {
    await loadFirst();
    let guard = 0;
    while (batchesLoaded.value < targetBatches && nextCursor.value != null && guard < 100) {
      await loadMore();
      guard += 1;
    }
  }

  const anchorFor = (uid: string): number => items.value.findIndex((item) => item.uid === uid);

  function dispose(): void {
    generation += 1;
    controller?.abort();
    controller = null;
    loadingCursorKey = null;
  }

  return { items, total, loaded, batchesLoaded, state, loadFirst, loadMore, retry, restore, applyDeletion, anchorFor, dispose };
}
