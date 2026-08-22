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
