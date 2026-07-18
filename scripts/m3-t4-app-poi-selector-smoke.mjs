import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

try {
  // --- Part 1: App draft lifecycle keeps the complete AppDocument ---
  const assetDraftLifecycle = await readFile(
    path.join(projectRoot, 'src/composables/useAssetDraftLifecycle.ts'),
    'utf8'
  );
  assert.match(assetDraftLifecycle, /useAssetDraftLifecycle<T>/);
  assert.match(assetDraftLifecycle, /serialize:\s*\(\)\s*=>\s*T/);
  console.log('  [1/3] Generic asset draft lifecycle preserves AppDocument: PASS');

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
  // M11-T6: 一覧データ取得は adapter 層経由 (AppList → createAppListAdapter → window.applist.request)
  assert.match(
    appList,
    /createAppListAdapter/,
    'AppList.vue が createAppListAdapter を使っていない'
  );

  // M11-T10: 新規追加は既存 new-draft があればそれを引き継いで遷移する
  assert.match(
    appList,
    /router\.push\([^;]*"\/appedit"\)/,
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

  // 行クリックで追加できること (Phase 8 Task 5: 地図選択の addMapSource と同じ挙動 —
  // 追加済み行は no-op で、解除は PoiReferenceEditor 右カラムの × から行う)
  assert.match(
    poiSourceSelector,
    /function\s+addSource/,
    'PoiSourceSelector に addSource がない'
  );
  assert.match(
    poiSourceSelector,
    /if \(isSelected\(source\.uid\)\) return;/,
    'PoiSourceSelector の addSource が追加済み no-op (地図選択と同じ挙動) になっていない'
  );

  // isSelected 関数が存在すること
  assert.match(
    poiSourceSelector,
    /function\s+isSelected/,
    'PoiSourceSelector に isSelected がない'
  );

  // 検索ボックス付き一覧であること (Phase 8 Task 5: 地図選択タブと同じ操作体系)
  assert.match(
    poiSourceSelector,
    /poisource\.search_placeholder/,
    'PoiSourceSelector に検索ボックスがない'
  );

  console.log('  [3/3] PoiSourceSelector.vue shape: PASS');

  console.log('M3-T4 App editor POI selector smoke passed');
} catch (err) {
  console.error('M3-T4 smoke FAILED:', err.message);
  process.exit(1);
}
