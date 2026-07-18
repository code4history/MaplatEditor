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
  return { app, page };
}

async function createMapWithGcps(page: Page): Promise<string> {
  // T12-4: DB 直書きを防ぐため、素体 save 後に window.mapedit.updateTin で compiled を生成し、
  // 再度 save して compiled / rtree / fts をバックエンド側で永続化する。
  return page.evaluate(async () => {
    const slug = `m11-t11-map-${Date.now()}`;
    const mapObject = {
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
    };
    const r1 = await window.mapedit.save({ slug, mapObject, tins: [] });
    if (!r1 || r1.result !== 'Success') throw new Error(`Map seed failed: ${JSON.stringify(r1)}`);

    const tinResult = await window.mapedit.updateTin(
      mapObject.gcps, mapObject.edges, 0, [mapObject.width, mapObject.height],
      mapObject.strictMode, mapObject.vertexMode,
    );
    if (!Array.isArray(tinResult) || !tinResult[1] || typeof tinResult[1] !== 'object') {
      throw new Error(`TIN compile failed: ${JSON.stringify(tinResult)}`);
    }
    const r2 = await window.mapedit.save({ slug, uid: r1.uid, mapObject, tins: [tinResult[1]] });
    if (!r2 || r2.result !== 'Success') throw new Error(`Compiled map save failed: ${JSON.stringify(r2)}`);
    return r2.uid;
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

async function createFarBaseMap(page: Page): Promise<{ uid: string; title: string; slug: string }> {
  return page.evaluate(async () => {
    const slug = `m11-t11-far-basemap-${Date.now()}`;
    const result = await window.baseMaps.saveUser({
      slug,
      tms: {
        lang: 'ja',
        title: { ja: `遠方テスト ${slug}` },
        label: { ja: `遠方テスト ${slug}` },
        attr: {},
        url: 'https://example.com/tiles/{z}/{x}/{y}.png',
        minZoom: 0,
        maxZoom: 18,
        thumbnail: '',
        // 東京GCP範囲と交差しない大阪方面の存在範囲
        coverageLngLats: [
          [135.49, 34.66],
          [135.51, 34.66],
          [135.51, 34.68],
          [135.49, 34.68],
        ],
      },
      create: true,
    });
    if (!result || result.result !== 'Success') throw new Error(`Far base map seed failed: ${JSON.stringify(result)}`);
    return { uid: result.uid, title: `遠方テスト ${slug}`, slug };
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
  // T12-4: DB 直書き・トリガー DROP を廃止し、公開 API だけで seed する。
  // createMapWithGcps 内で素体 save → window.mapedit.updateTin → compiled 付き save を済ませている。
  const { app, page } = await launch(e2eRoot);
  try {
    const mapUid = await createMapWithGcps(page);

    const appUid = await page.evaluate(async (mapUid) => {
      const slug = `m11-t11-app-${Date.now()}`;
      const r = await window.appedit.save({
        slug,
        create: true,
        document: {
          appID: slug,
          appName: { ja: '推定テストアプリ', en: 'Estimate test app' },
          title: { ja: '推定テストアプリ', en: 'Estimate test app' },
          description: {},
          lang: 'ja',
          sources: [{ sourceType: 'maplat', mapUid }],
          pois: [],
          httpSettings: {},
          appSettings: {},
          manifestSettings: {},
        },
      });
      if (!r || r.result !== 'Success') throw new Error(`seed app failed: ${JSON.stringify(r)}`);
      return r.uid;
    }, mapUid);

    return { mapUid, appUid };
  } finally {
    await quitElectronApplication(app);
  }
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

  test('HV-M2 regression: clearing inside envelope modal and confirming emits null (AppEdit coverage)', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t11-coverage-clear-'));
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

    // 初期状態は auto（手動 coverage は未設定）
    const initialCoverage = await page.evaluate(() => (window as any).testDebug.appData.value.coverageLngLats);
    expect(initialCoverage).toBeNull();

    // 範囲選択モーダルを開く。AppEdit は modelValue に auto coverage 自体を渡すので
    // ガイドバッジは表示されず、currentBbox は auto 値になっている。
    await page.locator('[data-testid="app-coverage-pick-button"]').first().click();
    await expect(page.locator('.envelope-modal')).toBeVisible();
    const autoCoordinateText = await page.locator('.envelope-modal .font-monospace').textContent();
    expect(autoCoordinateText).not.toBe('—');

    // モーダル内でクリア→確定しても、手動 coverage は null のまま（auto 維持）
    await page.locator('.envelope-modal .btn-outline-danger').first().click();
    await page.locator('.envelope-modal .btn-primary').first().click();
    await expect(page.locator('.envelope-modal')).not.toBeVisible();

    const afterClearCoverage = await page.evaluate(() => (window as any).testDebug.appData.value.coverageLngLats);
    expect(afterClearCoverage).toBeNull();

    // 既存の手動値を持って開いてクリア→確定すると、null が emit されて手動値が削除される。
    // これがないと、HV-M2 対応で入ったガードによりクリアが無視されて手動値が残る。
    await page.evaluate(() => {
      (window as any).testDebug.appData.value.coverageLngLats = [
        [139.74, 35.64],
        [139.76, 35.64],
        [139.76, 35.66],
        [139.74, 35.66],
      ];
    });
    await page.locator('[data-testid="app-coverage-pick-button"]').first().click();
    await expect(page.locator('.envelope-modal')).toBeVisible();
    await expect(page.locator('[data-testid="envelope-guide-badge"]')).not.toBeVisible();

    await page.locator('.envelope-modal .btn-outline-danger').first().click();
    await page.locator('.envelope-modal .btn-primary').first().click();
    await expect(page.locator('.envelope-modal')).not.toBeVisible();

    const afterManualClear = await page.evaluate(() => (window as any).testDebug.appData.value.coverageLngLats);
    expect(afterManualClear).toBeNull();

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

  test('HV-R2: checked base map outside filter region stays visible so it can be unchecked', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m11-t11-r2-checked-'));
    const { app, page } = await launch(e2eRoot);

    const mapUid = await createMapWithGcps(page);
    const { uid: farUid, title } = await createFarBaseMap(page);

    // 絞り込み対象外の遠方ベースマップを事前に ON にしておく
    await page.evaluate(async ({ mapRef, baseMapUid }) => {
      await window.mapedit.setBaseMapVisibilityForMapID(mapRef, baseMapUid, true);
    }, { mapRef: mapUid, baseMapUid: farUid });

    await openMapEdit(page, mapUid);
    await switchMapEditSettingsTab(page);

    // ロード完了を待つ
    await expect(page.locator('[data-testid="map-base-map-auto-label"]')).toBeVisible({ timeout: 30000 });

    // 絞り込み対象外だが、チェック済み（表示ON）なので一覧に残り、オフにできる
    await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 30000 });

    // チェックを外すと、未チェックかつ範囲外なのでフィルタ対象になり一覧から消える
    await page.locator('label').filter({ hasText: title }).first().click();

    await expect(page.getByText(title, { exact: true })).not.toBeVisible({ timeout: 10000 });

    await quitElectronApplication(app);
  });
});
