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
    /ResourceSelectorList/,
    'PoiReferenceEditor が共通 ResourceSelectorList を内蔵していない'
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

  assert.match(appEdit, /baseMapSearchAdapter/, 'AppEdit.vue が base map search adapter を使っていない');
  assert.match(appEdit, /createMapListAdapter/, 'AppEdit.vue が map search adapter を使っていない');

  assert.match(
    appEdit,
    /window\.appedit\.preparePreview/,
    'AppEdit.vue が HTTP プレビュー作成 API を呼んでいない'
  );

  console.log('  [2/3] AppList.vue app editor shape: PASS');

  // --- Part 3: shared POI selector shape ---
  assert.match(poiReferenceEditor, /poiSourceAdapter/, 'PoiReferenceEditor に POI search adapter がない');
  assert.match(poiReferenceEditor, /function\s+addPoiSource/, 'PoiReferenceEditor に追加操作がない');
  assert.match(poiReferenceEditor, /isPoiSelected\(item\.uid\)/, '追加済み POI の無効化がない');
  assert.match(poiReferenceEditor, /toggle-spatial-context/, '空間 context toggle の転送がない');
  console.log('  [3/3] shared POI selector shape: PASS');

  console.log('M3-T4 App editor POI selector smoke passed');
} catch (err) {
  console.error('M3-T4 smoke FAILED:', err.message);
  process.exit(1);
}
