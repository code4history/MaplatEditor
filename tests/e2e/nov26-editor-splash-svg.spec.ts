// nov26-editor-splash-svg（#462）E2E: スプラッシュ画像に SVG を指定できる。
//
// 人間の決定:
//   - スプラッシュの元画像に SVG を指定できる（指定ダイアログの拡張子でも選べる）
//   - SNS のカード画像（og:image）は「SVG から PNG を描いて使う」
//
// 確かめること:
//   (1) スプラッシュに SVG を選ぶと、保存前に <img> で表示される（naturalWidth = SVG の幅）
//   (2) 壊れた SVG は今と同じ InvalidImage（スプラッシュの値は変わらない）
//   (3) 書き出すと zip の img/ に SVG がそのまま入り、app JSON の splash も拡張子のまま
//   (4) og:image は Chromium で描いた PNG（1200x630・背景色で余白を埋め、図柄は縦横比を保つ）
//   (5) PWA のスプラッシュ（apple-touch-startup-image）も SVG から描ける
//
// 保存ダイアログは差し替える（前例 tests/e2e/nov26-rc-editor174-pwa-export.spec.ts）。
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch, openHash, saveFolderOf, stubMessageBoxAutoOk } from './helpers/mapPackage';

const APP_ID = 'nov26-splash-svg-app';
/** 図柄の色（青）。背景色 #f6f0d3 と区別できる色を選ぶ */
const FIGURE = { r: 0, g: 0, b: 255 };
const BACKGROUND = { r: 0xf6, g: 0xf0, b: 0xd3 };
/** 4:3 の図柄（幅 400 x 高さ 300） */
const SVG_WIDTH = 400;
const SVG_HEIGHT = 300;
const SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}">
  <rect x="0" y="0" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="#0000ff"/>
</svg>
`;
const BROKEN_SVG_TEXT = '<svg width="400" height="300"><rect width="400" height="300"></svg>';

function pngInfo(data: Buffer): { width: number; height: number } {
  expect(data.subarray(1, 4).toString('latin1'), 'PNG のはず').toBe('PNG');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

const near = (a: number, b: number) => Math.abs(a - b) <= 8;

test.describe('nov26-editor-splash-svg: スプラッシュに SVG を指定する', () => {
  test('SVG のスプラッシュが保存前に表示され、書き出しの og:image が PNG になる', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-splash-svg-'));
    const svgPath = path.join(e2eRoot, 'splash.svg');
    await writeFile(svgPath, SVG_TEXT, 'utf8');
    const brokenPath = path.join(e2eRoot, 'broken.svg');
    await writeFile(brokenPath, BROKEN_SVG_TEXT, 'utf8');

    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxAutoOk(app);
      const zipPath = path.join(e2eRoot, 'splash-svg-app.zip');
      await app.evaluate(async ({ dialog }, out) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: out })) as typeof dialog.showSaveDialog;
      }, zipPath);

      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(String(err?.stack ?? err)));

      const saveFolder = await saveFolderOf(page);
      expect(saveFolder).toBeTruthy();
      // NOV26-IM-PWA-ICON-SOURCE-0481: PWA の起動画面は **アイコン元画像** から描く。
      // ここでは赤い 512 のアイコン元画像を置き、apple-splash に青（スプラッシュの図柄）が出ないことを見る
      const iconUuid = randomUUID();
      const iconRel = `pwa/${iconUuid}.png`;
      const { mkdir } = await import('node:fs/promises');
      const { Jimp } = await import('jimp');
      await mkdir(path.join(saveFolder, 'pwa'), { recursive: true });
      await new Jimp({ width: 512, height: 512, color: 0xff0000ff }).write(path.join(saveFolder, iconRel) as `${string}.png`);
      // PWA 有効のアプリを先に作る
      const appUid = await page.evaluate(async ({ slug, icon }) => {
        const uid = crypto.randomUUID();
        const r = await window.appedit.save({
          uid, slug, create: true,
          document: {
            appID: slug, appName: { ja: 'Splash SVG' }, title: { ja: 'Splash SVG' },
            description: {}, keywords: '', siteUrl: '', lang: 'ja',
            sources: [],
            startFrom: '', pois: [],
            httpSettings: { pwaManifest: true },
            appSettings: {},
            manifestSettings: { iconSource: icon, backgroundColor: '#f6f0d3' },
          },
        });
        if (!r || r.result !== 'Success') throw new Error(JSON.stringify(r));
        return uid;
      }, { slug: APP_ID, icon: iconRel });

      await openHash(page, `#/appedit?uid=${appUid}`);
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30_000 });
      const splashInput = page.getByTestId('appedit-splash-name');

      // スプラッシュの指定ダイアログを差し替える（実 main の dialog。前例 m19-t12）
      const installDialog = async (file: string) => {
        await app.evaluate(async ({ dialog }, selected) => {
          dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [selected] })) as typeof dialog.showOpenDialog;
        }, file);
      };

      const splashPreview = page.getByTestId('appedit-splash-preview');

      // (2) 壊れた SVG は InvalidImage（スプラッシュは空のまま = 表示も出ない）
      await installDialog(brokenPath);
      await page.getByTestId('appedit-splash-upload').click();
      await expect(splashPreview).toHaveCount(0);
      await expect(splashInput).toHaveValue('');

      // (1) SVG を選ぶと保存前に表示される（保存前 = まだ apps テーブルへ書いていない）
      await installDialog(svgPath);
      await page.getByTestId('appedit-splash-upload').click();
      await expect(splashPreview).toBeVisible({ timeout: 30_000 });
      await expect(splashPreview).toHaveAttribute('src', /\.svg$/);
      await expect.poll(() => splashPreview.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(SVG_WIDTH);
      const splashName = await splashInput.inputValue();
      expect(splashName).toMatch(/^[0-9a-f-]{36}\.svg$/);
      // 保存前でも img/ に実体がある（書き出しの複製元）
      const savedSvg = await readFile(path.join(saveFolder, 'img', splashName), 'utf8');
      expect(savedSvg).toBe(SVG_TEXT);

      // 書き出しは DB の文書から読む（exportSavedApp）ので、まず保存する
      await page.getByTestId('editor-save').click();
      await expect.poll(
        () => page.evaluate(async (uid) => (await window.appedit.request(uid))?.appSettings?.splash, appUid),
        { timeout: 60_000 },
      ).toBe(splashName);

      // (3)(4)(5) 書き出す
      await page.locator('[data-editor-action="export"]').click();
      await expect(page.getByTestId('app-export-options')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('app-export-options-confirm').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 240_000 });
      for (let i = 0; i < 5; i++) {
        const modal = page.locator('.modal.d-block');
        if (await modal.count() === 0) break;
        const ok = modal.locator('button', { hasText: 'OK' }).first();
        if (await ok.count() === 0) break;
        await ok.click({ timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(300);
      }

      const { default: AdmZip } = await import('adm-zip');
      const zip = new AdmZip(zipPath);
      const entries = new Map(zip.getEntries().filter((e) => !e.isDirectory).map((e) => [e.entryName, e]));

      // (3) img/ に SVG がそのまま入り、app JSON の splash も拡張子のまま
      const splashEntry = entries.get(`img/${APP_ID}_splash.svg`);
      expect(splashEntry, 'img/ に SVG のスプラッシュが無い').toBeTruthy();
      expect((zip.readFile(splashEntry!) as Buffer).toString('utf8')).toBe(SVG_TEXT);
      const appJson = JSON.parse((zip.readFile(entries.get(`apps/${APP_ID}.json`)!) as Buffer).toString('utf8'));
      expect(appJson.splash).toBe(`${APP_ID}_splash.svg`);

      // (4) og:image は PNG（1200x630）。背景色で余白を埋め、図柄は 4:3 を保って中央
      const ogEntry = entries.get(`img/${APP_ID}_og.png`);
      expect(ogEntry, 'og:image の PNG が zip に無い').toBeTruthy();
      const og = zip.readFile(ogEntry!) as Buffer;
      const ogInfo = pngInfo(og);
      expect([ogInfo.width, ogInfo.height]).toEqual([1200, 630]);
      const indexHtml = (zip.readFile(entries.get('index.html')!) as Buffer).toString('utf8');
      expect(indexHtml).toContain(`<meta property="og:image" content="img/${APP_ID}_og.png">`);
      {
        const { Jimp, intToRGBA } = await import('jimp');
        const image = await Jimp.read(og);
        const at = (x: number, y: number) => intToRGBA(image.getPixelColor(x, y));
        for (const [x, y] of [[0, 0], [1199, 0], [0, 629], [1199, 629]]) {
          const px = at(x, y);
          expect([near(px.r, BACKGROUND.r), near(px.g, BACKGROUND.g), near(px.b, BACKGROUND.b)],
            `余白は背景色のはず (${x},${y}): ${JSON.stringify(px)}`).toEqual([true, true, true]);
        }
        const center = at(600, 315);
        expect([near(center.r, FIGURE.r), near(center.g, FIGURE.g), near(center.b, FIGURE.b)],
          `中央は図柄の色のはず: ${JSON.stringify(center)}`).toEqual([true, true, true]);
        // 4:3 を保って contain: 全高 630 に対して幅 630 * 4/3 = 840
        let left = -1;
        let right = -1;
        const mid = 315;
        for (let x = 0; x < 1200; x++) {
          const px = at(x, mid);
          const figure = near(px.r, FIGURE.r) && near(px.b, FIGURE.b);
          if (figure && left < 0) left = x;
          if (figure) right = x;
        }
        expect(Math.abs(right - left + 1 - 840)).toBeLessThanOrEqual(2);
      }

      // (5) PWA の起動画面はアイコン元画像（赤）から描く（スプラッシュの図柄（青）ではない）
      const pwaEntries = [...entries.keys()].filter((name) => name.startsWith(`pwa/${APP_ID}/`) && name.endsWith('.png'));
      expect(pwaEntries.length).toBe(54);
      {
        const name = `pwa/${APP_ID}/apple-splash-1320-2868.png`;
        const info = pngInfo(zip.readFile(entries.get(name)!) as Buffer);
        expect([info.width, info.height]).toEqual([1320, 2868]);
        const { Jimp, intToRGBA } = await import('jimp');
        const image = await Jimp.read(zip.readFile(entries.get(name)!) as Buffer);
        const corner = intToRGBA(image.getPixelColor(0, 0));
        expect([near(corner.r, BACKGROUND.r), near(corner.g, BACKGROUND.g), near(corner.b, BACKGROUND.b)],
          `PWA スプラッシュの四隅は背景色のはず: ${JSON.stringify(corner)}`).toEqual([true, true, true]);
        const center = intToRGBA(image.getPixelColor(660, 1434));
        expect([near(center.r, 255), near(center.g, 0), near(center.b, 0)],
          `PWA スプラッシュの中央はアイコン元画像の色（赤）のはず: ${JSON.stringify(center)}`).toEqual([true, true, true]);
      }

      expect(pageErrors).toEqual([]);
    } finally {
      await quitElectronApplication(app);
    }
  });
});

test.describe('nov26-editor-splash-svg: og:image を描けないとき', () => {
  test('og:image を付けず、警告を 1 件だけ積む', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-splash-svg-missing-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const zipPath = path.join(e2eRoot, 'missing-svg-app.zip');
      await app.evaluate(async ({ dialog }, out) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: out })) as typeof dialog.showSaveDialog;
        // 書き出し結果の警告（detail）を読めるように、自動 OK しつつ控える
        const g = globalThis as unknown as { __splashSvgMessages?: { message?: string; detail?: string }[] };
        g.__splashSvgMessages = [];
        dialog.showMessageBox = (async (_winOrOptions: unknown, maybeOptions?: unknown) => {
          const options = (maybeOptions ?? _winOrOptions) as { message?: string; detail?: string };
          g.__splashSvgMessages!.push({ message: options?.message, detail: options?.detail });
          return { response: 0, checkboxChecked: false };
        }) as typeof dialog.showMessageBox;
      }, zipPath);

      // 実体の無い SVG のスプラッシュ（描画に失敗する）
      const appUid = await page.evaluate(async (slug) => {
        const uid = crypto.randomUUID();
        const r = await window.appedit.save({
          uid, slug, create: true,
          document: {
            appID: slug, appName: { ja: 'Splash SVG missing' }, title: { ja: 'Splash SVG missing' },
            description: {}, keywords: '', siteUrl: '', lang: 'ja',
            sources: [],
            startFrom: '', pois: [],
            httpSettings: { pwaManifest: false },
            appSettings: { splash: `${crypto.randomUUID()}.svg` },
            manifestSettings: {},
          },
        });
        if (!r || r.result !== 'Success') throw new Error(JSON.stringify(r));
        return uid;
      }, 'nov26-splash-svg-missing');

      await openHash(page, `#/appedit?uid=${appUid}`);
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30_000 });
      await page.locator('[data-editor-action="export"]').click();
      await expect(page.getByTestId('app-export-options')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('app-export-options-confirm').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 120_000 });
      for (let i = 0; i < 5; i++) {
        const modal = page.locator('.modal.d-block');
        if (await modal.count() === 0) break;
        const ok = modal.locator('button', { hasText: 'OK' }).first();
        if (await ok.count() === 0) break;
        await ok.click({ timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(300);
      }

      const { default: AdmZip } = await import('adm-zip');
      const zip = new AdmZip(zipPath);
      const indexHtml = (zip.readFile('index.html') ?? Buffer.from('')).toString('utf8');
      expect(indexHtml).not.toContain('og:image');
      const pngEntries = zip.getEntries().filter((e) => /_og\.png$/.test(e.entryName));
      expect(pngEntries, 'og:image の PNG を残さない').toEqual([]);

      const messages = await app.evaluate(async () => {
        const g = globalThis as unknown as { __splashSvgMessages?: { message?: string; detail?: string }[] };
        return g.__splashSvgMessages ?? [];
      });
      const ogWarnings = messages
        .flatMap((m) => String(m.detail ?? '').split('\n'))
        .filter((line) => line.includes('og:image'));
      // 【NOV26-IR-EDITOR-SPLASH-SVG-0464 MINOR-4】スプラッシュの実体が無いときは「スプラッシュ画像が見つかりませんでした」
      // の 1 件だけにし、og:image の警告を重ねない（原因 1 つに警告 1 件）
      expect(ogWarnings.length, `og:image の警告は重ねない: ${JSON.stringify(messages)}`).toBe(0);
      const missingSplash = messages
        .flatMap((m) => String(m.detail ?? '').split('\n'))
        .filter((line) => line.includes('スプラッシュ画像が見つかりませんでした'));
      expect(missingSplash.length, 'スプラッシュの欠落の警告は 1 件').toBe(1);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
