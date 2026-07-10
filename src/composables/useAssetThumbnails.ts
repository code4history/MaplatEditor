// image asset の一覧検索 + サムネイル解決の共用 composable (Phase 6 Task 4)。
// AssetList.vue で実装した「search + 後着優先トークンガード + getFilePath の file:// URL
// 並行解決 + 個別失敗の noImage フォールバック」を AssetPicker と共用するため抽出した
// (挙動は AssetList 時代と不変)。
import { ref, reactive } from "vue";
import type { Ref } from "vue";
import type { ImageAssetRow } from "../electron";

export interface AssetThumbnails {
  items: Ref<ImageAssetRow[]>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  searchQuery: Ref<string>;
  /** uid → file:// URL。解決失敗 / onerror 時はエントリを持たず呼び出し側が noImage にフォールバック */
  thumbUrls: Record<string, string>;
  loadAssets: () => Promise<void>;
  /** 壊れた画像 (ファイル欠損等) の <img @error> ハンドラ */
  onThumbError: (uid: string) => void;
}

export function useAssetThumbnails(): AssetThumbnails {
  // 一覧 (search + サムネイル)。ページングなし (imageAssets.list/search は全件返す)
  const items = ref<ImageAssetRow[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const searchQuery = ref("");
  const thumbUrls = reactive<Record<string, string>>({});
  // 一覧再読込の後着優先トークン (Phase 3 MINOR-2): 検索連打で古い応答が後から返って
  // きても、最新の呼び出し以外は状態に反映しない (usePoiSourceList と同方式)
  let loadToken = 0;

  const loadAssets = async (): Promise<void> => {
    const token = ++loadToken;
    loading.value = true;
    error.value = null;
    try {
      const query = searchQuery.value.trim();
      const rows = query
        ? await window.imageAssets.search(query)
        : await window.imageAssets.list();
      if (token !== loadToken) return; // 後発の呼び出しに上書きされた
      items.value = rows;
      // サムネイルの file:// URL を並行解決 (getFilePath)。個別失敗は noImage フォールバック
      const urls = await Promise.all(
        rows.map((row) => window.imageAssets.getFilePath(row.uid).catch(() => null))
      );
      if (token !== loadToken) return;
      for (const key of Object.keys(thumbUrls)) delete thumbUrls[key];
      rows.forEach((row, i) => {
        const url = urls[i];
        if (url) thumbUrls[row.uid] = url;
      });
    } catch (e) {
      if (token !== loadToken) return;
      error.value = e instanceof Error ? e.message : String(e);
      items.value = [];
    } finally {
      if (token === loadToken) loading.value = false;
    }
  };

  const onThumbError = (uid: string) => {
    delete thumbUrls[uid];
  };

  return { items, loading, error, searchQuery, thumbUrls, loadAssets, onThumbError };
}
