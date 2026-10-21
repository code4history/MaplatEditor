// nov26-rc-editor174（#174）: PWA の画像を **Electron 自身の Chromium** で描く（AC9）。
//
//   (a) PWA 有効のアプリを実 UI から書き出すと、zip にアイコン 8・スプラッシュ 46 が
//       正しい名前・寸法・不透明で入る（基準 = scripts/fixtures/nov26-rc-editor174-pwa-baseline.json）
//   (b) その書き出しの間に **Chrome を起動しない**（main の child_process を横取りして、
//       chrome / chromium の起動が 0 件であることを見る）
//   (c) main の console.error が出ない
//
// 保存ダイアログは差し替える（前例 tests/e2e/nov26-m6-t8-export-options.spec.ts）。
import { expect, test } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch, openHash, saveFolderOf, stubMessageBoxAutoOk } from './helpers/mapPackage';

const APP_ID = 'nov26-rc-editor174-app';
const BASELINE = path.resolve(import.meta.dirname, '../../scripts/fixtures/nov26-rc-editor174-pwa-baseline.json');

type Baseline = {
  appIdPlaceholder: string;
  icons: { path: string; width: number; height: number }[];
  splash: { path: string; width: number; height: number }[];
};

/** PNG の IHDR から寸法と色型を読む。 */
function pngInfo(data: Buffer): { width: number; height: number; colorType: number } {
  expect(data.subarray(1, 4).toString('latin1'), 'PNG のはず').toBe('PNG');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), colorType: data[25] };
}

test.describe('nov26-rc-editor174: PWA 画像を Electron の Chromium で描く', () => {
  test('(a)(b)(c) 54 枚が正しい名前・寸法・不透明で入り、Chrome を起動しない', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-editor174-pwa-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxAutoOk(app);
      const zipPath = path.join(e2eRoot, 'pwa-app.zip');
      await app.evaluate(async ({ dialog }, out) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: out })) as typeof dialog.showSaveDialog;
      }, zipPath);

      const pageErrors: string[] = [];
      const mainErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(String(err?.stack ?? err)));
      app.on('console', (msg) => { if (msg.type() === 'error') mainErrors.push(msg.text()); });

      // PWA 有効のアプリを作る（アイコン・スプラッシュは既定の同梱 SVG 経路）
      const saveFolder = await saveFolderOf(page);
      expect(saveFolder).toBeTruthy();
      const appUid = await page.evaluate(async (slug) => {
        const uid = crypto.randomUUID();
        const r = await window.appedit.save({
          uid, slug, create: true,
          document: {
            appID: slug, appName: { ja: 'Editor174 PWA' }, title: { ja: 'Editor174 PWA' },
            description: {}, keywords: '', siteUrl: '', lang: 'ja',
            sources: [],
            startFrom: '', pois: [],
            httpSettings: { pwaManifest: true },
            appSettings: {},
            manifestSettings: { backgroundColor: '#f6f0d3' },
          },
        });
        if (!r || r.result !== 'Success') throw new Error(JSON.stringify(r));
        return uid;
      }, APP_ID);

      // Chrome 起動の見張りを main に入れる。main は ESM なので dynamic import は使えず、
      // Node の組み込みモジュールは process.getBuiltinModule で取る（CJS の実体を横取りする）
      const spyInstalled = await app.evaluate(() => {
        const cp = (process as unknown as {
          getBuiltinModule: (id: string) => Record<string, unknown>;
        }).getBuiltinModule('node:child_process');
        const g = globalThis as unknown as { __editor174CpCalls?: string[] };
        g.__editor174CpCalls = [];
        let patched = 0;
        for (const name of ['spawn', 'exec', 'execFile', 'execSync', 'spawnSync', 'fork']) {
          const original = cp[name] as (...a: unknown[]) => unknown;
          if (typeof original !== 'function') continue;
          patched += 1;
          cp[name] = (...args: unknown[]) => {
            g.__editor174CpCalls!.push(`${name}:${String(args[0])}`);
            return original.apply(cp, args);
          };
        }
        return patched;
      });
      expect(spyInstalled).toBeGreaterThan(0);

      // 実 UI から書き出す
      await openHash(page, `#/appedit?uid=${appUid}`);
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30000 });
      await page.locator('[data-editor-action="export"]').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 180000 });
      for (let i = 0; i < 5; i++) {
        const modal = page.locator('.modal.d-block');
        if (await modal.count() === 0) break;
        const ok = modal.locator('button', { hasText: 'OK' }).first();
        if (await ok.count() === 0) break;
        await ok.click({ timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(300);
      }

      // (b) Chrome を起動していない
      const cpCalls = await app.evaluate(async () => {
        const g = globalThis as unknown as { __editor174CpCalls?: string[] };
        return g.__editor174CpCalls ?? [];
      });
      expect(cpCalls.filter((c) => /chrome|chromium/i.test(c)), 'Chrome の起動が 0 件').toEqual([]);

      // (a) zip の中身
      const baseline = JSON.parse(await readFile(BASELINE, 'utf8')) as Baseline;
      const { default: AdmZip } = await import('adm-zip');
      const zip = new AdmZip(zipPath);
      const entries = new Map(zip.getEntries().filter((e) => !e.isDirectory).map((e) => [e.entryName, e]));
      expect([...entries.keys()].filter((n) => n.startsWith(`pwa/${APP_ID}/`)).length).toBe(54);

      const sampleAlpha: string[] = [];
      for (const spec of [...baseline.icons, ...baseline.splash]) {
        const entryName = spec.path.split(`pwa/${baseline.appIdPlaceholder}`).join(`pwa/${APP_ID}`);
        const entry = entries.get(entryName);
        expect(entry, `${entryName} が zip に無い`).toBeTruthy();
        const info = pngInfo(zip.readFile(entry!) as Buffer);
        expect([entryName, info.width, info.height]).toEqual([entryName, spec.width, spec.height]);
        // 不透明: RGBA を選んでいる場合もアルファを持たない（背景色で塗り潰すため）
        expect([2, 6]).toContain(info.colorType);
        sampleAlpha.push(entryName);
      }
      // 代表 3 枚は実際に画素を読んでアルファ 255 を確かめる（不透明の実証）
      for (const name of ['apple-icon-180.png', 'manifest-icon-512.maskable.png', 'apple-splash-2868-1320.png']) {
        const entry = entries.get(`pwa/${APP_ID}/${name}`)!;
        const { Jimp } = await import('jimp');
        const image = await Jimp.read(zip.readFile(entry) as Buffer);
        const W = image.bitmap.width;
        const H = image.bitmap.height;
        for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1], [W >> 1, H >> 1]]) {
          expect(image.bitmap.data[(y * W + x) * 4 + 3], `${name} のアルファ (${x},${y})`).toBe(255);
        }
      }
      expect(sampleAlpha.length).toBe(54);

      // (c) 例外が出ない（見張りが空振りしていないことも確かめる）
      await app.evaluate(() => { console.error('editor174-probe'); });
      await expect.poll(() => mainErrors.includes('editor174-probe'), { timeout: 10000 }).toBe(true);
      mainErrors.length = 0;
      expect(pageErrors, 'renderer に例外が出ない').toEqual([]);
      expect(mainErrors, 'main に console.error が出ない').toEqual([]);
      console.log('  (a)(b)(c): PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
