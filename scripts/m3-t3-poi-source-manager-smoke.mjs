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

  // M11-T6: 一覧は共通 primitives (useInfiniteResourceList + resource adapter) を使用 (MapList/AppList 同型)
  assert.match(
    poiSourceList,
    /useInfiniteResourceList/,
    'PoiSourceList が useInfiniteResourceList を使っていない'
  );
  assert.match(
    poiSourceList,
    /createPoiSourceListAdapter/,
    'PoiSourceList が createPoiSourceListAdapter を使っていない'
  );

  // M11-T10b 遅延作成統一: 一覧は行作成 IPC を直接呼ばず、エディタ未作成モードへ遷移する。
  // （createLocal / importFile / pickImportFile は PoiEdit 側が保存・import 自動起動で呼ぶ）
  assert.doesNotMatch(
    poiSourceList,
    /poiSources\.createLocal\(/,
    'PoiSourceList が window.poiSources.createLocal を直接呼んでいる（遅延作成違反）'
  );
  assert.match(
    poiSourceList,
    /\/poisources\/new/,
    'PoiSourceList の新規作成が /poisources/new 遷移でない'
  );
  assert.match(
    poiSourceList,
    /\/poisources\/new\?import=1/,
    'PoiSourceList のインポートが /poisources/new?import=1 遷移でない'
  );

  // リモート登録 UI は 18d62d8 でフラグ裏へ退避 (M11 一覧刷新後は未再配線)。
  // backend 契約 (poisource:registerRemote IPC) が存続していることを確認する
  const poiPreload = await readFile(
    path.join(projectRoot, 'electron/preload.ts'),
    'utf8'
  );
  assert.match(
    poiPreload,
    /poisource:registerRemote/,
    'preload に poisource:registerRemote IPC 配線がない'
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

  // M11-T7 (AC17): 生 checkSlug は撤去され、slug 可用性は PoiEdit 側の共通 SlugField が担う
  assert.doesNotMatch(
    poiSourceList,
    /assets\.checkSlug/,
    'PoiSourceList に生 checkSlug が残っている (AC17)'
  );

  // M11-T10b: 作成モーダル撤去 + 遅延作成統一に伴い、import のファイル名 → suggestSlug の
  // 自動提案 (43 §3.2) は PoiEdit の import 自動起動へ移動。一覧は /poisources/new 系へ遷移するだけ
  const poiEditSrc = await readFile(
    path.join(projectRoot, 'src/views/PoiEdit.vue'),
    'utf8'
  );
  assert.match(
    poiEditSrc,
    /suggestSlug\(picked\.fileName\)/,
    'PoiEdit の import 自動起動が suggestSlug でファイル名から slug を提案していない'
  );
  assert.match(
    poiEditSrc,
    /router\.replace\(\{ path: `\/poisources\/\$\{result\.uid\}` \}\)/,
    'PoiEdit の import 成功後の正準化遷移がない'
  );

  // 生 ipcRenderer を使わないこと (House rule / m2-t3)
  assert.doesNotMatch(
    poiSourceList,
    /ipcRenderer/,
    'PoiSourceList に生 ipcRenderer 使用が残存している'
  );

  // --- Part 3b: POI source search adapter shape ---
  const poiSourceAdapter = await readFile(
    path.join(projectRoot, 'src/views/resource-adapters/poiSourceListAdapter.ts'),
    'utf8'
  );

  // bbox 対応 search API を呼ぶこと
  assert.match(
    poiSourceAdapter,
    /window\.search\.poiSources/,
    'poiSourceListAdapter が window.search.poiSources を呼んでいない'
  );

  // cursor page を次 batch として提供すること
  assert.match(
    poiSourceAdapter,
    /nextCursor:\s*result\.next/,
    'poiSourceListAdapter に次 cursor がない'
  );

  console.log('  [3/3] PoiSourceList.vue shape: PASS');

  // 旧 PoiSourceDetail / PoiFeatureTable / usePoiSourceDetail のアサーションは
  // Phase 4 Task 5 (PoiEdit への置換) で削除。エディタ側の検証は m4-t5-poi-edit-smoke.mjs 参照

  console.log('M3-T3 POI source manager UI smoke passed');
} catch (err) {
  console.error('M3-T3 smoke FAILED:', err.message);
  process.exit(1);
}
