// oct26-m16-t2: main window・About ウィンドウの遷移ガード（セキュリティレビュー C の F-C1）の E2E。
//
// F-C1: main window（preload あり）に will-navigate と setWindowOpenHandler のガードが無く、プレビュー iframe 内の
// POI の `<a target="_top">` を押すと main window が外部ページへ遷移し、遷移先に preload（IPC）が入る。
//
// 検証すること:
//   G1  main window で location.href を外部 URL にしても、main frame は app://bundle/ に留まる
//       （アプリ内の画面遷移＝同一オリジン内の hash 遷移は従来どおり通る）
//   G2  main window で window.open(外部 URL) を呼んでも、新しいウィンドウは開かない
//   G3  プレビュー iframe に相当する子フレーム（http://localhost:<port>）の `target="_top"` リンクを押しても
//       main frame は遷移しない。`target="_blank"` でも新しいウィンドウは開かない。
//       子フレームの中だけの遷移（target 無しのリンク）は従来どおり通る
//   G4  About ウィンドウ（preload なし）にも同じガードが掛かる
//
// 外部サイトへは実際に出ない（遷移先は解決しない名前 example.invalid）。
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { evalMain, openAboutWindow } from './helpers/electronMenu';
import { launch } from './helpers/launchIsolated';

const EXTERNAL_URL = 'https://example.invalid/';
// 遷移が起きるなら起ききるまで待つ時間（.invalid の名前解決失敗はすぐ返る）
const SETTLE_MS = 2_000;

// main process で、全 webContents の will-navigate（main frame の遷移要求）と新規ウィンドウ生成を記録する。
// 記録は「遷移要求がガードの位置まで届いたこと」を示すためのもので、止めるかどうかには関与しない。
async function installRecorder(app: ElectronApplication): Promise<void> {
  await evalMain<void>(app, ({ app: electronApp, webContents }) => {
    const g = globalThis as unknown as {
      __m16t2?: { willNavigate: string[]; createdWindows: string[] };
      __m16t2Hooked?: WeakSet<object>;
    };
    g.__m16t2 = { willNavigate: [], createdWindows: [] };
    g.__m16t2Hooked = new WeakSet();
    const hook = (wc: Electron.WebContents) => {
      if (g.__m16t2Hooked!.has(wc)) return;
      g.__m16t2Hooked!.add(wc);
      wc.on('will-navigate', (_e: unknown, url: string) => { g.__m16t2!.willNavigate.push(url); });
      wc.on('did-create-window', (_w: unknown, details: { url: string }) => {
        g.__m16t2!.createdWindows.push(details.url);
      });
    };
    for (const wc of webContents.getAllWebContents()) hook(wc);
    electronApp.on('web-contents-created', (_ev, wc) => hook(wc));
  });
}

async function recorded(app: ElectronApplication): Promise<{ willNavigate: string[]; createdWindows: string[] }> {
  return evalMain(app, () => {
    const g = globalThis as unknown as { __m16t2: { willNavigate: string[]; createdWindows: string[] } };
    return { willNavigate: [...g.__m16t2.willNavigate], createdWindows: [...g.__m16t2.createdWindows] };
  });
}

async function windowCount(app: ElectronApplication): Promise<number> {
  return evalMain(app, ({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
}

async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(SETTLE_MS);
}

// プレビュー iframe（AppPreviewService の http://localhost:<port>）に相当する子フレームの配信元。
// 第三者の POI の HTML に書かれうるリンク 3 種を置く。
async function startFrameServer(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url?.startsWith('/second')) {
      res.end('<!doctype html><title>second</title><p id="second">second page</p>');
      return;
    }
    res.end(`<!doctype html><title>poi</title>
<a id="top" href="${EXTERNAL_URL}" target="_top">top</a>
<a id="blank" href="${EXTERNAL_URL}" target="_blank">blank</a>
<a id="inner" href="/second">inner</a>`);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://localhost:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test.describe('oct26-m16-t2 main window・About ウィンドウの遷移ガード（F-C1）', () => {
  test('G1: main window で location.href を外部 URL にしても main frame は app://bundle/ に留まる', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m16t2-g1-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await installRecorder(app);
      expect(page.mainFrame().url()).toMatch(/^app:\/\/bundle\//);

      // アプリ内の画面遷移（hash）は従来どおり通る
      await page.evaluate(() => { location.hash = '#/settings'; });
      await expect(page.locator('#langSwitcher')).toBeVisible();
      expect(page.mainFrame().url()).toBe('app://bundle/index.html#/settings');

      await page.evaluate((url) => { setTimeout(() => { location.href = url; }, 0); }, EXTERNAL_URL);
      // 遷移要求がガードの位置（will-navigate）まで届いたことを確かめてから、止まったかを見る
      await expect.poll(async () => (await recorded(app)).willNavigate).toContain(EXTERNAL_URL);
      await settle(page);
      expect(page.mainFrame().url()).toBe('app://bundle/index.html#/settings');
      // preload の API が同じ文書に残っている（遷移していない）
      expect(await page.evaluate(() => typeof window.settings)).toBe('object');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('G2: main window で window.open(外部 URL) を呼んでも新しいウィンドウは開かない', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m16t2-g2-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await installRecorder(app);
      const before = await windowCount(app);
      const opened = await page.evaluate((url) => window.open(url) !== null, EXTERNAL_URL);
      await settle(page);
      expect(opened).toBe(false);
      expect((await recorded(app)).createdWindows).toEqual([]);
      expect(await windowCount(app)).toBe(before);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('G3: 子フレームの target="_top"・"_blank" では main window は遷移せず窓も開かず、子フレーム内の遷移は通る', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m16t2-g3-'));
    const frameServer = await startFrameServer();
    const { app, page } = await launch(e2eRoot);
    try {
      await installRecorder(app);
      // 初期表示の router redirect（#/ → #/maplist）が済んでから main frame の URL を控える
      // （控えた後に redirect が走ると、ガードと無関係に比較が合わなくなる）
      const mainUrl = 'app://bundle/index.html#/maplist';
      await expect.poll(() => page.mainFrame().url()).toBe(mainUrl);
      const before = await windowCount(app);

      await page.evaluate((src) => {
        const iframe = document.createElement('iframe');
        iframe.id = 'm16t2-frame';
        iframe.src = src;
        // アプリの UI（navbar 等）に覆われないよう最前面に固定する
        iframe.style.position = 'fixed';
        iframe.style.left = '200px';
        iframe.style.top = '200px';
        iframe.style.width = '400px';
        iframe.style.height = '200px';
        iframe.style.zIndex = '2147483647';
        iframe.style.background = 'white';
        document.body.append(iframe);
      }, `${frameServer.origin}/poi`);
      const frame = page.frameLocator('#m16t2-frame');
      await expect(frame.locator('#top')).toBeVisible();

      // target="_top"（ユーザー操作のクリック。cross-origin の子フレームからでも top の遷移は許される）。
      // F-C1 の本筋なので最初に確かめる（ガードが無いとここで main window が外部へ遷移する）
      await frame.locator('#top').click();
      await expect.poll(async () => (await recorded(app)).willNavigate).toContain(EXTERNAL_URL);
      await settle(page);
      expect(page.mainFrame().url()).toBe(mainUrl);
      expect(await page.evaluate(() => typeof window.settings)).toBe('object');

      // target="_blank"（ユーザー操作のクリック）
      await frame.locator('#blank').click();
      await settle(page);
      expect((await recorded(app)).createdWindows).toEqual([]);
      expect(await windowCount(app)).toBe(before);

      // 子フレームの中だけの遷移は妨げない
      await frame.locator('#inner').click();
      await expect(frame.locator('#second')).toBeVisible();
      expect(page.mainFrame().url()).toBe(mainUrl);
    } finally {
      await quitElectronApplication(app);
      await frameServer.close();
    }
  });

  test('G4: About ウィンドウでも外部 URL への遷移と window.open が止まる', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m16t2-g4-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await page.evaluate(() => window.settings.set('lang', 'ja'));
      const aboutPage = await openAboutWindow(app, 'について');
      await installRecorder(app);
      const aboutUrl = aboutPage.mainFrame().url();
      expect(aboutUrl).toMatch(/^app:\/\/bundle\/about\.html\?/);
      await expect(aboutPage.locator('#versions')).toContainText('electron');
      const before = await windowCount(app);

      const opened = await aboutPage.evaluate((url) => window.open(url) !== null, EXTERNAL_URL);
      await settle(aboutPage);
      expect(opened).toBe(false);
      expect((await recorded(app)).createdWindows).toEqual([]);
      expect(await windowCount(app)).toBe(before);

      await aboutPage.evaluate((url) => { setTimeout(() => { location.href = url; }, 0); }, EXTERNAL_URL);
      await expect.poll(async () => (await recorded(app)).willNavigate).toContain(EXTERNAL_URL);
      await settle(aboutPage);
      expect(aboutPage.mainFrame().url()).toBe(aboutUrl);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
