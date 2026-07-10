import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

try {
  // --- Part 1: Header.vue POI tab ---
  const headerSource = await readFile(
    path.join(projectRoot, 'src/components/Header.vue'),
    'utf8'
  );

  // navbar.edit_poi が存在すること
  assert.match(
    headerSource,
    /edit_poi/,
    'Header.vue に edit_poi key がない'
  );

  // POI tab が navigate('PoiSourceList') を呼ぶこと
  assert.match(
    headerSource,
    /navigate\s*\(\s*['"]PoiSourceList['"]\s*\)/,
    'Header.vue に navigate("PoiSourceList") がない'
  );

  // isPoiSection computed が存在すること
  assert.match(
    headerSource,
    /isPoiSection/,
    'Header.vue に isPoiSection computed がない'
  );

  console.log('  [1/5] Header.vue POI tab: PASS');

  // --- Part 2: router poisource routes ---
  const routerSource = await readFile(
    path.join(projectRoot, 'src/router/index.ts'),
    'utf8'
  );

  // /poisources route が定義されていること
  assert.match(
    routerSource,
    /path\s*:\s*['"]\/poisources['"]/,
    'router に /poisources route がない'
  );

  // /poisources/:sourceId route が定義されていること
  assert.match(
    routerSource,
    /path\s*:\s*['"]\/poisources\/:sourceId['"]/,
    'router に /poisources/:sourceId route がない'
  );

  // PoiSourceList component が定義されていること
  assert.match(
    routerSource,
    /name\s*:\s*['"]PoiSourceList['"]/,
    'router に PoiSourceList name がない'
  );

  // PoiSourceDetail component が定義されていること
  assert.match(
    routerSource,
    /name\s*:\s*['"]PoiSourceDetail['"]/,
    'router に PoiSourceDetail name がない'
  );

  console.log('  [2/5] router poisource routes: PASS');

  // --- Part 3: PoiSourceList.vue shape ---
  const poiSourceList = await readFile(
    path.join(projectRoot, 'src/views/PoiSourceList.vue'),
    'utf8'
  );

  // usePoiSourceList composable を使用すること (一覧→編集 遷移型、MapList/AppList 同型)
  assert.match(
    poiSourceList,
    /usePoiSourceList/,
    'PoiSourceList が usePoiSourceList を使っていない'
  );

  // 新規作成 (local) フロー: window.poiSources.createLocal を呼ぶこと
  assert.match(
    poiSourceList,
    /poiSources\.createLocal/,
    'PoiSourceList が window.poiSources.createLocal を呼んでいない'
  );

  // インポートフロー: window.poiSources.importFile を呼ぶこと
  assert.match(
    poiSourceList,
    /poiSources\.importFile/,
    'PoiSourceList が window.poiSources.importFile を呼んでいない'
  );

  // インポートファイル選択: window.poiSources.pickImportFile を呼ぶこと
  assert.match(
    poiSourceList,
    /poiSources\.pickImportFile/,
    'PoiSourceList が window.poiSources.pickImportFile を呼んでいない'
  );

  // リモート登録フロー: window.poiSources.registerRemote を呼ぶこと
  assert.match(
    poiSourceList,
    /poiSources\.registerRemote/,
    'PoiSourceList が window.poiSources.registerRemote を呼んでいない'
  );

  // 削除前に参照提示 (AID-006): window.poiSources.findReferences を呼ぶこと
  assert.match(
    poiSourceList,
    /poiSources\.findReferences/,
    'PoiSourceList が window.poiSources.findReferences を呼んでいない'
  );

  // 削除フロー: window.poiSources.delete を呼ぶこと
  assert.match(
    poiSourceList,
    /poiSources\.delete/,
    'PoiSourceList が window.poiSources.delete を呼んでいない'
  );

  // slug 可用性チェック: window.assets.checkSlug を呼ぶこと (MapEdit と同 UX)
  assert.match(
    poiSourceList,
    /assets\.checkSlug/,
    'PoiSourceList が window.assets.checkSlug を呼んでいない'
  );

  // 新規作成フローで title → slug 自動提案が配線されていること (43 §3.2「自動生成初期値の提示」):
  // modal.title の watcher が suggestSlug を呼ぶ
  assert.match(
    poiSourceList,
    /watch\s*\(\s*\(\)\s*=>\s*modal\.title[\s\S]*?suggestSlug\s*\(/,
    'PoiSourceList に title → slug 自動提案 (watch modal.title → suggestSlug) がない'
  );

  // 手入力後は自動提案が上書きしないこと (slugEdited フラグ)
  assert.match(
    poiSourceList,
    /slugEdited/,
    'PoiSourceList に slug 手入力フラグ (slugEdited) がない'
  );

  // 成功時に uid でエディタへ遷移すること (router.push('/poisources/' + uid))
  assert.match(
    poiSourceList,
    /router\.push\([^)]*\/poisources\/\$\{[^}]*uid[^}]*\}/,
    'PoiSourceList が uid でエディタへ遷移していない'
  );

  // 生 ipcRenderer を使わないこと (House rule / m2-t3)
  assert.doesNotMatch(
    poiSourceList,
    /ipcRenderer/,
    'PoiSourceList に生 ipcRenderer 使用が残存している'
  );

  // --- Part 3b: usePoiSourceList composable shape ---
  const usePoiSourceList = await readFile(
    path.join(projectRoot, 'src/composables/usePoiSourceList.ts'),
    'utf8'
  );

  // window.poiSources.list を呼ぶこと (query/page/pageSize 契約)
  assert.match(
    usePoiSourceList,
    /poiSources\.list/,
    'usePoiSourceList が window.poiSources.list を呼んでいない'
  );

  // ページング (prev/next) を提供すること
  assert.match(
    usePoiSourceList,
    /nextPage/,
    'usePoiSourceList に nextPage がない'
  );
  assert.match(
    usePoiSourceList,
    /prevPage/,
    'usePoiSourceList に prevPage がない'
  );

  console.log('  [3/5] PoiSourceList.vue shape: PASS');

  // --- Part 4: PoiSourceDetail.vue shape ---
  const poiSourceDetail = await readFile(
    path.join(projectRoot, 'src/views/PoiSourceDetail.vue'),
    'utf8'
  );

  // usePoiSourceDetail composable を使用すること
  assert.match(
    poiSourceDetail,
    /usePoiSourceDetail/,
    'PoiSourceDetail が usePoiSourceDetail を使っていない'
  );

  // PoiFeatureTable コンポーネントを使用すること
  assert.match(
    poiSourceDetail,
    /PoiFeatureTable/,
    'PoiSourceDetail が PoiFeatureTable を使っていない'
  );

  // v-model:features が使用されていること
  assert.match(
    poiSourceDetail,
    /v-model:features/,
    'PoiSourceDetail に v-model:features がない'
  );

  // remote source で read-only flag が設定されること
  assert.match(
    poiSourceDetail,
    /document\.summary\.readOnly/,
    'PoiSourceDetail に readOnly flag がない'
  );

  // --- Part 4b: usePoiSourceDetail composable shape ---
  const usePoiSourceDetail = await readFile(
    path.join(projectRoot, 'src/composables/usePoiSourceDetail.ts'),
    'utf8'
  );

  // window.poiSources.get を呼ぶこと
  assert.match(
    usePoiSourceDetail,
    /poiSources\.get/,
    'usePoiSourceDetail が window.poiSources.get を呼んでいない'
  );

  // window.poiSources.save を呼ぶこと (v2: uid + {slug,title,fc,expectedRevision} 契約)
  assert.match(
    usePoiSourceDetail,
    /poiSources\.save/,
    'usePoiSourceDetail が window.poiSources.save を呼んでいない'
  );
  assert.doesNotMatch(
    usePoiSourceDetail,
    /poiSources\.saveLocal/,
    'usePoiSourceDetail に旧 saveLocal 呼び出しが残存している'
  );

  // window.poiSources.refreshRemote を呼ぶこと (旧 validateRemote は POI-118 の明示再取得へ刷新)
  assert.match(
    usePoiSourceDetail,
    /poiSources\.refreshRemote/,
    'usePoiSourceDetail が window.poiSources.refreshRemote を呼んでいない'
  );

  // window.poiSources.delete を呼ぶこと
  assert.match(
    usePoiSourceDetail,
    /poiSources\.delete/,
    'usePoiSourceDetail が window.poiSources.delete を呼んでいない'
  );

  // save エラーハンドリングが try/catch であること
  assert.match(
    usePoiSourceDetail,
    /catch\s*\(/,
    'usePoiSourceDetail の save に try/catch がない'
  );

  console.log('  [4/5] PoiSourceDetail.vue shape: PASS');

  // --- Part 5: PoiFeatureTable.vue shape ---
  const poiFeatureTable = await readFile(
    path.join(projectRoot, 'src/components/PoiFeatureTable.vue'),
    'utf8'
  );

  // v-model:features プロップを受け取ること
  assert.match(
    poiFeatureTable,
    /features\s*:\s*PoiFeatureCollection/,
    'PoiFeatureTable に features プロップがない'
  );

  // @update:features を emit すること
  assert.match(
    poiFeatureTable,
    /update:features/,
    'PoiFeatureTable に update:features emit がない'
  );

  // inline input が存在すること（name）
  assert.match(
    poiFeatureTable,
    /type\s*=\s*["']text["'].*form-control/s,
    'PoiFeatureTable に name input がない'
  );

  // inline input が存在すること（longitude）
  assert.match(
    poiFeatureTable,
    /type\s*=\s*["']number["'].*form-control/s,
    'PoiFeatureTable に longitude input がない'
  );

  // name フィールドに is-invalid クラス付与ロジックがあること
  assert.match(
    poiFeatureTable,
    /is-invalid/,
    'PoiFeatureTable に is-invalid クラスがない'
  );

  // v-for :key が feature.id ?? 'new-${index}' のパターンであること
  assert.match(
    poiFeatureTable,
    /feature\.id\s*\?\?\s*`new-\$\{index\}`/,
    'PoiFeatureTable の v-for :key パターンが不正'
  );

  console.log('  [5/5] PoiFeatureTable.vue shape: PASS');

  console.log('M3-T3 POI source manager UI smoke passed');
} catch (err) {
  console.error('M3-T3 smoke FAILED:', err.message);
  process.exit(1);
}
