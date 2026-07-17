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

async function createMapWithGcps(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const slug = `m11-t11-map-${Date.now()}`;
    const result = await window.mapedit.save({
      slug,
      mapObject: {
        mapID: slug,
        title: { ja: '推定テスト地図', en: 'Estimate Test Map' },
        officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr: {}, dataAttr: {}, description: {},
        license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
        imageExtension: 'jpg', width: 400, height: 300,
        gcps: [
          [[0, 300], [15551351.4, 4249117.8]],
          [[400, 300], [15562483.3, 4249117.8]],
          [[400, 0], [15562483.3, 4259837.2]],
          [[0, 0], [15551351.4, 4259837.2]],
        ],
        edges: [],
        sub_maps: [],
        strictMode: 'strict', vertexMode: 'plain', status: 'New',
      },
      tins: [],
    });
    if (!result || result.result !== 'Success') throw new Error(`Map seed failed: ${JSON.stringify(result)}`);
    return result.uid;
  });
}

async function seedMapAndApp(e2eRoot: string): Promise<{ mapUid: string; appUid: string }> {
  const mapUid = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001';
  const appUid = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001';
  // 1回起動して saveFolder を取得
  const { app, page } = await launch(e2eRoot);
  const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
  await quitElectronApplication(app);

  const dbPath = path.join(saveFolder, 'maplat.sqlite');
  const db = new DatabaseSync(dbPath);
  // 同じ内容の compiled が欲しいため gcps は配列形ではなく merc 含む compiled を DB 直書き
  const mapJson = JSON.stringify({
    width: 400,
    height: 300,
    lang: 'ja',
    edges: [[0, 0], [400, 0], [400, 300], [0, 300]],
    gcps: [
      { x: 0, y: 300, lng: 139.7, lat: 35.6 },
      { x: 400, y: 300, lng: 139.8, lat: 35.6 },
      { x: 400, y: 0, lng: 139.8, lat: 35.7 },
      { x: 0, y: 0, lng: 139.7, lat: 35.7 },
    ],
    compiled: {
      version: 2.00703,
      points: [
        [[0, 300], [15551351.4, 4249117.8]],
        [[400, 300], [15562483.3, 4249117.8]],
        [[400, 0], [15562483.3, 4259837.2]],
        [[0, 0], [15551351.4, 4259837.2]],
      ],
      vertices_points: [
        [[0, 300], [15551351.4, 4249117.8]],
        [[400, 300], [15562483.3, 4249117.8]],
        [[400, 0], [15562483.3, 4259837.2]],
        [[0, 0], [15551351.4, 4259837.2]],
      ],
      centroid_point: [[200, 150], [15556917.35, 4254477.5]],
      strict_status: 'strict',
      wh: [400, 300],
      weight_buffer: { forw: { '0': 1, '1': 1, '2': 1, '3': 1, bbox0: 1, bbox1: 1, bbox2: 1, bbox3: 1, cent: 1 }, bakw: { '0': 1, '1': 1, '2': 1, '3': 1, bbox0: 1, bbox1: 1, bbox2: 1, bbox3: 1, cent: 1 } },
      tins_points: [],
      vertices_params: [],
      edgeNodes: [],
    },
  });
  const appJson = JSON.stringify({
    appID: 'm11-t11-app',
    appName: { ja: '推定テストアプリ' },
    title: { ja: '推定テストアプリ' },
    description: {},
    lang: 'ja',
    sources: [{ sourceType: 'maplat', mapUid }],
    pois: [],
    httpSettings: {},
    appSettings: {},
    manifestSettings: {},
  });
  db.exec(`
    DROP TRIGGER IF EXISTS maps_search_ad;
    DROP TRIGGER IF EXISTS maps_search_au;
    DROP TRIGGER IF EXISTS maps_search_ai;
    DROP TRIGGER IF EXISTS apps_search_ad;
    DROP TRIGGER IF EXISTS apps_search_au;
    DROP TRIGGER IF EXISTS apps_search_ai;
    DROP TRIGGER IF EXISTS apps_rtree_ad;
    DROP TRIGGER IF EXISTS apps_rtree_au;
    DROP TRIGGER IF EXISTS apps_rtree_ai;
  `);
  db.exec(`DELETE FROM maps_rtree WHERE id IN (SELECT rid FROM maps_rtree_key WHERE uid = '${mapUid}'); DELETE FROM maps_rtree_key WHERE uid = '${mapUid}';`);
  db.exec(`DELETE FROM apps WHERE uid = '${appUid}'; DELETE FROM maps WHERE uid = '${mapUid}';`);
  db.prepare('INSERT INTO maps (uid, slug, data_json) VALUES (?, ?, ?)').run(mapUid, 'm11-t11-map', mapJson);
  const rowid = Number((db.prepare('SELECT last_insert_rowid() AS id').get() as any).id);
  db.prepare('INSERT INTO maps_rtree_key (uid, rid) VALUES (?, ?)').run(mapUid, rowid);
  db.prepare('INSERT INTO maps_rtree (id, min_x, max_x, min_y, max_y) VALUES (?, ?, ?, ?, ?)').run(
    rowid, 15551351.4, 15562483.3, 4249117.8, 4259837.2
  );
  db.prepare('INSERT INTO apps (uid, slug, data_json) VALUES (?, ?, ?)').run(appUid, 'm11-t11-app', appJson);
  db.close();
  return { mapUid, appUid };
}

async function openMapEdit(page: Page, uid: string): Promise<void> {
  await page.evaluate((nextUid) => { location.hash = `#/mapedit?uid=${nextUid}`; }, uid);
  await page.waitForFunction(() => !!(window as any).testDebug?.mapData?.value?.mapID);
}

async function openAppEdit(page: Page, uid: string): Promise<void> {
  await page.evaluate((nextUid) => { location.hash = `#/appedit?uid=${nextUid}`; }, uid);
  await page.waitForFunction(() => !!(window as any).testDebug?.appData?.value?.appID);
}

async function switchMapEditSettingsTab(page: Page): Promise<void> {
  await page.locator('.nav-link', { hasText: 'ベースマップ選択' }).click();
}

async function openEnvelopeModalFromMapEdit(page: Page): Promise<void> {
  await switchMapEditSettingsTab(page);
  await page.locator('button:has-text("地域で絞り込み")').first().click();
  await expect(page.locator('.envelope-modal')).toBeVisible();
}

test.describe('M11-T11 Geocoder & GCP Estimate E2E Tests', () => {
  test('MapEdit GCP estimate sets homePosition/mercZoom from GCPs', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t11-map-'));
    const { app, page } = await launch(e2eRoot);

    const uid = await createMapWithGcps(page);
    await openMapEdit(page, uid);

    const before = await page.evaluate(() => (window as any).testDebug.homePosition.value);
    expect(before).toBeUndefined();

    await page.evaluate(() => (window as any).testDebug.estimateHomeFromGcps());

    const after = await page.evaluate(() => (window as any).testDebug.homePosition.value);
    expect(after).toBeDefined();
    const mapHome = await page.evaluate(() => (window as any).testDebug.mapData.value.homePosition);
    expect(mapHome).toEqual(after);
    const mercZoom = await page.evaluate(() => (window as any).testDebug.mercZoom.value);
    expect(typeof mercZoom).toBe('number');

    await quitElectronApplication(app);
  });

  test('AppEdit estimate sets homePosition from selected source coverage', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t11-app-'));
    const { mapUid, appUid } = await seedMapAndApp(e2eRoot);
    const { app, page } = await launch(e2eRoot);

    await openAppEdit(page, appUid);

    // 自動導出提供範囲が計算されるのを待つ
    await page.waitForFunction(
      () => {
        const td = (window as any).testDebug;
        return !!(td.appData.value.coverageLngLats || td.appCoverageAuto.autoCoverage.value);
      },
      undefined,
      { timeout: 60000 },
    );

    const beforeLng = await page.evaluate(() => (window as any).testDebug.appData.value.appSettings.homeLng);
    const beforeLat = await page.evaluate(() => (window as any).testDebug.appData.value.appSettings.homeLat);
    expect(beforeLng).toBeNull();
    expect(beforeLat).toBeNull();

    await page.evaluate(() => (window as any).testDebug.estimateHomeFromSources());

    const afterLng = await page.evaluate(() => (window as any).testDebug.appData.value.appSettings.homeLng);
    const afterLat = await page.evaluate(() => (window as any).testDebug.appData.value.appSettings.homeLat);
    const afterZoom = await page.evaluate(() => (window as any).testDebug.appData.value.appSettings.defaultZoom);
    expect(typeof afterLng).toBe('number');
    expect(typeof afterLat).toBe('number');
    expect(typeof afterZoom).toBe('number');

    await quitElectronApplication(app);
  });

  test('EnvelopeEditorModal renders geocoder control (regression)', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t11-geocoder-'));
    const { app, page } = await launch(e2eRoot);

    const uid = await createMapWithGcps(page);
    await openMapEdit(page, uid);

    await openEnvelopeModalFromMapEdit(page);
    await expect(page.locator('.envelope-modal #gcd-input-query')).toHaveCount(1);

    await quitElectronApplication(app);
  });
});
