import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
  const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
  if (!path.resolve(saveFolder).startsWith(path.resolve(e2eRoot) + path.sep)) {
    throw new Error(`E2E storage isolation failed: ${saveFolder} is outside ${e2eRoot}`);
  }
  return { app, page };
}

async function seedSpatialDocuments(page: Page): Promise<{ mapUid: string; appUid: string; poiUid: string }> {
  return page.evaluate(async () => {
    const suffix = Date.now();
    const mapSlug = `t8b-map-${suffix}`;
    const mapObject = {
      mapID: mapSlug,
      title: { ja: 'T8b 配線固有 東京地図', en: 'T8b unique Tokyo map' },
      officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: {}, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA',
      reference: '', url: '', lang: 'ja', imageExtension: 'png', width: 400, height: 300,
      url_: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      gcps: [
        [[0, 300], [15551351.4, 4249117.8]], [[400, 300], [15562483.3, 4249117.8]],
        [[400, 0], [15562483.3, 4259837.2]], [[0, 0], [15551351.4, 4259837.2]],
      ],
      edges: [], sub_maps: [], strictMode: 'loose', vertexMode: 'plain', status: 'New',
    };
    const first = await window.mapedit.save({ slug: mapSlug, mapObject, tins: [] });
    if (!first || first.result !== 'Success') throw new Error(`map create failed: ${JSON.stringify(first)}`);
    const tin = await window.mapedit.updateTin(mapObject.gcps, [], 0, [400, 300], 'loose', 'plain');
    if (!Array.isArray(tin) || !tin[1]) throw new Error(`TIN compile failed: ${JSON.stringify(tin)}`);
    const savedMap = await window.mapedit.save({ slug: mapSlug, uid: first.uid, mapObject, tins: [tin[1]] });
    if (!savedMap || savedMap.result !== 'Success') throw new Error(`map update failed: ${JSON.stringify(savedMap)}`);

    const poiSlug = `t8b-poi-${suffix}`;
    const poi = await window.poiSources.createLocal({ slug: poiSlug, title: { ja: 'T8b 空間固有 POI' }, lang: 'ja' });
    if (!poi || poi.result !== 'Success') throw new Error(`poi create failed: ${JSON.stringify(poi)}`);
    const poiSave = await window.poiSources.save(poi.uid, {
      slug: poiSlug,
      title: { ja: 'T8b 空間固有 POI' },
      fc: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [139.75, 35.65] }, properties: { name: '東京点' } }] },
    });
    if (!poiSave || poiSave.result !== 'Success') throw new Error(`poi save failed: ${JSON.stringify(poiSave)}`);

    const appSlug = `t8b-app-${suffix}`;
    const savedApp = await window.appedit.save({ slug: appSlug, document: {
      appID: appSlug, appName: { ja: 'T8b Selector App' }, title: { ja: 'T8b Selector App' },
      description: {}, keywords: '', siteUrl: '', lang: 'ja',
      sources: [{ sourceType: 'maplat', mapUid: savedMap.uid, mapSlug }], pois: [],
      httpSettings: {}, appSettings: {}, manifestSettings: {},
    } });
    if (!savedApp || savedApp.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(savedApp)}`);
    return { mapUid: savedMap.uid, appUid: savedApp.uid, poiUid: poi.uid };
  });
}

test('WGS84 search adapters and selector contexts share FTS, bbox, remount, and independent toggles', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t8b-'));
  const { app, page } = await launch(e2eRoot);
  try {
    await page.evaluate(() => window.settings.set('lang', 'ja'));
    const seeded = await seedSpatialDocuments(page);
    const api = await page.evaluate(async ({ mapUid, poiUid }) => ({
      mapTokyo: await window.search.maps({ q: '配線固有', bbox: [139.5, 35.4, 140, 36], page: 1, pageSize: 20 }),
      mapOsaka: await window.search.maps({ q: '配線固有', bbox: [135, 34, 136, 35], page: 1, pageSize: 20 }),
      poiTokyo: await window.search.poiSources({ q: '空間固有', bbox: [139.5, 35.4, 140, 36], page: 1, pageSize: 20 }),
      poiOsaka: await window.search.poiSources({ q: '空間固有', bbox: [135, 34, 136, 35], page: 1, pageSize: 20 }),
      canonical: await window.search.resourceBbox('map', mapUid),
      mapUid, poiUid,
    }), seeded);
    expect(api.mapTokyo.docs.map((item: any) => item.uid)).toContain(api.mapUid);
    expect(api.mapOsaka.docs.map((item: any) => item.uid)).not.toContain(api.mapUid);
    expect(api.poiTokyo.docs.map((item: any) => item.uid)).toContain(api.poiUid);
    expect(api.poiOsaka.docs.map((item: any) => item.uid)).not.toContain(api.poiUid);
    expect(api.canonical).not.toBeNull();

    await page.evaluate((uid) => { location.hash = `#/appedit?uid=${uid}`; }, seeded.appUid);
    await expect(page.getByTestId('app-id')).toBeVisible();
    await page.getByTestId('app-sources-tab').click();
    const sourceList = page.locator('.resource-selector-list:visible');
    const sourceQuery = sourceList.locator('input[type="search"]');
    await sourceQuery.fill('配線固有');
    await expect(sourceList.locator('.resource-master-row')).toContainText('配線固有');
    const sourceToggle = sourceList.getByTestId('selector-spatial-toggle');
    await expect(sourceToggle).toContainText('自動');
    await sourceToggle.click();
    await expect(sourceToggle).toContainText(/全世界|指定なし/);

    await page.getByTestId('app-basemap-mode').click();
    const baseQuery = page.locator('.resource-selector-list:visible input[type="search"]');
    await baseQuery.fill('GSI');
    await expect(page.getByTestId('app-basemap-row-gsi')).toBeVisible();
    await page.getByRole('button', { name: /地図一覧|Map list/i }).click();
    await expect(page.locator('.resource-selector-list:visible input[type="search"]')).toHaveValue('配線固有');
    await expect(page.locator('.resource-selector-list:visible').getByTestId('selector-spatial-toggle')).toContainText(/全世界|指定なし/);

    await page.getByRole('tab').nth(2).click();
    const poiToggle = page.locator('.resource-selector-list:visible').getByTestId('selector-spatial-toggle');
    await expect(poiToggle).toContainText('自動');
    await poiToggle.click();
    await expect(poiToggle).toContainText(/全世界|指定なし/);

    // AC3/AC4: 一覧の bbox 範囲フィルタ UI (BaseMapList 文法: ボタン→モーダル→?bbox=→クリア)
    await page.evaluate(() => { location.hash = '#/maplist'; });
    await expect(page.getByTestId('map-range-filter')).toBeVisible();
    await page.getByTestId('map-range-filter').click();
    await expect(page.locator('.envelope-modal')).toBeVisible();
    await page.locator('.envelope-modal').getByRole('button', { name: /キャンセル|Cancel/i }).click();
    await page.evaluate(() => { location.hash = '#/maplist?bbox=139.5,35.4,140,36'; });
    await expect(page.locator(`[data-resource-uid="${seeded.mapUid}"]`)).toBeVisible();
    await expect(page.getByTestId('map-range-clear')).toBeVisible();
    await page.evaluate(() => { location.hash = '#/maplist?bbox=135,34,136,35'; });
    await expect(page.locator(`[data-resource-uid="${seeded.mapUid}"]`)).toHaveCount(0, { timeout: 15_000 });
    await page.getByTestId('map-range-clear').click();
    await expect(page).not.toHaveURL(/bbox=/);
    await expect(page.locator(`[data-resource-uid="${seeded.mapUid}"]`)).toBeVisible();

    await page.evaluate(() => { location.hash = '#/poisources?bbox=139.5,35.4,140,36'; });
    await expect(page.locator(`[data-resource-uid="${seeded.poiUid}"]`)).toBeVisible();
    await page.evaluate(() => { location.hash = '#/poisources?bbox=135,34,136,35'; });
    await expect(page.locator(`[data-resource-uid="${seeded.poiUid}"]`)).toHaveCount(0, { timeout: 15_000 });
    await page.getByTestId('poi-source-range-clear').click();
    await expect(page).not.toHaveURL(/bbox=/);
    await expect(page.locator(`[data-resource-uid="${seeded.poiUid}"]`)).toBeVisible();

    await page.evaluate((uid) => { location.hash = `#/mapedit?uid=${uid}`; }, seeded.mapUid);
    await expect(page.getByTestId('map-tab-pois')).toBeVisible();
    await page.getByTestId('map-tab-pois').click();
    // M12-T10 v2.0: MapEdit POI 選択は #range-filter slot で ResourceRangeFilterButton を使用（spatial-toggle は非表示）
    await expect(page.locator('.resource-selector-list:visible .resource-range-filter-button')).toBeVisible();
    await page.getByRole('tab').first().click();
    await page.getByTestId('map-tab-pois').click();
    await expect(page.locator('.resource-selector-list:visible .resource-range-filter-button')).toBeVisible();
  } finally {
    await quitElectronApplication(app);
  }
});
