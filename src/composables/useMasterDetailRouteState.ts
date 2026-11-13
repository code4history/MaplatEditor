import { useRoute, useRouter } from "vue-router";
import { mergeMasterDetailQuery } from "../utils/masterDetailRouteState";

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

  // 保存の後: 一覧を読み直してから保存した行を選ぶ。読み直しの間に利用者が別の画面や行へ
  // 移ったら、保存した行へ引き戻さない（BaseMap/Asset の master-detail 共通）。
  // 検索語だけの変更は移動に数えない（選び直して new の印を外す。検索語は残る）
  const selectSavedAfterReload = async (uid: string, reload: () => Promise<void>) => {
    const pathAtSave = route.path;
    const uidAtSave = route.query.uid;
    await reload();
    if (route.path !== pathAtSave || route.query.uid !== uidAtSave) return;
    await select(uid, false);
  };

  return { select, selectDuplicate, clearSelection, selectSavedAfterReload };
}
