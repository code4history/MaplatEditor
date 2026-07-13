import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

try {
  const undoStack = await readFile(
    path.join(projectRoot, 'src/services/editorUndoStack.ts'),
    'utf8'
  );

  assert.match(undoStack, /const\s+MAX_HISTORY\s*=\s*100/, 'UndoStack must keep SaaS MAX_HISTORY=100');
  assert.match(undoStack, /export\s+class\s+UndoStack<T>/, 'UndoStack class is missing');
  assert.match(undoStack, /canUndo\s*\(\)\s*:\s*boolean/, 'UndoStack.canUndo() is missing');
  assert.match(undoStack, /canRedo\s*\(\)\s*:\s*boolean/, 'UndoStack.canRedo() is missing');
  assert.match(undoStack, /isDirty\s*\(\)\s*:\s*boolean/, 'UndoStack.isDirty() is missing');
  assert.match(undoStack, /static\s+fromSnapshot<T>/, 'UndoStack.fromSnapshot() is missing');

  console.log('  [1/4] UndoStack SaaS parity surface: PASS');

  const mapEdit = await readFile(
    path.join(projectRoot, 'src/views/MapEdit.vue'),
    'utf8'
  );

  assert.match(mapEdit, /import\s+\{\s*UndoStack/, 'MapEdit.vue must import UndoStack');
  assert.match(mapEdit, /type\s+MapEditHistoryState/, 'MapEdit.vue must define MapEditHistoryState');
  assert.match(mapEdit, /captureHistoryState\s*\(\)/, 'MapEdit.vue must capture editable state');
  assert.match(mapEdit, /restoreHistoryState\s*\(/, 'MapEdit.vue must restore editable state');
  assert.match(mapEdit, /historyStack\s*=\s*ref<UndoStack<MapEditHistoryState>\s*\|\s*null>/, 'MapEdit.vue must own an UndoStack ref');
  assert.match(mapEdit, /canUndo\s*=\s*computed/, 'MapEdit.vue must expose canUndo');
  assert.match(mapEdit, /canRedo\s*=\s*computed/, 'MapEdit.vue must expose canRedo');
  assert.match(mapEdit, /performUndo\s*=\s*async/, 'MapEdit.vue must implement performUndo');
  assert.match(mapEdit, /performRedo\s*=\s*async/, 'MapEdit.vue must implement performRedo');
  assert.match(mapEdit, /recordHistorySnapshot/, 'MapEdit.vue must record history snapshots');
  assert.match(mapEdit, /historyRestoring/, 'MapEdit.vue must guard restore from recording new history');

  console.log('  [2/4] MapEdit history integration surface: PASS');

  assert.match(mapEdit, /@click="performUndo"/, 'MapEdit.vue must wire Undo button');
  assert.match(mapEdit, /@click="performRedo"/, 'MapEdit.vue must wire Redo button');
  assert.match(mapEdit, /:disabled="!canUndo"/, 'Undo button must be disabled when unavailable');
  assert.match(mapEdit, /:disabled="!canRedo"/, 'Redo button must be disabled when unavailable');
  assert.match(mapEdit, /keydown/, 'MapEdit.vue must register keyboard shortcuts');
  assert.match(mapEdit, /metaKey\s*\|\|\s*event\.ctrlKey/, 'Keyboard shortcuts must support Cmd/Ctrl');
  assert.match(mapEdit, /performUndo\s*\(\)/, 'Keyboard shortcut must call performUndo');
  assert.match(mapEdit, /performRedo\s*\(\)/, 'Keyboard shortcut must call performRedo');
  assert.match(mapEdit, /historyStack\.value\.save\s*\(\)/, 'Save success must record a history checkpoint');
  assert.match(mapEdit, /onMainProcessMessage/, 'MapEdit.vue must handle Electron menu undo/redo messages');

  // Phase 4 Task 2: 保存フローは useRevisionedAssetSave へ移行済み。
  // 成功時の画面固有処理は applySuccess クロージャ (reloadFromStore オプションの直前) に残る
  const saveSuccessBlock = mapEdit.match(/applySuccess:\s*async[\s\S]*?reloadFromStore:/)?.[0] ?? '';
  assert.ok(saveSuccessBlock, 'MapEdit.vue save success branch (applySuccess closure) could not be located');
  assert.doesNotMatch(saveSuccessBlock, /mapedit\.request/, 'Save success must not reload the map after saving');
  assert.match(saveSuccessBlock, /markHistorySaved\s*\(\)/, 'Save success must preserve history and mark its checkpoint');
  assert.doesNotMatch(saveSuccessBlock, /resetHistoryBase\s*\(\)/, 'Save success must not clear the history stack');

  const electronMain = await readFile(
    path.join(projectRoot, 'electron/main.ts'),
    'utf8'
  );
  assert.match(electronMain, /menu:undo/, 'Electron menu must send an app undo message');
  assert.match(electronMain, /menu:redo/, 'Electron menu must send an app redo message');
  assert.doesNotMatch(electronMain, /role:\s*['"]undo['"]/, 'Electron Undo menu must not use native role only');
  assert.doesNotMatch(electronMain, /role:\s*['"]redo['"]/, 'Electron Redo menu must not use native role only');

  console.log('  [3/4] Undo/Redo UI and shortcut wiring: PASS');

  // Phase 8 Task 2: MapEdit の POIデータタブ (settings タブの POI カードから移設)。
  // 器は mapData.pois 配列で、順番変更/上書き/解除/追加は共通部品 PoiReferenceEditor が
  // update:pois (配列ごと差し替え) で返す。書き込みは mapData の deep-watch が履歴を拾う
  // (明示 recordHistory 不要 = undo/redo 対象)
  assert.match(
    mapEdit,
    /import PoiReferenceEditor from '\.\.\/components\/PoiReferenceEditor\.vue'/,
    'MapEdit.vue must import PoiReferenceEditor'
  );
  assert.match(
    mapEdit,
    /activeTab === 'pois'[\s\S]{0,200}?poiref\.tab_label/,
    'MapEdit.vue must add the POI data tab (poiref.tab_label) to the tab bar'
  );
  const poisTab = mapEdit.match(/v-show="activeTab === 'pois'"[\s\S]*?<\/div>/)?.[0] ?? '';
  assert.ok(poisTab, 'MapEdit.vue pois tab block could not be located');
  assert.match(poisTab, /<PoiReferenceEditor/, 'MapEdit.vue must mount PoiReferenceEditor in the pois tab');
  // Phase 8 Task 5: 右カラム見出しは Map 用 (「この地図のPOIデータ一覧」) を渡す
  assert.match(
    poisTab,
    /heading-key="poiref\.selected_list_map"/,
    'MapEdit.vue must pass the map heading key (poiref.selected_list_map) to PoiReferenceEditor'
  );
  assert.match(mapEdit, /function onPoisChange/, 'MapEdit.vue must apply update:pois back to mapData.pois');
  assert.match(mapEdit, /delete mapData\.value\.pois/, 'MapEdit.vue must drop the pois key when nothing remains');
  const settingsTab = mapEdit.match(/v-show="activeTab === 'settings'"[\s\S]*?<!-- 地域指定モーダル/)?.[0] ?? '';
  assert.ok(settingsTab, 'MapEdit.vue settings tab block could not be located');
  // POI カードは settings タブから撤去済み (POIデータタブへ移設)
  assert.doesNotMatch(settingsTab, /PoiSourceSelector|PoiReferenceEditor/, 'settings タブに POI UI が残存している (POIデータタブへ移設済みのはず)');
  // ベースマップ可視性カードは flex-basis 0 で残り空間を受け取ること。
  // basis auto (flex-grow-1 のみ) だと flex-shrink-0 の兄弟カードとの圧縮競合でこのカードだけが
  // 潰れ、一覧のスクロール領域が 0px になる (2026-07-11 実機バグの再発防止)
  assert.match(
    settingsTab,
    /style="flex: 1 1 0; min-height: 0;"[\s\S]{0,200}?mapedit\.base_map_visibility/,
    'ベースマップ可視性カードに flex: 1 1 0 がない (圧縮競合で一覧が 0px に潰れる)'
  );
  // テキスト欄内の Cmd+Z 復活 (2026-07-11): menu:undo のセッション undo は
  // 編集フィールド内では発動しない (ネイティブ undo は App.vue が振り分け)
  assert.match(
    mapEdit,
    /onMainProcessMessage[\s\S]{0,400}?isEditableElement\(document\.activeElement\)/,
    'MapEdit の menu:undo ハンドラに編集フィールド中の抑止 (isEditableElement) がない'
  );

  // v-show と d-flex の同居禁止: Bootstrap の display:flex!important が v-show の
  // inline display:none に勝ち、ペインが常時表示になって後続タブを覆い隠す
  // (2026-07-12 実機バグ: settings ペインが POIデータタブを隠していた)
  assert.doesNotMatch(
    mapEdit,
    /<[a-zA-Z][^>]*v-show[^>]*\bd-flex\b[^>]*>/,
    'MapEdit に v-show + d-flex 同居要素がある (v-show 専用ラッパーを挟むこと)'
  );

  console.log('  [4/4] MapEdit POI data tab mount: PASS');
  console.log('M4 Undo/Redo smoke passed');
} catch (err) {
  console.error('M4 Undo/Redo smoke FAILED:', err.message);
  process.exit(1);
}
