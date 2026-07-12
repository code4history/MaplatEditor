// Phase 4 Task 5/6: PoiEdit エディタのソースパターン smoke。
// Task 5: /poisources/:sourceId が PoiEdit へ置き換わり、保存 (useRevisionedAssetSave) と
// 編集セッション (usePoiEditSession)、slug 一意性 (checkSlug excludeUid)、ReadOnly 分岐
// (cloneToLocal)、LangResourceInput が配線されていることを検証する。
// Task 6: 地図ペイン (PoiEditMap) の contextmenu 追加/削除・Modify ドラッグ移動・
// クリック選択・ReadOnly ガードの配線を検証する。
// Task 7: 属性フォーム (PoiAttributeForm) の存在と PoiEdit 配線、フィールド確定 =
// patchFeatureProperties/moveFeature 1 回、表示 ID 文字種・重複ガード、座標域外ガード、
// html XSS 警告、focusName expose を検証する。
// Task 8: feature 一覧 (PoiFeatureList) の存在と PoiEdit 配線、自前 windowing
// (spacer + scrollTop)、フィルタ対象 (表示 ID / name / desc)、scroll-to-selected、
// 新規作成 = mapSession.addFeature 経由、readOnly ガードを検証する。
// Phase 5 Task 2: raw GeoJSON 双方向ペイン (PoiRawPane) の存在と PoiEdit 配線、
// toExportForm/fromExportForm 配線、Apply = session.commit 1 回 (=1 Undo)、
// level==='error' ガード、規模ガード (poiGeoJson の export 定数)、readOnly を検証する。
// Phase 6 Task 4: AssetPicker (icon/image 共用モーダル) の存在と PoiAttributeForm 配線
// (icon/selectedIcon の解釈表示 + picker + クリア + 手入力 fallback、image 行 picker)、
// parseIconRef/isRegisteredIconSet 使用、未登録 setId / 未存在 asset 警告、
// 既存 onIconChange/onImageChange 確定経路の維持 (Undo 粒度不変)、readOnly を検証する。
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

const fileExists = async (relPath) => {
  try {
    await access(path.join(projectRoot, relPath));
    return true;
  } catch {
    return false;
  }
};

try {
  // --- Part 1: router が /poisources/:sourceId を PoiEdit へ向けていること ---
  const routerSource = await readFile(
    path.join(projectRoot, 'src/router/index.ts'),
    'utf8'
  );

  assert.match(
    routerSource,
    /path\s*:\s*['"]\/poisources\/:sourceId['"]/,
    'router に /poisources/:sourceId route がない'
  );
  assert.match(
    routerSource,
    /name\s*:\s*['"]PoiEdit['"]/,
    'router に PoiEdit name がない'
  );
  assert.match(
    routerSource,
    /import\(['"]\.\.\/views\/PoiEdit\.vue['"]\)/,
    'router が PoiEdit.vue を import していない'
  );
  assert.doesNotMatch(
    routerSource,
    /PoiSourceDetail/,
    'router に旧 PoiSourceDetail が残存している'
  );

  console.log('  [1/11] router PoiEdit route: PASS');

  // --- Part 2: PoiEdit.vue の配線 ---
  const poiEdit = await readFile(
    path.join(projectRoot, 'src/views/PoiEdit.vue'),
    'utf8'
  );

  // 保存フロー: revision 楽観ロックの共通 composable を使うこと (ADR-0007)
  assert.match(
    poiEdit,
    /useRevisionedAssetSave/,
    'PoiEdit が useRevisionedAssetSave を使っていない'
  );

  // 編集セッション: 明示 commit = 1 Undo 単位 (仕様 §5)
  assert.match(
    poiEdit,
    /usePoiEditSession/,
    'PoiEdit が usePoiEditSession を使っていない'
  );

  // 読込/保存の IPC 契約
  assert.match(
    poiEdit,
    /poiSources\.get/,
    'PoiEdit が window.poiSources.get を呼んでいない'
  );
  assert.match(
    poiEdit,
    /poiSources\.save/,
    'PoiEdit が window.poiSources.save を呼んでいない'
  );

  // 離脱確認 (goBack ボタン方式) のダイアログ文言
  assert.match(
    poiEdit,
    /poiedit\.confirm_no_save/,
    'PoiEdit に poiedit.confirm_no_save 離脱確認がない'
  );

  // slug 一意性チェック: excludeUid 付き checkSlug (ADR-0007: 自分の現 slug は空き扱い)
  assert.match(
    poiEdit,
    /assets\.checkSlug/,
    'PoiEdit が window.assets.checkSlug を呼んでいない'
  );
  assert.match(
    poiEdit,
    /excludeUid/,
    'PoiEdit の checkSlug に excludeUid がない'
  );

  // ReadOnly (remote) 分岐: 編集 UI を read-only 化し、cloneToLocal 導線を出す
  assert.match(
    poiEdit,
    /readOnly/,
    'PoiEdit に readOnly 分岐がない'
  );
  assert.match(
    poiEdit,
    /poiSources\.cloneToLocal/,
    'PoiEdit が window.poiSources.cloneToLocal を呼んでいない'
  );

  // title 編集は LangResourceInput 経由
  assert.match(
    poiEdit,
    /LangResourceInput/,
    'PoiEdit が LangResourceInput を使っていない'
  );

  // Undo/Redo: キーボード + menu:undo/redo IPC (MapEdit と同パターン)
  assert.match(
    poiEdit,
    /menu:undo/,
    'PoiEdit に menu:undo IPC ハンドリングがない'
  );
  assert.match(
    poiEdit,
    /onMainProcessMessage/,
    'PoiEdit が appEvents.onMainProcessMessage を購読していない'
  );

  // 診断/失敗メッセージは共有写像 (utils/poiSourceMessages) を使うこと
  assert.match(
    poiEdit,
    /poiSourceMessages/,
    'PoiEdit が utils/poiSourceMessages を使っていない'
  );

  // テキスト欄内の Cmd+Z 復活 (2026-07-11): メニューアクセラレータがネイティブ undo を
  // 横取りするため、App.vue がグローバルに handleMenuTextUndoRedo で振り分け、
  // PoiEdit のセッション undo は編集フィールド内では発動しない
  {
    const appVue = await readFile(path.join(projectRoot, 'src/App.vue'), 'utf8');
    assert.match(
      appVue,
      /handleMenuTextUndoRedo/,
      'App.vue がネイティブテキスト undo の振り分け (handleMenuTextUndoRedo) を配線していない'
    );
  }
  assert.match(
    poiEdit,
    /onMainProcessMessage[\s\S]{0,400}?isEditableElement\(document\.activeElement\)/,
    'PoiEdit の menu:undo ハンドラに編集フィールド中の抑止 (isEditableElement) がない'
  );

  // 保存中オーバーレイ: 保存クリック → IPC 応答までの編集操作を全面抑制する
  // (ユーザー決定 2026-07-11)。Delete キー経路にも saving ガードがあること
  assert.match(
    poiEdit,
    /poi-saving-overlay/,
    'PoiEdit に保存中オーバーレイ (poi-saving-overlay) がない'
  );
  assert.match(
    poiEdit,
    /onDeleteKeydown[\s\S]{0,200}?saveHandle\.saving\.value/,
    'onDeleteKeydown に saving ガードがない (保存中の Delete が編集を変更してしまう)'
  );

  // 生 ipcRenderer を使わないこと (House rule / m2-t3)
  assert.doesNotMatch(
    poiEdit,
    /ipcRenderer/,
    'PoiEdit に生 ipcRenderer 使用が残存している'
  );

  console.log('  [2/11] PoiEdit.vue wiring: PASS');

  // --- Part 3: LangResourceInput.vue の形 ---
  const langResourceInput = await readFile(
    path.join(projectRoot, 'src/components/LangResourceInput.vue'),
    'utf8'
  );

  // modelValue prop (string | Record<string,string> | undefined) と update:modelValue emit
  assert.match(
    langResourceInput,
    /modelValue\?\s*:\s*string\s*\|\s*Record<string,\s*string>/,
    'LangResourceInput の modelValue prop 型が契約と異なる'
  );
  assert.match(
    langResourceInput,
    /update:modelValue/,
    'LangResourceInput に update:modelValue emit がない'
  );

  // 11 言語タブは LANGS_MAP から導出 (重複定義しない)
  assert.match(
    langResourceInput,
    /LANGS_MAP/,
    'LangResourceInput が LANGS_MAP を使っていない'
  );

  // 確定時のみ emit (@change)。入力毎 (@input) には emit しない
  assert.match(
    langResourceInput,
    /@change/,
    'LangResourceInput に @change 確定ハンドラがない'
  );
  assert.doesNotMatch(
    langResourceInput,
    /@input/,
    'LangResourceInput が入力毎 (@input) に emit している'
  );

  // multiline / warning props (html XSS 警告用、POI-109)
  assert.match(
    langResourceInput,
    /multiline\?\s*:\s*boolean/,
    'LangResourceInput に multiline prop がない'
  );
  assert.match(
    langResourceInput,
    /warning\?\s*:\s*string/,
    'LangResourceInput に warning prop がない'
  );

  assert.doesNotMatch(
    langResourceInput,
    /ipcRenderer/,
    'LangResourceInput に生 ipcRenderer 使用が残存している'
  );

  console.log('  [3/11] LangResourceInput.vue shape: PASS');

  // --- Part 4: 旧画面 3 ファイルが削除されていること ---
  for (const relPath of [
    'src/views/PoiSourceDetail.vue',
    'src/components/PoiFeatureTable.vue',
    'src/composables/usePoiSourceDetail.ts',
  ]) {
    assert.equal(
      await fileExists(relPath),
      false,
      `旧ファイル ${relPath} が削除されていない`
    );
  }

  console.log('  [4/11] legacy files removed: PASS');

  // --- Part 5 (Task 6): PoiEdit 側の地図ペイン統合 ---
  // 地図ペインは PoiEditMap コンポーネントとしてマウントされること
  assert.match(
    poiEdit,
    /import PoiEditMap from ['"]\.\.\/components\/PoiEditMap\.vue['"]/,
    'PoiEdit が PoiEditMap を import していない'
  );
  assert.match(
    poiEdit,
    /<PoiEditMap[\s\S]*?:session=/,
    'PoiEdit が PoiEditMap に session を渡していない'
  );
  assert.match(
    poiEdit,
    /<PoiEditMap[\s\S]*?:read-only=/,
    'PoiEdit が PoiEditMap に read-only を渡していない'
  );

  // Delete キー削除: isInput 判定は onHistoryKeydown と同一関数 (isInputTarget) を共有
  assert.match(
    poiEdit,
    /const isInputTarget = /,
    'PoiEdit に共有の isInputTarget 判定がない'
  );
  assert.ok(
    (poiEdit.match(/isInputTarget\(event\)/g) || []).length >= 2,
    'isInputTarget が undo/redo と Delete キーの両方で共有されていない'
  );
  assert.match(
    poiEdit,
    /['"]Delete['"]/,
    'PoiEdit に Delete キーによる削除がない'
  );
  assert.match(
    poiEdit,
    /session\.removeFeature\(/,
    'PoiEdit の Delete キーが session.removeFeature を呼んでいない'
  );

  console.log('  [5/11] PoiEdit map pane integration: PASS');

  // --- Part 6 (Task 6): PoiEditMap.vue の配線 ---
  const poiEditMap = await readFile(
    path.join(projectRoot, 'src/components/PoiEditMap.vue'),
    'utf8'
  );

  // ol-contextmenu: 同梱版を import し defaultItems:false で作成、open で動的 push
  assert.match(
    poiEditMap,
    /import ContextMenu from ['"]\.\.\/libs\/ol-contextmenu\/main['"]/,
    'PoiEditMap が同梱 ol-contextmenu を import していない'
  );
  assert.match(
    poiEditMap,
    /new ContextMenu\(\{[\s\S]*?defaultItems:\s*false/,
    'PoiEditMap の ContextMenu が defaultItems:false で作成されていない'
  );

  // contextmenu 経由の追加/削除 (i18n キー + session API)
  assert.match(
    poiEditMap,
    /poiedit\.context_add/,
    'PoiEditMap に poiedit.context_add 項目がない'
  );
  assert.match(
    poiEditMap,
    /poiedit\.context_delete/,
    'PoiEditMap に poiedit.context_delete 項目がない'
  );
  assert.match(
    poiEditMap,
    /session\.addFeature\(/,
    'PoiEditMap の contextmenu が session.addFeature を呼んでいない'
  );
  assert.match(
    poiEditMap,
    /session\.removeFeature\(/,
    'PoiEditMap の contextmenu が session.removeFeature を呼んでいない'
  );

  // ドラッグ移動: marker source への Modify + Snap、modifyend → moveFeature (=1 Undo)
  assert.match(
    poiEditMap,
    /import \{[^}]*\bModify\b[^}]*\} from ['"]ol\/interaction['"]/,
    'PoiEditMap が ol/interaction の Modify を import していない'
  );
  assert.match(
    poiEditMap,
    /import \{[^}]*\bSnap\b[^}]*\} from ['"]ol\/interaction['"]/,
    'PoiEditMap が ol/interaction の Snap を import していない'
  );
  assert.match(
    poiEditMap,
    /modifystart/,
    'PoiEditMap に modifystart ハンドラがない'
  );
  assert.match(
    poiEditMap,
    /modifyend/,
    'PoiEditMap に modifyend ハンドラがない'
  );
  assert.match(
    poiEditMap,
    /session\.moveFeature\(/,
    'PoiEditMap の modifyend が session.moveFeature を呼んでいない'
  );

  // クリック選択: forEachFeatureAtPixel (layerFilter 'marker'、hitTolerance 5)
  assert.match(
    poiEditMap,
    /forEachFeatureAtPixel/,
    'PoiEditMap がクリック選択に forEachFeatureAtPixel を使っていない'
  );
  assert.match(
    poiEditMap,
    /layer\.get\(['"]name['"]\)\s*===\s*['"]marker['"]/,
    'PoiEditMap の layerFilter が marker レイヤーを対象にしていない'
  );
  assert.match(
    poiEditMap,
    /hitTolerance:\s*5/,
    'PoiEditMap の hitTolerance が 5 でない'
  );
  assert.match(
    poiEditMap,
    /session\.selectedUid/,
    'PoiEditMap が session.selectedUid を更新していない'
  );

  // base map selector: osm default + IPC 失敗時 /tms_list.json fallback (MapEdit 踏襲)
  assert.match(
    poiEditMap,
    /baseMaps\.list/,
    'PoiEditMap が window.baseMaps.list で base map 一覧を取っていない'
  );
  assert.match(
    poiEditMap,
    /tms_list\.json/,
    'PoiEditMap に /tms_list.json fallback がない'
  );
  assert.match(
    poiEditMap,
    /['"]osm['"]/,
    'PoiEditMap の base map default が osm でない'
  );

  // ReadOnly ガード: Modify の setActive(false) + contextmenu の disable()
  assert.match(
    poiEditMap,
    /setActive\(!/,
    'PoiEditMap が readOnly で Modify を無効化していない'
  );
  assert.match(
    poiEditMap,
    /contextmenu\.disable\(\)/,
    'PoiEditMap が readOnly で contextmenu を無効化していない'
  );

  // 一覧からの地図同期 API (Task 8 で使用)
  assert.match(
    poiEditMap,
    /defineExpose\(\{[\s\S]*?panTo/,
    'PoiEditMap が panTo を expose していない'
  );

  // 生 ipcRenderer を使わないこと (House rule / m2-t3)
  assert.doesNotMatch(
    poiEditMap,
    /ipcRenderer/,
    'PoiEditMap に生 ipcRenderer 使用が残存している'
  );

  // icon 読み込み失敗フォールバック (Phase 8 品質レビュー MAJOR-3): new Image() の preload
  // チェックで onerror 時に標準ピンへ差し替え、scheduleIconRedraw で再描画すること
  assert.match(
    poiEditMap,
    /new Image\(\)/,
    'PoiEditMap が icon の preload チェックに new Image() を使っていない'
  );
  assert.match(
    poiEditMap,
    /probe\.onerror\s*=\s*\(\)\s*=>\s*\{[\s\S]*?iconLoadOkCache\.set\([^,]+,\s*false\)[\s\S]*?scheduleIconRedraw\(\)/,
    'PoiEditMap の icon onerror ハンドラが失敗を記録して scheduleIconRedraw を呼んでいない'
  );
  assert.match(
    poiEditMap,
    /iconLoadOkCache\.get\(resolved\.src\)\s*!==\s*true/,
    'PoiEditMap の iconRefStyle が読み込み未確認/失敗時に標準ピンへフォールバックしていない'
  );
  // builtin (previewUrl) は同梱静的アセットのため読み込み失敗チェックの対象外とすること
  assert.match(
    poiEditMap,
    /if\s*\(!resolved\.pinShaped\)\s*\{/,
    'PoiEditMap が builtin (pinShaped) を読み込み失敗チェックの対象外にしていない'
  );

  console.log('  [6/11] PoiEditMap.vue map pane wiring: PASS');

  // --- Part 7 (Task 7): 属性フォーム (PoiAttributeForm) ---
  const attrForm = await readFile(
    path.join(projectRoot, 'src/components/PoiAttributeForm.vue'),
    'utf8'
  );

  // PoiEdit 配線: import + session/read-only を渡してマウント
  assert.match(
    poiEdit,
    /import PoiAttributeForm from ['"]\.\.\/components\/PoiAttributeForm\.vue['"]/,
    'PoiEdit が PoiAttributeForm を import していない'
  );
  assert.match(
    poiEdit,
    /<PoiAttributeForm[\s\S]*?:session=/,
    'PoiEdit が PoiAttributeForm に session を渡していない'
  );
  assert.match(
    poiEdit,
    /<PoiAttributeForm[\s\S]*?:read-only=/,
    'PoiEdit が PoiAttributeForm に read-only を渡していない'
  );

  // 新規追加時の name フォーカス: addFeature 直後の uid で focusName() を呼ぶ配線
  assert.match(
    poiEdit,
    /focusName\(\)/,
    'PoiEdit が addFeature 後に focusName() を呼んでいない'
  );

  // 未選択時プレースホルダ
  assert.match(
    attrForm,
    /poiedit\.select_poi/,
    'PoiAttributeForm に未選択プレースホルダ (poiedit.select_poi) がない'
  );

  // フィールド確定 = session API 1 回 (patch / move / remove)
  assert.match(
    attrForm,
    /session\.patchFeatureProperties\(/,
    'PoiAttributeForm が session.patchFeatureProperties を呼んでいない'
  );
  assert.match(
    attrForm,
    /session\.moveFeature\(/,
    'PoiAttributeForm の座標入力が session.moveFeature を呼んでいない'
  );
  assert.match(
    attrForm,
    /session\.removeFeature\(/,
    'PoiAttributeForm の削除ボタンが session.removeFeature を呼んでいない'
  );

  // 確定は change のみ (入力毎に commit しない)
  assert.match(
    attrForm,
    /@change/,
    'PoiAttributeForm に @change 確定ハンドラがない'
  );

  // LangResource フィールドは共用部品 LangResourceInput 経由
  assert.match(
    attrForm,
    /import LangResourceInput from ['"]\.\/LangResourceInput\.vue['"]/,
    'PoiAttributeForm が LangResourceInput を使っていない'
  );

  // html の XSS 警告 (POI-109、サニタイズはしない)
  assert.match(
    attrForm,
    /poiedit\.html_xss_warning/,
    'PoiAttributeForm に html XSS 警告 (poiedit.html_xss_warning) がない'
  );

  // 表示 ID: 文字種 (poiGeoJson の DISPLAY_ID_PATTERN 再利用) + ソース内重複ガード
  assert.match(
    attrForm,
    /DISPLAY_ID_PATTERN/,
    'PoiAttributeForm が DISPLAY_ID_PATTERN (poiGeoJson) を再利用していない'
  );
  assert.match(
    attrForm,
    /poisource\.errors\.display_id_charset/,
    'PoiAttributeForm に表示 ID 文字種エラーがない'
  );
  assert.match(
    attrForm,
    /poisource\.errors\.display_id_duplicate/,
    'PoiAttributeForm に表示 ID 重複エラーがない'
  );

  // name 必須 (2026-07-11 ポリシー: 空になる確定も commit し、エラーは committed 値から再判定)
  assert.match(
    attrForm,
    /poisource\.errors\.name_required/,
    'PoiAttributeForm に name 必須エラーがない'
  );

  // 座標域外表示 (±180/±90、非有限も含む。committed 値から再判定して表示する)
  assert.match(
    attrForm,
    /Number\.isFinite/,
    'PoiAttributeForm の座標入力に有限性ガードがない'
  );
  assert.match(
    attrForm,
    /-180|180/,
    'PoiAttributeForm に座標域外の範囲判定がない'
  );
  assert.match(
    attrForm,
    /poisource\.errors\.coord_range/,
    'PoiAttributeForm に座標域外エラーがない'
  );

  // 新ポリシー (2026-07-11): 域外でも有限数値なら commit する = onCoordChange の非 commit
  // ガードに範囲判定 (-180 等) が含まれず、moveFeature に到達すること
  const onCoordChangeBody = attrForm.match(
    /const onCoordChange = [\s\S]*?session\.moveFeature\([\s\S]*?\n\};/
  );
  assert.ok(
    onCoordChangeBody,
    'PoiAttributeForm の onCoordChange が moveFeature に到達していない'
  );
  assert.doesNotMatch(
    onCoordChangeBody[0],
    /-180|>\s*180|-90|>\s*90/,
    'PoiAttributeForm の onCoordChange が域外を非 commit ガードにしている (域外でも commit する新ポリシー)'
  );

  // 新ポリシー (2026-07-11): 表示 ID の空のみ非 commit (backend ensureDisplayIds の自動採番で
  // markSaved 後に DB と session が乖離するため。理由コメント必須)
  assert.match(
    attrForm,
    /ensureDisplayIds/,
    'PoiAttributeForm に表示 ID 空を非 commit にする理由 (ensureDisplayIds 乖離) のコメントがない'
  );

  // 新ポリシー (2026-07-11): PoiEdit が error レベル live issue を診断領域に表示し、
  // 保存ボタンを disabled にする (堰は backend Invalid + 事前ゲート)
  assert.match(
    poiEdit,
    /liveErrors/,
    'PoiEdit に error レベル live issue (liveErrors) がない'
  );
  assert.match(
    poiEdit,
    /liveErrors\.length > 0/,
    'PoiEdit の保存ボタンが error レベル live issue で disabled になっていない'
  );
  // type="number" の v-model は数値を返すため、String 化してから trim すること
  // (2026-07-11 実機バグ: lonInput.value.trim() が TypeError で座標入力が丸ごと無反応)
  assert.match(
    attrForm,
    /String\(lonInput\.value[\s\S]{0,20}\.trim\(\)/,
    'PoiAttributeForm の座標入力が String() 化せずに trim している (number v-model は数値を返す)'
  );

  // 新規追加時フォーカス用 focusName の expose
  assert.match(
    attrForm,
    /defineExpose\(\{[\s\S]*?focusName/,
    'PoiAttributeForm が focusName を expose していない'
  );

  // 生 ipcRenderer を使わないこと (House rule / m2-t3)
  assert.doesNotMatch(
    attrForm,
    /ipcRenderer/,
    'PoiAttributeForm に生 ipcRenderer 使用が残存している'
  );

  console.log('  [7/11] PoiAttributeForm.vue attribute form wiring: PASS');

  // --- Part 8 (Task 8): feature 一覧 (PoiFeatureList) ---
  const featureList = await readFile(
    path.join(projectRoot, 'src/components/PoiFeatureList.vue'),
    'utf8'
  );

  // PoiEdit 配線: import + session/read-only を渡してマウント、select/create を受ける
  assert.match(
    poiEdit,
    /import PoiFeatureList from ['"]\.\.\/components\/PoiFeatureList\.vue['"]/,
    'PoiEdit が PoiFeatureList を import していない'
  );
  assert.match(
    poiEdit,
    /<PoiFeatureList[\s\S]*?:session=/,
    'PoiEdit が PoiFeatureList に session を渡していない'
  );
  assert.match(
    poiEdit,
    /<PoiFeatureList[\s\S]*?:read-only=/,
    'PoiEdit が PoiFeatureList に read-only を渡していない'
  );
  assert.match(
    poiEdit,
    /<PoiFeatureList[\s\S]*?@select=/,
    'PoiEdit が PoiFeatureList の select を受けていない'
  );
  assert.match(
    poiEdit,
    /<PoiFeatureList[\s\S]*?@create=/,
    'PoiEdit が PoiFeatureList の create を受けていない'
  );

  // 行選択の実行責務は PoiEdit 側: selectedUid 書き込み + 明示 pan (仕様 §3.3)
  assert.match(
    poiEdit,
    /session\.selectedUid\.value = uid/,
    'PoiEdit の一覧行選択が session.selectedUid を書いていない'
  );
  assert.match(
    poiEdit,
    /mapPane\.value\?\.panTo\(uid\)/,
    'PoiEdit の一覧行選択が mapPane.panTo を呼んでいない'
  );

  // 新規作成 = 地図中央 (getCenterLngLat) + mapSession (wrapper) の addFeature 経由
  // (生 session.addFeature では name フォーカスが飛ばない、Task 7 実装メモ)
  assert.match(
    poiEdit,
    /getCenterLngLat\(\)/,
    'PoiEdit の一覧新規作成が地図中央 (getCenterLngLat) を使っていない'
  );
  assert.match(
    poiEdit,
    /mapSession\.addFeature\(/,
    'PoiEdit の一覧新規作成が mapSession.addFeature (wrapper) 経由でない'
  );

  // PoiEditMap 側の地図中央 API expose
  assert.match(
    poiEditMap,
    /defineExpose\(\{[\s\S]*?getCenterLngLat/,
    'PoiEditMap が getCenterLngLat を expose していない'
  );

  // フィルタ: 表示 ID / name / desc を対象に lowercase 部分一致
  assert.match(
    featureList,
    /filterText/,
    'PoiFeatureList にフィルタ入力 (filterText) がない'
  );
  assert.match(
    featureList,
    /poiedit\.filter_placeholder/,
    'PoiFeatureList のフィルタに poiedit.filter_placeholder がない'
  );
  assert.match(
    featureList,
    /langValues\(feature\.properties\?\.name\)/,
    'PoiFeatureList のフィルタが name (全言語) を対象にしていない'
  );
  assert.match(
    featureList,
    /langValues\(feature\.properties\?\.desc\)/,
    'PoiFeatureList のフィルタが desc (全言語) を対象にしていない'
  );
  assert.match(
    featureList,
    /displayId/,
    'PoiFeatureList のフィルタ/行が表示 ID を扱っていない'
  );
  assert.match(
    featureList,
    /toLowerCase\(\)/,
    'PoiFeatureList のフィルタが lowercase 部分一致でない'
  );

  // 自前 windowing (依存追加なし): 固定行高 + scrollTop 可視 slice + overscan + spacer
  assert.match(
    featureList,
    /ROW_HEIGHT = 32/,
    'PoiFeatureList の固定行高 (ROW_HEIGHT) がない'
  );
  assert.match(
    featureList,
    /OVERSCAN = 10/,
    'PoiFeatureList の overscan がない'
  );
  assert.match(
    featureList,
    /scrollTop/,
    'PoiFeatureList が scrollTop ベースの windowing をしていない'
  );
  assert.match(
    featureList,
    /topSpacerHeight/,
    'PoiFeatureList に上部 spacer がない'
  );
  assert.match(
    featureList,
    /bottomSpacerHeight/,
    'PoiFeatureList に下部 spacer がない'
  );
  assert.match(
    featureList,
    /\.slice\(startIndex\.value, endIndex\.value\)/,
    'PoiFeatureList が可視範囲の slice レンダリングをしていない'
  );
  // virtual list ライブラリの依存追加は禁止
  assert.doesNotMatch(
    featureList,
    /virtual-scroll|vue-virtual|virtua/,
    'PoiFeatureList が外部 virtual list 依存を import している'
  );

  // 選択同期: selectedUid の外部変化で scroll-to-selected (可視範囲外のときのみ)
  assert.match(
    featureList,
    /watch\(session\.selectedUid/,
    'PoiFeatureList が selectedUid を watch していない'
  );
  assert.match(
    featureList,
    /scrollToSelected/,
    'PoiFeatureList に scroll-to-selected がない'
  );

  // 件数表示 (フィルタ後 / 全件)
  assert.match(
    featureList,
    /poiedit\.feature_count/,
    'PoiFeatureList に件数表示 (poiedit.feature_count) がない'
  );

  // 新規作成ボタン: readOnly では非表示、実行は emit で PoiEdit に委譲
  assert.match(
    featureList,
    /v-if="!readOnly"[\s\S]*?emit\('create'\)/,
    'PoiFeatureList の新規作成ボタンに readOnly ガードがない'
  );
  assert.match(
    featureList,
    /poiedit\.add_poi/,
    'PoiFeatureList の新規作成ボタンに poiedit.add_poi がない'
  );
  // 一覧側は addFeature を直接呼ばない (実行責務は PoiEdit)
  assert.doesNotMatch(
    featureList,
    /addFeature\(/,
    'PoiFeatureList が addFeature を直接呼んでいる (PoiEdit へ委譲すること)'
  );

  // 生 ipcRenderer を使わないこと (House rule / m2-t3)
  assert.doesNotMatch(
    featureList,
    /ipcRenderer/,
    'PoiFeatureList に生 ipcRenderer 使用が残存している'
  );

  console.log('  [8/11] PoiFeatureList.vue feature list wiring: PASS');

  // --- Part 9 (Phase 5 Task 2): raw GeoJSON 双方向ペイン (PoiRawPane) ---
  const rawPane = await readFile(
    path.join(projectRoot, 'src/components/PoiRawPane.vue'),
    'utf8'
  );

  // PoiRawPane のルートに h-100 を付けてはならない (Bootstrap の !important が親スコープの
  // .poi-raw-pane { height: 40% } を打ち消し、flex-shrink:0 と相まって地図ペインを 0px に
  // 潰す — 2026-07-11 実機バグの再発防止)
  {
    // コメントは読み飛ばし、ルート div の開始タグだけを検査する (コメント内の説明文が誤爆しないように)
    const rawPaneRootTag = rawPane.match(/<template>\s*(?:<!--[\s\S]*?-->\s*)*(<div[^>]*>)/);
    assert.ok(rawPaneRootTag, 'PoiRawPane のルート div が見つからない');
    assert.doesNotMatch(
      rawPaneRootTag[1],
      /\bh-100\b/,
      'PoiRawPane のルートに h-100 がある (親の height:40% を !important で打ち消して地図が 0px に潰れる)'
    );
  }

  // PoiEdit 配線: import + session/read-only/visible を渡してマウント + 開閉トグル
  assert.match(
    poiEdit,
    /import PoiRawPane from ['"]\.\.\/components\/PoiRawPane\.vue['"]/,
    'PoiEdit が PoiRawPane を import していない'
  );
  assert.match(
    poiEdit,
    /<PoiRawPane[\s\S]*?:session=/,
    'PoiEdit が PoiRawPane に session を渡していない'
  );
  assert.match(
    poiEdit,
    /<PoiRawPane[\s\S]*?:read-only=/,
    'PoiEdit が PoiRawPane に read-only を渡していない'
  );
  assert.match(
    poiEdit,
    /<PoiRawPane[\s\S]*?:visible=/,
    'PoiEdit が PoiRawPane に visible (閉時の再生成停止用) を渡していない'
  );
  assert.match(
    poiEdit,
    /rawPaneOpen/,
    'PoiEdit に raw ペインの開閉トグル (rawPaneOpen) がない'
  );
  // 開閉で地図高さが変わるため OL に updateSize を通知する
  assert.match(
    poiEdit,
    /updateSize\(\)/,
    'PoiEdit がペイン開閉後に mapPane.updateSize() を呼んでいない'
  );
  assert.match(
    poiEditMap,
    /defineExpose\(\{[\s\S]*?updateSize/,
    'PoiEditMap が updateSize を expose していない'
  );

  // 表示: toExportForm (座標丸めなし — Write Store の精度を劣化させない)、
  // Apply: fromExportForm (Feature.id で UID 照合、POI-136)
  assert.match(
    rawPane,
    /toExportForm/,
    'PoiRawPane が toExportForm で表示を生成していない'
  );
  assert.match(
    rawPane,
    /fromExportForm/,
    'PoiRawPane が fromExportForm で Apply していない'
  );
  assert.match(
    rawPane,
    /roundCoordinates:\s*false/,
    'PoiRawPane の表示が roundCoordinates:false でない (座標が劣化する)'
  );

  // Apply = session.commit 1 回のみ (= 1 Undo、仕様 §5)。features/slug/title/layerMeta を
  // 同一 commit で差し替える
  assert.equal(
    (rawPane.match(/session\.commit\(/g) || []).length,
    1,
    'PoiRawPane の session.commit 呼び出しが 1 箇所でない (1 Apply = 1 Undo が崩れる)'
  );
  for (const member of ['features', 'slug', 'title', 'layerMeta']) {
    assert.match(
      rawPane,
      new RegExp(`draft\\.${member} = `),
      `PoiRawPane の commit が draft.${member} を差し替えていない`
    );
  }

  // level==='error' があれば適用不可 (warning のみなら適用可 + 警告表示)
  assert.match(
    rawPane,
    /level === ['"]error['"]/,
    "PoiRawPane に issues の level==='error' ガードがない"
  );
  assert.match(
    rawPane,
    /raw_apply_warnings/,
    'PoiRawPane に warning のみ適用時の警告表示 (raw_apply_warnings) がない'
  );

  // issue 文言は共有写像 (utils/poiSourceMessages) を使うこと
  assert.match(
    rawPane,
    /issueMessage/,
    'PoiRawPane が poiSourceMessages.issueMessage を使っていない'
  );

  // 規模ガード (POI-141): poiGeoJson の export 定数を使い readOnly 化 (再定義禁止)
  assert.match(
    rawPane,
    /SCALE_FEATURE_COUNT/,
    'PoiRawPane が SCALE_FEATURE_COUNT (poiGeoJson) を使っていない'
  );
  assert.match(
    rawPane,
    /SCALE_BYTE_SIZE/,
    'PoiRawPane が SCALE_BYTE_SIZE (poiGeoJson) を使っていない'
  );
  assert.doesNotMatch(
    rawPane,
    /\b1000\b|5 \* 1024/,
    'PoiRawPane が規模閾値をマジックナンバーで再定義している'
  );
  const poiGeoJsonSource = await readFile(
    path.join(projectRoot, 'src/utils/poiGeoJson.ts'),
    'utf8'
  );
  assert.match(
    poiGeoJsonSource,
    /export const SCALE_FEATURE_COUNT/,
    'poiGeoJson が SCALE_FEATURE_COUNT を export していない'
  );
  assert.match(
    poiGeoJsonSource,
    /export const SCALE_BYTE_SIZE/,
    'poiGeoJson が SCALE_BYTE_SIZE を export していない'
  );
  assert.match(
    rawPane,
    /raw_size_guard/,
    'PoiRawPane に規模ガード通知 (raw_size_guard) がない'
  );

  // remote ReadOnly / 規模ガードで textarea を readonly 化
  assert.match(
    rawPane,
    /:readonly="isReadOnly"/,
    'PoiRawPane の textarea が isReadOnly で readonly 化されていない'
  );

  // ローカル編集中は snapshot 再生成で上書きしない (dirty notice + 破棄して再生成)
  assert.match(
    rawPane,
    /localDirty/,
    'PoiRawPane にローカル編集の dirty 管理がない'
  );
  assert.match(
    rawPane,
    /raw_dirty_notice/,
    'PoiRawPane に dirty notice (raw_dirty_notice) がない'
  );
  assert.match(
    rawPane,
    /raw_discard/,
    'PoiRawPane に「破棄して再生成」(raw_discard) がない'
  );

  // JSON.parse 失敗 → 構文エラー表示で適用しない
  assert.match(
    rawPane,
    /raw_parse_error/,
    'PoiRawPane に構文エラー表示 (raw_parse_error) がない'
  );

  // 生 ipcRenderer を使わないこと (House rule / m2-t3)
  assert.doesNotMatch(
    rawPane,
    /ipcRenderer/,
    'PoiRawPane に生 ipcRenderer 使用が残存している'
  );

  // Phase 5 品質レビュー MINOR: localDirty 化時点の snapshot と比較した stale notice
  assert.match(
    rawPane,
    /raw_stale_notice/,
    'PoiRawPane に stale notice (raw_stale_notice) がない'
  );
  assert.match(
    rawPane,
    /dirtySnapshot/,
    'PoiRawPane が dirty 化時点の snapshot を保持していない (stale 判定ができない)'
  );

  // Phase 5 品質レビュー MINOR: FC.id (slug) が string でない場合はエラー化して適用不可
  assert.match(
    rawPane,
    /raw_id_not_string/,
    'PoiRawPane に id 非 string エラー (raw_id_not_string) がない'
  );

  console.log('  [9/11] PoiRawPane.vue raw GeoJSON pane wiring: PASS');

  // --- Part 10 (Phase 6 Task 4): AssetPicker + PoiAttributeForm の picker 配線 ---
  const assetPicker = await readFile(
    path.join(projectRoot, 'src/components/AssetPicker.vue'),
    'utf8'
  );

  // AssetPicker: mode ('icon' | 'image') + visible props、select/close emits
  assert.match(
    assetPicker,
    /mode:\s*['"]icon['"]\s*\|\s*['"]image['"]/,
    "AssetPicker に mode: 'icon' | 'image' prop がない"
  );
  assert.match(
    assetPicker,
    /visible:\s*boolean/,
    'AssetPicker に visible prop がない'
  );
  assert.match(
    assetPicker,
    /\(e:\s*['"]select['"],\s*ref:\s*string\)/,
    'AssetPicker に select(ref: string) emit がない'
  );
  assert.match(
    assetPicker,
    /\(e:\s*['"]close['"]\)/,
    'AssetPicker に close emit がない'
  );

  // タブ: Icon set は mode:'icon' のみ表示。registry (listIconSets) + formatIconRef で
  // `{setId}:{iconId}` を組み立てる (hardcode 分岐禁止、仕様 §7)
  assert.match(
    assetPicker,
    /v-if="mode === 'icon'"/,
    "AssetPicker の Icon set タブが mode:'icon' 限定になっていない"
  );
  assert.match(
    assetPicker,
    /listIconSets/,
    'AssetPicker が listIconSets (registry) を使っていない'
  );
  assert.match(
    assetPicker,
    /formatIconRef/,
    'AssetPicker が formatIconRef で参照文字列を組み立てていない'
  );

  // Assets タブ: AssetList と共用の composable (search + token ガード + getFilePath サムネ)
  assert.match(
    assetPicker,
    /useAssetThumbnails/,
    'AssetPicker が useAssetThumbnails (共用 composable) を使っていない'
  );
  const assetThumbs = await readFile(
    path.join(projectRoot, 'src/composables/useAssetThumbnails.ts'),
    'utf8'
  );
  assert.match(
    assetThumbs,
    /loadToken/,
    'useAssetThumbnails に後着優先トークンガードがない'
  );
  assert.match(
    assetThumbs,
    /getFilePath/,
    'useAssetThumbnails が getFilePath でサムネイルを解決していない'
  );
  const assetListView = await readFile(
    path.join(projectRoot, 'src/views/AssetList.vue'),
    'utf8'
  );
  assert.match(
    assetListView,
    /useAssetThumbnails/,
    'AssetList が共用 composable (useAssetThumbnails) に置き換わっていない'
  );

  // URL タブ: 空入力は決定不可
  assert.match(
    assetPicker,
    /urlInput\.trim\(\) === ''|urlInput\.value\.trim\(\) === ''/,
    'AssetPicker の URL タブに空入力ガードがない'
  );

  // Escape で close、二重 emit 防止
  assert.match(
    assetPicker,
    /['"]Escape['"]/,
    'AssetPicker に Escape ハンドリングがない'
  );
  assert.match(
    assetPicker,
    /if \(picked\) return/,
    'AssetPicker に二重 emit 防止 (picked ガード) がない'
  );

  // PoiAttributeForm 配線: image 行 picker は AssetPicker 直接、icon/selectedIcon 2 欄は
  // 共通部品 IconRefField (Phase 8 Task 2 で挙動不変抽出。PoiReferenceEditor と共用)
  const iconRefField = await readFile(
    path.join(projectRoot, 'src/components/IconRefField.vue'),
    'utf8'
  );
  assert.match(
    attrForm,
    /import AssetPicker from ['"]\.\/AssetPicker\.vue['"]/,
    'PoiAttributeForm が AssetPicker を import していない'
  );
  assert.match(
    attrForm,
    /import IconRefField from ['"]\.\/IconRefField\.vue['"]/,
    'PoiAttributeForm が IconRefField を import していない'
  );
  // icon/selectedIcon の 2 欄が IconRefField でマウントされ、確定は既存 onIconChange 経路
  // (session 1 commit = Undo 粒度不変) に流れること
  assert.match(
    attrForm,
    /@update:model-value="onIconChange\('icon', \$event\)"/,
    'PoiAttributeForm の icon 欄 (IconRefField) が onIconChange 経路に流れていない'
  );
  assert.match(
    attrForm,
    /@update:model-value="onIconChange\('selectedIcon', \$event\)"/,
    'PoiAttributeForm の selectedIcon 欄 (IconRefField) が onIconChange 経路に流れていない'
  );
  assert.match(
    attrForm,
    /openImagePicker\(index\)/,
    'PoiAttributeForm の image 行に picker ボタンがない'
  );

  // IconRefField: picker ボタン + 解釈表示 (parseIconRef / isRegisteredIconSet +
  // 未登録 setId / 未存在 asset の警告) + 手入力 + クリア
  assert.match(
    iconRefField,
    /@click="openPicker"/,
    'IconRefField に picker ボタンがない'
  );
  assert.match(
    iconRefField,
    /parseIconRef/,
    'IconRefField が parseIconRef で現在値を解釈していない'
  );
  assert.match(
    iconRefField,
    /isRegisteredIconSet/,
    'IconRefField が isRegisteredIconSet で未登録 setId を判定していない'
  );
  assert.match(
    iconRefField,
    /poiedit\.icon_unresolved_set/,
    'IconRefField に未登録 icon set 警告 (poiedit.icon_unresolved_set) がない'
  );
  assert.match(
    iconRefField,
    /poiedit\.icon_asset_missing/,
    'IconRefField に未存在 asset 警告 (poiedit.icon_asset_missing) がない'
  );
  assert.match(
    iconRefField,
    /imageAssets\.get\(/,
    'IconRefField が imageAssets.get で asset 参照を解決表示していない'
  );

  // 確定経路の維持 (Undo 粒度不変): picker 選択/手入力/クリアはすべて update:modelValue
  // 1 回に集約され、呼び出し側 (PoiAttributeForm) が 1 commit にする
  assert.match(
    iconRefField,
    /const onPickerSelect = \(value: string\): void => \{\s*\n\s*input\.value = value;\s*\n\s*commit\(value\);/,
    'IconRefField の picker 選択が commit (update:modelValue) 経路に流れていない'
  );
  assert.match(
    attrForm,
    /onImageChange\(picker\.imageIndex, value\)/,
    'PoiAttributeForm の image picker 選択が onImageChange 経路に流れていない'
  );
  assert.match(
    iconRefField,
    /v-model="input"/,
    'IconRefField の手入力 text 欄 (参照文法の直書き, POI-139) が残っていない'
  );
  assert.match(
    iconRefField,
    /@change="commit\(input\)"/,
    'IconRefField の手入力が commit (update:modelValue) 経路でない'
  );

  // クリアボタン (commit('') → 呼び出し側 onIconChange('') でフィールド削除)
  assert.match(
    iconRefField,
    /poiedit\.icon_clear/,
    'IconRefField に icon クリアボタン (poiedit.icon_clear) がない'
  );

  // readOnly: 選択/クリアボタンは非表示 (v-if="!readOnly")
  assert.match(
    iconRefField,
    /v-if="!readOnly"[\s\S]{0,200}?@click="openPicker"/,
    'IconRefField の picker ボタンに readOnly ガードがない'
  );
  assert.match(
    attrForm,
    /v-if="!readOnly"[\s\S]{0,200}?openImagePicker\(index\)/,
    'PoiAttributeForm の image picker ボタンに readOnly ガードがない'
  );

  // 生 ipcRenderer を使わないこと (House rule / m2-t3)
  assert.doesNotMatch(
    assetPicker,
    /ipcRenderer/,
    'AssetPicker に生 ipcRenderer 使用が残存している'
  );
  assert.doesNotMatch(
    assetThumbs,
    /ipcRenderer/,
    'useAssetThumbnails に生 ipcRenderer 使用が残存している'
  );
  assert.doesNotMatch(
    iconRefField,
    /ipcRenderer/,
    'IconRefField に生 ipcRenderer 使用が残存している'
  );

  // pickerOpen ガード (Phase 6 品質レビュー MAJOR-2): picker 表示中はグローバルキー
  // (undo/redo/Delete/menu:undo/redo) を抑止する。PoiAttributeForm が pickerOpen を expose し、
  // PoiEdit の3ハンドラがそれぞれ先頭でガードすること
  assert.match(
    attrForm,
    /defineExpose\(\{\s*focusName,\s*pickerOpen\s*\}\)/,
    'PoiAttributeForm が pickerOpen を defineExpose していない'
  );
  // pickerOpen は image 行 picker + IconRefField 内蔵の icon picker ×2 を集約すること
  // (IconRefField 抽出 [Phase 8] で icon picker が子コンポーネントに移ったため)
  assert.match(
    attrForm,
    /picker\.visible \|\|\s*\n\s*!!iconFieldRef\.value\?\.pickerOpen \|\|\s*\n\s*!!selectedIconFieldRef\.value\?\.pickerOpen/,
    'PoiAttributeForm の pickerOpen が IconRefField の picker 表示を集約していない'
  );
  assert.match(
    iconRefField,
    /defineExpose\(\{ pickerOpen: pickerVisible \}\)/,
    'IconRefField が pickerOpen を defineExpose していない'
  );
  assert.match(
    poiEdit,
    /const onHistoryKeydown = \(event: KeyboardEvent\) => \{\s*\n\s*if \(attrForm\.value\?\.pickerOpen\) return;/,
    'PoiEdit の onHistoryKeydown が picker 表示中のガードを先頭に持っていない'
  );
  assert.match(
    poiEdit,
    /const onDeleteKeydown = \(event: KeyboardEvent\) => \{\s*\n\s*if \(attrForm\.value\?\.pickerOpen\) return;/,
    'PoiEdit の onDeleteKeydown が picker 表示中のガードを先頭に持っていない'
  );
  assert.match(
    poiEdit,
    /const onMainProcessMessage = \(message: string\) => \{\s*\n\s*if \(attrForm\.value\?\.pickerOpen\) return;/,
    'PoiEdit の onMainProcessMessage が picker 表示中のガードを先頭に持っていない'
  );

  // 確定時の imageIndex 再検証 (範囲外/行不在は console.warn + no-op で黙って捨てない)
  assert.match(
    attrForm,
    /console\.warn\(\s*\n\s*`PoiAttributeForm: picker\.imageIndex/,
    'PoiAttributeForm の onPickerSelect が imageIndex 範囲外を console.warn していない'
  );

  console.log('  [10/11] AssetPicker + PoiAttributeForm picker wiring: PASS');

  // --- Part 11 (Phase 8 Task 1): PoiEdit 右ペイン分配 + マーカーアイコン反映 ---

  // 右ペイン CSS: フォーム優先の固定分配 (flex: 0 0 auto + max-height 55%)、
  // 一覧は残り高さ (flex: 1 1 0 + min-height)。大量 feature でもフォームが潰れない
  assert.match(
    poiEdit,
    /\.poi-form-area\s*\{[^}]*flex:\s*0 0 auto/,
    'PoiEdit の .poi-form-area が flex: 0 0 auto (フォーム優先の固定分配) でない'
  );
  assert.match(
    poiEdit,
    /\.poi-form-area\s*\{[^}]*max-height:\s*55%/,
    'PoiEdit の .poi-form-area が max-height: 55% を持っていない'
  );
  assert.match(
    poiEdit,
    /class="poi-form-area overflow-auto"/,
    'PoiEdit の .poi-form-area 要素に overflow-auto (内部スクロール) がない'
  );
  assert.match(
    poiEdit,
    /\.poi-list-area\s*\{[^}]*flex:\s*1 1 0/,
    'PoiEdit の .poi-list-area が flex: 1 1 0 (残り高さ) でない'
  );
  assert.match(
    poiEdit,
    /\.poi-list-area\s*\{[^}]*min-height:\s*160px/,
    'PoiEdit の .poi-list-area が min-height: 160px を持っていない'
  );

  // マーカーアイコン解決: parseIconRef で icon 参照文法を判別し、asset は
  // imageAssets.getFilePath の file:// URL を非同期キャッシュ経由で使う
  assert.match(
    poiEditMap,
    /import \{ listIconSets, parseIconRef \} from ['"]\.\.\/utils\/iconRefs['"]/,
    'PoiEditMap が iconRefs の parseIconRef/listIconSets を import していない'
  );
  assert.match(
    poiEditMap,
    /const ref = parseIconRef\(refString\);/,
    'PoiEditMap がアイコン参照を parseIconRef で解決していない'
  );
  assert.match(
    poiEditMap,
    /window\.imageAssets\s*\n?\s*\.getFilePath\(uid\)/,
    'PoiEditMap が asset 参照を imageAssets.getFilePath で解決していない'
  );

  // asset の非同期解決: uid → url|null の src キャッシュ + in-flight 重複要求ガード。
  // 失敗は null キャッシュで再要求しない。解決後の再描画は 1 回に coalesce
  assert.match(
    poiEditMap,
    /const assetSrcCache = new Map<string, string \| null>\(\);/,
    'PoiEditMap に asset src キャッシュ (Map<uid, url|null>) がない'
  );
  assert.match(
    poiEditMap,
    /if \(assetSrcCache\.has\(uid\) \|\| assetInFlight\.has\(uid\)\) return;/,
    'PoiEditMap の requestAssetSrc に in-flight 重複要求ガードがない'
  );
  assert.match(
    poiEditMap,
    /\.catch\(\(\) => \{\s*\n\s*assetSrcCache\.set\(uid, null\);/,
    'PoiEditMap が asset 解決失敗を null キャッシュしていない (再要求され続ける)'
  );
  assert.match(
    poiEditMap,
    /const scheduleIconRedraw = /,
    'PoiEditMap に解決後再描画の coalesce (scheduleIconRedraw) がない'
  );

  // Style/Icon インスタンスは src キーの cache で共有 (3000 feature 対策)
  assert.match(
    poiEditMap,
    /const iconStyleCache = new Map<string, Style>\(\);/,
    'PoiEditMap に src キーの Style キャッシュがない'
  );

  // 未設定/未解決は標準 SVG ピンへフォールバック、選択中は selectedIcon or 赤ピン切替
  assert.match(
    poiEditMap,
    /const raw = selected \? properties\?\.selectedIcon : properties\?\.icon;/,
    'PoiEditMap の markerStyle が icon/selectedIcon の切替意味論になっていない'
  );
  assert.match(
    poiEditMap,
    /return pinStyle\(selected\);/,
    'PoiEditMap の markerStyle が標準 SVG ピンへフォールバックしていない'
  );
  assert.match(
    poiEditMap,
    /markerStyle\(feature\.properties, uid === session\.selectedUid\.value\)/,
    'PoiEditMap の redrawMarkers が markerStyle を使っていない'
  );

  console.log('  [11/11] PoiEdit side pane split + marker icon resolution: PASS');

  console.log('M4-T5 PoiEdit editor skeleton smoke passed');
} catch (err) {
  console.error('M4-T5 smoke FAILED:', err.message);
  process.exit(1);
}
