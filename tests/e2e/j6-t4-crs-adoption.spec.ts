import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import Tin from '@maplat/tin';
import { toLonLat } from 'ol/proj.js';
import { quitElectronApplication } from './helpers/electronLifecycle';

test('MapEdit から採用中の操作拒否・降格・Undo・Redo・保存と Plan A のホーム設定を確認する', async () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const scratch = path.join(root, '.tmp-smoke');
  await mkdir(scratch, { recursive: true });
  const e2eRoot = await mkdtemp(path.join(scratch, 't4b-e2e-'));
  const app = await electron.launch({
    args: [root, `--user-data-dir=${e2eRoot}`], cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  try {
    const page = await app.firstWindow();
    await page.route(/^https?:/, (route) => route.abort());
    const points = [[0, 0], [100, 0], [100, 100], [0, 100], [54, 47]];
    const gcps = points.map(([x, y]) => [[x, y], [1070 + x, 1000 - y]]);
    const tin = new Tin({ points: gcps, wh: [100, 100], strictMode: 'strict', useV2Algorithm: true });
    await tin.updateTinAsync();
    const result = await page.evaluate((compiled) => window.mapedit.save({
      slug: 'test-t4b-crs',
      mapObject: {
        mapID: 'test-t4b-crs', title: { ja: '採用試験' }, attr: { ja: '出典' }, lang: 'ja',
        license: 'PD', dataLicense: 'CC BY-SA', width: 100, height: 100,
        gcps: compiled.points, edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain',
      },
      tins: [compiled],
    }), tin.getCompiled());
    expect(result?.result).toBe('Success');
    const uid = (result as any).uid;
    await page.evaluate((id) => { location.hash = `#/mapedit?uid=${id}`; }, uid);
    await expect.poll(() => page.evaluate(() => (window as any).testDebug?.historyDebug()?.length)).toBe(1);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.isVisible()))).toBe(false);

    const worldFile = { xScale: 1, xSkew: 0, xOrigin: 1000.5, yScale: -1, ySkew: 0, yOrigin: 999.5 };
    const selection = {
      setup: 'B',
      selected: { crs: { epsg: 3857 }, coreCompatible: true, worldFile,
        gcpsNew: gcps.map(([pixel, geo]) => ({ pixel, geo })) },
    };
    // 実ワーカーへ送る直前だけ待たせ、採用中に保存とメニューを駆動する。
    await page.evaluate((input) => {
      const browser = window as any;
      const send = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (...args: any[]) {
        browser.releaseTin = () => {
          Worker.prototype.postMessage = send;
          (send as any).apply(this, args);
        };
      };
      browser.adoptionResult = browser.testDebug.adoptCrsEstimation(input);
    }, selection);
    await expect.poll(() => page.evaluate(() => typeof (window as any).releaseTin)).toBe('function');
    expect(await page.evaluate(() => (window as any).testDebug.adoptionInProgress.value)).toBe(true);
    expect(await page.evaluate(() => (window as any).testDebug.saveMapAfterConfirm())).toBe(false);
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('main-process-message', 'menu:undo');
      win.webContents.send('main-process-message', 'menu:redo');
    });
    expect(await page.evaluate(() => (window as any).testDebug.historyDebug().length)).toBe(1);
    await page.evaluate(() => (window as any).releaseTin());
    expect(await page.evaluate(() => (window as any).adoptionResult)).toEqual({ status: 'adopted' });
    const after = await page.evaluate(() => {
      const debug = (window as any).testDebug;
      return { history: debug.historyDebug().length, intent: debug.layerTransformIntents.value.main,
        diagnostics: debug.tinDiagnostics.value.main, mapData: JSON.parse(JSON.stringify(debug.mapData.value)) };
    });
    expect(after.history).toBe(2);
    expect(after.intent).toEqual({ setup: 'B', crs: { epsg: 3857 }, worldFile });
    expect(after.diagnostics).toMatchObject({
      requestedOuterTransform: 'worldFile', outerTransform: 'extrapolate', fallbackReason: 'boundaryFlips',
    });
    expect(after.mapData.crs).toEqual({ epsg: 3857 });
    expect(after.mapData.worldFile).toBeUndefined();
    for (const [message, setup] of [['menu:undo', 'legacyV2'], ['menu:redo', 'B']]) {
      await app.evaluate(({ BrowserWindow }, data) => BrowserWindow.getAllWindows()[0].webContents.send('main-process-message', data), message);
      await expect.poll(() => page.evaluate(() => (window as any).testDebug.layerTransformIntents.value.main.setup)).toBe(setup);
    }
    await expect.poll(() => page.evaluate(() => (window as any).testDebug.adoptionInProgress.value)).toBe(false);
    expect(await page.evaluate(() => (window as any).testDebug.saveMapAfterConfirm())).toBe(true);
    const stored = await page.evaluate((id) => window.mapedit.request(id), uid);
    expect(stored.compiled.outerTransform).toBe('extrapolate');
    expect(stored.compiled.worldFile).toBeUndefined();
    await page.reload();
    await expect.poll(() => page.evaluate(() => (window as any).testDebug?.layerTransformIntents.value.main.setup)).toBe('C');

    // タイルは試験内のデータ URL で読み込み、非表示のまま実際のホーム設定ボタンを押す。
    await page.evaluate(async () => {
      const debug = (window as any).testDebug;
      debug.mapData.value.url_ = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
      await debug.loadMapTiles();
    });
    await page.getByTestId('map-tab-gcps').click();
    const setupA = {
      setup: 'A',
      selected: {
        crs: { epsg: 4326 }, coreCompatible: true,
        worldFile: { xScale: 0.00001, xSkew: 0.000001, xOrigin: 0.01, yScale: -0.00001, ySkew: 0, yOrigin: 0.01 },
        gcpsNew: gcps.map(([pixel, geo]) => ({ pixel, geo: toLonLat(geo) })),
      },
    };
    expect(await page.evaluate((input) => (window as any).testDebug.adoptCrsEstimation(input), setupA)).toEqual({ status: 'adopted' });
    const homeButton = page.getByTestId('map-edit-set-home-illst');
    await expect(homeButton).toBeEnabled();
    await homeButton.click();
    const newHome = await page.evaluate(() => (window as any).testDebug.homePosition.value);
    expect(newHome[0]).toBeCloseTo(0.01055, 4);
    expect(newHome[1]).toBeCloseTo(0.0095, 4);
    expect(await page.evaluate(() => (window as any).testDebug.saveMapAfterConfirm())).toBe(true);
    const storedA = await page.evaluate((id) => window.mapedit.request(id), uid);
    expect(storedA.tinEnabled).toBe(false);
    expect(storedA.worldFile).toEqual(setupA.selected.worldFile);
    expect(storedA.compiled).toBeUndefined();

  } finally {
    await quitElectronApplication(app);
    await rm(e2eRoot, { recursive: true, force: true });
  }
});
