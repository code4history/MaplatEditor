// 一覧トップの検索条件の記憶（直近の検索条件）— 永続化を担う唯一の場所。
//
// 設計: .nayuta/2026-10-21-nov26-editor-feat1-design.md（v1.0）§4.2・§4.3・§4.5
// 設計レビュー NOV26-DR-EDITOR-FEATURES-0456 の指示:
//   2. 800 ms の記録予約は compositionstart〜compositionend（isComposing）の間はしない
//      （日本語の変換中の文字を記録しない）
//
// 保存先は electron-store の設定ファイル（window.settings の新キー `recentSearches`）。
// window.settings を触るのはこのファイルだけで、チップの部品は表示専用に保つ。
import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import i18next from "i18next";
import type { ResourceListKind } from "../components/resource-list/resourceListTypes";
import {
  RECENT_SEARCH_LIMIT,
  RECENT_SEARCH_RECORD_DELAY_MS,
  RECENT_SEARCH_STORE_KEY,
  insertRecentSearch,
  normalizeQueryForHistory,
  normalizeRecentSearches,
  removeRecentSearch,
  type RecentSearchEntry,
  type RecentSearches,
} from "../utils/recentSearches";

export interface UseRecentSearches {
  /** この画面（kind）の直近の検索条件（新しい順） */
  items: Ref<RecentSearchEntry[]>;
  /** 設定ファイルからの読み込みが終わったか（取得前は空配列として扱う） */
  hydrated: Ref<boolean>;
  /** 保存に失敗したときの文言（表示はチップ行の責務） */
  error: Ref<string | null>;
  /** 入力のたびに呼ぶ。800 ms の停止で記録する（変換中は予約しない） */
  record(q: string): void;
  /** @change（Enter と blur）で呼ぶ。待たずに記録する */
  recordNow(q: string): void;
  /** 変換開始（compositionstart）。予約を取り消して以後の予約を止める */
  beginComposition(): void;
  /** 変換確定（compositionend）。変換後の値で予約し直す */
  endComposition(): void;
  /** チップのクリック。使った条件を先頭へ移動して永続化する */
  apply(q: string): Promise<void>;
  /** チップの ×。該当 1 件だけを消す（現在の検索条件は変えない） */
  remove(q: string): Promise<void>;
  /** 未記録の q を確定させる（離脱・unmount 時） */
  flush(): void;
}

export function useRecentSearches(kind: ResourceListKind): UseRecentSearches {
  const limit = RECENT_SEARCH_LIMIT[kind];
  const items = ref<RecentSearchEntry[]>([]);
  const hydrated = ref(false);
  const error = ref<string | null>(null);

  // electron-store に載っている値のうち、最後に読んだ/書いた内容（他 kind を壊さないため保持）
  let stored: RecentSearches = {};
  let hydrating: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: string | null = null;
  // 日本語入力の変換中か。変換中に停止しても記録しない（設計レビュー指示 2）
  let composing = false;
  // 変換中に見えた最新の入力値。変換確定後にこれで予約し直す
  let composingValue = "";
  // 書き込みは直列化する（set は JSON 全体を書くため、順序が入れ替わると古い値で上書きされる）
  let writes: Promise<void> = Promise.resolve();

  async function hydrate(): Promise<void> {
    if (hydrated.value) return;
    if (!hydrating) {
      hydrating = (async () => {
        try {
          const raw = typeof window !== "undefined" ? await window.settings.get(RECENT_SEARCH_STORE_KEY) : undefined;
          stored = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as RecentSearches) : {};
        } catch (cause) {
          // 読めないときは空として扱う（履歴は再入力で戻せる軽いデータ）
          console.error("Failed to read the recent searches", cause);
          stored = {};
        }
        items.value = normalizeRecentSearches(stored[kind], kind);
        hydrated.value = true;
      })();
    }
    await hydrating;
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function persist(): Promise<void> {
    // IPC は structured clone で運ぶため、Vue の reactive proxy をそのまま渡せない
    // （渡すと "An object could not be cloned." で保存が失敗する）。素の値へ写してから書く。
    const snapshot = items.value.map((entry) => ({ q: entry.q, at: entry.at }));
    writes = writes.then(async () => {
      // 書く直前に読み直す。履歴は全画面で 1 本のファイルを共有するので、他の kind が
      // 直前に書いた分を、この画面が古い手元の値で上書きして消さないようにする。
      let base: RecentSearches = stored;
      try {
        if (typeof window !== "undefined" && window.settings) {
          const raw = await window.settings.get(RECENT_SEARCH_STORE_KEY);
          if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) base = raw as RecentSearches;
        }
      } catch {
        // 読めないときは手元の値で書く（保存自体は試みる）
      }
      const next: RecentSearches = { ...base, [kind]: snapshot };
      try {
        if (typeof window !== "undefined" && window.settings) {
          await window.settings.set(RECENT_SEARCH_STORE_KEY, next);
        }
        stored = next;
        error.value = null;
      } catch (cause) {
        console.error("Failed to save the recent searches", cause);
        error.value = i18next.t("resource_list.recent_search_record_failed");
      }
    });
    return writes;
  }

  async function commit(q: string | null): Promise<void> {
    pending = null;
    if (q === null) return;
    const normalized = normalizeQueryForHistory(q);
    if (normalized === null) return; // 空（空白のみ）・長すぎる値は記録しない
    await hydrate();
    items.value = insertRecentSearch(items.value, normalized, Date.now(), limit);
    await persist();
  }

  function schedule(q: string): void {
    clearTimer();
    pending = q;
    timer = setTimeout(() => {
      timer = null;
      void commit(pending);
    }, RECENT_SEARCH_RECORD_DELAY_MS);
  }

  function record(q: string): void {
    composingValue = q;
    // 変換中は予約しない（日本語の変換途中の文字を履歴に残さない）
    if (composing) return;
    if (normalizeQueryForHistory(q) === null) {
      // 空へ戻した（絞り込み解除）。予約中の値も記録しない
      clearTimer();
      pending = null;
      return;
    }
    schedule(q);
  }

  function recordNow(q: string): void {
    clearTimer();
    void commit(q);
  }

  function beginComposition(): void {
    composing = true;
    clearTimer();
    pending = null;
  }

  function endComposition(): void {
    composing = false;
    if (composingValue) record(composingValue);
  }

  async function apply(q: string): Promise<void> {
    clearTimer();
    await commit(q);
  }

  async function remove(q: string): Promise<void> {
    await hydrate();
    items.value = removeRecentSearch(items.value, q);
    await persist();
  }

  function flush(): void {
    if (timer !== null) clearTimer();
    const q = pending;
    pending = null;
    if (q !== null) void commit(q);
  }

  onMounted(() => {
    void hydrate();
  });
  onBeforeUnmount(() => {
    // 画面を離れるときに未記録の q を取りこぼさない
    flush();
  });

  return { items, hydrated, error, record, recordNow, beginComposition, endComposition, apply, remove, flush };
}
