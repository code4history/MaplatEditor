// 差分保持ストレージモデル（地図の定義を maps/<slug>.json の設定ファイルに置き、アプリの sources にはその参照と上書きする値だけを書くという決まり / ベースマップのマスタを正本とし、アプリのソースは上書き差分だけを保存する決まり）の E2E。
//
//   case 12: 未上書きフィールドの入力欄は空で、placeholder にマスタの実効値が出る。
//         上書きすると解除ボタンが現れ、押すとマスタ値（＝空欄+placeholder）へ戻る
//   case 13: builtin（osm）にも tms と同一の編集フォームが出る。加えて builtin への上書きが
//         **実際に viewer へ届く**（地図の定義を maps/<slug>.json の設定ファイルに置き、アプリの sources にはその参照と上書きする値だけを書くという決まりで文字列のみ指定をやめた効果の本丸）
//   case 14: url の入力欄は全種別で出ない。代わりに「マスタで管理する」注記が出る
//   case 25: label の操作子は AppSourceEditor 側にあり、**上書きが無くても表示される**。
//         上書き可能フィールドはすべて data-testid="app-source-override-<key>" を持つ
//
// （凍結契約）: 上書き可能キーは `label` 1 個へ縮んだ。表題・帰属・
// ライセンス・ズーム範囲・サムネイルの操作子は撤去され、それらを対象にしていた本 spec の
// 検証も同じ縮小を受ける（残る操作子は label / envelopeLngLats / mercator シフト 2 欄）。
// 加えて、アプリのソース編集の整理で加えた「存在範囲からコピー」の活性条件と反映を本 spec で検証する。
// その条件を「コピー(a)」（存在範囲を持つマスタで活性・コピーで外接矩形になる）・「コピー(b)」
// （持たないマスタで非活性）・「コピー(c)」（値が入ると × が出て解除できる）と呼ぶ。
//
// NOTE (preview-restart の直 fetch の確認との順序): 本 spec の case 13 は出荷バンドル（public/preview 経由の
// maplat_ui.umd.js）で走る。MaplatCore の label マージ修正が伝搬鎖の全ホップへ
// 到達していることは `pnpm run smoke:preview-bundle-label-merge-guard` が固定する。src だけ直して
// dist を再生成し忘れると、ここは旧バンドルで通ってしまう。
import { _electron as electron, expect, test, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { seedBaseMap } from './helpers/baseMapSeed';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const OSM_TILE_FIXTURE_ROOT = path.resolve(import.meta.dirname, 'fixtures/osm-tiles');
const FAKE_TILE_PATH = path.resolve(import.meta.dirname, 'fixtures/fake-osm-tile.png');

// builtin_base_maps.json（ビルトインの正本）が持つ osm の実効値。
// 期待値をここへハードコードせず、カタログから読んで組み立てる（ハードコード禁止）。
async function osmCatalogEntry(): Promise<Record<string, any>> {
  const list = JSON.parse(await readFile(path.join(projectRoot, 'electron/builtin_base_maps.json'), 'utf8'));
  const entry = (Array.isArray(list) ? list : list.list).find((item: any) => String(item?.mapID) === 'osm');
  if (!entry) throw new Error('builtin_base_maps.json に osm が見つかりません');
  return entry;
}

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  // 外部 OSM タイルをローカル fixture へ差し替える（/t5 と同一方式）
  const fakeTile = await readFile(FAKE_TILE_PATH);
  await page.route('**/tile.openstreetmap.org/**', async (route) => {
    const m = route.request().url().match(/tile\.openstreetmap\.org\/(\d+)\/(\d+)\/(\d+)\.png/);
    if (m) {
      const fixturePath = path.join(OSM_TILE_FIXTURE_ROOT, m[1], m[2], `${m[3]}.png`);
      if (existsSync(fixturePath)) {
        return route.fulfill({ status: 200, contentType: 'image/png', body: await readFile(fixturePath) });
      }
    }
    return route.fulfill({ status: 200, contentType: 'image/png', body: fakeTile });
  });
  return { app, page };
}

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((next: string) => { location.hash = next; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

// type="search" の native × を押す。
// ヒット位置は欄の padding に依存する（a の計測は素の input で右端から 11〜18px
// だったが、Bootstrap の form-control-sm では 16〜20px だった）。∴ 固定オフセットを決め打ちせず
// 範囲を走査し、値が空になった時点で成功とする。全オフセットで空にならなければ失敗させる
// （「押せなかったので type の assert で代替する」という骨抜きはしない）。
// native × はフォーカス中に現れるため、走査前に focus する。
async function clickNativeSearchClear(locator: ReturnType<Page['getByTestId']>): Promise<void> {
  const box = (await locator.boundingBox())!;
  await locator.focus();
  for (const dx of [11, 13, 16, 18, 20, 22]) {
    await locator.click({ position: { x: box.width - dx, y: box.height / 2 } });
    if ((await locator.inputValue()) === '') return;
  }
  throw new Error(
    `native × を押せませんでした（走査したオフセット: 右端から 11〜22px / 欄幅 ${box.width}px）。` +
      'type="search" が付いていないか、レイアウトが変わってボタン位置が範囲外へ出た可能性がある',
  );
}

// AppEdit の既定言語（AppEdit.vue currentLang = 'ja'）に揃える。
// **coverageLngLats は null のまま**にしておく — コピー(b)「存在範囲を持たないマスタでは
// 『存在範囲からコピー』が非活性」の検証対象そのものであるため。
const masterTmsDoc = {
  lang: 'ja',
  kind: 'tms',
  maptype: null,
  url: 'https://example.com/{z}/{x}/{y}.png',
  title: { ja: 'マスタタイトル' },
  label: { ja: 'マスタラベル' },
  attr: { ja: '© マスタ帰属' },
  dataAttr: { ja: 'マスタのデータ帰属' },
  license: 'CC BY-SA',
  dataLicense: 'ODbL',
  licenseNote: { ja: 'マスタのライセンス補足' },
  dataLicenseNote: { ja: 'マスタのデータライセンス補足' },
  minZoom: 3,
  maxZoom: 15,
  thumbnail: '',
  coverageLngLats: null,
};

// 存在範囲を持つマスタ。非矩形（5 点）にしてあるのは、
// 「4 隅をそのまま写す（bbox へ潰さない）」実装でも入力欄の bbox が外接矩形になることと、
// 情報が落ちていないこと（クリア→再コピーで同じ値に戻る）を同時に見るため。
const COVERAGE_LNG_LATS: [number, number][] = [
  [130.25, 32.5],
  [131.75, 32.5],
  [131.75, 33.25],
  [130.9, 33.8],
  [130.25, 33.25],
];
// 外接矩形（west, south, east, north）を入力欄へ出したときの並び（小窓と同じ西・東・南・北 = DOM 順）
const COVERAGE_INPUT_ORDER = ['130.25', '131.75', '32.5', '33.8'];

// 新規アプリを立ち上げ、ソースタブでベースマップを1件選ぶところまで進める
async function newAppWithSource(page: Page, appSlug: string, masterSlug: string) {
  await openHash(page, '#/appedit');
  await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('app-id').fill(appSlug);
  await page.getByTestId('app-id').press('Tab');
  await page.getByTestId('app-title').fill('App');
  await page.getByTestId('app-title').press('Tab');

  await page.getByTestId('app-sources-tab').click();
  await page.getByTestId('app-basemap-mode').click();
  await page.getByTestId('app-basemap-search').fill(masterSlug);
  await expect(page.getByTestId(`app-basemap-row-${masterSlug}`)).toBeVisible({ timeout: 30000 });
  await page.getByTestId(`app-basemap-row-${masterSlug}`).click();
  const card = page.getByTestId(`app-selected-source-${masterSlug}`);
  await expect(card).toBeVisible();
  return card;
}

test('差分保持フォーム（プレースホルダ・×による解除・url 撤去・操作子の所在）', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-app-source-diff-model-ui-'));
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    const tmsSlug = `fx-tms-${Date.now()}`;
    await seedBaseMap(page, tmsSlug, { ...masterTmsDoc });
    // コピー(a) 用（存在範囲を持つマスタ）。
    // **AppEdit へ入る前に seed する** — baseMapMasters は onMounted で1回読むだけなので、
    // 画面表示後に seed したマスタは lookup に載らず、ソースがマスタ欠落表示になる
    const coverageSlug = `fx-cov-${Date.now()}`;
    await seedBaseMap(page, coverageSlug, { ...masterTmsDoc, coverageLngLats: COVERAGE_LNG_LATS });

    const card = await newAppWithSource(page, `fx-app-${Date.now()}`, tmsSlug);

    // role=base で出る操作子の全数。上書き可能キーは label だけになり、
    // 残りはアプリ所有キー（mercator シフトは overlay 専用なのでここには出ない）
    const BASE_ROLE_KEYS = ['label', 'envelopeLngLats'];

    // ---- case 25: 操作子がすべて AppSourceEditor 側に存在する ----
    for (const key of BASE_ROLE_KEYS) {
      await expect(card.getByTestId(`app-source-override-${key}`), `case 25: ${key} の操作子が存在する`).toBeVisible();
    }
    // case 25 の本丸: label は**上書きが無くても**操作子が出る（旧実装は v-if="source.label" で消えていた）
    await expect(card.getByTestId('app-source-override-label')).toHaveValue('');

    // ---- 廃止した 10 キーの操作子が 1 つも残っていない ----
    for (const key of [
      'title', 'attr', 'dataAttr', 'license', 'licenseNote', 'dataLicense', 'dataLicenseNote',
      'minZoom', 'maxZoom', 'thumbnail',
    ]) {
      await expect(
        card.getByTestId(`app-source-override-${key}`),
        `${key} の上書き操作子は撤去された`,
      ).toHaveCount(0);
    }
    // ---- 解除の × も利用範囲の 1 個だけ ----
    for (const key of ['minZoom', 'maxZoom', 'thumbnail']) {
      await expect(
        card.getByTestId(`app-source-clear-${key}`),
        `${key} の解除ボタンは撤去された`,
      ).toHaveCount(0);
    }

    // ---- case 28: 言語別欄は検索バーと同じ type="search"（native × の出現条件そのもの）----
    await expect(
      card.getByTestId('app-source-override-label'),
      'case 28: label は検索バー方式（type="search"）',
    ).toHaveAttribute('type', 'search');

    // ---- case 12: 未上書き → 入力欄は空・placeholder にマスタの実効値 ----
    await expect(card.getByTestId('app-source-override-label')).toHaveAttribute('placeholder', 'マスタラベル');

    // ---- case 12: 「マスタに戻す」ボタンは1つも存在しない（v1.4 で全廃）----
    await expect(
      card.getByTestId(/^app-source-reset-/),
      'case 12: 独立した「マスタに戻す」ボタンは廃止された',
    ).toHaveCount(0);

    // ---- case 12(a): 言語別テキストは native × を**実際に押して**解除する（a の実測に基づく）----
    const labelInput = card.getByTestId('app-source-override-label');
    await labelInput.fill('アプリ上書きラベル');
    await labelInput.press('Tab');
    await expect(labelInput).toHaveValue('アプリ上書きラベル');
    await clickNativeSearchClear(labelInput);
    await expect(labelInput, 'case 12: native × のクリックで上書きが解除される').toHaveValue('');
    await expect(labelInput).toHaveAttribute('placeholder', 'マスタラベル');

    // ---- 存在範囲を持たないマスタでは「存在範囲からコピー」が非活性 ----
    const copyButton = card.getByTestId('app-source-copy-coverage-envelopeLngLats');
    await expect(copyButton, 'コピー(b): 存在範囲が無くてもボタンは見える（v-if ではない）').toBeVisible();
    await expect(copyButton, 'コピー(b): 存在範囲が無いので非活性').toBeDisabled();
    // 利用範囲が未設定なので × も出ない
    await expect(card.getByTestId('app-source-clear-envelopeLngLats')).toHaveCount(0);

    // ---- case 14: url の入力欄は tms でも出ない ----
    // （人間指示）: 「マスタで管理する」注記は削除された。上書き欄が全廃された画面では
    // 「変更できない」注記だけが浮き、隣接する欄の説明と誤読されるため
    await expect(card.getByTestId('app-source-url-field'), 'case 14: url 入力欄は撤去済み').toHaveCount(0);
    await expect(card.getByTestId('app-source-url'), 'case 14: url 入力欄は撤去済み').toHaveCount(0);
    await expect(
      card.getByTestId('app-source-url-note'),
      'url のマスタ管理注記は削除された',
    ).toHaveCount(0);

    // ---- overlay へ切り替えると、アプリ所有キー（mercator shift）の操作子が現れる ----
    await card.locator('select.form-select-sm').first().selectOption('overlay');
    await expect(card.getByTestId('app-source-override-mercatorXShift')).toBeVisible();
    await expect(card.getByTestId('app-source-override-mercatorYShift')).toBeVisible();

    // ---- コピー(a)/(c): 存在範囲を持つマスタでコピー → 4 入力欄が外接矩形になる ----
    await page.getByTestId('app-basemap-search').fill(coverageSlug);
    await expect(page.getByTestId(`app-basemap-row-${coverageSlug}`)).toBeVisible({ timeout: 30000 });
    await page.getByTestId(`app-basemap-row-${coverageSlug}`).click();
    const covCard = page.getByTestId(`app-selected-source-${coverageSlug}`);
    await expect(covCard).toBeVisible();

    const covCopy = covCard.getByTestId('app-source-copy-coverage-envelopeLngLats');
    await expect(covCopy, 'コピー(a): 存在範囲があるので活性').toBeEnabled();
    const envelopeInputs = covCard
      .getByTestId('app-source-override-envelopeLngLats')
      .locator('.envelope-input input');
    await expect(envelopeInputs).toHaveCount(4);
    for (let i = 0; i < 4; i += 1) {
      await expect(envelopeInputs.nth(i), 'コピー(a): コピー前は空欄').toHaveValue('');
    }
    await covCopy.click();
    for (let i = 0; i < 4; i += 1) {
      await expect(
        envelopeInputs.nth(i),
        `コピー(a): コピー後の利用範囲がマスタの存在範囲の外接矩形になる（${i}）`,
      ).toHaveValue(COVERAGE_INPUT_ORDER[i]);
    }
    // コピー(c): 値が入ったので × が現れ、押すと解除される（従来どおりの挙動）
    const covClear = covCard.getByTestId('app-source-clear-envelopeLngLats');
    await expect(covClear, 'コピー(c): 値が入ると × が出る').toBeVisible();
    await covClear.click();
    for (let i = 0; i < 4; i += 1) {
      await expect(envelopeInputs.nth(i), 'コピー(c): × で解除される').toHaveValue('');
    }
    await expect(covClear, 'コピー(c): 解除後は × が消える').toHaveCount(0);
    // 再コピーで同じ値へ戻る（4 隅をそのまま保持しており、bbox 化で情報が落ちていない）
    await covCopy.click();
    for (let i = 0; i < 4; i += 1) {
      await expect(envelopeInputs.nth(i)).toHaveValue(COVERAGE_INPUT_ORDER[i]);
    }

    // ---- case 13(UI 面): builtin osm にも tms と同一のフォームが出る ----
    await page.getByTestId('app-basemap-search').fill('osm');
    await expect(page.getByTestId('app-basemap-row-osm')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('app-basemap-row-osm').click();
    const osmCard = page.getByTestId('app-selected-source-osm');
    await expect(osmCard).toBeVisible();
    const osm = await osmCatalogEntry();
    for (const key of BASE_ROLE_KEYS) {
      await expect(osmCard.getByTestId(`app-source-override-${key}`), `case 13: builtin にも ${key} の操作子が出る`).toBeVisible();
    }
    await expect(osmCard.getByTestId('app-source-override-label')).toHaveAttribute('placeholder', String(osm.label.ja));
    await expect(osmCard.getByTestId('app-source-override-url-field')).toHaveCount(0);
    await expect(osmCard.getByTestId('app-source-url-field'), 'case 14: builtin でも url 入力欄は出ない').toHaveCount(0);
    await expect(osmCard.getByTestId('app-source-url-note')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});

// 人間の確認で決めた翻訳モードの範囲: 表示ラベルが翻訳モードで編集できること。
//
// 本タスクの要望は「表示ラベルを単言語要素 → 多言語要素にする」である。器（LangResourceInput）は
// 差分モデルの時点で入っていたが、**欄に :disabled="translationMode" が付いていたため、既定言語以外へ
// 切り替えると読み取り専用になり翻訳を入力できなかった**（base 74c3806 から存在した欠陥）。
// チップは出るのに入力できない ＝ 機構として多言語になっていない。
//
// リポジトリ全体の規律（実測）: 翻訳モードで無効化するのは**言語に依存しない構造的な値だけ**である。
//   - BaseMapEdit.vue: 構造的な欄は structuralDisabled（= readOnly || translationMode || saving || …）、
//     言語別欄（LangResourceInput 6 箇所）は **translationMode を意図的に外した** disabled 式を使う
//   - MapEdit.vue: slug / 既定言語 / ライセンス / タイル URL は translationMode で無効化、
//     言語別の map-title / map-label には disabled が無い
//   - AppEdit.vue: slug / 既定言語 / ポート / 色 / 座標 / role などは translationMode で無効化、
//     言語別の app-title / app-manifest-name / app-manifest-short-name には disabled が無い
// AppSourceEditor.vue だけがこの規律から外れていた。
test('表示ラベルは翻訳モードでも編集でき、言語間を往復できる（構造的な値は無効のまま）', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-app-source-diff-model-translation-'));
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    const tmsSlug = `fx-tr-${Date.now()}`;
    await seedBaseMap(page, tmsSlug, { ...masterTmsDoc });
    const card = await newAppWithSource(page, `fx-app-${Date.now()}`, tmsSlug);

    const label = card.getByTestId('app-source-override-label');
    const langSelect = page.getByTestId('editor-language');

    // ---- 既定言語（ja）で入力する ----
    await expect(label, '既定言語では従来どおり編集できる').toBeEnabled();
    await label.fill('ラベル日本語');
    await label.press('Tab');
    await expect(label).toHaveValue('ラベル日本語');

    // mercator シフト欄を出すため overlay へ切り替えておく。role は**言語に依存しない構造的な値**で
    // あり翻訳モードでは変更できない（AppEdit.vue:1619）ので、既定言語のうちに切り替える
    await card.locator('select.form-select-sm').first().selectOption('overlay');
    await expect(card.getByTestId('app-source-override-mercatorXShift')).toBeVisible();

    // ---- 右上の言語セレクタで English へ切り替える（= 翻訳モード）----
    await langSelect.selectOption('en');
    // 人間の報告どおり JA チップが出る（ja に値があり、active が ja ではなくなったため）
    await expect(
      card.locator('.lang-value-chip', { hasText: 'JA' }),
      '翻訳モード: 他言語に値があることを示す JA チップが出る',
    ).toBeVisible();
    // **本丸**: 翻訳モードでも表示ラベルは編集できる（この assert が欠陥の再現そのもの）
    await expect(label, '翻訳モード: 翻訳モードでも表示ラベルは編集できる').toBeEnabled();
    await expect(label, '翻訳モード: en は未入力なので空欄').toHaveValue('');
    await label.fill('Label in English');
    await label.press('Tab');
    await expect(label).toHaveValue('Label in English');

    // ---- 翻訳モードでも、言語に依存しない構造的な値は無効のまま（既存の意図を壊さない）----
    await expect(
      card.getByTestId('app-source-copy-coverage-envelopeLngLats'),
      '翻訳モード: 構造的な操作（存在範囲からコピー）は翻訳モードで無効のまま',
    ).toBeDisabled();
    const envelopeInputs = card
      .getByTestId('app-source-override-envelopeLngLats')
      .locator('.envelope-input input');
    for (let i = 0; i < 4; i += 1) {
      await expect(
        envelopeInputs.nth(i),
        `翻訳モード: 利用範囲の入力欄は翻訳モードで無効のまま（${i}）`,
      ).toBeDisabled();
    }
    await expect(
      card.getByTestId('app-source-override-mercatorXShift'),
      '翻訳モード: mercator シフトは翻訳モードで無効のまま',
    ).toBeDisabled();
    await expect(card.getByTestId('app-source-override-mercatorYShift')).toBeDisabled();
    // role セレクト自体（構造的な値）も翻訳モードでは変更できないままであること
    await expect(
      card.locator('select.form-select-sm').first(),
      '翻訳モード: role セレクトは翻訳モードで無効のまま',
    ).toBeDisabled();

    // ---- 往復: en → ja → en で双方の値が保たれる ----
    await langSelect.selectOption('ja');
    await expect(label, '翻訳モード: ja へ戻すと ja の値が出る').toHaveValue('ラベル日本語');
    await expect(label).toBeEnabled();
    await expect(
      card.locator('.lang-value-chip', { hasText: 'EN' }),
      '翻訳モード: ja から見ると EN チップが出る',
    ).toBeVisible();
    await langSelect.selectOption('en');
    await expect(label, '翻訳モード: en へ戻すと en の値が保たれている').toHaveValue('Label in English');

    // maplat 分岐の表示ラベル（app-source-maplat-label）は登録地図の seed が要るため
    // 本 spec では扱わず、smoke 側のソーステキスト照合（翻訳モードの範囲）で同じ規律を機械照合する

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});

test('builtin(osm) への上書きが配信 JSON と viewer の両方へ届く', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-app-source-diff-model-viewer-'));
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    // AppEdit の保存は main 側の確認ダイアログを挟む（app-poi-hide-override と同一の stub）
    await app.evaluate(async ({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
    });

    const osm = await osmCatalogEntry();
    const appSlug = `fx-viewer-${Date.now()}`;

    await openHash(page, '#/appedit');
    await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('app-id').fill(appSlug);
    await page.getByTestId('app-id').press('Tab');
    await page.getByTestId('app-title').fill('Viewer App');
    await page.getByTestId('app-title').press('Tab');

    await page.getByTestId('app-sources-tab').click();
    await page.getByTestId('app-basemap-mode').click();
    await page.getByTestId('app-basemap-search').fill('osm');
    await expect(page.getByTestId('app-basemap-row-osm')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('app-basemap-row-osm').click();
    const osmCard = page.getByTestId('app-selected-source-osm');
    await expect(osmCard).toBeVisible();

    // builtin へ上書きを入れる（旧実装＝文字列のみ指定では、これが viewer へ一切届かなかった）。
    // v1.4: 言語別欄は LangResourceInput の blur 確定（= 1 Undo 単位）。fill 後に確定させる。
    // 上書きできるのは label だけになったため、届くことの検証も label で行う
    await osmCard.getByTestId('app-source-override-label').fill('上書きラベル');
    await osmCard.getByTestId('app-source-override-label').press('Tab');

    await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 30000 });
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });

    // ---- プレビューを開く ----
    await page.locator('[role="tab"]').filter({ hasText: /プレビュー/ }).click();
    await expect(page.locator('iframe.preview-map')).toBeVisible({ timeout: 60000 });
    const previewSrc = (await page.locator('iframe.preview-map').getAttribute('src'))!;
    const previewBase = previewSrc.replace(/\/$/, '');
    const token = previewSrc.match(/\/preview\/([^/]+)\//)![1];

    const fetchJson = async (url: string) => await page.evaluate(async (u: string) => {
      const resp = await fetch(u);
      if (!resp.ok) throw new Error(`fetch ${u} failed: ${resp.status}`);
      return await resp.json();
    }, url);

    // ---- (a) 配信アプリ JSON: ID 参照 + settingFile + 上書き分だけ（地図の定義を maps/<slug>.json の設定ファイルに置き、アプリの sources にはその参照と上書きする値だけを書くという決まり）----
    const appJson: any = await fetchJson(`${previewBase}/apps/${token}.json`);
    const element = appJson.sources.find((s: any) => s && typeof s === 'object' && s.mapID === 'osm');
    expect(element, 'case 13: osm ソースが**オブジェクト**として出る（文字列のみ指定は廃止）').toBeTruthy();
    expect(element.settingFile, 'case 13: 定義は maps/osm.json を指す').toBe('maps/osm.json');
    expect(element.maptype, 'case 13: maptype を出してはならない（source_ex.ts:126 が settingFile を読まなくなる）').toBeUndefined();
    expect(element.url, 'case 13: url はアプリ JSON に出ない（マスタ管理）').toBeUndefined();
    // 上書きできないキーはアプリ JSON へ一切出ない（設定ファイル側のマスタ値が効く）
    expect(element.maxZoom, 'maxZoom は上書きできないのでアプリ JSON に出ない').toBeUndefined();
    expect(element.title, 'title は上書きできないのでアプリ JSON に出ない').toBeUndefined();
    // 実装中に自分で作り込んだ欠陥の回帰止め:
    // LangResourceInput は「現在言語＝既定言語」のときプレーン文字列を emit する。それを
    // そのまま保存すると、出力側は**マスタの lang**（osm は "en"）を基準に解釈するため、
    // ja を上書きしたつもりが en を書き換える。この assert は修正前に実際に失敗していた
    expect(element.label?.ja, 'case 13: 言語別上書きは編集した言語だけ差し替わる').toBe('上書きラベル');
    expect(element.label?.en, 'case 13: 未編集の言語はマスタ値が保たれる（キー単位全置換対策）').toBe(String(osm.label.en));

    // ---- (b) 設定ファイル: マスタの定義がそのまま出る ----
    const settingJson: any = await fetchJson(`${previewBase}/maps/osm.json`);
    expect(settingJson.maptype, 'case 13: 設定ファイル側が maptype を持つ').toBe('base');
    expect(settingJson.url, 'case 13: タイル URL はマスタ由来').toBe(String(osm.url));
    expect(settingJson.title?.ja, 'case 13: 設定ファイルはマスタ値のまま（上書きを焼き込まない）').toBe(String(osm.title.ja));
    expect(settingJson.maxZoom, 'case 13: 設定ファイルはマスタ値のまま').toBe(osm.maxZoom);

    // ---- (c) viewer 実体: マージ後の値がソースへ載っている ----
    const handle = await page.locator('iframe.preview-map').elementHandle();
    const frame = (await handle!.contentFrame()) as Frame;
    await frame.waitForFunction(() => !!(window as any).__maplatPreview?.core?.cacheHash?.osm, undefined, { timeout: 120_000 });
    const viewerState = await frame.evaluate(() => {
      const source: any = (window as any).__maplatPreview.core.cacheHash.osm;
      return {
        maxZoom: source.maxZoom,
        label: source.label,
        title: source.get('title'),
        attr: source.get('attr'),
      };
    });
    expect(viewerState.label?.ja, 'case 13: 上書きした label が viewer のソースへ届く').toBe('上書きラベル');
    // 上書きできないキーは settingFile 経由でマスタ値が効く（アプリごとに固定されない）
    expect(viewerState.maxZoom, 'maxZoom はマスタ値が効く').toBe(osm.maxZoom);
    expect(viewerState.title?.ja, 'title はマスタ値が効く').toBe(String(osm.title.ja));
    // 欠陥（label が undefined で潰れる）の回帰止め — 未上書きの言語がマスタ値のまま残ること
    expect(viewerState.label?.en, 'case 13: label が settingFile 側の値を undefined で潰さない').toBe(String(osm.label.en));
    expect(viewerState.attr?.ja, 'case 13: 未上書きの帰属はマスタ値が効く').toBe(String(osm.attr.ja));

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});
