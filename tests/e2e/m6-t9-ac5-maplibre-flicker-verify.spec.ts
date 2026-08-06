// m6-t9 §3.4 第2段階: MapLibre ちらつきの人間検証環境準備。
// 恒久テストではない（AC5 は人間検証 + task-state 記録が検証手段。設計 §7）。
// maplibre kind のベースマップを含むアプリのプレビューを起動し、URL を stdout へ出力した後、
// page.pause() で一時停止する。nayuta-implementer スキル「E2Eテスト実施後のモード」の手順どおり、
// PWDEBUG=1 PLAYWRIGHT_USE_EXISTING_SERVER=1 pnpm exec playwright test <このファイル> --headed
// で実行すると、Playwright Inspector が開いた状態で一時停止するので、人間は Resume を押す前に
// 別ウィンドウで stdout に出力される M6T9_AC5_PREVIEW_URL を開き、実際の描画を目視確認できる。
import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { seedE2EProviderKeys } from './helpers/providerKeys';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const PREVIEW_PORT = 45786; // 他 spec (45782/45784) と衝突しない固定ポート
const MAPLIBRE_STYLE = 'https://tile.openstreetmap.jp/styles/osm-bright/style.json';

async function fillAndCommit(locator: ReturnType<Page['getByTestId']>, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press('Tab');
}

test('m6-t9 AC5 第2段階: maplibre プレビューを人間検証用に起動して一時停止する', async () => {
  test.setTimeout(0); // page.pause() は人間操作待ちのため無制限
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t9-ac5-'));
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await seedE2EProviderKeys(page);

  // ---- maplibre マスタを UI で作成・保存（m6-t5-mapbox-maplibre.spec.ts と同型） ----
  await page.evaluate(() => { location.hash = '/basemaps'; });
  await page.getByTestId('basemap-new').click();
  await expect(page.getByTestId('basemap-kind-prompt')).toBeVisible();
  await page.getByTestId('basemap-kind-maplibre').click();
  await fillAndCommit(page.getByTestId('basemap-slug'), 'ac5-verify-maplibre');
  await fillAndCommit(page.getByTestId('basemap-title'), 'AC5 検証用 MapLibre');
  await fillAndCommit(page.getByTestId('basemap-attr'), '(C) OSM');
  await fillAndCommit(page.getByTestId('basemap-style-url'), MAPLIBRE_STYLE);
  await expect(page.getByTestId('editor-save')).toBeEnabled();
  await page.getByTestId('editor-save').click();
  await expect(page).not.toHaveURL(/new=1/, { timeout: 30_000 });

  const master = await page.evaluate(async () => {
    const list = await (window as any).baseMaps.list();
    const items = Array.isArray(list) ? list : list?.items || list?.result || [];
    return (items as any[]).find((m) => (m.mapID || m.slug) === 'ac5-verify-maplibre');
  });
  expect(master).toBeTruthy();

  // ---- アプリを1件シードしてプレビュー ----
  const slug = 'ac5-verify-app';
  await page.evaluate(async ({ slug, sources, previewPort }) => {
    const saved = await (window as any).appedit.save({ slug, document: {
      appID: slug, appName: { ja: slug }, title: { ja: slug },
      description: {}, keywords: '', siteUrl: '', lang: 'ja',
      sources,
      appSettings: { homeLng: 139.767, homeLat: 35.681, defaultZoom: 12 },
      pois: [],
      httpSettings: { previewPort }, manifestSettings: {},
    } });
    if (!saved || saved.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(saved)}`);
  }, {
    slug,
    sources: [{
      sourceType: 'base-map',
      mapID: 'ac5-verify-maplibre',
      role: 'base',
      data: { ...(master.data || master), kind: 'maplibre', maptype: 'maplibre', style: MAPLIBRE_STYLE },
    }],
    previewPort: PREVIEW_PORT,
  });

  await page.evaluate(() => { location.hash = '/applist'; });
  await expect(page.locator('[data-resource-uid]').first()).toBeVisible({ timeout: 15000 });
  await page.locator('[data-resource-uid] a').filter({ hasText: slug }).first().click();
  await page.locator('[role="tab"]').filter({ hasText: /プレビュー/ }).click();
  await expect(page.locator('iframe.preview-map')).toBeVisible({ timeout: 60000 });
  const src = (await page.locator('iframe.preview-map').getAttribute('src'))!;

  // eslint-disable-next-line no-console
  console.log(`M6T9_AC5_PREVIEW_URL=${src}`);
  // eslint-disable-next-line no-console
  console.log('layer_maplibre.ts の render() が呼ばれる前は maplibreDiv が visibility:hidden かつ');
  // eslint-disable-next-line no-console
  console.log('サイズ未確定のため、MapLibre GL JS が起動時に "No map visible because the map');
  // eslint-disable-next-line no-console
  console.log('container\'s width or height are 0" という警告を出す（実測: preview 読み込み時に3回）。');
  // eslint-disable-next-line no-console
  console.log('render() 内の mlMap.resize() 補正（canvas.width/height と frameState.size の不一致時）が');
  // eslint-disable-next-line no-console
  console.log('この初期0サイズを是正する設計だが、resize() 実行の瞬間に一瞬ちらつく可能性がある。');
  // eslint-disable-next-line no-console
  console.log('上記 URL を開き、初回表示時・パン/ズーム操作時のちらつきの有無を目視確認してください。');

  await page.pause();
  await app.close();
});
