// M12-T16: Map/App/POI リソース一覧の診断バッジ表示 E2E。
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';

async function openHash(page: Page, hash: string, ready: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await expect(page.locator(ready)).toBeVisible({ timeout: 30_000 });
}

async function forceJapanese(page: Page): Promise<void> {
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

function mapObject(slug: string, title: string, pois: unknown[] = []) {
  return {
    mapID: slug,
    title: { ja: title },
    officialTitle: {},
    author: {},
    era: {},
    createdAt: {},
    contributor: {},
    mapper: {},
    attr: {},
    dataAttr: {},
    description: {},
    license: 'PD',
    dataLicense: 'CC BY-SA',
    reference: '',
    url: '',
    lang: 'ja',
    imageExtension: 'jpg',
    width: 400,
    height: 300,
    gcps: [],
    edges: [],
    sub_maps: [],
    strictMode: 'strict',
    vertexMode: 'plain',
    status: 'New',
    pois,
  };
}

async function seedMap(page: Page, input: { slug: string; title: string; pois?: unknown[]; strict?: boolean }): Promise<{ uid: string; slug: string }> {
  const payload = {
    slug: input.slug,
    mapObject: mapObject(input.slug, input.title, input.pois ?? []),
    tins: input.strict ? [{ strict_status: 'strict_error' }] : ['tooLessGcps'],
  };
  return page.evaluate(async ({ slug, mapObject, tins }) => {
    const result = await window.mapedit.save({ slug, mapObject, tins });
    if (!result || result.result !== 'Success') throw new Error(`seed map failed: ${JSON.stringify(result)}`);
    return { uid: result.uid, slug };
  }, payload);
}

async function flipMapToStrict(page: Page, target: { uid: string; slug: string; title: string }): Promise<void> {
  const payload = {
    uid: target.uid,
    slug: target.slug,
    mapObject: mapObject(target.slug, target.title, []),
  };
  await page.evaluate(async ({ uid, slug, mapObject }) => {
    const result = await window.mapedit.save({
      uid,
      slug,
      mapObject,
      tins: [{ strict_status: 'strict_error' }],
    });
    if (!result || result.result !== 'Success') throw new Error(`strict flip failed: ${JSON.stringify(result)}`);
  }, payload);
}

async function seedPoi(page: Page, slug: string, title: string, fc: unknown): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async ({ slug, title, fc }) => {
    const created = await window.poiSources.createLocal({ slug, title: { ja: title }, lang: 'ja' });
    if (!created || created.result !== 'Success') throw new Error(`createLocal failed: ${JSON.stringify(created)}`);
    const saved = await window.poiSources.save(created.uid, { slug, title: { ja: title }, fc });
    if (!saved || saved.result !== 'Success') throw new Error(`poi save failed: ${JSON.stringify(saved)}`);
    return { uid: created.uid, slug };
  }, { slug, title, fc });
}

async function seedApp(page: Page, input: { slug: string; title: string; document: Record<string, unknown> }): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async ({ slug, title, document }) => {
    const result = await window.appedit.save({
      slug,
      document: {
        appID: slug,
        appName: { ja: title },
        title: { ja: title },
        lang: 'ja',
        sources: [],
        httpSettings: {},
        appSettings: {},
        manifestSettings: {},
        ...document,
      },
    });
    if (!result || result.result !== 'Success') throw new Error(`app save failed: ${JSON.stringify(result)}`);
    return { uid: result.uid, slug };
  }, input);
}

function fc(id: string, props: Record<string, unknown> = {}) {
  return {
    type: 'FeatureCollection',
    id,
    features: [
      {
        type: 'Feature',
        id: `${id}-f`,
        geometry: { type: 'Point', coordinates: [139, 35] },
        properties: { name: { ja: id }, ...props },
      },
    ],
  };
}

function maplatSource(ref: string) {
  return { sourceType: 'maplat', mapUid: ref, role: 'maplat', startFrom: true, data: { mapID: ref, maptype: 'maplat', noload: true } };
}

test.describe('M12-T16 resource list error badges', () => {
  test('Map/App/POI lists show diagnostics badges without flagging inline POI', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m12-t16-'));
    const { app, page }: { app: ElectronApplication; page: Page } = await launch(e2eRoot);
    try {
      await forceJapanese(page);

      const missingPoiUid = '99999999-9999-4999-8999-999999999999';
      const missingAssetUid = '88888888-8888-4888-8888-888888888888';

      const normalMap = await seedMap(page, { slug: 't16-normal-map', title: 'T16 正常地図' });
      const strictMap = await seedMap(page, { slug: 't16-strict-map', title: 'T16 strict地図' });
      const missingPoiMap = await seedMap(page, {
        slug: 't16-missing-poi-map',
        title: 'T16 POI欠損地図',
        pois: [{ poiUid: missingPoiUid }],
      });
      const inlineMap = await seedMap(page, {
        slug: 't16-inline-map',
        title: 'T16 inline地図',
        pois: [fc('inline-fc'), 'https://example.com/pois.geojson', { poiUid: 'not-a-uuid' }],
      });

      const brokenPoi = await seedPoi(
        page,
        't16-broken-poi',
        'T16 欠損POI',
        fc('broken-poi', { html: { ja: `maplat-asset:${missingAssetUid}` } }),
      );
      const normalPoi = await seedPoi(page, 't16-normal-poi', 'T16 正常POI', fc('normal-poi'));

      const guardedApp = await seedApp(page, {
        slug: 't16-guarded-app',
        title: 'T16 参照地図エラーアプリ',
        document: { sources: [maplatSource(strictMap.uid)] },
      });
      await seedApp(page, {
        slug: 't16-unsupported-pois-app',
        title: 'T16 POI形式未対応アプリ',
        document: { pois: { main: fc('legacy-layer') } },
      });
      await seedApp(page, {
        slug: 't16-normal-app',
        title: 'T16 正常アプリ',
        document: { sources: [maplatSource(normalMap.uid)] },
      });
      await flipMapToStrict(page, { uid: strictMap.uid, slug: strictMap.slug, title: 'T16 strict地図' });

      const rejectDocument = {
        appID: `t16-reject-${Date.now()}`,
        appName: { ja: '拒否確認' },
        title: { ja: '拒否確認' },
        lang: 'ja',
        sources: [maplatSource(strictMap.uid)],
        httpSettings: {},
        appSettings: {},
        manifestSettings: {},
      };
      const rejectResult = await page.evaluate(async (document) => window.appedit.save({
        slug: `t16-reject-${Date.now()}`,
        document,
      }), rejectDocument);
      expect(rejectResult.result).toBe('Error');

      await openHash(page, '#/maplist', '[data-resource-list="map"]');
      await expect(page.locator(`[data-resource-uid="${strictMap.uid}"] .badge`, { hasText: 'strictエラー' })).toBeVisible();
      await expect(page.locator(`[data-resource-uid="${missingPoiMap.uid}"] .badge`, { hasText: 'POI参照欠損' })).toBeVisible();
      await expect(page.locator(`[data-resource-uid="${normalMap.uid}"] .badge`)).toHaveCount(0);
      await expect(page.locator(`[data-resource-uid="${inlineMap.uid}"] .badge`)).toHaveCount(0);

      await openHash(page, '#/applist', '[data-resource-list="app"]');
      await expect(page.locator(`[data-resource-uid="${guardedApp.uid}"] .badge`, { hasText: '参照地図エラー' })).toBeVisible();
      await expect(page.locator('.resource-grid-card', { hasText: 'T16 POI形式未対応アプリ' }).locator('.badge', { hasText: 'POI形式未対応' })).toBeVisible();
      await expect(page.locator('.resource-grid-card', { hasText: 'T16 正常アプリ' }).locator('.badge')).toHaveCount(0);

      await openHash(page, '#/poisources', '[data-resource-list="poi-source"]');
      const brokenPoiCard = page.locator(`[data-resource-uid="${brokenPoi.uid}"]`);
      await expect(brokenPoiCard.locator('.badge', { hasText: 'ローカル' })).toBeVisible();
      await expect(brokenPoiCard.locator('.badge', { hasText: 'アセット欠損' })).toBeVisible();
      await expect(page.locator(`[data-resource-uid="${normalPoi.uid}"] .badge`, { hasText: 'アセット欠損' })).toHaveCount(0);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
