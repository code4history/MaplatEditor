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
  assert.match(mapEdit, /historyStack\.value\.save\s*\(\)/, 'Save success must reset dirty history base');
  assert.match(mapEdit, /onMainProcessMessage/, 'MapEdit.vue must handle Electron menu undo/redo messages');

  // Phase 4 Task 2: 保存フローは useRevisionedAssetSave へ移行済み。
  // 成功時の画面固有処理は applySuccess クロージャ (reloadFromStore オプションの直前) に残る
  const saveSuccessBlock = mapEdit.match(/applySuccess:\s*async[\s\S]*?reloadFromStore:/)?.[0] ?? '';
  assert.ok(saveSuccessBlock, 'MapEdit.vue save success branch (applySuccess closure) could not be located');
  assert.doesNotMatch(saveSuccessBlock, /mapedit\.request/, 'Save success must not reload the map after saving');
  assert.match(saveSuccessBlock, /resetHistoryBase\s*\(\)/, 'Save success must reset dirty history base via resetHistoryBase');

  const electronMain = await readFile(
    path.join(projectRoot, 'electron/main.ts'),
    'utf8'
  );
  assert.match(electronMain, /menu:undo/, 'Electron menu must send an app undo message');
  assert.match(electronMain, /menu:redo/, 'Electron menu must send an app redo message');
  assert.doesNotMatch(electronMain, /role:\s*['"]undo['"]/, 'Electron Undo menu must not use native role only');
  assert.doesNotMatch(electronMain, /role:\s*['"]redo['"]/, 'Electron Redo menu must not use native role only');

  console.log('  [3/4] Undo/Redo UI and shortcut wiring: PASS');

  // Phase 7 Task 3 (POI-137): MapEdit の settings タブに POI ソース selector をマウント。
  // 器は mapData.pois 配列で、差分反映は AppEdit と共有の utils/poiReferenceUi。
  // 書き込みは mapData の deep-watch が履歴を拾う (明示 recordHistory 不要 = undo/redo 対象)
  assert.match(
    mapEdit,
    /import PoiSourceSelector from '\.\.\/components\/PoiSourceSelector\.vue'/,
    'MapEdit.vue must import PoiSourceSelector'
  );
  assert.match(
    mapEdit,
    /import \{ extractPoiRefs, applyPoiSelection, samePoiSelection \} from '\.\.\/utils\/poiReferenceUi'/,
    'MapEdit.vue must use the shared poiReferenceUi helpers'
  );
  const settingsTab = mapEdit.match(/v-show="activeTab === 'settings'"[\s\S]*?<!-- 地域指定モーダル/)?.[0] ?? '';
  assert.ok(settingsTab, 'MapEdit.vue settings tab block could not be located');
  assert.match(settingsTab, /<PoiSourceSelector/, 'MapEdit.vue must mount PoiSourceSelector in the settings tab');
  assert.match(settingsTab, /mapedit\.poi_selector_label/, 'POI selector must have its own mapedit.poi_selector_label heading');
  assert.match(mapEdit, /function syncPoiSelectionFromMapData/, 'MapEdit.vue must sync selector state from mapData.pois');
  assert.match(mapEdit, /function onPoiSelectionChange/, 'MapEdit.vue must write selector changes back to mapData.pois');
  assert.match(mapEdit, /delete mapData\.value\.pois/, 'MapEdit.vue must drop the pois key when nothing remains');
  // ベースマップ可視性カードは flex-basis 0 で「POI カード確保後の残り空間」を受け取ること。
  // basis auto (flex-grow-1 のみ) だと flex-shrink-0 の POI カードとの圧縮競合でこのカードだけが
  // 潰れ、一覧のスクロール領域が 0px になる (2026-07-11 実機バグの再発防止)
  assert.match(
    settingsTab,
    /style="flex: 1 1 0; min-height: 0;"[\s\S]{0,200}?mapedit\.base_map_visibility/,
    'ベースマップ可視性カードに flex: 1 1 0 がない (POI カードとの圧縮競合で一覧が 0px に潰れる)'
  );

  console.log('  [4/4] MapEdit POI source selector mount: PASS');
  console.log('M4 Undo/Redo smoke passed');
} catch (err) {
  console.error('M4 Undo/Redo smoke FAILED:', err.message);
  process.exit(1);
}
