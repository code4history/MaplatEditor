// m20-t6: Wiki（MaplatEditor.wiki）掲載用スクリーンショット取得スクリプト（新規 7 枚）。
// タスク設計書 `docs/superpowers/specs/2026-08-10-m20-t6-screenshots-design.md` v1.1 §5 準拠。
//
// 機能テストではなく、Wiki 用の静的画像資産を決定的に生成する補助スクリプトである
// （先例: tests/e2e/m14-t3-wiki-screenshots.spec.ts。既存 4 枚 current-1〜4 はそちらが撮る）。
// assertion は「実ユーザーデータ非接触ガード」（launch() 内蔵）と各画面の到達確認に限定し、
// 画像の内容が意図どおりかは目視判定である（設計 §5.4）。
//
//   current-5-basemap-edit    ベースマップ編集（サムネイル管理セクションを含む）      B-50/B-51
//   current-6-app-source-cards アプリ編集「地図選択」タブの builtin/tms/overlay カード B-52/B-53
//   current-7-settings        設定画面（2タブ + JPEG 上限の「？」ポップアップ）        B-54/B-55
//   current-9-about           About ウィンドウ（別 BrowserWindow）                    B-58/B-59
//   current-10-map-poi-tab    地図の POI タブ（バッジ3分類・上書き編集ブロック）       B-60/B-61
//   current-11-merc-tab       メルカトルタイル生成タブ（タイルセット選択ダイアログ）   B-62/B-63
//   current-12-app-settings   アプリ編集の HTTP 設定 8 トグル + アプリ設定            B-64
//
// current-8-app-menu.png は OS ネイティブのメニューバーであり Playwright では構造的に撮れない
// （設計 §1.3(a)）。唯一の人間ゲート G-A として手動撮影する（設計 §4.2 / docs/m20-t6-g-a-手順書）。
//
// 起動は helpers/launchIsolated.ts を使う（MAPLAT_E2E_ROOT + --user-data-dir。実ユーザーの
// save folder / 設定ストアに一切触れない。付け忘れを構造的に防ぐため launch() を直書きしない）。
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';
import { evalMain, openAboutWindow } from './helpers/electronMenu';
// m19-t5: 512px サムネイルは webp。符号化は唯一の実装（宛先拡張子で選ぶ）へ委譲する
// （tests/e2e/m19-t2-basemap-thumbnail-512.spec.ts と同じ参照の仕方）
import { writeImageByExt } from '../../electron/utils/thumbnail512Codec';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const artifactDir = path.join(projectRoot, 'test-results', 'm20-t6-screenshots');
// サムネイルの素材。m13-t5 migration fixture（人間承認済み・権利クリア確認済み）の
// 高畑公園テスト1 のタイル 1 枚（256px）を使う。新規の画像素材を持ち込まない
const THUMBNAIL_SOURCE = path.join(
  projectRoot, 'tests/fixtures/m13-t5-migration-pipeline/tiles/takabatake_kozu1/2/0/0.jpg',
);

// 1x1 透明 PNG（m6-t8-merc-tile-set.spec.ts 等、既存 E2E フィクスチャ群と同一バイト列）
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

async function forceEnglish(page: Page): Promise<void> {
  // 契約 C9: 英語 UI で単一撮影する（英日両ページから共有）。m14-t3 と同一手順に
  // **リロードを1つ足している**: ContextHelp.vue は Bootstrap Popover の content を
  // onMounted で1度だけ束縛するため、言語切替より前に mount された「？」は切替後も
  // 旧言語の本文を出し続ける（実測: 設定画面の JPEG 上限の「？」が日本語のままだった）。
  // 撮影対象に「？」の中身が含まれる ∴ 全コンポーネントを英語で mount し直させる。
  await page.evaluate(() => window.settings.set('lang', 'en'));
  await page.evaluate(() => { location.hash = '#/settings'; });
  await expect(page.locator('#langSwitcher')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#langSwitcher')).toHaveValue('en');
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#langSwitcher')).toHaveValue('en', { timeout: 15000 });
}

/**
 * メインウィンドウの内容領域サイズを変える。
 * 既定（1200x768）に収まらない縦長の画面を 1 枚へ収めるためだけに使う（current-6）。
 */
async function setContentSize(app: ElectronApplication, size: { w: number; h: number }): Promise<void> {
  await evalMain<void>(app, ({ BrowserWindow }, s: { w: number; h: number }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('main window not found');
    win.setContentSize(s.w, s.h);
  }, size);
}

async function openHash(page: Page, hash: string, ready: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await expect(page.locator(ready)).toBeVisible({ timeout: 20000 });
}

function shooter(page: Page) {
  return (name: string) => page.screenshot({ path: path.join(artifactDir, `${name}.png`) });
}

async function saveFolderOf(page: Page): Promise<string> {
  return page.evaluate(() => window.settings.get('saveFolder'));
}

/** saveFolder/tmbs/{key}.png（52px）と {key}_512.webp を素材画像から作って直接置く。 */
async function placeThumbnails(saveFolder: string, key: string): Promise<void> {
  const tmbs = path.join(saveFolder, 'tmbs');
  await mkdir(tmbs, { recursive: true });
  const { Jimp } = await import('jimp');
  const source = await Jimp.read(THUMBNAIL_SOURCE);
  await source.clone().resize({ w: 52, h: 52 }).write(path.join(tmbs, `${key}.png`) as `${string}.${string}`);
  await writeImageByExt(source.clone().resize({ w: 512, h: 512 }), path.join(tmbs, `${key}_512.webp`));
}

/** 英語のユーザーベースマップ（kind: tms）を 1 件作り、uid を返す。 */
async function seedTmsBaseMap(page: Page, slug: string, title: string): Promise<string> {
  return page.evaluate(async ({ slug: s, title: ti }) => {
    const uid = crypto.randomUUID();
    // saveUser の戻りは成功形と revision-conflict の union。ここは新規作成なので成功形のみを見る
    const result: any = await window.baseMaps.saveUser({
      uid, slug: s, create: true,
      tms: {
        kind: 'tms', lang: 'en',
        title: { en: ti }, label: { en: ti },
        attr: { en: '© Example Tile Provider' }, dataAttr: {},
        license: 'CC BY 4.0', dataLicense: 'ODbL', licenseNote: {}, dataLicenseNote: {},
        url: 'https://tiles.example.com/{z}/{x}/{y}.png',
        minZoom: 0, maxZoom: 18,
        thumbnail: `tmbs/${uid}.png`,
        coverageLngLats: [[139.60, 35.60], [139.90, 35.60], [139.90, 35.80], [139.60, 35.80]],
        tileJsonSourceUrl: null, sourceMapUid: null,
      },
    } as any);
    if (!result || result.result !== 'Success') throw new Error(`base map seed failed: ${JSON.stringify(result)}`);
    return uid;
  }, { slug, title });
}

test.describe('m20-t6 Wiki 掲載用スクリーンショット（新規 7 枚）', () => {
  test('current-5 / current-6 / current-12: ベースマップ編集とアプリ編集', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m20-t6-app-'));
    await mkdir(artifactDir, { recursive: true });
    const { app, page } = await launch(e2eRoot);
    const shot = shooter(page);
    try {
      await forceEnglish(page);
      const saveFolder = await saveFolderOf(page);

      const stamp = Date.now();
      const baseSlug = `sample-city-basemap-${stamp}`;
      const overlaySlug = `sample-city-overlay-${stamp}`;
      const baseUid = await seedTmsBaseMap(page, baseSlug, 'Sample City Base Tiles');
      const overlayUid = await seedTmsBaseMap(page, overlaySlug, 'Sample City Overlay Tiles');
      await placeThumbnails(saveFolder, baseUid);
      await placeThumbnails(saveFolder, overlayUid);

      // ================= current-5: ベースマップ編集（サムネイル管理セクション） =================
      await openHash(page, `#/basemaps?uid=${baseUid}`, '[data-testid="basemap-editor"]');
      // 512px プレビューが解決されるまで待つ（サムネイル管理セクションの主役）
      await expect(page.locator('img[alt="512px"]')).toBeVisible({ timeout: 20000 });
      await page.getByTestId('basemap-thumbnail-replace-512').scrollIntoViewIfNeeded();
      await page.waitForTimeout(500); // スクロール確定とサムネイル描画の安定待ち
      await shot('current-5-basemap-edit');

      // ================= current-6: アプリ編集「地図選択」タブのソースカード =================
      const appUid: string = await page.evaluate(async (suffix: number) => {
        const slug = `sample-app-${suffix}`;
        const result: any = await window.appedit.save({
          slug,
          document: {
            appID: slug, appName: { en: 'Sample City App' }, title: { en: 'Sample City App' },
            description: { en: 'A sample app used for the Wiki screenshots.' },
            keywords: '', siteUrl: '', lang: 'en', sources: [], pois: [],
            httpSettings: {}, appSettings: {}, manifestSettings: {},
          },
        } as any);
        if (!result || result.result !== 'Success') throw new Error(`app seed failed: ${JSON.stringify(result)}`);
        return result.uid;
      }, stamp);

      await openHash(page, `#/appedit?uid=${appUid}`, '[data-testid="app-id"]');
      await page.getByTestId('app-sources-tab').click();
      await page.getByTestId('app-basemap-mode').click();

      // ビルトイン（viewer builtin = osm。src/utils/appSourceModel.ts:13 VIEWER_BUILTIN_IDS）→
      // 自作 tms（role=base）→ 自作 tms（role=overlay へ切替）の 3 バリアントを 1 枚に収める（設計 §3.1）
      for (const slug of ['osm', baseSlug, overlaySlug]) {
        await page.getByTestId('app-basemap-search').fill(slug);
        await page.locator(`[data-testid="app-basemap-row-${slug}"]`).click({ timeout: 20000 });
      }
      await expect(page.locator('[data-testid^="app-selected-source-"]')).toHaveCount(3, { timeout: 20000 });
      await page.locator(`[data-testid="app-selected-source-${overlaySlug}"] select`).selectOption('overlay');
      await expect(page.locator(`[data-testid="app-selected-source-${overlaySlug}"] select`)).toHaveValue('overlay');
      await page.getByTestId('app-basemap-search').fill('');
      // 3 バリアントのカードは既定の 768px 高では 2 枚強しか入らない。台帳 B-52 は
      // 3 バリアントを 1 枚に収めることを求めており、枝番へ割ると m20-t3 が書いた
      // Wiki の参照行を書き換える必要が出る（設計 §12 残件2）∴ ウィンドウを縦に伸ばして 1 枚に収める
      await setContentSize(app, { w: 1200, h: 1140 });
      await expect(page.locator('[data-testid^="app-selected-source-"]').nth(2)).toBeInViewport({ timeout: 20000 });
      await page.waitForTimeout(800); // 一覧の再取得とサムネイル描画の安定待ち
      await shot('current-6-app-source-cards');
      // 以降の撮影は既定サイズへ戻す（12 枚の見た目を揃える）
      await setContentSize(app, { w: 1200, h: 768 });
      await expect
        .poll(async () => page.evaluate(() => window.innerHeight), { timeout: 20000 })
        .toBeLessThan(1000);

      // ================= current-12: HTTP 設定 8 トグル + アプリ設定 =================
      // 掲載先は独立の「アプリ設定タブ」ではなくメタデータ編集タブ内である（設計 §3.2）
      // メタデータ編集タブには testid が無いのでラベルで選ぶ（m14-t3 spec と同じ選び方）
      await page.locator('.editor-ui-tabs .nav-link', { hasText: 'Edit Metadata' }).click();
      const httpToggles = page.locator('.toggle-grid .form-check-input');
      await expect(httpToggles).toHaveCount(8, { timeout: 20000 });
      // 非既定値を数個 ON にして「設定されている」ことが分かる状態にする（設計 §5.3）
      await httpToggles.nth(0).check(); // PWA（Cache の従属元）
      await httpToggles.nth(1).check(); // Overlay UI
      await httpToggles.nth(5).check(); // Cache（PWA 従属。ON にできることを示す）
      // アプリ設定の見出しを最下部へ入れると、その上の HTTP 設定 8 トグルが同時に収まる
      await page.getByRole('heading', { name: 'App Settings', exact: true }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await shot('current-12-app-settings');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('current-7 / current-9: 設定画面と About ウィンドウ', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m20-t6-settings-'));
    await mkdir(artifactDir, { recursive: true });
    const { app, page } = await launch(e2eRoot);
    const shot = shooter(page);
    try {
      await forceEnglish(page);

      // ================= current-7: 設定画面（2タブ + JPEG 上限の「？」） =================
      await openHash(page, '#/settings', '#langSwitcher');
      await expect(page.locator('.nav-tabs .nav-item')).toHaveCount(2);
      const jpegHelp = page.getByTestId('settings-jpeg-decode-help');
      await expect(jpegHelp).toBeVisible({ timeout: 15000 });
      // 「？」の中身（ContextHelp のポップアップ）が開いた状態を撮る。掲載文（Concepts.md）が
      // 「説明は欄の下に印字せず ? に入れた」と述べており、開いていないと何も示せない
      await jpegHelp.hover();
      await expect(page.locator('.popover')).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(300);
      await shot('current-7-settings');

      // ================= current-9: About ウィンドウ =================
      // OS メニュー自体は撮れないが、メニュー項目の click は main process 側から呼べるため
      // About ウィンドウ（独立 BrowserWindow）は自動撮影できる（設計 §1.2）
      const aboutPage = await openAboutWindow(app, 'About');
      await expect(aboutPage.locator('#versions')).toBeVisible({ timeout: 15000 });
      await expect(aboutPage.locator('#appVersion')).toContainText('Version', { timeout: 15000 });
      await aboutPage.screenshot({ path: path.join(artifactDir, 'current-9-about.png') });
      await aboutPage.close();
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('current-10 / current-11: 地図の POI タブとメルカトルタイル生成タブ', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m20-t6-map-'));
    await mkdir(artifactDir, { recursive: true });
    const { app, page } = await launch(e2eRoot);
    const shot = shooter(page);
    try {
      await forceEnglish(page);
      const saveFolder = await saveFolderOf(page);
      const stamp = Date.now();
      const mapSlug = `sample-historical-map-${stamp}`;

      // --- 地図 fixture: strict コンパイル済み（merc タブの生成条件 wmtsEditReady を満たす） ---
      // GCP 3 点と originals/{uid}.png の直接配置は m6-t8-merc-tile-set.spec.ts の
      // seedStrictMap と同型（UI 経由のアップロードは非決定的なので使わない）
      const toMerc = (x: number, y: number): number[] => [
        15551351.4 + (x / 400) * (15562483.3 - 15551351.4),
        4249117.8 + ((300 - y) / 300) * (4259837.2 - 4249117.8),
      ];
      const gcps = [
        [[50, 250], toMerc(50, 250)],
        [[350, 250], toMerc(350, 250)],
        [[350, 50], toMerc(350, 50)],
      ];

      // 参照先として登録 POI ソースを 1 件作る（外部ファイル参照カードの中身ではなく、
      // POI タブ左ペインの一覧を空にしないため）
      await page.evaluate(async (suffix: number) => {
        const slug = `sample-poi-source-${suffix}`;
        const created: any = await window.poiSources.createLocal({
          slug, title: { en: 'Sample Landmarks' }, lang: 'en',
        });
        if (!created || created.result !== 'Success') throw new Error(`poi seed failed: ${JSON.stringify(created)}`);
        await window.poiSources.save(created.uid, {
          slug, title: { en: 'Sample Landmarks' },
          fc: {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature', id: 'l1', geometry: { type: 'Point', coordinates: [139.767, 35.681] },
              properties: { name: { en: 'Sample Landmark' } },
            }],
          },
        } as any);
      }, stamp);

      const mapUid: string = await page.evaluate(async ({ slug, gcps }: any) => {
        const mapObject: any = {
          mapID: slug, title: { en: 'Sample Historical Map' },
          officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
          attr: { en: 'Sample Archive' }, dataAttr: {}, description: {},
          license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'en',
          imageExtension: 'png', width: 400, height: 300,
          gcps, edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
          // POI タブのバッジ 3 分類を 1 枚に写すための参照列（設計 §5.3 / 台帳 B-60）。
          // 先頭が上書きレイヤ（形状 fc）なので複層モード = 要素ごとに 1 カードで描画される
          pois: [
            { layer: 'https://example.com/pois/temples.geojson', title: { en: 'Temples (overridden title)' } },
            'https://example.com/pois/landmarks.geojson',
            {
              type: 'FeatureCollection', id: 'embedded-pois',
              features: [{
                type: 'Feature', id: 'e1', geometry: { type: 'Point', coordinates: [139.77, 35.68] },
                properties: { name: { en: 'Embedded POI' } },
              }],
            },
          ],
        };
        const r1: any = await window.mapedit.save({ slug, mapObject, tins: [] });
        if (!r1 || r1.result !== 'Success') throw new Error(`map seed failed: ${JSON.stringify(r1)}`);
        const tinResult: any = await window.mapedit.updateTin(
          mapObject.gcps, mapObject.edges, 0, [mapObject.width, mapObject.height],
          mapObject.strictMode, mapObject.vertexMode,
        );
        if (!Array.isArray(tinResult) || !tinResult[1] || typeof tinResult[1] !== 'object') {
          throw new Error(`TIN compile failed: ${JSON.stringify(tinResult)}`);
        }
        const r2: any = await window.mapedit.save({ slug, uid: r1.uid, mapObject, tins: [tinResult[1]] });
        if (!r2 || r2.result !== 'Success') throw new Error(`compiled map save failed: ${JSON.stringify(r2)}`);
        return r2.uid as string;
      }, { slug: mapSlug, gcps });

      await mkdir(path.join(saveFolder, 'originals'), { recursive: true });
      await writeFile(path.join(saveFolder, 'originals', `${mapUid}.png`), Buffer.from(TINY_PNG_BASE64, 'base64'));

      // ================= current-10: 地図の POI タブ =================
      await openHash(page, `#/mapedit?uid=${mapUid}`, '[data-testid="map-tab-pois"]');
      await page.getByTestId('map-tab-pois').click();
      const poisPane = page.getByTestId('map-pois-tab-pane');
      await expect(poisPane).toBeVisible({ timeout: 20000 });
      await expect(poisPane.locator('.selected-source')).toHaveCount(3, { timeout: 20000 });
      // 3 バッジ（外部ファイル参照 / 外部URL参照 / 地図内定義POI）が揃っていること
      await expect(poisPane.getByText('External file reference')).toBeVisible();
      await expect(poisPane.getByText('External URL reference')).toBeVisible();
      await expect(poisPane.getByText('Map-embedded POI')).toBeVisible();
      await expect(poisPane.getByTestId('poiref-add-override')).toBeVisible();
      await page.waitForTimeout(500);
      await shot('current-10-map-poi-tab');

      // ================= current-11: メルカトルタイル生成タブ =================
      // 掲載文（Tutorials.md）は「タイルセット選択ダイアログ」を示す画像を求める。
      // このモーダルは同じ地図から生成済みの merc マスタが 1 件以上あるときに出る
      // （MapEdit.vue wmtsGenerate: 0 件なら確認なしで新規作成）。∴ 生成済み 1 件を seed する
      await page.evaluate(async ({ sourceMapUid, slug }: any) => {
        const result: any = await window.baseMaps.saveUser({
          uid: crypto.randomUUID(), slug: `${slug}-merc`, create: true,
          tms: {
            kind: 'merc', lang: 'en',
            title: { en: 'Sample Historical Map (Mercator)' }, label: { en: 'Sample Historical Map (Mercator)' },
            attr: { en: 'Sample Archive' }, dataAttr: {},
            license: 'PD', dataLicense: 'CC BY-SA', licenseNote: {}, dataLicenseNote: {},
            url: '', minZoom: 0, maxZoom: 18, thumbnail: '',
            coverageLngLats: null, tileJsonSourceUrl: null, sourceMapUid,
          },
        } as any);
        if (!result || result.result !== 'Success') throw new Error(`merc master seed failed: ${JSON.stringify(result)}`);
      }, { sourceMapUid: mapUid, slug: mapSlug });

      await page.getByTestId('map-tab-merc').click();
      await expect(page.getByTestId('map-merc-tab-pane')).toBeVisible({ timeout: 20000 });
      const generateButton = page.getByTestId('merc-generate-button');
      await expect(generateButton).toBeEnabled({ timeout: 20000 });
      await generateButton.click();
      await expect(page.getByTestId('merc-tile-set-modal')).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(500);
      await shot('current-11-merc-tab');
      // 生成は行わない（撮影目的のため選択ダイアログで止める）
      await page.getByTestId('merc-modal-cancel').click();
    } finally {
      await quitElectronApplication(app);
    }
  });
});
