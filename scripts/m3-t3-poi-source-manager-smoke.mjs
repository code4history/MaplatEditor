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

  console.log('  [1/3] Header.vue POI tab: PASS');

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

  // エディタ (Phase 4: PoiEdit) が定義されていること (旧 PoiSourceDetail は m4-t5 で置換済み)
  assert.match(
    routerSource,
    /name\s*:\s*['"]PoiEdit['"]/,
    'router に PoiEdit name がない'
  );

  console.log('  [2/3] router poisource routes: PASS');

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

  console.log('  [3/3] PoiSourceList.vue shape: PASS');

  // 旧 PoiSourceDetail / PoiFeatureTable / usePoiSourceDetail のアサーションは
  // Phase 4 Task 5 (PoiEdit への置換) で削除。エディタ側の検証は m4-t5-poi-edit-smoke.mjs 参照

  console.log('M3-T3 POI source manager UI smoke passed');
} catch (err) {
  console.error('M3-T3 smoke FAILED:', err.message);
  process.exit(1);
}
