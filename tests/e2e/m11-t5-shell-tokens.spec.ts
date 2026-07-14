import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const artifactDir = path.join(projectRoot, 'test-results', 'm11-t5-screenshots');

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // AC14: 実ユーザーデータへ接続せず、隔離 root 外なら test 開始前に throw する
  const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
  if (!path.resolve(saveFolder).startsWith(path.resolve(e2eRoot) + path.sep)) {
    throw new Error(`E2E storage isolation failed: ${saveFolder} is outside ${e2eRoot}`);
  }
  return { app, page };
}

async function openHash(page: Page, hash: string, ready: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await expect(page.locator(ready)).toBeVisible();
}

// エディタ UI 言語を ja へ確定させる。settings.set → /settings 訪問で
// Settings.vue の onMounted が i18next.changeLanguage('ja') を呼ぶ（OS 既定言語に依存しない）。
async function forceJapanese(page: Page): Promise<void> {
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  await openHash(page, '#/settings', '#langSwitcher');
  await expect(page.locator('#langSwitcher')).toHaveValue('ja');
}

// m11-t3 の seed helper を再掲（isolated service 経由でエンティティ作成）
async function seedApp(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const slug = `m11-t5-app-${Date.now()}`;
    const result = await window.appedit.save({ slug, document: {
      appID: slug, appName: { en: 'T5 App' }, title: { en: 'T5 App' }, description: {},
      keywords: '', siteUrl: '', lang: 'en', sources: [], pois: [],
      httpSettings: {}, appSettings: {}, manifestSettings: {},
    }});
    if (!result || result.result !== 'Success') throw new Error(`seed app failed: ${JSON.stringify(result)}`);
    return result.uid;
  });
}

async function seedPoi(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const slug = `m11-t5-poi-${Date.now()}`;
    const result = await window.poiSources.createLocal({ slug, title: { ja: 'T5 POI', en: 'T5 POI' }, lang: 'ja' });
    if (!result || result.result !== 'Success') throw new Error(`seed poi failed: ${JSON.stringify(result)}`);
    return result.uid;
  });
}

async function seedMap(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const slug = `m11-t5-map-${Date.now()}`;
    const result = await window.mapedit.save({ slug, mapObject: {
      mapID: slug, title: { ja: 'T5 地図', en: 'T5 Map' },
      officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: {}, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA',
      reference: '', url: '', lang: 'ja', imageExtension: 'jpg', width: 400, height: 300,
      gcps: [], edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
    }, tins: [] });
    if (!result || result.result !== 'Success') throw new Error(`seed map failed: ${JSON.stringify(result)}`);
    return result.uid;
  });
}

test('shell font, header vocabulary, and header offset use tokens', async () => {
  test.setTimeout(120_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t5-'));
  const { app, page } = await launch(e2eRoot);
  try {
    // AC2: 通常 UI の computed font が system-ui スタック（Inter/Avenir でない）
    const bodyFont = await page.evaluate(() => getComputedStyle(document.querySelector('#app') as Element).fontFamily);
    expect(bodyFont.toLowerCase()).not.toContain('inter');
    expect(bodyFont.toLowerCase()).not.toContain('avenir');

    // AC6: 黒 header が 5管理語彙 + 設定（ja）
    await forceJapanese(page);
    await openHash(page, '#/maplist', '.main-content');
    for (const label of ['地図管理', 'POI管理', 'ベースマップ管理', 'アプリ管理', 'アセット管理', '設定']) {
      await expect(page.locator('.navbar-nav .nav-link', { hasText: label })).toBeVisible();
    }

    // AC6: route / nav 遷移が不変
    await page.locator('.navbar-nav .nav-link', { hasText: 'ベースマップ管理' }).click();
    await expect(page).toHaveURL(/\/basemaps/);
    await page.locator('.navbar-nav .nav-link', { hasText: 'アセット管理' }).click();
    await expect(page).toHaveURL(/\/assets/);

    // AC7: header 高さと main-content offset が一致
    const headerHeight = await page.evaluate(() => (document.querySelector('.navbar') as HTMLElement).offsetHeight);
    const contentOffset = await page.evaluate(() => parseInt(getComputedStyle(document.querySelector('.main-content') as Element).marginTop, 10));
    expect(headerHeight).toBe(50);
    expect(contentOffset).toBe(50);
  } finally {
    await app.close();
  }
});

test('pilot editors show token diagnostics, mono slug, and context help', async () => {
  test.setTimeout(120_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t5-'));
  const { app, page } = await launch(e2eRoot);
  try {
    // 新規エディタは list の「新規追加」ボタン経由で開く（uid が randomUUID で採番され ?uid=..&new=1 になる）
    await openHash(page, '#/basemaps', '[data-master-detail="base-map"]');
    await page.getByTestId('basemap-new').click();
    await expect(page.locator('[data-testid="basemap-editor"]')).toBeVisible();

    // AC3: slug 入力が monospace（computed font に mono が含まれる）
    const slugFont = await page.getByTestId('basemap-slug').evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase());
    expect(slugFont).toMatch(/mono|menlo|consolas|courier|sfmono|liberation/);

    // AC10: ContextHelp tooltip（slug）が focus と hover で開く
    const help = page.locator('[data-editor-help]').first();
    await help.focus();
    await expect(page.locator('.tooltip')).toBeVisible();
    await page.getByTestId('basemap-slug').focus(); // blur
    await expect(page.locator('.tooltip')).toHaveCount(0);
    await help.hover();
    await expect(page.locator('.tooltip')).toBeVisible();

    // AC11 / AC9: slug を不正化 → field 診断（danger）が出る
    await page.getByTestId('basemap-slug').fill('bad slug!');
    await page.getByTestId('basemap-slug').press('Tab');
    await expect(page.locator('[data-diagnostic-scope="field"]')).toBeVisible();

    // AC10: 存在範囲(coverage) の ContextHelp popover が click で開き、Escape/外側 click で閉じる
    const pop = page.locator('[data-editor-help]').last();
    await pop.click();
    await expect(page.locator('.popover')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.popover')).toHaveCount(0);
    await pop.click();
    await expect(page.locator('.popover')).toBeVisible();
    await page.mouse.click(5, 5); // 外側 click
    await expect(page.locator('.popover')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('captures regression screenshots for human review', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t5-'));
  const { app, page } = await launch(e2eRoot);
  const shot = (name: string) => page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: true });
  try {
    await forceJapanese(page);

    // 5一覧
    await openHash(page, '#/maplist', '.main-content');       await shot('01-map-list');
    await openHash(page, '#/poisources', '.main-content');    await shot('02-poi-source-list');
    await openHash(page, '#/basemaps', '[data-master-detail="base-map"]'); await shot('03-base-map-list');
    await openHash(page, '#/applist', '.main-content');       await shot('04-app-list');
    await openHash(page, '#/assets', '[data-master-detail="image-asset"]'); await shot('05-asset-list');

    // pilot 2 Edit（新規追加ボタン経由でエディタを開く）
    await openHash(page, '#/basemaps', '[data-master-detail="base-map"]');
    await page.getByTestId('basemap-new').click();
    await expect(page.locator('[data-testid="basemap-editor"]')).toBeVisible();
    await shot('06-base-map-edit');

    await openHash(page, '#/assets', '[data-master-detail="image-asset"]');
    await page.getByTestId('asset-new').click();
    await expect(page.getByTestId('asset-slug')).toBeVisible();
    await shot('07-asset-edit');

    // S3回帰面: MapEdit の到達可能な .card 面（settings タブのベースマップ表示 card）
    const mapUid = await seedMap(page);
    await openHash(page, `#/mapedit?uid=${mapUid}`, '#mapDocumentLanguage');
    // NOTE: データ入出力(inout)タブは現行 MapEdit のタブバーに導線が無い（activeTab==='inout' の setter 不在）。
    // 到達可能な .card 面（設定タブのベースマップ表示 card）を撮る。
    await page.locator('.nav-tabs .nav-link', { hasText: /ベースマップ|Base Map|設定|Settings/ }).first().click().catch(() => undefined);
    await shot('08-map-edit-card');

    // S3回帰面: AppEdit source-row 面
    const appUid = await seedApp(page);
    await openHash(page, `#/appedit?uid=${appUid}`, '[data-testid="app-id"]');
    await page.getByTestId('app-sources-tab').click().catch(() => undefined);
    await page.getByTestId('app-basemap-mode').click().catch(() => undefined); // source-row 一覧を表示
    await shot('09-app-edit-source-row');

    // S3回帰面: PoiEdit 診断面
    const poiUid = await seedPoi(page);
    await openHash(page, `#/poisources/${poiUid}`, '.poi-side-pane');
    await shot('10-poi-edit-diagnostics');
  } finally {
    await app.close();
  }
});
