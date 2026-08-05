// m6-t5: Mapbox / MapLibre 種別と GL ライブラリ配線の E2E
// AC16: maplibre マスタを style URL 付きで保存でき、そのマスタを含むアプリの
//       プレビュー HTML に maplibre-gl CDN（link+script, SRI 付き）が ol.js より前に注入される。
//       maplibre を含まないアプリには注入されない（条件付き注入）。
// AC19 側（m6-t1 spec 更新）と分担: 本 spec は保存 → プレビュー HTML の実配線を見る。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
// m1-t6（45782）・開発者実行中（41781）と衝突しない固定ポート
const PREVIEW_PORT = 45784;
const MAPLIBRE_STYLE = 'https://tile.openstreetmap.jp/styles/osm-bright/style.json';

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

async function fillAndCommit(locator: ReturnType<Page['getByTestId']>, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press('Tab');
}

function fetchBody(port: number, urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'GET', agent: false, timeout: 10000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

async function previewSrc(page: Page): Promise<{ src: string; port: number; token: string }> {
  await expect(page.locator('iframe.preview-map')).toBeVisible({ timeout: 60000 });
  const src = (await page.locator('iframe.preview-map').getAttribute('src'))!;
  return { src, port: Number(new URL(src).port), token: src.match(/\/preview\/([^/]+)\//)![1] };
}

test('m6-t5 AC16: maplibre マスタ保存 → プレビュー HTML へ maplibre-gl CDN が条件付き注入される', async () => {
  test.setTimeout(240_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t5-'));
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    // ---- 1) maplibre マスタを UI で作成・保存 ----
    await page.evaluate(() => { location.hash = '/basemaps'; });
    await page.getByTestId('basemap-new').click();
    await expect(page.getByTestId('basemap-kind-prompt')).toBeVisible();
    await page.getByTestId('basemap-kind-maplibre').click();

    // 種別ロック + style 欄表示 + 既定サムネ（AC13）
    await expect(page.getByTestId('basemap-kind-maplibre')).toHaveClass(/btn-primary/);
    await expect(page.getByTestId('basemap-style-url')).toBeVisible();
    // maplibre ヒントが i18n 経由で表示される（moustache 抜けの回帰検知を兼ねる）
    await expect(page.getByTestId('basemap-style-maplibre-hint')).toBeVisible();
    await expect(page.getByTestId('basemap-style-maplibre-hint')).not.toContainText("{ t(");

    // style 空では保存不可（AC4）
    await fillAndCommit(page.getByTestId('basemap-slug'), 'e2e-m6t5-maplibre');
    await fillAndCommit(page.getByTestId('basemap-title'), 'MLマスタ');
    await fillAndCommit(page.getByTestId('basemap-attr'), '© OSM');
    await expect(page.getByTestId('editor-save')).toBeDisabled();

    // style を入れると保存可能（AC2）
    await fillAndCommit(page.getByTestId('basemap-style-url'), MAPLIBRE_STYLE);
    await expect(page.getByTestId('editor-save')).toBeEnabled();
    await page.getByTestId('editor-save').click();
    await expect(page).not.toHaveURL(/new=1/, { timeout: 30_000 });

    // 保存データに maptype/style が載っている（AC2 の永続化側）
    const master = await page.evaluate(async () => {
      const list = await (window as any).baseMaps.list();
      const items = Array.isArray(list) ? list : list?.items || list?.result || [];
      return (items as any[]).find((m) => (m.mapID || m.slug) === 'e2e-m6t5-maplibre');
    });
    expect(master, 'baseMaps.list に保存したマスタが無い').toBeTruthy();
    expect(master.data?.maptype ?? master.maptype).toBe('maplibre');
    expect(master.data?.style ?? master.style).toBe(MAPLIBRE_STYLE);

    // ---- 2) そのマスタを含むアプリをシードしてプレビュー ----
    const seedApp = async (slug: string, sources: unknown[]) => {
      await page.evaluate(async ({ slug, sources, previewPort }) => {
        const saved = await (window as any).appedit.save({ slug, document: {
          appID: slug, appName: { ja: slug }, title: { ja: slug },
          description: {}, keywords: '', siteUrl: '', lang: 'ja',
          sources,
          appSettings: { homeLng: 139.767, homeLat: 35.681, defaultZoom: 10 },
          pois: [],
          httpSettings: { previewPort }, manifestSettings: {},
        } });
        if (!saved || saved.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(saved)}`);
      }, { slug, sources, previewPort: PREVIEW_PORT });
    };

    const maplibreSource = {
      sourceType: 'base-map',
      mapID: 'e2e-m6t5-maplibre',
      role: 'base',
      data: {
        ...(master.data || master),
        kind: 'maplibre',
        maptype: 'maplibre',
        style: MAPLIBRE_STYLE,
      },
    };
    await seedApp('e2e-m6t5-app-ml', [maplibreSource]);
    await seedApp('e2e-m6t5-app-osm', ['osm']);

    // ---- 3) maplibre アプリのプレビュー HTML に CDN が入る ----
    await page.evaluate(() => { location.hash = '/applist'; });
    await expect(page.locator('[data-resource-uid]').first()).toBeVisible({ timeout: 15000 });
    await page.locator('[data-resource-uid] a').filter({ hasText: 'e2e-m6t5-app-ml' }).first().click();
    await page.locator('[role="tab"]').filter({ hasText: /プレビュー/ }).click();
    const s1 = await previewSrc(page);
    expect(s1.port).toBe(PREVIEW_PORT);

    const html1 = (await fetchBody(s1.port, `/preview/${s1.token}/`)).body;
    // link + script が SRI 付きで、ol.js より前
    const cssIdx = html1.indexOf('maplibre-gl@5.6.2/dist/maplibre-gl.css');
    const jsIdx = html1.indexOf('maplibre-gl@5.6.2/dist/maplibre-gl.js');
    const olIdx = html1.indexOf('assets/ol.js');
    expect(cssIdx, 'preview HTML に maplibre-gl css CDN が無い').toBeGreaterThanOrEqual(0);
    expect(jsIdx, 'preview HTML に maplibre-gl js CDN が無い').toBeGreaterThanOrEqual(0);
    expect(olIdx).toBeGreaterThanOrEqual(0);
    expect(cssIdx).toBeLessThan(olIdx);
    expect(jsIdx).toBeLessThan(olIdx);
    expect(html1).toContain('integrity="sha384-');
    expect(html1).toContain('crossorigin="anonymous"');
    // maplibre のみのアプリに mapbox CDN は入らない
    expect(html1).not.toContain('mapbox-gl-js');

    // ---- 4) maplibre を含まないアプリには CDN が入らない ----
    await page.evaluate(() => { location.hash = '/applist'; });
    await expect(page.locator('[data-resource-uid]').first()).toBeVisible({ timeout: 15000 });
    await page.locator('[data-resource-uid] a').filter({ hasText: 'e2e-m6t5-app-osm' }).first().click();
    await page.locator('[role="tab"]').filter({ hasText: /プレビュー/ }).click();
    const s2 = await previewSrc(page);
    const html2 = (await fetchBody(s2.port, `/preview/${s2.token}/`)).body;
    expect(html2).not.toContain('maplibre-gl@');
    expect(html2).not.toContain('mapbox-gl-js');

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});

// m6-t5 AC12（v1.3）: provider 3種別は MapEdit 背景選択の左右両ペインに表示されない
// （loadBaseMapVisibility の単一投入点で除外。人間判断 2026-08-05「選択肢に非表示」）
test('m6-t5 AC12: provider マスタは MapEdit 背景選択の両ペインに表示されない', async () => {
  test.setTimeout(240_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t5-ac12-'));
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    // provider マスタ2件（maplibre / mapbox）を IPC で seed
    await page.evaluate(async (style) => {
      const base = {
        lang: 'ja',
        title: { ja: 'prov' }, label: { ja: 'prov' },
        attr: { ja: 'A' }, dataAttr: {},
        license: '', dataLicense: '', licenseNote: {}, dataLicenseNote: {},
        url: '', minZoom: null, maxZoom: null, thumbnail: '', coverageLngLats: null,
      };
      for (const [slug, kind, st] of [
        ['e2e-m6t5-ml-hidden', 'maplibre', style],
        ['e2e-m6t5-mb-hidden', 'mapbox', 'mapbox://styles/mapbox/streets-v12'],
      ] as const) {
        const r = await (window as any).baseMaps.saveUser({
          slug, create: true,
          tms: { ...base, kind, maptype: kind, style: st },
        });
        if (!r || (r.result && r.result !== 'Success')) throw new Error(`saveUser failed: ${JSON.stringify(r)}`);
      }
    }, MAPLIBRE_STYLE);

    // 地図を seed してベースマップ設定タブへ（m12-t10 のパターン）
    const seeded = await page.evaluate(async () => {
      const mapSlug = `m6t5-map-${Date.now()}`;
      const mapR = await (window as any).mapedit.save({
        slug: mapSlug,
        mapObject: {
          mapID: mapSlug, title: { ja: 'm6t5 map', en: 'm6t5 map en' },
          officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
          attr: { ja: 'attr' }, dataAttr: {}, description: {},
          license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
          imageExtension: 'jpg', width: 400, height: 300,
          gcps: [[[0, 0], [15550000, 4160000]], [[400, 0], [15560000, 4160000]], [[400, 300], [15560000, 4150000]]],
          edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
        },
        tins: [],
      });
      if (!mapR || mapR.result !== 'Success') throw new Error(JSON.stringify(mapR));
      return { mapUid: mapR.uid };
    });
    await page.evaluate((uid: string) => { location.hash = `#/mapedit?uid=${uid}`; }, seeded.mapUid);
    await expect(page.getByTestId('map-tab-settings')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('map-tab-settings').click();
    await expect(page.getByTestId('map-base-map-selector')).toBeVisible({ timeout: 30000 });

    // IPC 上は provider 項目が存在する（保存はできている）
    const visibility = await page.evaluate(async (uid: string) => {
      return await (window as any).mapedit.getBaseMapVisibilityOfMapID(uid);
    }, seeded.mapUid);
    const ml = visibility.find((i: any) => i.mapID === 'e2e-m6t5-ml-hidden');
    const mb = visibility.find((i: any) => i.mapID === 'e2e-m6t5-mb-hidden');
    expect(ml, 'IPC 返却に maplibre マスタが無い（seed 失敗の可能性）').toBeTruthy();
    expect(mb, 'IPC 返却に mapbox マスタが無い（seed 失敗の可能性）').toBeTruthy();

    // 左ペイン（選択候補）に出ない
    for (const item of [ml, mb]) {
      await expect(
        page.getByTestId('map-base-map-selector').locator(`[data-resource-uid="${item.uid}"]`),
        `左ペインに ${item.mapID} が表示されている`,
      ).toHaveCount(0);
    }
    // 右ペイン（選択済み）にも出ない
    await expect(page.locator('[data-testid="map-selected-basemap-e2e-m6t5-ml-hidden"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="map-selected-basemap-e2e-m6t5-mb-hidden"]')).toHaveCount(0);
    // 非 provider（osm）は従来どおり選択済みペインに出る（フィルタの誤爆が無いこと。
    // osm は locked=常時表示のため右ペイン側を見る。m12-t10:91 と同じ定点）
    await expect(page.locator('[data-testid="map-selected-basemap-osm"]')).toBeVisible({ timeout: 15000 });

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});
