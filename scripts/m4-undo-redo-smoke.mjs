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
  // m1-t6-hotfix-1 (AC8): 履歴記録契約は「文書の編集だけを記録し、読み込み・再同期は記録しない」
  // （設計 2026-08-01-m1-t6-hotfix-1-mapedit-history-derived-write-design.md v1.9 §5.1）。
  // 抑止は useHistorySuppression のスコープが担い、MapEdit は履歴タイマーを直接操作しない。
  assert.match(mapEdit, /useHistorySuppression\(/, 'MapEdit.vue must own suppression scopes via useHistorySuppression');
  assert.match(mapEdit, /withoutHistoryAsync\('W1'/, 'W1 (restore) must be wrapped in an async suppression scope');
  for (const tag of ['W2', 'W3', 'W4']) {
    assert.match(mapEdit, new RegExp(`withoutHistory\\('${tag}'`), `${tag} must be wrapped in a suppression scope`);
  }
  // INV-4: 履歴タイマーの直接操作が MapEdit から消えていること
  assert.doesNotMatch(mapEdit, /clearTimeout\(/, 'MapEdit.vue must not clear the history timer directly (INV-4)');
  assert.doesNotMatch(mapEdit, /historyTimer/, 'MapEdit.vue must not own the history timer any more (INV-4)');
  // C1 / C6: MapEdit 側の終端廃棄
  assert.match(
    mapEdit,
    /const resetHistoryBase = \(\) => \{[\s\S]{0,200}?cancelPendingSnapshot\(\)/,
    'C1 resetHistoryBase must discard the pending snapshot origin',
  );
  assert.match(
    mapEdit,
    /onBeforeUnmount\(\(\) => \{[\s\S]{0,200}?cancelPendingSnapshot\(\)/,
    'C6 onBeforeUnmount must discard the pending snapshot origin',
  );
  // C2 / C3: 直接確定は保留 origin を破棄せず引き継ぐ
  for (const [name, re] of [
    ['C2 markHistorySaved', /const markHistorySaved = \(\) => \{[\s\S]{0,400}?mergeOrigin\(pending, \['\(direct\)'/],
    ['C3 commitHistorySnapshot', /const commitHistorySnapshot = \(\) => \{[\s\S]{0,400}?mergeOrigin\(pending, \['\(direct\)'/],
  ]) {
    assert.match(mapEdit, re, `${name} must carry the pending timer origin over`);
  }
  // C7: 進入直前フラッシュ。MapEdit 側では catch しない（composable が捕捉して報告する契約）
  const flushCallback = mapEdit.match(/onBeforeFirstScope:\s*\(\)\s*=>\s*\{[\s\S]*?\n    \},/)?.[0] ?? '';
  assert.ok(flushCallback, 'C7 onBeforeFirstScope callback could not be located');
  assert.match(flushCallback, /cancelPendingSnapshot\(\)/, 'C7 must take the pending origin');
  assert.match(flushCallback, /'\(flush\)'/, "C7 must tag its origin with '(flush)'");
  assert.doesNotMatch(flushCallback, /\bcatch\b/, 'C7 callback must not catch (the composable catches and reports)');
  // INV-3: origin は引数で渡る（取得と消費の責務分離）
  assert.match(mapEdit, /const recordHistorySnapshot = \(origin/, 'recordHistorySnapshot must take an explicit origin (INV-3)');
  // INV-6: journal を書くのは MapEdit 側。onDiagnostic の3分岐から journal() を呼ぶ
  const diagHandler = mapEdit.match(/onDiagnostic:\s*\(e\)\s*=>\s*\{[\s\S]*?\n    \},/)?.[0] ?? '';
  assert.ok(diagHandler, 'onDiagnostic handler could not be located');
  for (const t of ['schedule', 'discard-suppressed', 'flush-error']) {
    assert.ok(diagHandler.includes(`'${t}'`), `onDiagnostic must handle ${t}`);
  }
  assert.match(diagHandler, /journal\(/, 'onDiagnostic must record through MapEdit journal() (INV-6)');

  // INV-7: composable 側の onDiagnostic 呼び出しはすべて try の内側にある
  const suppression = await readFile(
    path.join(projectRoot, 'src/composables/useHistorySuppression.ts'),
    'utf8'
  );
  const bareDiagnosticCalls = suppression
    .split('\n')
    .filter((line) => /options\.onDiagnostic\?\.\(/.test(line)).length;
  assert.equal(bareDiagnosticCalls, 1, 'onDiagnostic must be invoked from exactly one place (the reportDiagnostic wrapper)');
  assert.match(
    suppression,
    /const reportDiagnostic[\s\S]{0,300}?try \{[\s\S]{0,120}?options\.onDiagnostic\?\.\(event\);[\s\S]{0,120}?\} catch/,
    'the single onDiagnostic call must sit inside the non-interrupting try/catch wrapper (INV-7)',
  );

  console.log('  [2/4] MapEdit history integration surface: PASS');

  assert.match(mapEdit, /@undo="performUndo"/, 'MapEdit.vue must wire shared Header Undo');
  assert.match(mapEdit, /@redo="performRedo"/, 'MapEdit.vue must wire shared Header Redo');
  assert.match(mapEdit, /:can-undo="canUndo"/, 'Header Undo must receive availability');
  assert.match(mapEdit, /:can-redo="canRedo"/, 'Header Redo must receive availability');
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
  // M11-T3/T9: タブバーは共通 EditorTabs 化され、POI タブの label は editor_ui.tabs.pois
  assert.match(
    mapEdit,
    /key: 'pois', labelKey: 'editor_ui\.tabs\.pois'/,
    "MapEdit.vue must add the POI data tab (editor_ui.tabs.pois) to the EditorTabs bar"
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
  // ベースマップ可視性ペインは共有 ResourceSelector (M12-T10 v2.0) へ移行済み。
  // 旧 inline `flex: 1 1 0; min-height: 0;` の意図 = 「兄弟要素との圧縮競合で一覧の
  // スクロール領域が 0px に潰れない」(2026-07-11 実機バグの再発防止) は、ホスト側の
  // flex-grow-1 min-h-0 と ResourceSelector 内部の min-height:0 / overflow:auto が引き継ぐ
  assert.match(
    settingsTab,
    /<ResourceSelector[^>]*class="[^"]*\bflex-grow-1\b[^"]*\bmin-h-0\b/,
    'settings タブの ResourceSelector に flex-grow-1 min-h-0 がない (圧縮競合で一覧が 0px に潰れる)'
  );
  assert.match(
    settingsTab,
    /mapedit\.base_map_visibility/,
    'settings タブにベースマップ可視性ペイン (mapedit.base_map_visibility) がない'
  );
  const resourceSelector = await readFile(
    path.join(projectRoot, 'src/components/ResourceSelector.vue'),
    'utf8'
  );
  assert.match(
    resourceSelector,
    /min-height:\s*0/,
    'ResourceSelector のペインに min-height: 0 がない (一覧潰れ防止の引き継ぎ先)'
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
