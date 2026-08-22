// t1: E2E ヘッドレス化と、配布物で死んでいる経路3件の是正。
// 設計書 docs/superpowers/specs/2026-08-22-mapeditor-e2e-headless-and-fallback-fixes-t1-design.md
//
// 検証する受け入れ条件:
//   AC1  E2E 実行時（MAPLAT_E2E_ROOT 付き起動）、メインウィンドウと About ウィンドウが
//        isVisible() === false で生成される。paintWhenInitiallyHidden は既定 true のまま ∴
//        非表示でも renderer は描画を続ける（screenshot 系 spec の前提を壊さない）
//   AC4  新規地図（未保存）でベースマップ一覧が osm/gsi/gsi_ortho の3種になり、
//        /tms_list.json への要求が発生しない（HR-2・dev/配布物の挙動統一）
//   AC5  zip インポート直後に dist/tmbs/ 宛のネットワーク要求が 0 件になる（HR-3・
//        MaplatCore mixin の相対仮置き fetch を options.thumbnail 注入で通さない）
//
// 製品起動（env 無し）での挙動不変性は main.ts の show 制御が MAPLAT_E2E_ROOT のみに
// 分岐する構造で担保される（smoke m19-t4a が webPreferences 内容を引き続き検査）。
import { expect, test, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';
// m20-t6 §5.2: evalMain() / About ウィンドウ起動は helpers/electronMenu.ts へ抽出済み
import { evalMain, openAboutWindow } from './helpers/electronMenu';
// AC5 の zip インポート工程は m5-t4b が確立した共有ヘルパー（seed/搬出/別 slug 化）を再利用する
import {
  openHash,
  saveFolderOf,
  seedFullMap,
  stubMessageBoxAutoOk,
  rewriteZipSlug,
} from './helpers/mapPackage';

async function forceJapanese(page: Page): Promise<void> {
  await page.evaluate(() => window.settings.set('lang', 'ja'));
}

test.describe('t1 E2E ヘッドレス化（HR-1）', () => {
  test('AC1: MAPLAT_E2E_ROOT 付き起動ではメインウィンドウが isVisible()===false で生成される', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t1-ac1-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // launchIsolated.ts は env へ MAPLAT_E2E_ROOT を必ず付与する。全 BrowserWindow が
      // 非表示で生成されていることを main プロセス側で実測する
      const visibilities = await evalMain<boolean[]>(app, ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((w) => w.isVisible()),
      );
      expect(visibilities.length).toBeGreaterThan(0);
      expect(visibilities.every((v) => v === false)).toBe(true);

      // paintWhenInitiallyHidden 既定 true の前提確認: 非表示でも renderer は描画しており
      // DOM が構築されている（可視性とは独立の attached 判定で確かめる）
      await expect(page.locator('#app')).toBeAttached();
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC1: About ウィンドウも isVisible()===false で生成される', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t1-ac1-about-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await forceJapanese(page);
      // electronMenu.openAboutWindow は waitForEvent('window') + domcontentloaded 待ちのみで
      // show を待たない ∴ 非表示ウィンドウでも検出できる（設計 §7.1.1 実測どおり）
      const aboutPage: Page = await openAboutWindow(app, 'について');
      await expect(aboutPage.locator('body')).toBeAttached();

      const visibilities = await evalMain<boolean[]>(app, ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((w) => w.isVisible()),
      );
      expect(visibilities.length).toBeGreaterThan(0);
      expect(visibilities.every((v) => v === false)).toBe(true);
    } finally {
      await quitElectronApplication(app);
    }
  });
});

test.describe('t1 ベースマップフォールバック統一（HR-2）', () => {
  test('AC4: 新規（未保存）エディタで /tms_list.json 要求が発生しない', async () => {
    test.setTimeout(120_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t1-ac4-'));
    const { app, page } = await launch(e2eRoot);
    // 監視はナビゲーション前に張る（setupBaseMaps は mount 経路で走るため）
    const tmsListRequests: string[] = [];
    page.on('request', (req) => {
      if (/tms_list\.json/.test(req.url())) tmsListRequests.push(req.url());
    });
    try {
      await page.evaluate(() => window.settings.set('lang', 'ja'));
      // 新規（未保存）エディタ: mapUid / mapID が空のため setupBaseMaps の1段目ガードが
      // スキップされる経路。旧実装はここで dev 専用 fetch が発火していた
      // （file:// 配布物相当の本実行形態では ERR_FILE_NOT_FOUND で失敗していた要求）
      await page.evaluate((nextHash) => { location.hash = nextHash; }, '#/mapedit?new=1');
      await expect(page.getByTestId('map-tab-settings')).toBeVisible({ timeout: 30_000 });
      // setupBaseMaps 完了を含む十分な猶予を置いてから集計する（対象は「要求が発生しないこと」）
      await page.waitForTimeout(3_000);
      expect(tmsListRequests).toEqual([]);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC4: POI エディタのベースマップセレクターは常時表示3種（osm/gsi/gsi_ortho）', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t1-ac4-poi-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await page.evaluate(() => window.settings.set('lang', 'ja'));
      // POI ソースを seed し PoiEdit を開く（m11-t9 の seed パターンと同型）
      const poi = await page.evaluate(async () => {
        const slug = `t1-ac4-poi-${Date.now()}`;
        const created = await window.poiSources.createLocal({ slug, title: { ja: 'T1 POI', en: 'T1 POI' }, lang: 'ja' });
        if (!created || created.result !== 'Success') throw new Error(JSON.stringify(created));
        return created.uid as string;
      });
      await page.evaluate((nextHash) => { location.hash = nextHash; }, `#/poisources/${poi}`);
      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 20_000 });

      // 地図右上オーバーレイのセレクター選択肢 = 常時表示（alwaysVisible）3種
      const options = page.locator('#poiEditMap + div select option');
      await expect(options).toHaveCount(3, { timeout: 20_000 });
      const values = await options.evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
      expect(values.sort()).toEqual(['gsi', 'gsi_ortho', 'osm']);
    } finally {
      await quitElectronApplication(app);
    }
  });
});

test.describe('t1 インポート直後サムネイルの相対 fetch 死除去（HR-3）', () => {
  test('AC5: zip インポート直後に dist/tmbs/ 宛のページ相対要求が発生しない', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t1-ac5-'));
    const { app, page } = await launch(e2eRoot);
    // 監視は全工程に先立って張る。旧実装はインポート直後の Source 初期化で
    // MaplatCore mixin が相対仮置き fetch を行い、file:// ページ相対の
    // dist/tmbs/<slug>.jpg 宛要求が必ず 1 件発生していた（設計 §7.3.1 実測）
    const pageRelativeTmbsRequests: string[] = [];
    page.on('request', (req) => {
      if (/\/dist\/tmbs\//.test(req.url())) pageRelativeTmbsRequests.push(req.url());
    });
    try {
      await stubMessageBoxAutoOk(app);
      const seeded = await seedFullMap(page, await saveFolderOf(page), e2eRoot);

      // 地図 ZIP を実 UI の搬出ボタンから作る（m5-t4b AC11-b と同じ導線）
      const zipPath = path.join(e2eRoot, 'map-export.zip');
      await app.evaluate(async ({ dialog }, outZip) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: outZip })) as typeof dialog.showSaveDialog;
      }, zipPath);
      await openHash(page, `#/mapedit?uid=${seeded.mapUid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 30_000 });
      await page.locator('[data-editor-action="export"]').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 120_000 });

      // 別 slug の ZIP を作り、取込ダイアログがそれを返すようにする
      const copySlug = `${seeded.mapSlug}-copy`;
      const copyZip = path.join(e2eRoot, 'map-copy.zip');
      await rewriteZipSlug(zipPath, copyZip, seeded.mapSlug, copySlug);
      await app.evaluate(async ({ dialog }, inZip) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [inZip] })) as typeof dialog.showOpenDialog;
      }, copyZip);

      // 実 UI の取込導線: MapList の「インポート」→ /mapedit?new=1&import=1 で新規エディタ起動
      await openHash(page, '#/maplist');
      const importButton = page.locator('[data-resource-import]');
      await expect(importButton).toBeVisible({ timeout: 30_000 });
      await importButton.click();
      await expect(page.getByText('正常に地図データが登録できました。')).toBeVisible({ timeout: 120_000 });
      await expect(page.getByTestId('map-title')).toHaveValue('T4B 地図', { timeout: 30_000 });

      // インポート直後の Source 初期化（loadMapTiles / setupBaseMaps）が
      // 完走するだけの猶予を置いてから集計する
      await page.waitForTimeout(5_000);
      expect(pageRelativeTmbsRequests).toEqual([]);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
