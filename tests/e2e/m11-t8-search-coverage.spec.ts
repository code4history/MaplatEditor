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
      DROP TRIGGER IF EXISTS apps_rtree_ad;
      DROP TRIGGER IF EXISTS apps_rtree_au;
      DROP TRIGGER IF EXISTS apps_rtree_ai;
      DROP TRIGGER IF EXISTS maps_search_ad;
      DROP TRIGGER IF EXISTS maps_search_au;
      DROP TRIGGER IF EXISTS maps_search_ai;
      DROP TRIGGER IF EXISTS poi_sources_search_ad;
      DROP TRIGGER IF EXISTS poi_sources_search_au;
      DROP TRIGGER IF EXISTS poi_sources_search_ai;
      DROP TRIGGER IF EXISTS poi_sources_rtree_ad;
      DROP TRIGGER IF EXISTS poi_sources_rtree_au;
      DROP TRIGGER IF EXISTS poi_sources_rtree_ai;

      DELETE FROM schema_migrations;
      DELETE FROM apps;
      DELETE FROM maps;
      DELETE FROM base_maps;
      DELETE FROM base_maps_fts;
      DELETE FROM apps_rtree;
      DELETE FROM apps_rtree_key;
      DELETE FROM apps_fts;
      DELETE FROM maps_fts;
      DELETE FROM maps_rtree;
      DELETE FROM maps_rtree_key;
      DELETE FROM assets_fts;
      DELETE FROM poi_sources_rtree;
      DELETE FROM poi_sources_rtree_key;
      
      INSERT INTO schema_migrations (id) VALUES ('2026-07-04-sqlite-write-store-legacy-import');
      INSERT INTO schema_migrations (id) VALUES ('2026-07-14-app-localized-search-index-backfill');
      
      INSERT INTO base_maps (uid, slug, scope, sort_order, data_json) VALUES (
        'bm-1', 'test-basemap', 'global', 10, '{"title":{"ja":"テストベースマップ","en":"Test BaseMap"},"label":"bm-label","attribution":"bm-attr"}'
      );
      
      INSERT INTO maps (uid, slug, data_json) VALUES (
        'aaaaaaaa-bbbb-cccc-dddd-000000000001', 'test-map', '{"width":400,"height":300,"lang":"ja","edges":[[0,0],[400,0],[400,300],[0,300]],"gcps":[{"x":0,"y":300,"lng":139.7,"lat":35.6},{"x":400,"y":0,"lng":139.8,"lat":35.7}],"compiled":{"vertices_points":[[null,[15551351.4,4249117.8]],[null,[15562483.3,4259837.2]]]}}'
      );
      
      INSERT INTO apps (uid, slug, data_json) VALUES (
        'bbbbbbbb-cccc-dddd-eeee-000000000001', 'test-app', '{"appName":"テストアプリ","sources":[{"sourceType":"maplat","mapUid":"aaaaaaaa-bbbb-cccc-dddd-000000000001"}]}'
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
      return await (window as any).search.baseMaps({ q: 'ベースマップ', page: 1, pageSize: 10 });
    });
    expect(ftsResult.docs.map((d: any) => d.uid)).toContain('bm-1');

    // 空間検索の検証 (自動カバレッジのアプリが searchExtent で引っかかること)
    // 東京周辺の BBox [W, S, E, N] = [139.5, 35.5, 140.0, 36.0]
    const spatialResult = await page.evaluate(async () => {
      return await (window as any).search.searchExtent('app', [15529087, 4232311, 15584729, 4301232]);
    });
    expect(spatialResult).toContain('test-app');

    // 4. アプリ編集画面でのカバレッジ変更のインタラクション（トグル無し）の検証
    await page.evaluate(() => window.settings.set('lang', 'ja'));
    await page.evaluate((nextHash) => { location.hash = nextHash; }, '#/applist');
    await expect(page.locator('.resource-list__toolbar')).toBeVisible();

    await page.locator(`[data-resource-uid="bbbbbbbb-cccc-dddd-eeee-000000000001"] a`).click();
    // m19-t11: ③の呼称は「アプリ提供範囲(参考)」→「アプリ対象範囲」
    await expect(page.getByTestId('app-coverage-label')).toContainText('アプリ対象範囲');
    await expect(page.locator('.small.font-monospace')).toContainText('W139.69');
    await expect(page.locator('button:has-text("クリア")')).not.toBeVisible();

    // 手動指定をシミュレート
    await page.evaluate(() => {
      (window as any).testDebug.applyAppCoverage([
        [139.0, 35.0], [140.0, 35.0], [140.0, 36.0], [139.0, 36.0]
      ]);
    });

    // 手動指定後は、その値が表示され、かつ「クリア」ボタンが表示される
    await expect(page.locator('.small.font-monospace')).toContainText('W139 S35 E140 N36');
    await expect(page.locator('button:has-text("クリア")')).toBeVisible();

    // 手動の状態で地図を追加しても、手動の範囲が上書きされないことを確認
    await page.evaluate(() => {
      (window as any).testDebug.appData.value.sources.push({
        sourceType: 'maplat',
        mapUid: 'map-new'
      });
    });

    // 手動カバレッジ（W139 S35 E140 N36）のままであること
    await expect(page.locator('.small.font-monospace')).toContainText('W139 S35 E140 N36');

    // 「クリア」ボタンをクリックして手動をクリア
    await page.locator('button:has-text("クリア")').click();

    // クリア後は、クリアボタンが消え、自動計算結果に戻る
    await expect(page.locator('button:has-text("クリア")')).not.toBeVisible();
    await expect(page.locator('.small.font-monospace')).not.toContainText('W139 S35 E140 N36');

    // 地図をすべて削除すると、カバレッジも消去（-）される
    await page.evaluate(() => {
      (window as any).testDebug.appData.value.sources = [];
    });
    await expect(page.locator('.small.font-monospace')).toHaveText('-');

    // 5. ヘッダー被りの検証（800px幅で navbar-bottom ≤ main-content-top）
    // タブ展開が保たれる 800px（>768px navbar-expand-md 閾値）で検証
    await page.setViewportSize({ width: 800, height: 800 });
    await page.waitForTimeout(500);

    const overlap = await page.evaluate(() => {
      const navbar = document.querySelector('.navbar') as HTMLElement | null;
      const main = document.querySelector('.main-content') as HTMLElement | null;
      if (!navbar || !main) return { gap: NaN, status: 'missing' };
      const nr = navbar.getBoundingClientRect();
      const mr = main.getBoundingClientRect();
      return { gap: mr.top - nr.bottom, status: mr.top < nr.bottom ? 'overlap' : 'ok' };
    });
    expect(overlap.status, `Header-content gap: ${overlap.gap}px (expected >= 0)`).toBe('ok');

    await quitElectronApplication(app);
  });
});