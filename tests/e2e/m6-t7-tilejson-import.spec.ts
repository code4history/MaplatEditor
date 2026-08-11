// m6-t7 TileJSON 取り込み E2E
// AC1: tms 種別編集画面に「TileJSON から読み込む」URL入力欄とボタンが表示される
// AC2: 有効な TileJSON URL を入力して読み込むと、url/minZoom/maxZoom/attr/title/
//      coverageLngLats が正しくフォームへ反映される
// AC6: vector_layers を持つ TileJSON は拒否され、MapLibre 種別への誘導メッセージが表示される
//
// TileJSON のフェッチ元は使い捨てローカル HTTP サーバ（m9-t3 smoke / m5-t9 E2E で確立済みの
// 手法）で模擬し、外部ネットワークへ依存しない。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

const VALID_TILEJSON = JSON.stringify({
  tiles: ['https://example.test/{z}/{x}/{y}.png'],
  minzoom: 2,
  maxzoom: 18,
  attribution: 'Example Attribution',
  name: 'Example Tiles',
  bounds: [130, 30, 140, 40],
});

const VECTOR_TILEJSON = JSON.stringify({
  tiles: ['https://example.test/{z}/{x}/{y}.pbf'],
  vector_layers: [{ id: 'layer1' }],
});

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  return { app, page };
}

/** TileJSON を配信する使い捨てサーバ（パスで応答本文を切替） */
async function startTileJsonServer(): Promise<{ server: Server; validUrl: string; vectorUrl: string }> {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/vector.json') {
      res.end(VECTOR_TILEJSON);
      return;
    }
    res.end(VALID_TILEJSON);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    server,
    validUrl: `http://127.0.0.1:${port}/tiles.json`,
    vectorUrl: `http://127.0.0.1:${port}/vector.json`,
  };
}

async function fillAndCommit(locator: ReturnType<Page['getByTestId']>, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press('Tab');
}

test('TileJSON import: UI presence, successful import populates form, vector tileset is rejected', async () => {
  test.setTimeout(120_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t7-'));
  const { server, validUrl, vectorUrl } = await startTileJsonServer();
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await page.evaluate(() => { location.hash = '/basemaps?page=3'; });
    await page.getByTestId('basemap-new').click();
    await page.getByTestId('basemap-kind-tms').click();
    await expect(page.getByTestId('basemap-title')).toBeVisible();

    // AC1: URL 入力欄とボタンが表示される
    await expect(page.getByTestId('basemap-tilejson-url-input')).toBeVisible();
    await expect(page.getByTestId('basemap-tilejson-import')).toBeVisible();
    await expect(page.getByTestId('basemap-tilejson-import')).toBeDisabled(); // URL 未入力

    // AC2: 有効な TileJSON URL を読み込むとフォームへ反映される
    await page.getByTestId('basemap-tilejson-url-input').fill(validUrl);
    await expect(page.getByTestId('basemap-tilejson-import')).toBeEnabled();
    await page.getByTestId('basemap-tilejson-import').click();

    await expect(page.getByTestId('basemap-url')).toHaveValue('https://example.test/{z}/{x}/{y}.png', { timeout: 15_000 });
    await expect(page.getByTestId('basemap-min-zoom')).toHaveValue('2');
    await expect(page.getByTestId('basemap-max-zoom')).toHaveValue('18');
    await expect(page.getByTestId('basemap-attr')).toHaveValue('Example Attribution');
    await expect(page.getByTestId('basemap-title')).toHaveValue('Example Tiles');
    // coverageLngLats = bboxToEnvelope([130,30,140,40]) → envelopeToBbox で W130 S30 E140 N40 に復元表示
    await expect(page.getByText(/W130.*S30.*E140.*N40/)).toBeVisible();
    await expect(page.locator('[data-diagnostic-scope="operation"]')).toHaveCount(0);

    // 実装レビュー M-1: 1回の取り込み = 1 commit = undo 1回で取り込み前へ完全に戻ること
    await page.getByTestId('editor-undo').click();
    await expect(page.getByTestId('basemap-url')).toHaveValue('');
    await expect(page.getByTestId('basemap-min-zoom')).toHaveValue('');
    await expect(page.getByTestId('basemap-max-zoom')).toHaveValue('');
    await expect(page.getByTestId('basemap-attr')).toHaveValue('');
    await expect(page.getByTestId('basemap-title')).toHaveValue('');
    await expect(page.getByText(/W130.*S30.*E140.*N40/)).toHaveCount(0);
    // redo で取り込み後の状態へ戻し、以降のテストを継続する
    await page.getByTestId('editor-redo').click();
    await expect(page.getByTestId('basemap-url')).toHaveValue('https://example.test/{z}/{x}/{y}.png');
    await expect(page.getByTestId('basemap-attr')).toHaveValue('Example Attribution');

    // slug を埋めて保存可能な状態にする（AC2 の反映がフォーム経由で保存できることの確認）
    await fillAndCommit(page.getByTestId('basemap-slug'), 'e2e-tilejson-import');
    await expect(page.getByTestId('editor-save')).toBeEnabled();

    // AC6: vector tileset は拒否され誘導メッセージが表示される（フォーム値は上書きされない）
    await page.getByTestId('basemap-tilejson-url-input').fill(vectorUrl);
    await page.getByTestId('basemap-tilejson-import').click();
    await expect(page.locator('[data-diagnostic-scope="operation"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-diagnostic-scope="operation"]')).toContainText('ベクタタイルセット');
    await expect(page.locator('[data-diagnostic-scope="operation"]')).toContainText('MapLibre');
    // 拒否後もフォーム値は import 前のまま（クロバーされない）
    await expect(page.getByTestId('basemap-url')).toHaveValue('https://example.test/{z}/{x}/{y}.png');

    expect(pageErrors).toEqual([]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await quitElectronApplication(app);
  }
});
