import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

test.describe('M11-T8 Search Coverage & Backfill E2E Tests', () => {
  test('existing DB backfill re-builds FTS5 & RTree indexes, and auto coverage app is indexable in searchExtent', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t8-'));
    
    // 1. 初期起動
    let { app, page } = await launch(e2eRoot);
    const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
    await quitElectronApplication(app);

    // 2. 既存DBシード作成 (旧IDのみ)
    const dbPath = path.join(saveFolder, 'maplat.sqlite');
    const db = new DatabaseSync(dbPath);
    
    db.exec(`
      DROP TRIGGER IF EXISTS base_maps_search_ad;
      DROP TRIGGER IF EXISTS base_maps_search_au;
      DROP TRIGGER IF EXISTS base_maps_search_ai;
      DROP TRIGGER IF EXISTS assets_search_ad;
      DROP TRIGGER IF EXISTS assets_search_au;
      DROP TRIGGER IF EXISTS assets_search_ai;
      DROP TRIGGER IF EXISTS apps_search_ad;
      DROP TRIGGER IF EXISTS apps_search_au;
      DROP TRIGGER IF EXISTS apps_search_ai;
      DROP TRIGGER IF EXISTS maps_search_ad;
      DROP TRIGGER IF EXISTS maps_search_au;
      DROP TRIGGER IF EXISTS maps_search_ai;
      DROP TRIGGER IF EXISTS poi_sources_search_ad;
      DROP TRIGGER IF EXISTS poi_sources_search_au;
      DROP TRIGGER IF EXISTS poi_sources_search_ai;

      DELETE FROM schema_migrations;
      DELETE FROM apps;
      DELETE FROM maps;
      DELETE FROM base_maps;
      
      INSERT INTO schema_migrations (id) VALUES ('2026-07-04-sqlite-write-store-legacy-import');
      INSERT INTO schema_migrations (id) VALUES ('2026-07-14-app-localized-search-index-backfill');
      
      INSERT INTO base_maps (uid, slug, scope, data_json) VALUES (
        'bm-1', 'test-basemap', 'global', '{"title":{"ja":"テストベースマップ","en":"Test BaseMap"},"label":"bm-label","attribution":"bm-attr"}'
      );
      
      INSERT INTO maps (uid, slug, data_json) VALUES (
        'map-1', 'test-map', '{"width":400,"height":300,"lang":"ja","edges":[[0,0],[400,0],[400,300],[0,300]],"gcps":[{"x":0,"y":300,"lng":139.7,"lat":35.6},{"x":400,"y":0,"lng":139.8,"lat":35.7}]}'
      );
      
      INSERT INTO apps (uid, slug, data_json) VALUES (
        'app-1', 'test-app', '{"appName":"テストアプリ","sources":[{"sourceType":"maplat","mapUid":"map-1"}]}'
      );
    `);

    // まだ再構築前なので base_maps_fts と apps_rtree は 0件
    const initialFts = db.prepare("SELECT COUNT(*) as cnt FROM base_maps_fts").get() as any;
    const initialRtree = db.prepare("SELECT COUNT(*) as cnt FROM apps_rtree").get() as any;
    expect(initialFts.cnt).toBe(0);
    expect(initialRtree.cnt).toBe(0);
    
    db.close();

    // 3. 再起動（ここでバックフィルが自動実行される）
    const relaunch = await launch(e2eRoot);
    app = relaunch.app;
    page = relaunch.page;

    // FTS 全文検索の検証 (base-map の全文検索が機能することを確認)
    const ftsResult = await page.evaluate(async () => {
      return await (window as any).search.list('base-map', { q: 'ベースマップ' }, 1, 10);
    });
    expect(ftsResult.docs.map((d: any) => d.uid)).toContain('bm-1');

    // 空間検索の検証 (自動カバレッジのアプリが searchExtent で引っかかること)
    // 東京周辺の BBox [W, S, E, N] = [139.5, 35.5, 140.0, 36.0]
    const spatialResult = await page.evaluate(async () => {
      return await (window as any).search.searchExtent('app', [139.5, 35.5, 140.0, 36.0]);
    });
    expect(spatialResult).toContain('app-1');

    // 4. アプリ編集画面でのカバレッジ変更のインタラクション（トグル無し）の検証
    await page.evaluate(() => window.settings.set('lang', 'ja'));
    await page.evaluate((nextHash) => { location.hash = nextHash; }, '#/applist');
    await expect(page.locator('.resource-list__toolbar')).toBeVisible();

    // app-1 の編集へ遷移
    await page.locator(`[data-resource-card="app-1"] a`).click();
    await expect(page.locator('.app-edit')).toBeVisible();

    // 初期状態：自動カバレッジ表示、クリアボタン非表示
    await expect(page.locator('text=アプリ提供範囲(参考)')).toBeVisible();
    const bboxTextInitial = await page.locator('.small.font-monospace').textContent();
    expect(bboxTextInitial).toContain('W139.69');
    await expect(page.locator('button:has-text("クリア")')).not.toBeVisible();

    // 手動指定をシミュレート
    await page.evaluate(() => {
      (window as any).testDebug.applyAppCoverage([
        [139.0, 35.0], [140.0, 35.0], [140.0, 36.0], [139.0, 36.0]
      ]);
    });

    // 手動指定後は、その値が表示され、かつ「クリア」ボタンが表示される
    const bboxTextManual = await page.locator('.small.font-monospace').textContent();
    expect(bboxTextManual).toContain('W139 S35 E140 N36');
    await expect(page.locator('button:has-text("クリア")')).toBeVisible();

    // 手動の状態で地図を追加しても、手動の範囲が上書きされないことを確認
    await page.evaluate(() => {
      (window as any).testDebug.appData.value.sources.push({
        sourceType: 'maplat',
        mapUid: 'map-new'
      });
    });
    await page.waitForTimeout(500);

    // 手動カバレッジ（W139 S35 E140 N36）のままであること
    const bboxTextAfterAdd = await page.locator('.small.font-monospace').textContent();
    expect(bboxTextAfterAdd).toContain('W139 S35 E140 N36');

    // 「クリア」ボタンをクリックして手動をクリア
    await page.locator('button:has-text("クリア")').click();

    // クリア後は、クリアボタンが消え、自動計算結果に戻る
    await expect(page.locator('button:has-text("クリア")')).not.toBeVisible();
    const bboxTextAfterClear = await page.locator('.small.font-monospace').textContent();
    expect(bboxTextAfterClear).not.toContain('W139 S35 E140 N36');

    // 地図をすべて削除すると、カバレッジも消去（-）される
    await page.evaluate(() => {
      (window as any).testDebug.appData.value.sources = [];
    });
    await page.waitForTimeout(500);
    const bboxTextEmpty = await page.locator('.small.font-monospace').textContent();
    expect(bboxTextEmpty).toBe('-');

    // 5. ヘッダー被りの検証（nowrapの効果）
    await page.locator('.navbar-nav .nav-link', { hasText: 'ベースマップ管理' }).click();
    await expect(page).toHaveURL(/\/basemaps/);
    await page.locator('.navbar-nav .nav-link', { hasText: 'アセット管理' }).click();
    await expect(page).toHaveURL(/\/assets/);

    const toolbarMargin = await page.evaluate(() => {
      const el = document.querySelector('.main-content') as HTMLElement;
      return el ? parseInt(getComputedStyle(el).marginTop, 10) : 0;
    });
    expect(toolbarMargin).toBe(50);

    await quitElectronApplication(app);
  });
});
