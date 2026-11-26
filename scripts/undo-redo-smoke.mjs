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

  console.log('  [1/5] UndoStack SaaS parity surface: PASS');

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
  assert.match(mapEdit, /performUndo\s*=/, 'MapEdit.vue must implement performUndo');
  assert.match(mapEdit, /performRedo\s*=/, 'MapEdit.vue must implement performRedo');
  assert.match(mapEdit, /recordHistorySnapshot/, 'MapEdit.vue must record history snapshots');
  // 履歴記録契約は「文書の編集だけを記録し、読み込み・再同期は記録しない」
  // 抑止は useHistorySuppression のスコープが担い、MapEdit は履歴タイマーを直接操作しない。
  assert.match(mapEdit, /useHistorySuppression\(/, 'MapEdit.vue must own suppression scopes via useHistorySuppression');
  assert.match(mapEdit, /withoutHistoryAsync\('W1'/, 'W1 (restore) must be wrapped in an async suppression scope');
  for (const tag of ['W2', 'W3', 'W4']) {
    assert.match(mapEdit, new RegExp(`withoutHistory\\('${tag}'`), `${tag} must be wrapped in a suppression scope`);
  }
  // INV-4: 履歴タイマーの直接操作が MapEdit から消えていること
  assert.doesNotMatch(mapEdit, /clearTimeout\(/, 'MapEdit.vue must not clear the history timer directly (INV-4)');
  assert.doesNotMatch(mapEdit, /historyTimer/, 'MapEdit.vue must not own the history timer any more (INV-4)');
  // MapEdit 側の終端廃棄
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
  // 直接確定は保留 origin を破棄せず引き継ぐ
  for (const [name, re] of [
    ['C2 markHistorySaved', /const markHistorySaved = \(\) => \{[\s\S]{0,400}?mergeOrigin\(pending, \['\(direct\)'/],
    ['C3 commitHistorySnapshot', /const commitHistorySnapshot = \(\) => \{[\s\S]{0,400}?mergeOrigin\(pending, \['\(direct\)'/],
  ]) {
    assert.match(mapEdit, re, `${name} must carry the pending timer origin over`);
  }
  // 進入直前フラッシュ。MapEdit 側では catch しない（composable が捕捉して報告する契約）
  const flushCallback = mapEdit.match(/onBeforeFirstScope:\s*\(\)\s*=>\s*\{[\s\S]*?\n    \},/)?.[0] ?? '';
  assert.ok(flushCallback, 'C7 onBeforeFirstScope callback could not be located');
  assert.match(flushCallback, /cancelPendingSnapshot\(\)/, 'C7 must take the pending origin');
  assert.match(flushCallback, /'\(flush\)'/, "C7 must tag its origin with '(flush)'");
  assert.doesNotMatch(flushCallback, /\bcatch\b/, 'C7 callback must not catch (the composable catches and reports)');
  // === 復元時のタイルソース再構築===
  // syncRestoredTiles の本体で exchangeTileSource( が gcpsToMarkers( より前に現れる
  {
    const body = mapEdit.match(/async function syncRestoredTiles\([\s\S]*?\n\}/)?.[0] ?? '';
    assert.ok(body, 'syncRestoredTiles could not be located');
    // 位置比較はコメントを除いた実コードで行う（説明コメントが呼び出しより前に
    // 同名を含むと偽陰性になるため）
    const code = body.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    const exchangeAt = code.indexOf('exchangeTileSource(');
    const markersAt = code.indexOf('gcpsToMarkers(');
    assert.ok(exchangeAt >= 0, 'syncRestoredTiles must rebuild the tile source');
    assert.ok(markersAt >= 0, 'syncRestoredTiles must redraw markers');
    assert.ok(exchangeAt < markersAt, 'the tile source must be rebuilt BEFORE gcpsToMarkers() (coordinate transforms depend on illstSource)');
    assert.match(code, /tileIdentityKey\(/, 'syncRestoredTiles must gate the rebuild on the tile identity key');
  }
  // extension / imageExtension の cleanup
  assert.doesNotMatch(mapEdit, /mapData\.value\.extension\b/, 'mapData.value.extension must not be referenced');
  assert.match(
    mapEdit,
    /const resolveImageExtension = [\s\S]{0,160}?imageExtension/,
    'resolveImageExtension must read imageExtension',
  );
  for (const [name, re] of [
    ['exchangeTileSource', /const exchangeTileSource = async[\s\S]*?\n\};/],
    ['tileIdentityKey', /const tileIdentityKey = [\s\S]*?;\n/],
  ]) {
    const body = mapEdit.match(re)?.[0] ?? '';
    assert.ok(body, `${name} could not be located`);
    assert.match(body, /resolveImageExtension\(/, `${name} must resolve the extension through resolveImageExtension()`);
  }

  // INV-8 (C8): 保留中の編集はポインタ移動より前に確定させる（b）。
  // needle を一意にするため commitPendingBeforeNavigate() ラッパ経由であることを検査する。
  const navigation = mapEdit.match(/const restoreHistoryNavigation = async [\s\S]*?\n\};/)?.[0] ?? '';
  const flushAt = navigation.indexOf('commitPendingBeforeNavigate()');
  const restoreAt = navigation.indexOf('layerTransformState.value[direction]()');
  assert.ok(flushAt >= 0 && restoreAt > flushAt, 'ポインタ移動の前に保留中の履歴を確定する');
  for (const [fn, direction] of [['performUndo', 'undo'], ['performRedo', 'redo']]) {
    assert.ok(mapEdit.includes(`const ${fn} = () => restoreHistoryNavigation('${direction}')`));
    assert.ok(mapEdit.includes(`${direction}: () => moveHistoryPointer('${direction}')`));
  }
  assert.match(mapEdit, /function moveHistoryPointer[\s\S]*?stack\[direction\]\(\)/);
  assert.match(navigation, /if \(!result\.restored/);

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

  console.log('  [2/5] MapEdit history integration surface: PASS');

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

  // 保存フローは useRevisionedAssetSave へ移行済み。
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

  console.log('  [3/5] Undo/Redo UI and shortcut wiring: PASS');

  // MapEdit の POIデータタブ (settings タブの POI カードから移設)。
  // 器は mapData.pois 配列で、順番変更/上書き/解除/追加は共通部品 PoiReferenceEditor が
  // update:pois (配列ごと差し替え) で返す。書き込みは mapData の deep-watch が履歴を拾う
  // (明示 recordHistory 不要 = undo/redo 対象)
  assert.match(
    mapEdit,
    /import PoiReferenceEditor from '\.\.\/components\/PoiReferenceEditor\.vue'/,
    'MapEdit.vue must import PoiReferenceEditor'
  );
  // タブバーは共通 EditorTabs 化され、POI タブの label は editor_ui.tabs.pois
  assert.match(
    mapEdit,
    /key: 'pois', labelKey: 'editor_ui\.tabs\.pois'/,
    "MapEdit.vue must add the POI data tab (editor_ui.tabs.pois) to the EditorTabs bar"
  );
  const poisTab = mapEdit.match(/v-show="activeTab === 'pois'"[\s\S]*?<\/div>/)?.[0] ?? '';
  assert.ok(poisTab, 'MapEdit.vue pois tab block could not be located');
  assert.match(poisTab, /<PoiReferenceEditor/, 'MapEdit.vue must mount PoiReferenceEditor in the pois tab');
  // 右カラム見出しは Map 用 (「この地図のPOIデータ一覧」) を渡す
  assert.match(
    poisTab,
    /heading-key="poiref\.selected_list_map"/,
    'MapEdit.vue must pass the map heading key (poiref.selected_list_map) to PoiReferenceEditor'
  );
  assert.match(mapEdit, /function onPoisChange/, 'MapEdit.vue must apply update:pois back to mapData.pois');
  // 「空ならキー削除」を含む保存形の決定は、AppEdit と共通の書き込み関所
// writeDocumentPois（appPoisFormat）へ移した。表明の意図（MapEdit が保存形を正しく決める経路を
// 持つこと）は不変で、その所在が View 内の直書きから共通実装へ移っただけである。
// 空配列でキーが消えることそのものは smoke Part D が表駆動で検証する。
assert.match(
  mapEdit,
  /writeDocumentPois\(mapData\.value, next, mapData\.value\.pois\)/,
  'MapEdit.vue must route the pois write path through writeDocumentPois (which drops the key when nothing remains)'
);
  // 錨: settings タブの直後に置かれたモーダルのコメント。（779f3df・用語統一）で
  // 「地域指定モーダル」→「絞り込み範囲の指定モーダル」に変わった（#117 S3）。
  const settingsTab = mapEdit.match(/v-show="activeTab === 'settings'"[\s\S]*?<!-- 絞り込み範囲の指定モーダル/)?.[0] ?? '';
  assert.ok(settingsTab, 'MapEdit.vue settings tab block could not be located');
  // 錨だけ合わせて以降の断言が素通りしていないこと: 切り出しは settings タブの v-show から始まり、
  // 中身を持ち、他のタブ（activeTab === …）を飲み込んでいない
  assert.ok(settingsTab.startsWith(`v-show="activeTab === 'settings'"`), 'settings タブの切り出しが v-show から始まらない');
  assert.ok(settingsTab.length > 1000, `settings タブの切り出しが短すぎる (${settingsTab.length} 文字)`);
  assert.equal((settingsTab.match(/activeTab === '/g) ?? []).length, 1, 'settings タブの切り出しが他のタブまで飲み込んでいる');
  console.log(`ok: (S3) settings tab block located (${settingsTab.length} chars, single tab)`);
  // POI カードは settings タブから撤去済み (POIデータタブへ移設)
  assert.doesNotMatch(settingsTab, /PoiSourceSelector|PoiReferenceEditor/, 'settings タブに POI UI が残存している (POIデータタブへ移設済みのはず)');
  // ベースマップ可視性ペインは共有 ResourceSelector へ移行済み。
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

  console.log('  [4/5] MapEdit POI data tab mount: PASS');

  // === CRS 採用の経路（v4 追補 Critical 1）===
  // 採用の反映は 'adopt-crs' の抑止スコープの中で行い、解除の後に履歴を 1 件だけ明示的に記録する。
  // 抑止が解ける前に記録すると、recordHistorySnapshot が抑止を尊重して捨てるので Undo の点が 1 つ消える。
  assert.match(
    mapEdit,
    /withoutHistoryAsync:\s*\(apply\)\s*=>\s*withoutHistoryAsync\('adopt-crs', \(\) => \{\s*apply\(\);\s*applyLayerSnapshotToDocuments\(layerTransformState\.value\.capture\(\)\);/,
    '採用の反映は adopt-crs の抑止スコープの中で行う',
  );
  assert.match(
    mapEdit,
    /commit: \(layers\) => \{\s*applyLayerSnapshotToDocuments\(layers\);\s*commitHistorySnapshot\(\);/,
    '履歴の記録は commitHistorySnapshot の 1 回（デバウンスを待たない直接確定）',
  );
  const adopt = mapEdit.match(/async function adoptCrsEstimation[\s\S]*?\n\}\n/)?.[0] ?? '';
  assert.ok(adopt, 'adoptCrsEstimation could not be located');
  assert.ok(
    adopt.indexOf('commitPendingBeforeNavigate()') >= 0
      && adopt.indexOf('commitPendingBeforeNavigate()') < adopt.indexOf('startAdoption('),
    '採用の前に保留中の編集を確定させる',
  );
  for (const guard of ['documentEditsBlocked', 'saving.value', 'preparingSave.value', 'exporting.value', 'modalVisible.value']) {
    assert.ok(adopt.slice(0, 400).includes(guard), `採用の入口で ${guard} を見て拒否する`);
  }

  // 実物の層モデル・抑止スコープ・UndoStack を MapEdit と同じ配線でつなぎ、履歴が 1 件だけ残ることを動かして確かめる。
  const { useHistorySuppression } = await import(new URL('../src/composables/useHistorySuppression.ts', import.meta.url).href);
  const { useLayerTransformState } = await import(new URL('../src/composables/useLayerTransformState.ts', import.meta.url).href);
  const { UndoStack } = await import(new URL('../src/services/editorUndoStack.ts', import.meta.url).href);
  const options = { strictMode: 'strict', vertexMode: 'plain' };
  const crs = { epsg: 6674, authority: 'EPSG', code: '6674' };
  const worldFile = { xScale: 2, xSkew: 0, xOrigin: 0, ySkew: 0, yScale: -2, yOrigin: 0 };
  const initial = [{
    layerId: 'main', intent: { setup: 'legacyV2' }, buildOptions: options,
    gcps: [[[0, 0], [0, 0]], [[1, 0], [2, 0]], [[0, 1], [0, -2]]], edges: [], bounds: [128, 256],
  }];
  const selection = { intent: { setup: 'B', crs, worldFile }, buildOptions: options, gcps: initial[0].gcps, edges: [] };

  const harness = (prepareAdoption) => {
    const suppression = useHistorySuppression();
    const stack = new UndoStack(structuredClone(initial));
    const log = { scopeTags: [], suppressedAtCommit: [], skipped: 0 };
    // MapEdit の recordHistorySnapshot と同じく、抑止中の記録は捨てる
    const record = (snapshot) => {
      log.suppressedAtCommit.push(suppression.suppressed.value);
      if (suppression.suppressed.value) { log.skipped++; return; }
      stack.push(structuredClone(snapshot));
    };
    const model = useLayerTransformState(initial, {
      history: {
        commit: (layers) => { suppression.cancelPendingSnapshot(); record(layers); },
        undo: () => { if (!stack.canUndo()) return undefined; stack.undo(); return structuredClone(stack.current()); },
        redo: () => { if (!stack.canRedo()) return undefined; stack.redo(); return structuredClone(stack.current()); },
        withoutHistoryAsync: (apply) => suppression.withoutHistoryAsync('adopt-crs', () => {
          log.scopeTags.push(suppression.currentTag.value);
          apply();
        }),
      },
      buildTin: async ({ layer }) => ({ tin: { gcps: layer.gcps, ...layer.buildOptions } }),
      prepareAdoption,
    });
    return { model, stack, log, suppression };
  };

  {
    const { model, stack, log, suppression } = harness(async (copy, picked) => ({ ...copy, ...picked }));
    assert.equal(stack.canUndo(), false);
    assert.deepEqual(await model.startAdoption('main', selection), { status: 'adopted' });
    assert.deepEqual(log.scopeTags, ['adopt-crs'], '反映は adopt-crs のスコープの中');
    assert.deepEqual(log.suppressedAtCommit, [false], '履歴の記録は抑止が解けた後に 1 回だけ');
    assert.equal(log.skipped, 0);
    assert.equal(suppression.suppressed.value, false);
    assert.equal(stack.canUndo(), true);
    assert.equal(stack.current()[0].intent.setup, 'B');
    // Undo で採用前（旧 V2）へ、Redo で採用後へ戻れる
    assert.equal(model.undo().restored, true);
    assert.equal(model.capture()[0].intent.setup, 'legacyV2');
    assert.equal(stack.canUndo(), false);
    assert.equal(model.redo().restored, true);
    assert.equal(model.capture()[0].intent.setup, 'B');
  }
  {
    // 準備に失敗・拒否された採用は履歴を作らず、スコープも残さない
    const { model, stack, log, suppression } = harness(async () => { throw new Error('reference_mismatch'); });
    assert.equal((await model.startAdoption('main', selection)).status, 'failed');
    assert.equal(stack.canUndo(), false);
    assert.deepEqual(log.suppressedAtCommit, []);
    assert.equal(suppression.suppressed.value, false);
    assert.equal(model.capture()[0].intent.setup, 'legacyV2');
  }

  console.log('  [5/5] CRS adoption history path: PASS');
  console.log('Undo/Redo smoke passed');
} catch (err) {
  console.error('Undo/Redo smoke FAILED:', err.message);
  process.exit(1);
}
