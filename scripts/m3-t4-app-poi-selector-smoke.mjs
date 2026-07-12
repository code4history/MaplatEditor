import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

try {
  // --- Part 1: useAppDraft 型拡張 + saveDraft シグネチャ ---
  const useAppDraft = await readFile(
    path.join(projectRoot, 'src/composables/useAppDraft.ts'),
    'utf8'
  );

  // MinimalAppDraft に selectedPoiSources が存在すること
  assert.match(
    useAppDraft,
    /selectedPoiSources\s*\?\s*:\s*SelectedPoiSourceRef\[\]/,
    'useAppDraft.ts に selectedPoiSources がない'
  );

  // saveDraft がオブジェクト引数を取ること（旧 3 引数シグネチャでないこと）
  assert.doesNotMatch(
    useAppDraft,
    /function\s+saveDraft\s*\(\s*ref\s*:\s*SelectedRegisteredMapRef/,
    'useAppDraft.ts の saveDraft が旧 3 引数シグネチャのまま'
  );

  // saveDraft が MinimalAppDraft オブジェクト引数を取ること
  assert.match(
    useAppDraft,
    /function\s+saveDraft\s*\(\s*draft\s*:\s*MinimalAppDraft\s*\)/,
    'useAppDraft.ts の saveDraft が MinimalAppDraft オブジェクト引数を取らない'
  );

  // loadDraft が selectedPoiSources の正規化を行うこと
  assert.match(
    useAppDraft,
    /selectedPoiSources/,
    'useAppDraft.ts の loadDraft に selectedPoiSources 正規化がない'
  );

  // SelectedPoiSourceRef を import すること
  assert.match(
    useAppDraft,
    /SelectedPoiSourceRef/,
    'useAppDraft.ts に SelectedPoiSourceRef の import がない'
  );

  // --- Part 1b: AppDraftService.ts 型拡張 ---
  const appDraftService = await readFile(
    path.join(projectRoot, 'electron/services/AppDraftService.ts'),
    'utf8'
  );

  // MinimalAppDraft に selectedPoiSources が存在すること
  assert.match(
    appDraftService,
    /selectedPoiSources\s*\?\s*:/,
    'AppDraftService.ts に selectedPoiSources がない'
  );

  // selectedMap が optional であること
  assert.match(
    appDraftService,
    /selectedMap\s*\?\s*:/,
    'AppDraftService.ts の selectedMap が optional でない'
  );

  console.log('  [1/3] useAppDraft + AppDraftService 型拡張: PASS');

  // --- Part 2: AppList/AppEdit app editor shape ---
  const appList = await readFile(
    path.join(projectRoot, 'src/views/AppList.vue'),
    'utf8'
  );
  const appEdit = await readFile(
    path.join(projectRoot, 'src/views/AppEdit.vue'),
    'utf8'
  );

  // AppList は地図/ベースマップ一覧に集中 (POI selector はエディタ側の責務)
  assert.doesNotMatch(
    appList,
    /PoiSourceSelector/,
    'AppList に POI selector が残っている'
  );

  // Phase 8 Task 2: AppEdit の POI UI は POIデータタブの PoiReferenceEditor に集約
  // (PoiSourceSelector は PoiReferenceEditor が追加用に内蔵する)
  assert.match(
    appEdit,
    /PoiReferenceEditor/,
    'AppEdit に PoiReferenceEditor がマウントされていない'
  );
  const poiReferenceEditor = await readFile(
    path.join(projectRoot, 'src/components/PoiReferenceEditor.vue'),
    'utf8'
  );
  assert.match(
    poiReferenceEditor,
    /PoiSourceSelector/,
    'PoiReferenceEditor が追加用の PoiSourceSelector を内蔵していない'
  );

  // AppList は複数アプリ一覧であること
  assert.match(
    appList,
    /window\.applist\.request/,
    'AppList.vue が window.applist.request を呼んでいない'
  );

  assert.match(
    appList,
    /router\.push\("\/appedit"\)/,
    'AppList.vue が新規 AppEdit へ遷移しない'
  );

  // AppEdit は metadata/sources/pois/preview タブ構成であること (Phase 8 で POIデータタブ追加)
  assert.match(
    appEdit,
    /activeTab\s*=\s*ref<"metadata"\s*\|\s*"sources"\s*\|\s*"pois"\s*\|\s*"preview">/,
    'AppEdit.vue に metadata/sources/pois/preview タブ状態がない'
  );

  assert.match(
    appEdit,
    /window\.baseMaps\.list\s*\(\s*\)/,
    'AppEdit.vue が window.baseMaps.list() を呼んでいない'
  );

  // raw window.maplist.* の直呼びは m1-t2 smoke の allowlist で禁止されているため、
  // サービス層 fetchAllRegisteredMaps の利用を検証する
  assert.match(
    appEdit,
    /fetchAllRegisteredMaps/,
    'AppEdit.vue が desktopMapList サービス(fetchAllRegisteredMaps)を使っていない'
  );

  assert.match(
    appEdit,
    /window\.appedit\.preparePreview/,
    'AppEdit.vue が HTTP プレビュー作成 API を呼んでいない'
  );

  console.log('  [2/3] AppList.vue app editor shape: PASS');

  // --- Part 3: PoiSourceSelector.vue shape ---
  const poiSourceSelector = await readFile(
    path.join(projectRoot, 'src/components/PoiSourceSelector.vue'),
    'utf8'
  );

  // usePoiSourceList composable を使用すること
  assert.match(
    poiSourceSelector,
    /usePoiSourceList/,
    'PoiSourceSelector に usePoiSourceList がない'
  );

  // @update:selected を emit すること
  assert.match(
    poiSourceSelector,
    /update:selected/,
    'PoiSourceSelector に update:selected emit がない'
  );

  // 複数選択が可能であること（selectedSources が配列）
  assert.match(
    poiSourceSelector,
    /selectedSources\s*=\s*ref<SelectedPoiSourceRef\[\]>/,
    'PoiSourceSelector の selectedSources が配列でない'
  );

  // toggleSelect 関数が存在すること
  assert.match(
    poiSourceSelector,
    /function\s+toggleSelect/,
    'PoiSourceSelector に toggleSelect がない'
  );

  // isSelected 関数が存在すること
  assert.match(
    poiSourceSelector,
    /function\s+isSelected/,
    'PoiSourceSelector に isSelected がない'
  );

  console.log('  [3/3] PoiSourceSelector.vue shape: PASS');

  console.log('M3-T4 App editor POI selector smoke passed');
} catch (err) {
  console.error('M3-T4 smoke FAILED:', err.message);
  process.exit(1);
}
