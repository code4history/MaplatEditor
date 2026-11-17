// provider/basemap 周辺の是正6件（/t6 実装レビュー由来）
// case 1: provider kind（google/mapbox/maplibre）の AppSource は url 入力欄が表示されない。
//      【/ case 14 で上位規則へ吸収】url の上書き欄は **全種別** から撤去された。
//      ベースマップの同一性そのものを変える操作であり、マスタ側で別のベースマップを作るべきもの。
//      ∴ 「provider は出ない / tms は出る」という 当時の対比は成立しなくなった。
//      本テストは「url 入力欄が出ないこと」を provider と tms の**両方**で固定する。
//      url がマスタ管理である旨の注記（app-source-url-note）は削除された。
//      上書き欄が全廃された画面では「変更できない」注記だけが浮き、隣接する欄の説明と誤読される。
//      ∴ 本テストも注記の可視性ではなく**不在**を固定する。撤去そのものの意図は E2E が受け持つ
// case 3: 【撤去・アプリのソースの差分モデルへ移管】「マスタから再取得」機能自体をこの spec の対象から撤去したため、当該テストも削除
// case 6: 種別選択ボタン・プリセットボタンで、無効なボタンにのみ ContextHelp が表示され、有効なボタンには出ない
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { seedE2EProviderKeys } from './helpers/providerKeys';
import { baseMapMasterDoc as baseTmsDoc, seedBaseMap } from './helpers/baseMapSeed';

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

async function fillAndCommit(locator: ReturnType<Page['getByTestId']>, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press('Tab');
}

test('provider kind hides url field in AppSourceEditor; ContextHelp shows only when actually disabled', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-provider-followups-ac1-'));
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await seedE2EProviderKeys(page);

    const googleSlug = `fx-google-${Date.now()}`;
    await seedBaseMap(page, googleSlug, baseTmsDoc({ kind: 'google', maptype: 'google_roadmap', url: '' }));
    const tmsSlug = `fx-tms-${Date.now()}`;
    await seedBaseMap(page, tmsSlug, baseTmsDoc({ kind: 'tms', maptype: null, url: 'https://example.com/{z}/{x}/{y}.png' }));

    // ---- case 6: 種別選択ボタン群 — 無効な merc のみ理由が出る。google/mapbox はキー投入済みのため出ない ----
    await page.evaluate(() => { location.hash = '/basemaps'; });
    await page.getByTestId('basemap-new').click();
    await expect(page.getByTestId('basemap-kind-prompt')).toBeVisible();
    await expect(page.getByTestId('basemap-kind-merc-reason')).toBeVisible();
    await expect(page.getByTestId('basemap-kind-google-reason')).toHaveCount(0);
    await expect(page.getByTestId('basemap-kind-mapbox-reason')).toHaveCount(0);
    await expect(page.getByTestId('basemap-kind-maplibre-reason')).toHaveCount(0);
    await expect(page.getByTestId('basemap-kind-tms-reason')).toHaveCount(0);

    // ---- case 1: アプリへソース追加 → url 欄は provider / tms のいずれでも出ない----
    await page.evaluate(() => { location.hash = '/appedit'; });
    await expect(page.getByTestId('app-id')).toBeVisible();
    const appSlug = `fx-app-${Date.now()}`;
    await fillAndCommit(page.getByTestId('app-id'), appSlug);
    await fillAndCommit(page.getByTestId('app-title'), 'App');

    await page.getByTestId('app-sources-tab').click();
    await page.getByTestId('app-basemap-mode').click();
    await page.getByTestId('app-basemap-search').fill(googleSlug);
    await expect(page.getByTestId(`app-basemap-row-${googleSlug}`)).toBeVisible();
    await page.getByTestId(`app-basemap-row-${googleSlug}`).click();
    const googleSource = page.getByTestId(`app-selected-source-${googleSlug}`);
    await expect(googleSource).toBeVisible();
    await expect(googleSource.getByTestId('app-source-url-field')).toHaveCount(0);
    await expect(googleSource.getByTestId('app-source-url-note'), '注記は削除された').toHaveCount(0);

    await page.getByTestId('app-basemap-search').fill(tmsSlug);
    await expect(page.getByTestId(`app-basemap-row-${tmsSlug}`)).toBeVisible();
    await page.getByTestId(`app-basemap-row-${tmsSlug}`).click();
    const tmsSource = page.getByTestId(`app-selected-source-${tmsSlug}`);
    await expect(tmsSource).toBeVisible();
    // tms でも url 欄は出ない（その後、注記は削除された）
    await expect(tmsSource.getByTestId('app-source-url-field')).toHaveCount(0);
    await expect(tmsSource.getByTestId('app-source-url')).toHaveCount(0);
    await expect(tmsSource.getByTestId('app-source-url-note'), '注記は削除された').toHaveCount(0);

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});
