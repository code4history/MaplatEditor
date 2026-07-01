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
    /import\s+type\s*\{[^}]*SelectedPoiSourceRef[^}*\}\s+from/,
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

  // --- Part 2: AppList.vue shape ---
  const appList = await readFile(
    path.join(projectRoot, 'src/views/AppList.vue'),
    'utf8'
  );

  // PoiSourceSelector コンポーネントを使用すること
  assert.match(
    appList,
    /PoiSourceSelector/,
    'AppList.vue に PoiSourceSelector がない'
  );

  // currentDraft ref が存在すること
  assert.match(
    appList,
    /currentDraft/,
    'AppList.vue に currentDraft がない'
  );

  // saveDraft を currentDraft で呼ぶこと
  assert.match(
    appList,
    /saveDraft\s*\(\s*currentDraft\.value\s*\)/,
    'AppList.vue で saveDraft を currentDraft で呼んでいない'
  );

  // onPoiSourcesUpdate 関数が存在すること
  assert.match(
    appList,
    /function\s+onPoiSourcesUpdate/,
    'AppList.vue に onPoiSourcesUpdate がない'
  );

  // clearDraft を使っていないこと（死蔵）
  assert.doesNotMatch(
    appList,
    /clearDraft\s*\(\s*\)/,
    'AppList.vue に clearDraft が残存している'
  );

  console.log('  [2/3] AppList.vue shape: PASS');

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
    /selectedSources\s*:\s*Ref<SelectedPoiSourceRef\[\]>/,
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
