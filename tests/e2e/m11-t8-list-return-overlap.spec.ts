// m11-t8 回帰テスト: エディタから一覧へ戻った際に、スクロール位置復元の
// scrollIntoView が overflow:hidden の body まで祖先スクロールさせ、fixed ヘッダー下に
// ツールバーが潜り込むバグ(人間検証 2026-07-16 添付3で再現)の再発防止。
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

test('list toolbar stays below fixed header after editor -> list return', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-hdr-return-'));
  let { app, page } = await launch(e2eRoot);
  const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
  await quitElectronApplication(app);

  const dbPath = path.join(saveFolder, 'maplat.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    DROP TRIGGER IF EXISTS maps_search_ai; DROP TRIGGER IF EXISTS maps_search_au; DROP TRIGGER IF EXISTS maps_search_ad;
    DROP TRIGGER IF EXISTS apps_search_ai; DROP TRIGGER IF EXISTS apps_search_au; DROP TRIGGER IF EXISTS apps_search_ad;
    DROP TRIGGER IF EXISTS apps_rtree_ai; DROP TRIGGER IF EXISTS apps_rtree_au; DROP TRIGGER IF EXISTS apps_rtree_ad;
    INSERT INTO maps (uid, slug, data_json) VALUES (
      'aaaaaaaa-bbbb-cccc-dddd-000000000001', 'test-map', '{"width":400,"height":300,"lang":"ja","edges":[[0,0],[400,0],[400,300],[0,300]],"gcps":[{"x":0,"y":300,"lng":139.7,"lat":35.6},{"x":400,"y":0,"lng":139.8,"lat":35.7}],"compiled":{"vertices_points":[[null,[15551351.4,4249117.8]],[null,[15562483.3,4259837.2]]]}}'
    );
    INSERT INTO apps (uid, slug, data_json) VALUES (
      'bbbbbbbb-cccc-dddd-eeee-000000000001', 'test-app', '{"appName":"テストアプリ","sources":[{"sourceType":"maplat","mapUid":"aaaaaaaa-bbbb-cccc-dddd-000000000001"}]}'
    );
  `);
  db.close();

  const relaunch = await launch(e2eRoot);
  app = relaunch.app;
  page = relaunch.page;

  await page.evaluate(() => window.settings.set('lang', 'ja'));
  await page.evaluate((nextHash) => { location.hash = nextHash; }, '#/applist');
  await expect(page.locator('.resource-list__toolbar')).toBeVisible();

  // エディタへ遷移し、実利用と同様にコンテンツをスクロールさせる
  await page.locator(`[data-resource-uid="bbbbbbbb-cccc-dddd-eeee-000000000001"] a`).click();
  // m19-t11: ③の呼称は「アプリ提供範囲(参考)」→「アプリ対象範囲」
  await expect(page.getByTestId('app-coverage-label')).toContainText('アプリ対象範囲');
  await page.evaluate(() => {
    const main = document.querySelector('.main-content') as HTMLElement | null;
    if (main) main.scrollTop = 200;
  });

  // 一覧へ戻る
  await page.locator('text=一覧へ').click();
  await expect(page.locator('.resource-list__status')).toBeVisible();
  await page.waitForTimeout(400);

  const layout = await page.evaluate(() => {
    const navbar = document.querySelector('.navbar') as HTMLElement | null;
    const toolbar = document.querySelector('.resource-list__toolbar') as HTMLElement | null;
    return {
      navbarBottom: navbar?.getBoundingClientRect().bottom ?? NaN,
      toolbarTop: toolbar?.getBoundingClientRect().top ?? NaN,
      bodyScrollTop: document.body.scrollTop,
      htmlScrollTop: document.documentElement.scrollTop,
    };
  });

  // body/html は決してスクロールしない(fixed ヘッダー前提の不変条件)
  expect(layout.bodyScrollTop, 'body must never scroll').toBe(0);
  expect(layout.htmlScrollTop, 'html must never scroll').toBe(0);
  // ツールバーはヘッダーの下端以下に位置する(被りなし)
  expect(layout.toolbarTop, `toolbar top ${layout.toolbarTop} must be >= navbar bottom ${layout.navbarBottom}`)
    .toBeGreaterThanOrEqual(layout.navbarBottom - 1);

  await quitElectronApplication(app);
});
