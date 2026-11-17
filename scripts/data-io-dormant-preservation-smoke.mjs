// MapEdit 到達不能 Data IO パネルの休眠保全注記スモークテスト
//
// （全18箇所の保全注記）と （休眠専用 i18n キーの代表4キー×全11ロケール）
// の存在を assert する。本スモークはコード側の「削除禁止」注記が誤って失われていないこと、
// および翻訳ファイルから休眠専用キーが誤って削除されていないことを検出する回帰テスト。
//
// WMTS 生成部分（#1 コメント文言の一部・#11 wmtsGenerate・#13
// WmtsGeneratorService クラス・#17 preload.ts wmtsGen bridge）が到達可能になったことに伴い、
// 該当4箇所の assert を「到達可能になった」旨の新文言へ更新した。CSV インポート関連（#1 の
// 残り・#2-#10・#12・#14-#16・#18）は無改修のまま。
//
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

async function readProjectFile(relativePath) {
  return readFile(path.join(projectRoot, relativePath), 'utf8');
}

try {
  // --- 全18箇所: コード側保全注記の存在 assert ---

  const mapEdit = await readProjectFile('src/views/MapEdit.vue');

  // #1 パネル本体（v-show wrapper 全体を覆うブロックコメント）。WMTS生成部分がmercタブへ
  // 分離・移設されたことに伴い、文言を「CSVインポートは削除禁止・WMTS生成部分は到達可能になった」へ更新
  assert.match(
    mapEdit,
    /<!-- 旧実装 mapedit\.html L\.274-375[\s\S]{0,80}<!--\s*\n\s*本ブロックへのUI導線は意図的に撤去済み[\s\S]{0,900}v-show="activeTab === 'inout'"/,
    '#1 Data IO パネル本体のブロックコメントが欠落している',
  );
  assert.match(mapEdit, /dataio\.\* 全28キー・\n\s*mapedit\.export_map_data/, '#1 ブロックコメントの dataio.* i18n キー削除禁止明記が欠落している');
  assert.match(mapEdit, /WMTS生成部分（旧実装 mapedit\.html の同タブ下部）は新規\n\s*「メルカトルタイル」タブへ分離・移設済み/, '#1 ブロックコメントのWMTS生成部分移設明記が欠落している');
  // 実装レビューM-1是正: wmtsgenerate.*は「引き続き使用する」ではなく、実装レビューで
  // ProgressReporterのテキストキーがmerc.*へ修正された結果コードから参照されなくなった
  // （公開するパスは merc と呼び、エディタのコードは wmts の綴りを残す決まり: UIから"WMTS"を排除）。JSON定義自体は既存の変更の休眠保全対象として残す
  assert.match(mapEdit, /ユーザー向け文言は公開するパスは merc と呼び、エディタのコードは wmts の綴りを残す決まりに\n\s*従いwmtsgenerate\.\*ではなくmerc\.\*を使う/, '#1 ブロックコメントの merc.* 使用の明記が欠落している');
  assert.match(mapEdit, /wmtsgenerate\.\* 5キーはコードから参照されなくなったが、\n\s*JSON定義自体は休眠保全の対象として削除しない/, '#1 ブロックコメントのwmtsgenerate.*休眠保全（コード非参照）明記が欠落している');

  // #2 mainLayerHash（computed）
  assert.match(
    mapEdit,
    /mainLayerHash: 旧実装 map\.js L\.248-254[^\n]*\n\/\/ 休眠パネル専用（削除禁止・地図からのタイル生成へ転用予定）\nconst mainLayerHash = computed/,
    '#2 mainLayerHash の保全注記が欠落している',
  );

  // #3 wmtsDirty（computed）
  assert.match(
    mapEdit,
    /\/\/ 旧実装 map\.js L\.211-213\n\/\/ 休眠パネル専用（削除禁止・地図からのタイル生成へ転用予定）\nconst wmtsDirty = computed/,
    '#3 wmtsDirty の保全注記が欠落している',
  );

  // #4 wmtsEditReady（computed）
  assert.match(
    mapEdit,
    /Tin\.STATUS_STRICT = 'strict'\)\n\/\/ 休眠パネル専用（削除禁止・地図からのタイル生成へ転用予定）\nconst wmtsEditReady = computed/,
    '#4 wmtsEditReady の保全注記が欠落している',
  );

  // #5 csvUploadUiValue（ref）
  assert.match(
    mapEdit,
    /csvUploadUiValue 初期値\n\/\/ 休眠パネル専用（削除禁止・あとで再編予定）\nconst csvUploadUiValue = ref/,
    '#5 csvUploadUiValue の保全注記が欠落している',
  );

  // #6 csvUpError（computed）
  assert.match(
    mapEdit,
    /\/\/ 旧実装 map\.js L\.176-194\n\/\/ 休眠パネル専用（削除禁止・あとで再編予定）\nconst csvUpError = computed/,
    '#6 csvUpError の保全注記が欠落している',
  );

  // #7 csvUpErrorMessage（computed）
  assert.match(
    mapEdit,
    /コード→文言の写像を一元化\n\/\/ 休眠パネル専用（削除禁止・あとで再編予定）\nconst csvUpErrorMessage = computed/,
    '#7 csvUpErrorMessage の保全注記が欠落している',
  );

  // #8 csvProjPreset（computed get/set）
  assert.match(
    mapEdit,
    /\/\/ 旧実装 map\.js L\.198-207\n\/\/ 休眠パネル専用（削除禁止・あとで再編予定）\nconst csvProjPreset = computed/,
    '#8 csvProjPreset の保全注記が欠落している',
  );

  // #9 csvQgisSetting()
  assert.match(
    mapEdit,
    /QGIS GeoReferencer のデフォルト設定を適用\n\/\/ 休眠パネル専用（削除禁止・あとで再編予定）\nconst csvQgisSetting = \(\) => \{/,
    '#9 csvQgisSetting の保全注記が欠落している',
  );

  // #10 updateWholeGcps()
  assert.match(
    mapEdit,
    /vueMap\._updateWholeGcps\(gcps\) 相当\n\/\/ 休眠パネル専用（削除禁止・あとで再編予定）\n\/\/ CSV\/インポートで GCP を一括設定する\nconst updateWholeGcps = /,
    '#10 updateWholeGcps の保全注記が欠落している',
  );

  // #11 wmtsGenerate: 既存の変更でMapEdit.vueの新規mercタブから到達可能になった（関数名は維持）
  assert.match(
    mapEdit,
    /vueMap\.\$on\('wmtsGenerate'\) 相当\n\/\/ 本ロジックはMapEdit\.vueの新規「メルカトルタイル」タブから到達可能になった\n\/\/ （以前から転用を予定していた地図からのタイル生成に対応）。関数名\(wmtsGenerate\)は維持し、呼び出し元の\n\/\/ ボタンのみ休眠inoutタブから新規mercタブへ移設した。有効条件: wmtsEditReady\n[\s\S]{0,300}async function wmtsGenerate\(\): Promise<void> \{/,
    '#11 wmtsGenerate の保全注記が欠落している（既存の変更で到達可能へ更新後の文言）',
  );

  // #12 uploadCsv()
  assert.match(
    mapEdit,
    /vueMap\.\$on\('uploadCsv'\) 相当\n\/\/ 休眠パネル専用（削除禁止・あとで再編予定）\nconst uploadCsv = async/,
    '#12 uploadCsv の保全注記が欠落している',
  );

  // #13 WmtsGeneratorService（クラス全体）: 既存の変更で新規mercタブから到達可能になった
  const wmtsService = await readProjectFile('electron/services/WmtsGeneratorService.ts');
  assert.match(
    wmtsService,
    /\/\/ 本クラスへのUI導線は一度撤去されていたが、その後 MapEdit\.vueの[\s\S]{0,400}class WmtsGeneratorService \{/,
    '#13 WmtsGeneratorService クラスの保全注記が欠落している',
  );
  // tin-v2-mode-smoke が依存する行に保全コメントが割り込んでいないことも同時に確認
  assert.match(
    wmtsService,
    /new Tin\(TIN_V2_OPTIONS\)/,
    '#13 保全コメント挿入により new Tin(TIN_V2_OPTIONS) 行が破壊されている（tin-v2-mode-smoke 依存）',
  );

  // #14 registerWmtsHandlers() / wmtsGen:generate ハンドラ
  const wmtsIpc = await readProjectFile('electron/ipc/wmts.ts');
  assert.match(
    wmtsIpc,
    /\/\/ 本ハンドラ登録自体はmain\.ts:138\(import\)\/229\(起動時呼び出し\)により[\s\S]{0,400}export function registerWmtsHandlers\(\) \{/,
    '#14 registerWmtsHandlers の保全注記が欠落している',
  );

  // #15 mapedit:uploadCsv ハンドラ
  const mapeditIpc = await readProjectFile('electron/ipc/mapedit.ts');
  assert.match(
    mapeditIpc,
    /mapedit_uploadCsv 相当（CSV インポート）\n\s*\/\/ 休眠パネル専用（削除禁止・あとで再編予定）\n\s*ipc\.handle\('mapedit:uploadCsv'/,
    '#15 mapedit:uploadCsv ハンドラの保全注記が欠落している',
  );

  // #16 preload.ts uploadCsv bridge / #17 preload.ts wmtsGen bridge
  const preload = await readProjectFile('electron/preload.ts');
  assert.match(
    preload,
    /\/\/ 休眠パネル専用（削除禁止・あとで再編予定）\n\s*uploadCsv: \(csvRepl: string, csvUpSettings: any\) =>/,
    '#16 preload.ts uploadCsv bridge の保全注記が欠落している',
  );
  assert.match(
    preload,
    /\/\/ MapEdit\.vueの新規「メルカトルタイル」タブから到達可能になった\ncontextBridge\.exposeInMainWorld\('wmtsGen', \{/,
    '#17 preload.ts wmtsGen bridge の保全注記が欠落している',
  );

  // #18 electron.d.ts uploadCsv 型宣言
  const electronDts = await readProjectFile('src/electron.d.ts');
  assert.match(
    electronDts,
    /\/\/ 休眠パネル専用（削除禁止・あとで再編予定）\n\s*uploadCsv\(csvRepl: string, csvUpSettings: any\): Promise<any>;/,
    '#18 electron.d.ts uploadCsv 宣言の保全注記が欠落している',
  );

  console.log('  [1/2] 18箇所全数の保全注記: PASS');

  // --- 休眠専用 i18n キー: 代表4キー × 全11ロケールの存在 assert ---

  const locales = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'th', 'vi', 'zh', 'zh-TW'];
  const representativeKeys = [
    ['dataio', 'import_csv_submit'],
    ['dataio', 'csv_format_error'],
    ['wmtsgenerate', 'generate'],
    ['mapedit', 'export_map_data'],
  ];

  for (const locale of locales) {
    const messages = JSON.parse(
      await readProjectFile(`public/locales/${locale}/translation.json`),
    );
    for (const [namespace, key] of representativeKeys) {
      const value = messages[namespace]?.[key];
      assert.equal(
        typeof value,
        'string',
        `${locale}: ${namespace}.${key} が欠落している（休眠専用i18nキーの削除リスク）`,
      );
      assert.notEqual(value.trim(), '', `${locale}: ${namespace}.${key} が空文字列である`);
    }
  }

  console.log('  [2/2] 休眠専用i18nキー 代表4キー×全11ロケールの存在: PASS');

  console.log('Data IO dormant preservation smoke: PASS');
} catch (err) {
  console.error('Data IO dormant preservation smoke FAILED:', err.message);
  process.exit(1);
}
