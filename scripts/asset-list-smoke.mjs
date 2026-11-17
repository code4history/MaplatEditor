// image asset マネージャタブ (AssetList) のソースパターン smoke。
// Header/router 配線、window.imageAssets API の全配線、削除前 findReferences (AID-006)、
// checkSlug + excludeUid、pickImageFile null ガード、一覧 token ガード、
// Escape ハンドラ、生 ipcRenderer 不使用 (poc-t3) を検証する
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

try {
  // --- Part 1: Header.vue Assets tab ---
  const headerSource = await readFile(
    path.join(projectRoot, 'src/components/Header.vue'),
    'utf8'
  );

  assert.match(
    headerSource,
    /navbar\.assets/,
    'Header.vue に navbar.assets key がない'
  );

  assert.match(
    headerSource,
    /navigate\s*\(\s*['"]AssetList['"]\s*\)/,
    'Header.vue に navigate("AssetList") がない'
  );

  assert.match(
    headerSource,
    /isAssetSection/,
    'Header.vue に isAssetSection computed がない'
  );

  // 表示順: Assets タブは Edit App (navbar.edit_app) の後・Settings (navbar.settings) の前
  const appIdx = headerSource.indexOf('navbar.edit_app');
  const assetIdx = headerSource.indexOf('navbar.assets');
  const settingsIdx = headerSource.indexOf('navbar.settings');
  assert.ok(
    appIdx >= 0 && appIdx < assetIdx && assetIdx < settingsIdx,
    'Assets タブが Edit App の後・Settings の前に並んでいない'
  );

  console.log('  [1/4] Header.vue Assets tab: PASS');

  // --- Part 2: router /assets route ---
  const routerSource = await readFile(
    path.join(projectRoot, 'src/router/index.ts'),
    'utf8'
  );

  assert.match(
    routerSource,
    /path\s*:\s*['"]\/assets['"]/,
    'router に /assets route がない'
  );

  assert.match(
    routerSource,
    /name\s*:\s*['"]AssetList['"]/,
    'router に AssetList name がない'
  );

  console.log('  [2/4] router /assets route: PASS');

  // --- Part 3: AssetList.vue shape ---
  let assetList = await readFile(
    path.join(projectRoot, 'src/views/AssetList.vue'),
    'utf8'
  );
  assetList += await readFile(
    path.join(projectRoot, 'src/components/assets/AssetMasterList.vue'),
    'utf8'
  );
  assetList += await readFile(
    path.join(projectRoot, 'src/components/assets/AssetEdit.vue'),
    'utf8'
  );
  // P5/case 1: 行は共通 primitives へ移行。削除メニューの Escape 閉じは ResourceActionMenu、
  // サムネイル(loading=lazy)と欠損フォールバック(placeholder)は ResourceMasterRow が担う。
  assetList += await readFile(
    path.join(projectRoot, 'src/components/resource-list/ResourceActionMenu.vue'),
    'utf8'
  );
  assetList += await readFile(
    path.join(projectRoot, 'src/components/resource-list/ResourceMasterRow.vue'),
    'utf8'
  );
  const assetImagesIpc = await readFile(path.join(projectRoot, 'electron/ipc/assets-images.ts'), 'utf8');
  assert.doesNotMatch(
    assetImagesIpc,
    /imageassets:rename/,
    '廃止したimageassets:renameの登録が残っている'
  );

  // 一覧 (list/search) + サムネイル (getFilePath) は 後に AssetPicker と
  // 共用の composable (useAssetThumbnails) へ抽出した (挙動不変)。AssetList 固有の
  // API 配線 (add/updateMetadata/delete/findReferences/pickImageFile) は本体に残る
  const assetThumbs = await readFile(
    path.join(projectRoot, 'src/composables/useAssetThumbnails.ts'),
    'utf8'
  );
  const assetSearchAdapter = await readFile(
    path.join(projectRoot, 'src/views/resource-adapters/imageAssetSearchAdapter.ts'),
    'utf8'
  );
  assert.match(
    assetList,
    /useAssetThumbnails/,
    'AssetList が useAssetThumbnails (共用 composable) を使っていない'
  );
  assert.match(assetThumbs, /imageAssetSearchAdapter\.load/, 'useAssetThumbnails が共通 search adapter を使っていない');
  assert.match(assetSearchAdapter, /window\.search\.imageAssets/, 'image asset adapter が FTS API を呼んでいない');
  assert.match(assetThumbs, /imageAssets\.getFilePath\(/, 'useAssetThumbnails が window.imageAssets.getFilePath を呼んでいない');
  for (const api of ['add', 'updateMetadata', 'delete', 'findReferences', 'pickImageFile']) {
    assert.match(
      assetList,
      new RegExp(`imageAssets\\.${api}\\(`),
      `AssetList が window.imageAssets.${api} を呼んでいない`
    );
  }

  // 削除前に参照提示 (AID-006 / BM-121-A 同型): 同一関数内で findReferences → delete の順
  assert.match(
    assetList,
    /imageAssets\.findReferences[\s\S]*?imageAssets\.delete\(/,
    'AssetList が削除前に findReferences を呼んでいない'
  );

  // 削除確認は共通 DeleteConfirmDialog + useResourceDelete へ委譲。
  // findReferences 失敗時の文言 (references_unavailable) は共通 dialog 側が持つ
  assert.match(
    assetList,
    /DeleteConfirmDialog/,
    'AssetList が共通 DeleteConfirmDialog を使っていない'
  );
  assert.match(
    assetList,
    /useResourceDelete/,
    'AssetList が useResourceDelete を使っていない'
  );
  const deleteDialogSource = await readFile(
    path.join(projectRoot, 'src/components/resource-list/DeleteConfirmDialog.vue'),
    'utf8'
  );
  assert.match(
    deleteDialogSource,
    /references_unavailable/,
    'DeleteConfirmDialog に findReferences 失敗時の文言 (references_unavailable) がない'
  );

  // slug 可用性チェックは AssetEdit 内の共通 SlugField (予約 lifecycle、
  // 自己予約は identity で除外) へ移行し、生 checkSlug は撤去
  assert.doesNotMatch(
    assetList,
    /assets\.checkSlug/,
    'AssetList に生 checkSlug が残っている '
  );
  const assetEditSource = await readFile(
    path.join(projectRoot, 'src/components/assets/AssetEdit.vue'),
    'utf8'
  );
  assert.match(
    assetEditSource,
    /SlugField/,
    'AssetEdit が共通 SlugField を使っていない'
  );
  // 自己除外は SlugField の予約 identity (assetUid 除外) が担う。
  // pickImageFile の null (キャンセル) ガードは AssetEdit 側へ移動
  assert.match(
    assetEditSource,
    /pickImageFile\(\);\s*\n\s*if\s*\(\s*!picked\s*\)\s*return/,
    'AssetEdit に pickImageFile の null (キャンセル) ガードがない'
  );
  // pick の reject は通知する
  assert.match(
    assetList,
    /pick_failed/,
    'AssetList に pickImageFile 失敗通知 (pick_failed) がない'
  );

  // 一覧読込の後着優先トークン (検索連打での順序逆転防止)。
  // 後に composable へ移設
  assert.match(
    assetThumbs,
    /loadToken/,
    'useAssetThumbnails に一覧読込トークン (loadToken) がない'
  );
  assert.match(
    assetThumbs,
    /token\s*!==\s*loadToken/,
    'useAssetThumbnails に token 不一致での応答破棄がない'
  );

  // slug 自動提案は空欄時だけ適用し、手入力値を上書きしない
  assert.match(
    assetList,
    /document\.value\.slug\s*\|\|\s*suggestSlug/,
    'AssetEdit が手入力済み slug を画像再選択で上書きする'
  );

  // add の payload-too-large は専用文言へ写像する
  assert.match(
    assetList,
    /payload-too-large/,
    'AssetList に payload-too-large の専用分岐がない'
  );

  // Escape でモーダル/コンテキストメニューを閉じる
  assert.match(
    assetList,
    /['"]Escape['"]/,
    'AssetList に Escape ハンドラがない'
  );

  // サムネイルは遅延読込 + 欠損/壊れた画像のフォールバック（ResourceMasterRow の
  // placeholder + @error 復帰へ移行。noImage PNG からアイコン placeholder へ変更）
  assert.match(
    assetList,
    /loading="lazy"/,
    'Assetlist のサムネイルが loading="lazy" でない'
  );
  assert.match(
    assetList,
    /resource-master-row__placeholder|no_image/,
    'AssetList に欠損サムネイルのフォールバック（placeholder / no_image）がない'
  );

  // 生 ipcRenderer を使わないこと (House rule / poc-t3)
  assert.doesNotMatch(
    assetList,
    /ipcRenderer/,
    'AssetList に生 ipcRenderer 使用が残存している'
  );

  console.log('  [3/4] AssetList.vue shape: PASS');

  // --- Part 4: i18n assetlist.* が 11 ロケール全部に揃っていること ---
  const locales = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'th', 'vi', 'zh', 'zh-TW'];
  const flatten = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) =>
      typeof v === 'object' && v !== null ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]
    );
  let referenceKeys = null;
  for (const locale of locales) {
    const data = JSON.parse(
      await readFile(path.join(projectRoot, `public/locales/${locale}/translation.json`), 'utf8')
    );
    assert.ok(data.assetlist, `${locale} に assetlist がない`);
    assert.ok(data.navbar?.assets, `${locale} に navbar.assets がない`);
    const keys = flatten(data.assetlist).sort();
    if (referenceKeys === null) referenceKeys = keys;
    else assert.deepEqual(keys, referenceKeys, `${locale} の assetlist キー構成が他ロケールと不一致`);
  }

  console.log('  [4/4] i18n assetlist.* (11 locales): PASS');

  console.log('asset list smoke passed');
} catch (err) {
  console.error('smoke FAILED:', err.message);
  process.exit(1);
}
