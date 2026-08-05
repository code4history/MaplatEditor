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
