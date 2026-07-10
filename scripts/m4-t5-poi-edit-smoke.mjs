// Phase 4 Task 5: PoiEdit エディタ骨格のソースパターン smoke。
// /poisources/:sourceId が PoiEdit へ置き換わり、保存 (useRevisionedAssetSave) と
// 編集セッション (usePoiEditSession)、slug 一意性 (checkSlug excludeUid)、ReadOnly 分岐
// (cloneToLocal)、LangResourceInput が配線されていることを検証する。
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

  console.log('  [1/4] router PoiEdit route: PASS');

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

  // 生 ipcRenderer を使わないこと (House rule / m2-t3)
  assert.doesNotMatch(
    poiEdit,
    /ipcRenderer/,
    'PoiEdit に生 ipcRenderer 使用が残存している'
  );

  console.log('  [2/4] PoiEdit.vue wiring: PASS');

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

  console.log('  [3/4] LangResourceInput.vue shape: PASS');

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

  console.log('  [4/4] legacy files removed: PASS');

  console.log('M4-T5 PoiEdit editor skeleton smoke passed');
} catch (err) {
  console.error('M4-T5 smoke FAILED:', err.message);
  process.exit(1);
}
