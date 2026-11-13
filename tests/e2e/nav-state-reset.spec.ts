// 画面遷移（location.hash の書き換え）の後の状態の再発防止。
//   1. hash の書き換えで画面を移ると、上部タブの強調は移った先の画面に追随する
//      （書き換えが初期遷移と競合して取りこぼされない）
//   2. 画面を移ると、新しい画面は先頭から表示される（前の画面のスクロール位置を持ち越さない）
// 同じ画面の中の操作（一覧の絞り込みなど）と、戻るボタンで戻ったときの復元は壊さない
// （復元の担保は既存の「Back restores query and scroll」等の e2e）。
import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launch } from './helpers/launchIsolated';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { takeScreenshot } from './helpers/screenshot';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const evidenceDir = path.join(projectRoot, '.tmp-evidence', 'after-fix');

async function openHash(page: Page, hash: string, ready: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await expect(page.locator(ready)).toBeVisible({ timeout: 20000 });
}

async function activeTabs(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll('.navbar-nav .nav-link.active'))
    .map((el) => (el.textContent || '').trim().replace(/\s+/g, '')));
}

/** 画面の外（共有）にあるスクロール位置。画面を移るたびに先頭へ戻っていること */
async function sharedScrollTops(page: Page): Promise<{ main: number; body: number; html: number }> {
  return page.evaluate(() => {
    const main = document.querySelector('.main-content') as HTMLElement | null;
    return {
      main: main ? Math.round(main.scrollTop) : 0,
      body: Math.round(document.body.scrollTop),
      html: Math.round(document.documentElement.scrollTop),
    };
  });
}

async function seedMaps(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await page.evaluate(async (slugTag: string) => {
      const slug = `nav-scroll-map-${slugTag}`;
      const result = await (window as any).mapedit.save({ slug, mapObject: {
        mapID: slug, title: { ja: `画面遷移試験 地図 ${slugTag}` },
        officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr: {}, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA',
        reference: '', url: '', lang: 'ja', imageExtension: 'jpg', width: 400, height: 300,
        gcps: [], edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
      }, tins: [] });
      if (!result || result.result !== 'Success') throw new Error(`seed map failed: ${JSON.stringify(result)}`);
    }, String(i).padStart(2, '0'));
  }
}

async function seedApps(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await page.evaluate(async (slugTag: string) => {
      const slug = `nav-scroll-app-${slugTag}`;
      const result = await (window as any).appedit.save({ slug, document: {
        appID: slug, appName: { ja: `画面遷移試験 アプリ ${slugTag}` }, title: { ja: `画面遷移試験 アプリ ${slugTag}` },
        description: {}, keywords: '', siteUrl: '', lang: 'ja', sources: [], pois: [],
        httpSettings: {}, appSettings: {}, manifestSettings: {},
      } });
      if (!result || result.result !== 'Success') throw new Error(`seed app failed: ${JSON.stringify(result)}`);
    }, String(i).padStart(2, '0'));
  }
}

test('hash の書き換えで画面を移ると、上部タブの強調は移った先の画面に追随する', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-nav-tabs-'));
  await mkdir(evidenceDir, { recursive: true });
  const { app, page } = await launch(e2eRoot);
  try {
    await page.evaluate(() => window.settings.set('lang', 'ja'));

    // 着いた画面に合わせてタブの強調が移ること（落ち着いた状態）
    const steps: { hash: string; ready: string; label: string }[] = [
      { hash: '#/maplist', ready: '[data-resource-list="map"]', label: '地図管理' },
      { hash: '#/poisources', ready: '[data-resource-list="poi-source"]', label: 'POI管理' },
      { hash: '#/basemaps', ready: '[data-master-detail="base-map"]', label: 'ベースマップ管理' },
      { hash: '#/applist', ready: '[data-resource-list="app"]', label: 'アプリ管理' },
      { hash: '#/assets', ready: '[data-master-detail="image-asset"]', label: 'アセット管理' },
      { hash: '#/settings', ready: '#langSwitcher', label: '設定' },
    ];
    for (const step of steps) {
      await openHash(page, step.hash, step.ready);
      await expect.poll(async () => activeTabs(page), { timeout: 5000 }).toEqual([step.label]);
    }
    await takeScreenshot(page, path.join(evidenceDir, 'nav-tabs-settled.png'));

    // 初期遷移の途中で hash を書き換えても、書き換え先の画面とタブに着くこと。
    // 初期遷移（遅いチャンク読み込み）が URL を初期ターゲットへ書き戻して書き換えを
    // 取りこぼすと、前の画面（タブの強調を含む）が残ってしまうため、ここを固定する。
    // Settings のチャンクを止めて初期遷移を確定させないまま書き換え、書き換えた後に放す
    // （時間の決め打ちに頼らず、書き換えが必ず初期遷移の確定より前になるようにする）。
    await openHash(page, '#/settings', '#langSwitcher');
    const cdp = await page.context().newCDPSession(page);
    const held: string[] = [];
    let holding = true;
    const release = (requestId: string) => cdp.send('Fetch.continueRequest', { requestId }).catch(() => undefined);
    cdp.on('Fetch.requestPaused', (e) => {
      if (holding && /Settings-[^/]+\.js/.test(e.request.url)) held.push(e.requestId);
      else void release(e.requestId);
    });
    try {
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });

      await page.reload({ waitUntil: 'domcontentloaded' });
      // 初期遷移が Settings のチャンクで止まっていることを確かめてから書き換える
      await expect.poll(() => held.length, { timeout: 20000 }).toBeGreaterThanOrEqual(1);
      expect(await page.locator('#langSwitcher').count()).toBe(0);
      await page.evaluate(() => { location.hash = '#/poisources'; });

      holding = false;
      await Promise.all(held.map(release));

      await expect(page.locator('[data-resource-list="poi-source"]')).toBeVisible({ timeout: 15000 });
      await expect.poll(async () => page.evaluate(() => location.hash), { timeout: 5000 }).toContain('#/poisources');
      await expect.poll(async () => activeTabs(page), { timeout: 5000 }).toEqual(['POI管理']);
      await takeScreenshot(page, path.join(evidenceDir, 'nav-tabs-after-hash-write.png'));
    } finally {
      holding = false;
      await cdp.send('Fetch.disable').catch(() => undefined);
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: false }).catch(() => undefined);
    }
  } finally {
    await quitElectronApplication(app);
  }
});

test('画面を移ると、新しい画面は先頭から表示される', async () => {
  test.setTimeout(300_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-nav-scroll-'));
  await mkdir(evidenceDir, { recursive: true });
  const { app, page } = await launch(e2eRoot);
  try {
    await page.evaluate(() => window.settings.set('lang', 'ja'));
    await seedMaps(page, 22);
    await seedApps(page, 22);

    // 長い一覧の下のほうまでスクロールする
    await openHash(page, '#/applist', '[data-resource-list="app"]');
    await expect.poll(async () => page.locator('[data-resource-uid]').count()).toBeGreaterThan(0);
    await page.locator('[data-resource-content="app"]').evaluate((el) => { el.scrollTop = 900; });
    await expect.poll(async () => page.locator('[data-resource-content="app"]').evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);

    await openHash(page, '#/maplist', '[data-resource-list="map"]');
    await expect.poll(async () => page.locator('[data-resource-uid]').count()).toBeGreaterThan(0);
    await page.locator('[data-resource-content="map"]').evaluate((el) => { el.scrollTop = 900; });
    await expect.poll(async () => page.locator('[data-resource-content="map"]').evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    await takeScreenshot(page, path.join(evidenceDir, 'nav-scroll-long-list.png'));

    // 長い一覧の下のほうから別の画面へ移る → 新しい画面は先頭から表示される
    await openHash(page, '#/applist', '[data-resource-content="app"]');
    await takeScreenshot(page, path.join(evidenceDir, 'nav-scroll-after-move.png'));
    await expect
      .poll(async () => page.locator('[data-resource-content="app"]').evaluate((el) => el.scrollTop), { timeout: 5000 })
      .toBe(0);
    expect(await sharedScrollTops(page)).toEqual({ main: 0, body: 0, html: 0 });

    // 一覧へ戻っても、戻るボタンでの帰還でない限り先頭から表示される
    await openHash(page, '#/maplist', '[data-resource-content="map"]');
    await expect
      .poll(async () => page.locator('[data-resource-content="map"]').evaluate((el) => el.scrollTop), { timeout: 5000 })
      .toBe(0);
    expect(await sharedScrollTops(page)).toEqual({ main: 0, body: 0, html: 0 });

    // 一覧の下のほうから編集画面へ移っても先頭から表示される
    await page.locator('[data-resource-content="map"]').evaluate((el) => { el.scrollTop = 900; });
    await expect.poll(async () => page.locator('[data-resource-content="map"]').evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    await openHash(page, '#/settings', '#langSwitcher');
    expect(await sharedScrollTops(page)).toEqual({ main: 0, body: 0, html: 0 });

    // 画面の外（共有）の .main-content をスクロールしてから移っても、新しい画面は先頭から表示される。
    // 画面の上に残るバナー（移行レポート）があると、.main-content は画面の高さを超えてはみ出す。
    // このはみ出しは画面を移っても残るので、.main-content の位置を揃えないと前の位置を持ち越す。
    await app.evaluate(({ BrowserWindow }) => {
      const warnings = Array.from({ length: 12 }, (_, index) => `画面遷移試験の警告 ${index + 1}`);
      BrowserWindow.getAllWindows()[0].webContents.send('app:migrationReport', { renamedSlugs: [], warnings });
    });
    await expect(page.getByTestId('migration-report')).toBeVisible();
    const scrollMain = async (): Promise<number> => page.locator('.main-content').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return Math.round(el.scrollTop);
    });
    const mainOverflow = async (): Promise<number> => page.locator('.main-content')
      .evaluate((el) => el.scrollHeight - el.clientHeight);
    await expect.poll(mainOverflow).toBeGreaterThan(0);
    await expect.poll(scrollMain).toBeGreaterThan(0);
    await takeScreenshot(page, path.join(evidenceDir, 'nav-main-content-scrolled.png'));

    await openHash(page, '#/maplist', '[data-resource-content="map"]');
    // 移った先の画面もはみ出す（はみ出さなければ位置は自然に 0 になり、確かめにならない）
    expect(await mainOverflow()).toBeGreaterThan(0);
    await takeScreenshot(page, path.join(evidenceDir, 'nav-main-content-after-move.png'));
    expect(await sharedScrollTops(page)).toEqual({ main: 0, body: 0, html: 0 });
  } finally {
    await quitElectronApplication(app);
  }
});
