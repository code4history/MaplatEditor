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
        imageExtension: 'png', width: 400, height: 300,
        // GCPタブを有効にするため最低限の画像URLを与える（noload経由でエラーは無視される）
        url_: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
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

async function createPoiSource(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const slug = `m11-t11-poi-${Date.now()}`;
    const result = await window.poiSources.createLocal({
      slug,
      title: { ja: 'ジオコーダ配線テスト', en: 'Geocoder Wiring Test' },
      lang: 'ja',
    });
    if (!result || result.result !== 'Success') throw new Error(`POI source seed failed: ${JSON.stringify(result)}`);
    return result.uid;
  });
}

async function createTestBaseMap(page: Page): Promise<{ uid: string; title: string; slug: string }> {
  return page.evaluate(async () => {
    const slug = `m11-t11-basemap-${Date.now()}`;
    const result = await window.baseMaps.saveUser({
      slug,
      tms: {
        lang: 'ja',
        title: { ja: `外れGCPテスト ${slug}` },
        label: { ja: `外れGCPテスト ${slug}` },
        attr: {},
        url: 'https://example.com/tiles/{z}/{x}/{y}.png',
        minZoom: 0,
        maxZoom: 18,
        thumbnail: '',
        // 東京中心部の存在範囲（外れGCPの茨城側を含まない）
        coverageLngLats: [
          [139.75, 35.62],
          [139.78, 35.62],
          [139.78, 35.67],
          [139.75, 35.67],
        ],
      },
      create: true,
    });
    if (!result || result.result !== 'Success') throw new Error(`Base map seed failed: ${JSON.stringify(result)}`);
    return { uid: result.uid, title: `外れGCPテスト ${slug}`, slug };
  });
}

async function createMapWithOutlierGcps(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const slug = `m11-t11-outlier-${Date.now()}`;
    const result = await window.mapedit.save({
      slug,
      mapObject: {
        mapID: slug,
        title: { ja: '外れGCP推定テスト', en: 'Outlier GCP Estimate Test' },
        officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr: {}, dataAttr: {}, description: {},
        license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
        imageExtension: 'png', width: 500, height: 400,
        url_: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        gcps: [
          [[0, 400], [15551351.4, 4249117.8]],
          [[500, 400], [15562483.3, 4249117.8]],
          [[500, 0], [15562483.3, 4259837.2]],
          [[0, 0], [15551351.4, 4259837.2]],
          // 茨城方面の外れGCP
          [[450, 50], [15584500.0, 4265000.0]],
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
  const { app, page } = await launch(e2eRoot);
  const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
  await quitElectronApplication(app);

  const dbPath = path.join(saveFolder, 'maplat.sqlite');
  const db = new DatabaseSync(dbPath);
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

async function navigateToPoiEdit(page: Page, uid: string): Promise<void> {
  await page.evaluate((nextUid) => { location.hash = `#/poisources/${nextUid}`; }, uid);
  await expect(page.locator('#gcd-input-query')).toBeVisible({ timeout: 60000 });
}

async function switchMapEditGcpsTab(page: Page): Promise<void> {
  const tab = page.locator('[data-testid="map-tab-gcps"]');
  await expect(tab).toBeVisible();
  await tab.click();
}

async function switchMapEditSettingsTab(page: Page): Promise<void> {
  const tab = page.locator('[data-testid="map-tab-settings"]');
  await expect(tab).toBeVisible();
  await tab.click();
}

test.describe('M11-T11 Geocoder & GCP Estimate E2E Tests', () => {
  test('AC1: PoiEditMap renders geocoder control', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t11-poi-'));
    const { app, page } = await launch(e2eRoot);

    const uid = await createPoiSource(page);
    await navigateToPoiEdit(page, uid);

    await expect(page.locator('#gcd-input-query')).toBeVisible();

    await quitElectronApplication(app);
  });

  test('AC2/AC7: MapEdit estimate button sets homePosition and is one undo unit', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t11-map-'));
    const { app, page } = await launch(e2eRoot);

    const uid = await createMapWithGcps(page);
    await openMapEdit(page, uid);
    // GCPタブを有効化するため url_ をセット（画像読込は不要）
    await page.evaluate(() => {
      (window as any).testDebug.mapData.value.url_ = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    });
    await switchMapEditGcpsTab(page);

    const before = await page.evaluate(() => (window as any).testDebug.homePosition.value);
    expect(before).toBeUndefined();

    await page.locator('[data-testid="map-edit-estimate-home"]').first().click();

    await page.waitForFunction(
      () => (window as any).testDebug.homePosition.value != null,
      undefined,
      { timeout: 30000 },
    );

    const after = await page.evaluate(() => (window as any).testDebug.homePosition.value);
    expect(after).toBeDefined();
    expect(Math.abs(after[0] - 139.75)).toBeLessThan(0.02);
    expect(Math.abs(after[1] - 35.65)).toBeLessThan(0.02);

    const mercZoom = await page.evaluate(() => (window as any).testDebug.mercZoom.value);
    expect(typeof mercZoom).toBe('number');
    expect(mercZoom).toBeGreaterThanOrEqual(8);

    await page.locator('[data-testid="editor-undo"]').click();

    await page.waitForFunction(
      () => (window as any).testDebug.homePosition.value == null,
      undefined,
      { timeout: 30000 },
    );
    const undone = await page.evaluate(() => (window as any).testDebug.homePosition.value);
    expect(undone).toBeUndefined();

    await quitElectronApplication(app);
  });

  test('AC3: base map filter auto -> manual override -> clear returns to auto', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t11-ac3-'));
    const { app, page } = await launch(e2eRoot);

    const uid = await createMapWithGcps(page);
    await openMapEdit(page, uid);
    await switchMapEditSettingsTab(page);

    // auto: GCP範囲自動ラベルが表示されている
    await expect(page.locator('[data-testid="map-base-map-auto-label"]')).toBeVisible();
    // 手動 override 指定前はクリアボタンがない
    await expect(page.locator('[data-testid="map-base-map-region-clear"]')).not.toBeVisible();

    // モーダルを開き、testDebug経由で手動領域を設定し確定
    await page.locator('[data-testid="map-base-map-region-button"]').click();
    await expect(page.locator('.envelope-modal')).toBeVisible();

    // 描画UIを経由せず親 ref を直接書き換えて manual override をシミュレート
    await page.evaluate(() => {
      (window as any).testDebug.baseMapFilterRegion.value = [
        [139.74, 35.64],
        [139.76, 35.64],
        [139.76, 35.66],
        [139.74, 35.66],
      ];
    });

    // モーダルを閉じて親ビューに戻る
    await page.locator('.envelope-modal .btn-close').first().click();
    await expect(page.locator('.envelope-modal')).not.toBeVisible();

    await expect(page.locator('[data-testid="map-base-map-region-label"]')).toBeVisible();
    const labelText = await page.locator('[data-testid="map-base-map-region-label"]').textContent();
    expect(labelText).toMatch(/W139\.74.*S35\.64.*E139\.76.*N35\.66/);

    // auto ラベルは非表示
    await expect(page.locator('[data-testid="map-base-map-auto-label"]')).not.toBeVisible();

    // クリアで auto に戻る
    await page.locator('[data-testid="map-base-map-region-clear"]').click();
    await expect(page.locator('[data-testid="map-base-map-auto-label"]')).toBeVisible();
    await expect(page.locator('[data-testid="map-base-map-region-clear"]')).not.toBeVisible();

    await quitElectronApplication(app);
  });

  test('AC4: AppEdit estimate button sets homePosition/defaultZoom from source coverage', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t11-app-'));
    const { mapUid, appUid } = await seedMapAndApp(e2eRoot);
    const { app, page } = await launch(e2eRoot);

    await openAppEdit(page, appUid);

    await page.waitForFunction(
      () => {
        const td = (window as any).testDebug;
        return !!(td.appData.value.coverageLngLats || td.appCoverageAuto?.autoCoverage?.value);
      },
      undefined,
      { timeout: 60000 },
    );

    const beforeLng = await page.evaluate(() => (window as any).testDebug.appData.value.appSettings.homeLng);
    const beforeLat = await page.evaluate(() => (window as any).testDebug.appData.value.appSettings.homeLat);
    expect(beforeLng).toBeNull();
    expect(beforeLat).toBeNull();

    await page.locator('[data-testid="app-edit-estimate-home"]').click();

    const afterLng = await page.evaluate(() => (window as any).testDebug.appData.value.appSettings.homeLng);
    const afterLat = await page.evaluate(() => (window as any).testDebug.appData.value.appSettings.homeLat);
    const afterZoom = await page.evaluate(() => (window as any).testDebug.appData.value.appSettings.defaultZoom);
    expect(typeof afterLng).toBe('number');
    expect(typeof afterLat).toBe('number');
    expect(typeof afterZoom).toBe('number');
    expect(Math.abs(afterLng - 139.75)).toBeLessThan(0.02);
    expect(Math.abs(afterLat - 35.65)).toBeLessThan(0.02);

    await quitElectronApplication(app);
  });

  test('EnvelopeEditorModal renders geocoder control (regression)', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t11-geocoder-'));
    const { app, page } = await launch(e2eRoot);

    const uid = await createMapWithGcps(page);
    await openMapEdit(page, uid);
    await switchMapEditSettingsTab(page);

    await page.locator('[data-testid="map-base-map-region-button"]').click();
    await expect(page.locator('.envelope-modal #gcd-input-query')).toHaveCount(1);

    await quitElectronApplication(app);
  });

  test('HV-M2: region modal shows auto GCP range as a guide without overriding auto', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t11-hv2-'));
    const { app, page } = await launch(e2eRoot);

    const uid = await createMapWithGcps(page);
    await openMapEdit(page, uid);
    await switchMapEditSettingsTab(page);

    await page.locator('[data-testid="map-base-map-region-button"]').click();
    await expect(page.locator('.envelope-modal')).toBeVisible();
    await expect(page.locator('[data-testid="envelope-guide-badge"]')).toBeVisible();
    const coordinateText = await page.locator('.envelope-modal .font-monospace').textContent();
    expect(coordinateText).toMatch(/W\s*139\./);
    expect(coordinateText).toMatch(/N\s*35\./);

    // ガイド表示だけでは auto 状態は上書きしない
    await page.locator('.envelope-modal .btn-close').first().click();
    await expect(page.locator('.envelope-modal')).not.toBeVisible();
    const region = await page.evaluate(() => (window as any).testDebug.baseMapFilterRegion.value);
    expect(region).toBeNull();

    await quitElectronApplication(app);
  });

  test('HV-M3: outlier GCP uses intersects (not contains) so local base map still listed', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t11-hv3-'));
    const { app, page } = await launch(e2eRoot);

    const { title } = await createTestBaseMap(page);
    const mapUid = await createMapWithOutlierGcps(page);
    await openMapEdit(page, mapUid);
    await switchMapEditSettingsTab(page);

    // ロード完了を待つ（まず auto ラベルか一覧のいずれかが表示される）
    await expect(page.locator('[data-testid="map-base-map-auto-label"]')).toBeVisible({ timeout: 30000 });

    // 外れGCPを含む bbox は存在範囲で包含されていないが、一部交差しているため表示される
    await expect(page.getByText(title, { exact: false })).toBeVisible({ timeout: 30000 });

    await quitElectronApplication(app);
  });
});
