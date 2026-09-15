// oct26-m4-t6: renderer の Content-Security-Policy（MaplatEditor#120）の E2E。
// 設計: oct26-m4-t6 設計書 v3（§2.1 のポリシー・§2.3 案 A＋案 B・§6 AC1/AC3/AC4/AC7）
//
//   AC1  実起動の renderer から fetch した app://bundle/index.html・about.html の応答に、設計 v3 §2.1 の CSP が付く。
//        __local の応答は sandbox の CSP と nosniff だけ（renderer CSP を重ねない）
//   AC3  起動した renderer に、インライン script・外部 https script・onerror 属性・文字列 setTimeout・blob: Worker を
//        注入しても実行されない
//   AC4  地図一覧・対応点編集（外部タイル＋下書きタイル＋保存済みタイル）・プレビュー iframe・about ウィンドウを通して
//        CSP 違反のコンソール行が 0 件。検出力は同じ収集器で既知の違反（blob: Worker）を 1 回起こし ≥1 件数えることで示す
//   AC7  保存フォルダに置いた .js/.mjs/.txt/.json/拡張子無し/大文字 .JS を <script src> で、.js/.txt を Worker で読ませても
//        実行されない。迂回形（assets/../・%2e%2e・.%2E・..%2F・..%5C・..\・旧 app://local）も実行されない。
//        R2-MIN-2: 同梱物だが assets/ 外のスクリプト（app://bundle/preview/service-worker.js）が CSP 違反で拒否される
//        （案 B の対象外なので、パス限定 CSP〔案 A〕だけで赤緑が決まる）
//
// ポリシー文字列は spec 内に逐語で置く（electron/utils/appScheme.ts を import すると、変更前の版で「変更前の値」を
// 測ってしまい変更前 FAIL を示せないため。t2ff spec と同じ理由）。
//
// 撤退時（設計 v3 §8.2 撤退条件 2）: renderer CSP を戻す commit では AC1（ヘッダ）・AC3・AC4 と、AC7 の
// 「assets/ 外の同梱スクリプトが CSP で拒否される」断言を test.skip にする（理由「renderer CSP は 11 月へ撤退・#120」）。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { openAboutWindow } from './helpers/electronMenu';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const FAKE_TILE_PATH = path.resolve(import.meta.dirname, 'fixtures/fake-osm-tile.png');

// 設計 v3 §2.1（逐語）
const RENDERER_CSP =
  "default-src 'self'; script-src app://bundle/assets/ app://bundle/about.js; style-src 'self'; img-src 'self' data: https: http:; font-src 'self'; connect-src 'self' https: http://localhost:*; worker-src app://bundle/assets/; frame-src http://localhost:*; child-src 'none'; media-src 'self'; object-src 'none'; manifest-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'";
const LOCAL_SANDBOX_CSP = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";

const encodePath = (abs: string): string => abs.split('/').map((s) => encodeURIComponent(s)).join('/');
const sameOriginLocalUrl = (abs: string): string => `app://bundle/__local${encodePath(abs)}`;

type Launched = { app: ElectronApplication; page: Page; saveFolder: string };

async function launch(e2eRoot: string): Promise<Launched> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const saveFolder: string = await page.evaluate(() => window.settings.get('saveFolder'));
  if (!path.resolve(saveFolder).startsWith(path.resolve(e2eRoot) + path.sep)) {
    throw new Error(`E2E storage isolation failed: ${saveFolder} is outside ${e2eRoot}`);
  }
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  return { app, page, saveFolder };
}

// main process で全 webContents（main window・about・非表示ウィンドウ）の CSP 違反のコンソール行を集める。
// 以後に作られる webContents も web-contents-created で拾う。
async function installCspCollector(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp, webContents }) => {
    const g = globalThis as unknown as { __t6Csp?: { url: string; msg: string }[]; __t6Hooked?: WeakSet<object> };
    g.__t6Csp = [];
    g.__t6Hooked = new WeakSet();
    const hook = (wc: Electron.WebContents) => {
      if (g.__t6Hooked!.has(wc)) return;
      g.__t6Hooked!.add(wc);
      wc.on('console-message', (e: any, ...rest: any[]) => {
        const msg = String(e?.message ?? rest[1] ?? '');
        if (/Content Security Policy/.test(msg)) {
          let url = '';
          try { url = wc.getURL(); } catch { /* destroyed */ }
          g.__t6Csp!.push({ url, msg });
        }
      });
    };
    for (const wc of webContents.getAllWebContents()) hook(wc);
    electronApp.on('web-contents-created', (_ev, wc) => hook(wc));
  });
}

async function cspLines(app: ElectronApplication): Promise<{ url: string; msg: string }[]> {
  return app.evaluate(() => ((globalThis as any).__t6Csp ?? []) as { url: string; msg: string }[]);
}

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

async function makeImage(imagePath: string, width: number, height: number): Promise<void> {
  const { Jimp } = await import('jimp');
  const img = new Jimp({ width, height, color: 0xffffffff });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (((x + y) >> 4) % 2 === 0) img.setPixelColor(0x3366ccff, x, y);
    }
  }
  await img.write(imagePath as `${string}.${string}`);
}

// t2ff spec の seedMap と同じ（400x300 画像の境界内側・strict で TIN が組める GCP）
async function seedMap(page: Page): Promise<string> {
  const toMerc = (x: number, y: number): number[] => [
    15551351.4 + (x / 400) * (15562483.3 - 15551351.4),
    4249117.8 + ((300 - y) / 300) * (4259837.2 - 4249117.8),
  ];
  const gcps = [[[50, 250], toMerc(50, 250)], [[350, 250], toMerc(350, 250)], [[350, 50], toMerc(350, 50)]];
  const slug = `oct26-m4-t6-${Date.now()}`;
  return page.evaluate(async ({ slug, gcps }) => {
    const mapObject = {
      mapID: slug, title: { ja: 'oct26-m4-t6 CSP' },
      officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: { ja: 'oct26-m4-t6 attribution' }, dataAttr: {}, description: {},
      license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
      imageExtension: 'png', width: 400, height: 300,
      gcps, edges: [] as unknown[], sub_maps: [] as unknown[],
      strictMode: 'strict', vertexMode: 'plain', status: 'New',
    };
    const r1 = await window.mapedit.save({ slug, mapObject, tins: [] });
    if (!r1 || r1.result !== 'Success') throw new Error(`seed failed: ${JSON.stringify(r1)}`);
    const tin = await window.mapedit.updateTin(mapObject.gcps, mapObject.edges, 0, [400, 300], 'strict', 'plain');
    if (!Array.isArray(tin) || !tin[1]) throw new Error(`TIN compile failed: ${JSON.stringify(tin)}`);
    const r2 = await window.mapedit.save({ slug, uid: r1.uid, mapObject, tins: [tin[1]] });
    if (!r2 || r2.result !== 'Success') throw new Error(`compiled save failed: ${JSON.stringify(r2)}`);
    return r1.uid as string;
  }, { slug, gcps });
}

test.describe('oct26-m4-t6 renderer の Content-Security-Policy', () => {
  test('AC1: 同梱 HTML の応答に設計 v3 §2.1 の CSP が付き、__local の応答には重ならない', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-oct26-m4-t6-ac1-'));
    const { app, page, saveFolder } = await launch(e2eRoot);
    try {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      await writeFile(path.join(saveFolder, 'oct26-m4-t6-tile.png'), png);
      const headers = await page.evaluate(async (localUrl) => {
        const h = async (u: string) => {
          const r = await fetch(u);
          return { status: r.status, csp: r.headers.get('content-security-policy'), ro: r.headers.get('content-security-policy-report-only'), nosniff: r.headers.get('x-content-type-options') };
        };
        return { index: await h('app://bundle/index.html'), about: await h('app://bundle/about.html'), local: await h(localUrl) };
      }, sameOriginLocalUrl(path.join(saveFolder, 'oct26-m4-t6-tile.png')));
      console.log('[AC1] headers', JSON.stringify(headers));
      expect.soft(headers.index.csp, 'index.html の応答に renderer CSP が無い／値が違う').toBe(RENDERER_CSP);
      expect.soft(headers.about.csp, 'about.html の応答に renderer CSP が無い／値が違う').toBe(RENDERER_CSP);
      expect.soft(headers.index.ro, 'Report-Only ではなく強制で付ける').toBeNull();
      expect.soft(headers.local.status).toBe(200);
      expect.soft(headers.local.csp, '__local の応答は sandbox の CSP だけ（renderer CSP を重ねない）').toBe(LOCAL_SANDBOX_CSP);
      expect.soft(headers.local.nosniff, '__local の応答に nosniff').toBe('nosniff');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC3: 注入したインライン script・外部 script・onerror・文字列 setTimeout・blob: Worker が実行されない', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-oct26-m4-t6-ac3-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 外部 script はネットワークに依存させない（CSP は要求前に拒否するので、ここへ届くのは CSP が無いときだけ）
      await page.route('https://oct26-m4-t6.invalid/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.__inj_external = 1' }));
      await page.waitForTimeout(1_000);
      const result = await page.evaluate(async () => {
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const w = window as any;
        const res: Record<string, string> = {};
        const s = document.createElement('script'); s.textContent = 'window.__inj_inline = 1'; document.body.append(s);
        const ext = document.createElement('script'); ext.src = 'https://oct26-m4-t6.invalid/x.js'; document.body.append(ext);
        const d = document.createElement('div'); d.innerHTML = '<img src="app://bundle/__oct26-m4-t6-nonexistent.png" onerror="window.__inj_onerror = 1">'; document.body.append(d);
        try { (setTimeout as any)('window.__inj_settimeout = 1', 0); } catch (e) { res.settimeoutThrow = String(e); }
        res.blobWorker = 'pending';
        try {
          const worker = new Worker(URL.createObjectURL(new Blob(['postMessage("ran")'])));
          worker.onmessage = () => { res.blobWorker = 'ran'; };
          worker.onerror = () => { res.blobWorker = 'error'; };
        } catch (e) { res.blobWorker = 'throw:' + (e as Error).name; }
        await wait(4_000);
        res.inline = w.__inj_inline === 1 ? 'ran' : 'blocked';
        res.external = w.__inj_external === 1 ? 'ran' : 'blocked';
        res.onerror = w.__inj_onerror === 1 ? 'ran' : 'blocked';
        res.settimeout = w.__inj_settimeout === 1 ? 'ran' : 'blocked';
        return res;
      });
      console.log('[AC3] inject', JSON.stringify(result));
      expect.soft(result.inline, 'インライン script が実行された').toBe('blocked');
      expect.soft(result.external, '外部 https script が実行された').toBe('blocked');
      expect.soft(result.onerror, 'onerror 属性が実行された').toBe('blocked');
      expect.soft(result.settimeout, '文字列 setTimeout が実行された').toBe('blocked');
      expect.soft(result.blobWorker, 'blob: Worker が実行された').not.toBe('ran');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC4: 地図一覧・対応点編集（外部＋下書き＋保存済みタイル）・プレビュー・about を通して CSP 違反 0（陽性対照 ≥1）', async () => {
    test.setTimeout(420_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-oct26-m4-t6-ac4-'));
    const imagePath = path.join(e2eRoot, 'csp-src.png');
    await makeImage(imagePath, 400, 300);
    const { app, page } = await launch(e2eRoot);
    try {
      await installCspCollector(app);
      // 外部タイルは fixture へ差し替える（CSP は要求前に判定するので、差し替えは検査を迂回しない）
      const fakeTile = await readFile(FAKE_TILE_PATH);
      for (const pattern of ['**/tile.openstreetmap.org/**', '**/cyberjapandata.gsi.go.jp/**', '**/t.tilemap.jp/**']) {
        await page.route(pattern, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: fakeTile }));
      }
      // 起動時の読込（index.html・chunk・Worker 生成前の初期化）も収集器の下で通す
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2_000);

      // 対応点編集: 下書きタイル（draft-tiles）＋右ペインの外部タイル
      const uid = await seedMap(page);
      await openHash(page, `#/mapedit?uid=${uid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 30_000 });
      await app.evaluate(async ({ dialog }, selected) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [selected] })) as typeof dialog.showOpenDialog;
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      }, imagePath);
      await page.getByRole('button', { name: '地図画像登録' }).click();
      const okButton = page.getByRole('button', { name: 'OK' });
      await expect(okButton).toBeEnabled({ timeout: 120_000 });
      await okButton.click();
      await expect.poll(async () => page.evaluate(() => (window as any).testDebug?.mapData?.value?.url_ ?? ''), { timeout: 30_000 })
        .toContain('draft-tiles');
      await page.getByTestId('map-tab-gcps').click();
      await page.waitForTimeout(8_000);

      // 保存 → 保存済みタイル（__local の tiles）で対応点編集を開き直す
      await page.getByTestId('editor-save').click();
      await expect.poll(async () => page.evaluate(() => (window as any).testDebug?.mapData?.value?.url_ ?? ''), { timeout: 60_000 })
        .not.toContain('draft-tiles');
      const savedUrl: string = await page.evaluate(() => (window as any).testDebug.mapData.value.url_);
      expect(savedUrl.startsWith('app://bundle/__local/'), `保存後の url_ が __local でない: ${savedUrl}`).toBe(true);

      // 地図一覧（サムネイルは __local）
      await openHash(page, '#/maplist');
      await expect(page.locator(`[data-resource-uid="${uid}"]`)).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(2_000);

      await openHash(page, `#/mapedit?uid=${uid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(2_000);
      await page.getByTestId('map-tab-gcps').click();
      await page.waitForTimeout(8_000);

      // プレビュー iframe（http://localhost の配信ページ・connect-src の JSON）
      await page.evaluate(async () => {
        const s = `oct26-m4-t6-app-${Date.now()}`;
        const saved = await window.appedit.save({ slug: s, document: {
          appID: s, appName: { ja: 'oct26-m4-t6 CSP' }, title: { ja: 'oct26-m4-t6 CSP' },
          description: {}, keywords: '', siteUrl: '', lang: 'ja',
          sources: ['osm'],
          appSettings: { homeLng: 139.76, homeLat: 35.68, defaultZoom: 14 },
          pois: [], httpSettings: {}, manifestSettings: {},
        } });
        if (!saved || saved.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(saved)}`);
      });
      await openHash(page, '#/applist');
      await expect(page.locator('[data-resource-uid]').first()).toBeVisible({ timeout: 15_000 });
      await page.locator('[data-resource-uid] a').first().click();
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 15_000 });
      await page.locator('[role="tab"]').filter({ hasText: /プレビュー/ }).click();
      await expect(page.locator('iframe.preview-map')).toBeVisible({ timeout: 30_000 });
      const frame = await (await page.locator('iframe.preview-map').elementHandle())!.contentFrame();
      expect(frame, 'preview iframe の contentFrame を取得できない').not.toBeNull();
      await frame!.waitForFunction(() => !!(window as any).__maplatPreview, undefined, { timeout: 90_000 });
      await page.waitForTimeout(3_000);

      // about ウィンドウ（about.js・about.css の外出し）
      const aboutPage = await openAboutWindow(app, 'について');
      await expect(aboutPage.locator('#versions')).toContainText('electron', { timeout: 10_000 });
      const aboutText = await aboutPage.locator('#versions').innerText();
      expect.soft(aboutText).not.toContain('Error:');
      expect.soft(await aboutPage.locator('#appVersion').innerText()).toMatch(/^Version \d/);
      // about.css が効いている（外出し後に style-src で落ちていない）
      expect.soft(await aboutPage.locator('.logo-img').evaluate((el) => getComputedStyle(el).width)).toBe('128px');
      await aboutPage.close();

      const before = await cspLines(app);
      console.log('[AC4] CSP violation lines (product flows)', before.length, JSON.stringify(before.slice(0, 10)));
      expect.soft(before, '製品の経路で CSP 違反のコンソール行が出た').toEqual([]);

      // 陽性対照: 同じ収集器で既知の違反（worker-src に反する blob: Worker）を 1 回起こし、数えられることを示す
      await page.evaluate(() => {
        try { new Worker(URL.createObjectURL(new Blob(['postMessage(1)']))); } catch { /* CSP により throw することがある */ }
      });
      await expect.poll(async () => (await cspLines(app)).length, { timeout: 10_000 }).toBeGreaterThan(before.length);
      const after = (await cspLines(app)).slice(before.length);
      console.log('[AC4] positive control lines', JSON.stringify(after));
      expect.soft(after.some((l) => /worker-src/.test(l.msg)), '陽性対照の違反が worker-src として記録されない').toBe(true);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC7: 保存フォルダ内のスクリプト（各拡張子・Worker・迂回形）が実行されず、assets/ 外の同梱スクリプトも CSP で拒否される', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-oct26-m4-t6-ac7-'));
    const { app, page, saveFolder } = await launch(e2eRoot);
    try {
      await page.waitForTimeout(1_000);
      const mark = (k: string) => `window.__t6 = (window.__t6||[]).concat(${JSON.stringify(k)});`;
      const files: Record<string, string> = { js: 'evil.js', mjs: 'evil.mjs', txt: 'evil.txt', json: 'evil.json', noext: 'evil', upperJS: 'EVIL2.JS' };
      for (const [k, f] of Object.entries(files)) await writeFile(path.join(saveFolder, f), mark(k));
      await writeFile(path.join(saveFolder, 'worker.js'), 'postMessage("worker-ran")');
      await writeFile(path.join(saveFolder, 'worker.txt'), 'postMessage("worker-ran")');
      const L = (f: string) => sameOriginLocalUrl(path.join(saveFolder, f));
      const txtAbs = encodePath(path.join(saveFolder, 'evil.txt'));
      const scripts: Record<string, string> = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, L(f)]));
      Object.assign(scripts, {
        bp_dotdot: `app://bundle/assets/../__local${txtAbs}`,
        bp_pct2e: `app://bundle/assets/%2e%2e/__local${txtAbs}`,
        bp_pct2e2: `app://bundle/assets/.%2E/__local${txtAbs}`,
        bp_pct2f: `app://bundle/assets/..%2F__local${txtAbs}`,
        bp_pct5c: `app://bundle/assets/..%5C__local${txtAbs}`,
        bp_backslash: `app://bundle/assets/..\\__local${txtAbs}`,
        bp_legacy: `app://local${txtAbs}`,
      });
      // 迂回形は bp_* の各キーで印を付けられないので、evil.txt の印（'txt'）が立つかで見る。
      // 1 本ずつ読み、読む前に印を消す。
      const run = await page.evaluate(async (urls) => {
        const res: Record<string, { event: string; ran: boolean }> = {};
        const w = window as any;
        for (const [k, u] of Object.entries(urls)) {
          w.__t6 = [];
          res[k] = await new Promise((resolve) => {
            const s = document.createElement('script');
            s.src = u;
            const done = (event: string) => resolve({ event, ran: (w.__t6 || []).length > 0 });
            s.onload = () => done('load');
            s.onerror = () => setTimeout(() => done('error'), 50);
            document.body.append(s);
            setTimeout(() => done('timeout'), 4_000);
          });
        }
        return res;
      }, scripts);
      const workers = await page.evaluate(async (urls) => {
        const res: Record<string, string> = {};
        for (const [k, u] of Object.entries(urls)) {
          res[k] = await new Promise((resolve) => {
            try {
              const wk = new Worker(u);
              wk.onmessage = (e) => resolve(String(e.data));
              wk.onerror = () => resolve('error');
              setTimeout(() => resolve('timeout'), 4_000);
            } catch (e) { resolve('throw:' + (e as Error).name); }
          });
        }
        return res;
      }, { workerJs: L('worker.js'), workerTxt: L('worker.txt') });
      console.log('[AC7] scripts', JSON.stringify(run), 'workers', JSON.stringify(workers));
      for (const [k, r] of Object.entries(run)) {
        expect.soft(r.ran, `保存フォルダ内のスクリプト（${k}: ${scripts[k].split(encodePath(saveFolder)).join('<saveFolder>')}）が実行された`).toBe(false);
      }
      for (const [k, r] of Object.entries(workers)) {
        expect.soft(r, `保存フォルダ内の Worker（${k}）が実行された`).not.toBe('worker-ran');
      }

      // R2-MIN-2: 同梱物だが assets/ 外のスクリプト。案 B（__local の 403・nosniff）の対象外なので、
      // パス限定の script-src（案 A）が外れると赤になる。実行されると preview 用のスクリプトが renderer で走るので、
      // 断言は「CSP 違反で拒否された」側だけにする。
      const nonAssets = await page.evaluate(async (u) => new Promise<{ event: string; violated: boolean; directive: string }>((resolve) => {
        let violated = false;
        let directive = '';
        const onV = (e: SecurityPolicyViolationEvent) => {
          if (e.blockedURI && u.startsWith(e.blockedURI.slice(0, 20))) { violated = true; directive = e.effectiveDirective; }
        };
        document.addEventListener('securitypolicyviolation', onV);
        const s = document.createElement('script');
        s.src = u;
        const done = (event: string) => { document.removeEventListener('securitypolicyviolation', onV); resolve({ event, violated, directive }); };
        s.onload = () => done('load');
        s.onerror = () => setTimeout(() => done('error'), 100);
        document.body.append(s);
        setTimeout(() => done('timeout'), 4_000);
      }), 'app://bundle/preview/service-worker.js');
      console.log('[AC7] bundle non-assets script', JSON.stringify(nonAssets));
      expect.soft(nonAssets.violated && nonAssets.event === 'error',
        `assets/ 外の同梱スクリプトが CSP で拒否されない（script-src のパス限定が外れている）: ${JSON.stringify(nonAssets)}`).toBe(true);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
