// #106: 「ホーム画面に追加（PWA）」がオンで「オフライン表示（キャッシュ）」がオフのとき、書き出したアプリは
// manifest を出し、存在しない service-worker.js を登録しに行かない。
//
// S1 キャッシュ無効の書き出し: service-worker.js の要求 0 件・登録の失敗の行 0 件・登録 0。manifest は 200 で名前が一致
// S2 対照（キャッシュ有効の書き出し）: service-worker.js が 200・登録 1・manifest は S1 と同じ
// S3 プレビュー（キャッシュ無効）: プレビューの iframe の中で登録 0・service-worker.js の要求なし
//
// 地図は組み込みの OpenStreetMap（osm）。タイルは tests/e2e/fixtures/osm-tiles の実在のタイル（札幌の周り z14）を
// テストの中のサーバから配り、tile.openstreetmap.org への要求はそこへ振り替える（helpers/exportedApp.ts）。
// 書き出したアプリは Electron の BrowserWindow で開く（前例 maplibre-version-select.spec.ts）。
//
// 環境変数 PWA_WORKER_SHOT_DIR を付けたときだけ、AppEdit の PWA・キャッシュの欄の写真の段を足す
// （人が前後を見比べる記録。合否の関門ではない）。
import { expect, test, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch, openHash, stubMessageBoxAutoOk } from './helpers/mapPackage';
import { openInWindow, routeOsmTilesToFixture, serveExportedZip } from './helpers/exportedApp';

const APP_ID = 'pwa-worker-optional-app';
const PREVIEW_PORT = 45797;
const SHOT_DIR = process.env.PWA_WORKER_SHOT_DIR;
const SHOT_PREFIX = process.env.PWA_WORKER_SHOT_PREFIX || 'after';

let app: ElectronApplication;
let page: Page;
let e2eRoot: string;
let appUid: string;

const isRegisterFailure = (text: string) => /Failed to register/i.test(text) && /service.?worker/i.test(text);

async function exportFromUi(label: string): Promise<string> {
  const zip = path.join(e2eRoot, `${label}.zip`);
  await app.evaluate(async ({ dialog }, out) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: out })) as typeof dialog.showSaveDialog;
  }, zip);
  await page.locator('[data-editor-action="export"]').click();
  await expect(page.getByTestId('app-export-options')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('app-export-options-confirm').click();
  await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 180_000 });
  for (let i = 0; i < 5; i++) {
    const modal = page.locator('.modal.d-block');
    if (await modal.count() === 0) break;
    await modal.locator('button', { hasText: 'OK' }).first().click({ timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  await expect(page.locator('.modal.d-block')).toHaveCount(0, { timeout: 20_000 });
  return zip;
}

async function openAppEdit(): Promise<void> {
  await openHash(page, '#/applist');
  await expect(page.locator('iframe.preview-map')).toHaveCount(0, { timeout: 30_000 });
  await openHash(page, `#/appedit?uid=${appUid}`);
  await expect(page.getByTestId('app-pwa-toggle')).toBeVisible({ timeout: 30_000 });
}

/** 書き出したアプリを開き、地図のタイルが描かれてから 5 秒待って、観測した値を返す */
async function openExported(label: string, zip: string) {
  const served = await serveExportedZip(zip, path.join(e2eRoot, `${label}-extract`));
  const tiles = await routeOsmTilesToFixture(app);
  const { win, consoleLines, pageErrors } = await openInWindow(app, `${served.origin}/`);
  try {
    await expect(win.locator('canvas').first()).toBeAttached({ timeout: 60_000 });
    await expect.poll(() => tiles.requests.filter((r) => r.status === 200).length, {
      timeout: 60_000, message: '実在の OSM タイルの要求が来ない',
    }).toBeGreaterThan(0);
    await win.waitForTimeout(5_000);
    const registrations = await win.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope));
    const manifestLinks = await win.evaluate(() => [...document.querySelectorAll('link[rel="manifest"]')].map((l) => l.getAttribute('href')));
    const manifestFetch = await win.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
      if (!link) return null;
      const r = await fetch(link.href);
      return { status: r.status, name: (await r.json().catch(() => ({}))).name as string | undefined };
    });
    const manifestFile = JSON.parse(await readFile(path.join(served.dir, 'pwa', `${APP_ID}_manifest.json`), 'utf8'));
    const observed = {
      label,
      origin: served.origin,
      registrations,
      manifestLinks,
      manifestFetch,
      manifestFileName: manifestFile.name,
      requests: served.requests.map((r) => `${r.status} ${r.path}`),
      tileRequests: tiles.requests.length,
      tileRequests200: tiles.requests.filter((r) => r.status === 200).length,
      console: consoleLines.map((l) => `[${l.type}] ${l.text}`),
      pageErrors,
    };
    // evidence 用（S2 の対照が環境で落ちたときに本体の不具合と区別するため、全部を出す）
    console.log(`OBSERVED ${JSON.stringify(observed, null, 2)}`);
    return { observed, served, consoleLines };
  } finally {
    await win.close().catch(() => {});
    await tiles.unroute();
    await served.close();
  }
}

function expectManifest(observed: { manifestLinks: (string | null)[]; manifestFetch: { status: number; name?: string } | null; manifestFileName: string }) {
  expect(observed.manifestLinks, 'manifest の link がただ 1 つ').toHaveLength(1);
  expect(observed.manifestLinks[0]!.endsWith(`pwa/${APP_ID}_manifest.json`)).toBe(true);
  expect(observed.manifestFetch?.status, 'manifest が 200 で返る').toBe(200);
  expect(observed.manifestFetch?.name, 'manifest の name が書き出した zip の中のものと一致').toBe(observed.manifestFileName);
  expect(observed.manifestFileName).toBeTruthy();
}

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.describe('#106 キャッシュが無効なら Service Worker を登録させない', () => {
  test.beforeAll(async () => {
    e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-pwa-worker-optional-'));
    ({ app, page } = await launch(e2eRoot));
    await stubMessageBoxAutoOk(app);
    appUid = await page.evaluate(async ({ slug, previewPort }) => {
      const uid = crypto.randomUUID();
      const r = await (window as any).appedit.save({
        uid, slug, create: true,
        document: {
          appID: slug, appName: { ja: 'オフライン表示なしの PWA' }, title: { ja: 'オフライン表示なしの PWA' },
          description: {}, keywords: '', siteUrl: '', lang: 'ja',
          sources: ['osm'], startFrom: '', pois: [],
          // 実在のタイル（fixtures/osm-tiles）の範囲: z14・経度 141.35〜141.39・緯度 43.15〜43.26
          appSettings: { homeLng: 141.37, homeLat: 43.2, defaultZoom: 14 },
          httpSettings: { previewPort, pwaManifest: true, enableCache: false },
          manifestSettings: { backgroundColor: '#f6f0d3' },
        },
      });
      if (!r || r.result !== 'Success') throw new Error(JSON.stringify(r));
      return uid;
    }, { slug: APP_ID, previewPort: PREVIEW_PORT });
  });

  test.afterAll(async () => {
    if (app) await quitElectronApplication(app);
  });

  if (SHOT_DIR) {
    test('写真: AppEdit の PWA・キャッシュの欄（前後の比較の記録）', async () => {
      await mkdir(SHOT_DIR, { recursive: true });
      await openAppEdit();
      const grid = page.locator('.toggle-grid').filter({ has: page.getByTestId('app-pwa-toggle') });
      await grid.scrollIntoViewIfNeeded();
      await writeFile(path.join(SHOT_DIR, `${SHOT_PREFIX}-http-toggles.png`), await grid.screenshot());
      // キャッシュの欄（6 番目の label）の ? に focus して説明を開いた状態
      const cacheHelp = grid.locator(':scope > label').nth(5).locator('[data-editor-help]');
      await cacheHelp.focus();
      const popover = page.locator('.editor-ui-help-popover');
      await expect(popover).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(300);
      const a = (await grid.boundingBox())!;
      const b = (await popover.boundingBox())!;
      const x = Math.max(0, Math.min(a.x, b.x) - 8);
      const y = Math.max(0, Math.min(a.y, b.y) - 8);
      const clip = { x, y, width: Math.max(a.x + a.width, b.x + b.width) + 8 - x, height: Math.max(a.y + a.height, b.y + b.height) + 8 - y };
      await writeFile(path.join(SHOT_DIR, `${SHOT_PREFIX}-cache-help.png`), await page.screenshot({ clip }));
      await cacheHelp.blur();
    });
  }

  test('S1 キャッシュ無効の書き出し: service-worker.js を取りに行かず登録もしない。manifest はある', async () => {
    await openAppEdit();
    await expect(page.getByTestId('app-pwa-toggle')).toBeChecked();
    const zip = await exportFromUi('s1-cache-off');
    const { observed, consoleLines } = await openExported('S1', zip);
    expect(observed.requests.filter((r) => r.endsWith('/service-worker.js')), 'service-worker.js の要求が 0 件').toEqual([]);
    expect(consoleLines.filter((l) => isRegisterFailure(l.text)), 'Service Worker の登録の失敗の行が 0 件').toEqual([]);
    expect(observed.registrations, '登録が 0').toEqual([]);
    expectManifest(observed);
  });

  test('S3 プレビュー（キャッシュ無効）: iframe の中で登録 0・service-worker.js の要求なし', async () => {
    await openAppEdit();
    await page.locator('[role="tab"]').filter({ hasText: /プレビュー/ }).click();
    await expect(page.locator('iframe.preview-map')).toBeVisible({ timeout: 60_000 });
    const src = (await page.locator('iframe.preview-map').getAttribute('src'))!;
    await expect.poll(() => page.frames().some((f) => f.url() === src), { timeout: 30_000 }).toBe(true);
    const frame: Frame = page.frames().find((f) => f.url() === src)!;
    await expect.poll(() => frame.evaluate(() => Boolean((window as any).__maplatPreview)).catch(() => false), { timeout: 90_000 }).toBe(true);
    await page.waitForTimeout(5_000);
    const registrations = await frame.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope));
    const workerEntries = await frame.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('service-worker.js')));
    console.log(`OBSERVED ${JSON.stringify({ label: 'S3', src, registrations, workerEntries, resourceEntries: await frame.evaluate(() => performance.getEntriesByType('resource').length) }, null, 2)}`);
    expect(registrations, 'プレビューで登録が 0').toEqual([]);
    expect(workerEntries, 'プレビューで service-worker.js の要求が無い').toEqual([]);
  });

  test('S2 対照（キャッシュ有効の書き出し）: service-worker.js が 200 で登録 1。manifest は S1 と同じ', async () => {
    await openAppEdit();
    const cache = page.locator('.toggle-grid > label').nth(5).locator('input[type="checkbox"]');
    await expect(cache).toBeEnabled();
    await cache.check();
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('editor-save')).toBeDisabled({ timeout: 30_000 });
    const stored = await page.evaluate(async (u) => (window as any).appedit.request(u), appUid);
    expect(stored?.httpSettings?.enableCache ?? stored?.document?.httpSettings?.enableCache).toBe(true);
    const zip = await exportFromUi('s2-cache-on');
    const { observed, consoleLines } = await openExported('S2', zip);
    expect(observed.requests.filter((r) => r === '200 /service-worker.js').length, 'service-worker.js が 200 で 1 件以上').toBeGreaterThan(0);
    expect(observed.registrations, '登録が 1').toHaveLength(1);
    expect(consoleLines.filter((l) => isRegisterFailure(l.text)), 'Service Worker の登録の失敗の行が 0 件').toEqual([]);
    expectManifest(observed);
  });
});
