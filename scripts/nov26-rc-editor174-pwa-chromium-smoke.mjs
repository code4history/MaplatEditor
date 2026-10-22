// nov26-rc-editor174（code4history/MaplatEditor#174）スモーク（実 Electron）:
// PWA 画像（アイコン 8・スプラッシュ 46）を **Electron 自身の Chromium** で描く実装を、
// 実際の書き出し経路（AppExportService.exportApp）で検証する。
//
// 固定する受け入れ条件（設計書 v3 §8）:
//   AC1   8 + 46 ファイルが正しい寸法で作られ、warnings に appedit.export.pwa_fallback が入らない
//   AC2   manifest の icons が基準と完全一致
//   AC3   index.html の htmlMeta 4 グループが基準と完全一致（startup-image 46 行）
//   AC4   favicon.ico が 196x196 PNG を包んだ ICO
//   AC5   幾何 = 背景塗り＋余白 10%（W 基準）＋ contain 中央寄せ
//   AC12  54 枚の所要を元画像 512px と 4000px で記録（閾値では落とさない）
//   AC13  スプラッシュ画像が無くても PWA の 54 枚はアイコン元画像からそろう（missing_splash は 1 件）
//   AC14  描画後に非表示ウィンドウが残らない
//   AC15  apple-splash はアイコン元画像から描く（スプラッシュ画像の色が出ない）
//   AC16  退避経路（jimp）でも favicon・mstile を作る（NOV26-IM-PWA-ICON-SOURCE-0481）
//
// 起動方式は scripts/m1-electron-storage-adapter-smoke.mjs と同じ（vite で SSR ビルドし、
// electron バイナリで実行する）。Electron が無い環境では SKIP する。
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { build } from 'vite';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const baselinePath = path.join(projectRoot, 'scripts/fixtures/nov26-rc-editor174-pwa-baseline.json');

let electronBin = null;
try {
  electronBin = require('electron');
} catch {
  electronBin = null;
}
if (typeof electronBin !== 'string') {
  console.log('nov26-rc-editor174 pwa chromium smoke skipped: electron バイナリが見つからない');
  process.exit(0);
}

await mkdir(path.join(projectRoot, '.tmp-smoke'), { recursive: true });
const workDir = await mkdtemp(path.join(projectRoot, '.tmp-smoke', 'rc-editor174-pwa-chromium-'));
const entryFile = path.join(workDir, 'entry.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'entry.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  const exportRoot = path.join(workDir, 'export-out');
  const timingRoot = path.join(workDir, 'timing');
  for (const dir of [dataDir, exportRoot, timingRoot, path.join(workDir, 'userData')]) {
    await mkdir(dir, { recursive: true });
  }
  const p = (rel) => JSON.stringify(path.join(projectRoot, rel));

  // electron-store は実物をそのまま使えるが、書き込み先を汚さないよう最小の代替を置く
  await writeFile(
    electronStoreStubFile,
    `
      export default class Store<T extends Record<string, any>> {
        store: T;
        constructor(options: { defaults?: T } = {}) {
          this.store = { ...(options.defaults || {}) } as T;
        }
        get(key: string) { return this.store[key]; }
        set(key: string, value: any) { this.store[key as keyof T] = value; }
        has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
      }
    `
  );

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';
      import { readFile, writeFile, mkdir, readdir, mkdtemp } from 'node:fs/promises';
      import nodePath from 'node:path';
      import { app, dialog, BrowserWindow } from 'electron';
      import { Jimp, intToRGBA } from 'jimp';

      const timeout = setTimeout(() => { console.error('NOV26-RC-EDITOR174 pwa chromium smoke timed out'); app.exit(1); }, 600000);
      const workDir = ${JSON.stringify(workDir)};
      const dataDir = ${JSON.stringify(dataDir)};
      const exportRoot = ${JSON.stringify(exportRoot)};
      const timingRoot = ${JSON.stringify(timingRoot)};

      // 注意: app.setPath('userData', ...) を ready 前に呼ぶと、この環境では ready が来なくなる。
      // 書き込み先の隔離は起動引数 --user-data-dir で行う（spawn 側）。
      process.env.APP_ROOT = ${JSON.stringify(projectRoot)};

      let zipSeq = 0;
      // 描画用ウィンドウを壊したときに「全部のウィンドウが閉じた」でアプリが終わらないようにする
      // （本番の main.ts は 'window-all-closed' を購読して macOS では終了しない）
      app.on('window-all-closed', () => {});
      console.log('[smoke] entry loaded');
      // 注意: ESM の main で app.whenReady() を top-level await で待つと、Electron が main の
      // 評価完了を待ってから ready を発火するため互いに待ち合って止まる。ready の後に本体を走らせる。
      async function main() {
      try {
        console.log('[smoke] app ready');
        dialog.showSaveDialog = (async () => {
          zipSeq += 1;
          return { canceled: false, filePath: nodePath.join(exportRoot, 'export-' + zipSeq + '.zip') };
        }) as any;
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as any;

        const { default: SettingsService } = await import(${p('electron/services/SettingsService.ts')});
        SettingsService.set('saveFolder', dataDir);
        SettingsService.set('tmpFolder', nodePath.join(workDir, 'tmp'));
        const { default: AppExportService } = await import(${p('electron/services/AppExportService.ts')});
        console.log('[smoke] modules loaded');
        const renderer = await import(${p('electron/utils/pwaChromiumRenderer.ts')});

        const baseline = JSON.parse(await readFile(${JSON.stringify(baselinePath)}, 'utf8'));
        const APP_ID = 'pwa_assets_app';
        const withAppId = (value: any) =>
          JSON.parse(JSON.stringify(value).split('pwa/' + baseline.appIdPlaceholder).join('pwa/' + APP_ID));
        const BACKGROUND = '#f6f0d3';
        const ICON_COLOR = 0xff0000ff;
        const SPLASH_COLOR = 0x0000ffff;

        await mkdir(nodePath.join(dataDir, 'img'), { recursive: true });
        await (new Jimp({ width: 512, height: 512, color: ICON_COLOR })).write(nodePath.join(dataDir, 'icon.png'));
        await (new Jimp({ width: 600, height: 1200, color: SPLASH_COLOR })).write(nodePath.join(dataDir, 'img', 'splash.png'));

        const fakeWin = { webContents: { send() {} } };
        const makeDoc = (overrides: any = {}) => ({
          appID: APP_ID,
          title: { ja: 'PWAアセット検証' },
          lang: 'ja',
          sources: [],
          httpSettings: { pwaManifest: true },
          appSettings: { splash: 'splash.png' },
          manifestSettings: { iconSource: 'icon.png', backgroundColor: BACKGROUND },
          ...overrides,
        });

        async function pngInfo(file: string) {
          const data = await readFile(file);
          assert.ok(data.subarray(1, 4).toString('latin1') === 'PNG', file + ' は PNG のはず');
          return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), colorType: data[25], data };
        }

        const { default: AdmZip } = await import('adm-zip');
        async function extract(zipPath: string) {
          zipSeq += 1;
          const dir = nodePath.join(exportRoot, 'extract-' + zipSeq);
          new AdmZip(zipPath).extractAllTo(dir, true);
          return dir;
        }

        const windowCountAfterRender = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length;
        const baseWindowCount = BrowserWindow.getAllWindows().length;

        // ===== 主経路: アイコン PNG + スプラッシュ PNG、PWA 有効 =====
        const started = Date.now();
        const main = await AppExportService.exportApp(fakeWin as any, makeDoc());
        const exportMs = Date.now() - started;
        assert.equal(main.result, 'Success', 'AC1: 書き出しは Success のはず: ' + JSON.stringify(main).slice(0, 300));
        assert.ok(!main.warnings.includes('appedit.export.pwa_fallback'),
          'AC1: pwa_fallback 警告が入ってはいけない: ' + JSON.stringify(main.warnings));
        assert.equal(windowCountAfterRender(), baseWindowCount,
          'AC14: 描画用の非表示ウィンドウが残ってはいけない');
        const mainDir = await extract(String(main.outDir));
        const pwaDir = nodePath.join(mainDir, 'pwa', APP_ID);
        const pwaFiles = (await readdir(pwaDir)).sort();
        assert.equal(pwaFiles.length, 8 + 46, 'AC1: pwa/ 直下は 8 + 46 = 54 ファイルのはず: ' + pwaFiles.length);

        const hexToRgb = (hex: string) => ({
          r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16),
        });
        const bg = hexToRgb(BACKGROUND);
        const isBg = (p: any) => Math.abs(p.r - bg.r) <= 2 && Math.abs(p.g - bg.g) <= 2 && Math.abs(p.b - bg.b) <= 2;

        // AC1: 全ての名前・寸法・不透明
        for (const spec of [...baseline.icons, ...baseline.splash]) {
          const relPath = spec.path.split('pwa/' + baseline.appIdPlaceholder).join('pwa/' + APP_ID);
          const file = nodePath.join(mainDir, relPath.split('/').join(nodePath.sep));
          const info = await pngInfo(file);
          assert.equal(info.width, spec.width, spec.path + ' の幅が基準と違う');
          assert.equal(info.height, spec.height, spec.path + ' の高さが基準と違う');
          assert.ok(info.colorType === 2 || info.colorType === 6, 'AC1: PNG の色型は RGB/RGBA のはず: ' + spec.path);
        }
        // 不透明（アルファ 255）: 代表的な 6 枚で画素を抜き取りで見る
        for (const name of ['apple-icon-180.png', 'manifest-icon-512.maskable.png', 'favicon-196.png',
                            'mstile-icon-558-270.png', 'apple-splash-1320-2868.png', 'apple-splash-2868-1320.png']) {
          const image = await Jimp.read(nodePath.join(pwaDir, name));
          const W = image.bitmap.width;
          const H = image.bitmap.height;
          for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1], [W >> 1, H >> 1]]) {
            const px = intToRGBA(image.getPixelColor(x, y));
            assert.equal(px.a, 255, 'AC1: ' + name + ' の画素は不透明のはず (' + x + ',' + y + ')');
          }
        }
        console.log('ok AC1: アイコン 8 + スプラッシュ 46 が実在し、寸法・不透明が基準と一致（warnings に pwa_fallback なし）');
        console.log('[timing] exportApp(pwa) total=' + exportMs + 'ms');

        // AC2: manifest の icons が基準と完全一致
        const manifest = JSON.parse(await readFile(nodePath.join(mainDir, 'pwa', APP_ID + '_manifest.json'), 'utf8'));
        assert.deepEqual(manifest.icons, withAppId(baseline.manifestIcons), 'AC2: manifest の icons が基準と一致しない');
        console.log('ok AC2: manifest の icons は基準（ライブラリ関数の出力）と完全一致');

        // AC3: index.html の 4 グループが基準と同じ文字列
        const indexHtml = await readFile(nodePath.join(mainDir, 'index.html'), 'utf8');
        const expectedMeta = withAppId(baseline.htmlMeta);
        for (const key of ['favicon', 'appleTouchIcon', 'msTileImage', 'appleLaunchImage']) {
          const value: string = expectedMeta[key];
          assert.ok(typeof value === 'string' && value.length > 0, 'AC3: 基準に ' + key + ' があるはず');
          for (const line of value.split('\\n').filter((l: string) => l.trim())) {
            assert.ok(indexHtml.includes(line.trim()), 'AC3: index.html に ' + key + ' の行が無い: ' + line.trim());
          }
        }
        assert.equal((indexHtml.match(/rel="apple-touch-startup-image"/g) || []).length, 46,
          'AC3: index.html の apple-touch-startup-image は 46 行のはず');
        console.log('ok AC3: index.html の htmlMeta 4 グループは基準と同一（startup-image 46 行）');

        // AC4: favicon.ico = 196x196 PNG を包んだ ICO
        const ico = await readFile(nodePath.join(mainDir, 'favicon.ico'));
        assert.equal(ico.readUInt16LE(0), 0, 'AC4: ICO の reserved は 0');
        assert.equal(ico.readUInt16LE(2), 1, 'AC4: ICO の type は 1');
        assert.ok(ico.readUInt16LE(4) >= 1, 'AC4: ICO に画像が 1 枚以上');
        assert.equal(ico[6], 196 % 256, 'AC4: ICO の幅は 196');
        const icoOffset = ico.readUInt32LE(18);
        assert.ok(ico.subarray(icoOffset, icoOffset + 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
          'AC4: ICO に包まれた画像は PNG のはず');
        assert.equal(ico.readUInt32BE(icoOffset + 16), 196, 'AC4: 内包 PNG の幅は 196');
        console.log('ok AC4: favicon.ico は 196x196 PNG を包んだ ICO');

        // AC5: 幾何 = 背景塗り＋余白 10%（W 基準）＋ contain 中央寄せ
        {
          const icon = await Jimp.read(nodePath.join(pwaDir, 'apple-icon-180.png'));
          const W = icon.bitmap.width;
          const at = (x: number, y: number) => intToRGBA(icon.getPixelColor(x, y));
          for (const [x, y] of [[0, 0], [W - 1, 0], [0, W - 1], [W - 1, W - 1]]) {
            assert.ok(isBg(at(x, y)), 'AC5: 四隅は背景色のはず (' + x + ',' + y + '): ' + JSON.stringify(at(x, y)));
          }
          const center = at(W >> 1, W >> 1);
          assert.ok(center.r > 200 && center.g < 60, 'AC5: 中央は元画像色（赤）のはず: ' + JSON.stringify(center));
          const mid = Math.floor(W / 2);
          let left = -1;
          let right = -1;
          for (let x = 0; x < W; x++) {
            const red = at(x, mid).g < 120;
            if (red && left < 0) left = x;
            if (red) right = x;
          }
          const figureWidth = right - left + 1;
          assert.ok(Math.abs(figureWidth - Math.round(0.8 * W)) <= 1,
            'AC5: 図柄の幅は round(0.8W)±1 のはず: 実測 ' + figureWidth);
          assert.ok(isBg(at(mid, Math.round(0.1 * W) - 2)), 'AC5: 上余白は背景色のはず');
        }
        {
          const name = 'apple-splash-640-1136.png';
          const splash = await Jimp.read(nodePath.join(pwaDir, name));
          const W = splash.bitmap.width;
          const at = (x: number, y: number) => intToRGBA(splash.getPixelColor(x, y));
          assert.ok(isBg(at(0, 0)), 'AC5: スプラッシュの四隅は背景色のはず');
          // AC15: apple-splash は**アイコン元画像**から描く（スプラッシュ画像の青が出ない）
          const center = at(Math.floor(W / 2), Math.floor(1136 / 2));
          assert.ok(center.r > 200 && center.b < 60,
            'AC15: apple-splash の中央はアイコン元画像の色（赤）のはず: ' + JSON.stringify(center));
          // 余白は W 基準の 10%: 640 の 10% = 64。四角いアイコンは 512x512 で中央寄せ
          let left = -1;
          let right = -1;
          const mid = 568;
          for (let x = 0; x < W; x++) {
            const red = at(x, mid).b < 120;
            if (red && left < 0) left = x;
            if (red) right = x;
          }
          assert.ok(Math.abs(right - left + 1 - 512) <= 1,
            'AC5: 図柄の幅は 512（640 - 2*64）のはず: 実測 ' + (right - left + 1));
        }
        console.log('ok AC5: 幾何は背景塗り＋パディング 10%（W 基準）＋ contain 中央寄せ');

        // ===== AC13/AC15: スプラッシュ画像が無くても、PWA の 54 枚はアイコン元画像からそろう =====
        {
          const substituted = await AppExportService.exportApp(fakeWin as any, makeDoc({
            appSettings: { splash: 'missing.png' },
          }));
          assert.equal(substituted.result, 'Success', 'AC13: スプラッシュが無くても書き出しは成功するはず');
          assert.equal(substituted.warnings.filter((k: string) => k === 'appedit.export.missing_splash').length, 1,
            'AC13: 無いスプラッシュは missing_splash 警告を 1 件積むはず: ' + JSON.stringify(substituted.warnings));
          assert.ok(!substituted.warnings.includes('appedit.export.pwa_fallback'),
            'AC13: PWA の描画は退避に落ちないはず: ' + JSON.stringify(substituted.warnings));
          assert.equal(windowCountAfterRender(), baseWindowCount, 'AC14: スプラッシュ無しでもウィンドウが残らないはず');
          const substitutedDir = await extract(String(substituted.outDir));
          const files = (await readdir(nodePath.join(substitutedDir, 'pwa', APP_ID))).filter((f: string) => f.endsWith('.png'));
          assert.equal(files.length, 54, 'AC13: スプラッシュが無くても 54 枚そろうはず: ' + files.length);
          // AC15: スプラッシュ画像の代わりにアイコン元画像（赤）で描けている
          const splash = await Jimp.read(nodePath.join(substitutedDir, 'pwa', APP_ID, 'apple-splash-640-1136.png'));
          const center = intToRGBA(splash.getPixelColor(320, 568));
          assert.ok(center.r > 200 && center.b < 60,
            'AC15: apple-splash の中央はアイコン元画像の色（赤）のはず: ' + JSON.stringify(center));
        }
        {
          // 同梱の既定 SVG 経路（iconSource 未指定）: Chromium が SVG をそのまま描く
          const doc = makeDoc();
          delete doc.manifestSettings.iconSource;
          const defaultIcon = await AppExportService.exportApp(fakeWin as any, doc);
          assert.equal(defaultIcon.result, 'Success', '既定アイコン経路の書き出しは成功するはず');
          assert.ok(!defaultIcon.warnings.includes('appedit.export.pwa_fallback'),
            '既定アイコン経路で pwa_fallback に落ちてはいけない: ' + JSON.stringify(defaultIcon.warnings));
          const dir = await extract(String(defaultIcon.outDir));
          const iconFiles = (await readdir(nodePath.join(dir, 'pwa', APP_ID))).filter((f: string) => f.endsWith('.png'));
          assert.equal(iconFiles.length, 54, '既定 SVG 経路でも 54 枚そろうはず: ' + iconFiles.length);
          const svgIcon = await Jimp.read(nodePath.join(dir, 'pwa', APP_ID, 'apple-icon-180.png'));
          const corner = intToRGBA(svgIcon.getPixelColor(0, 0));
          assert.ok(isBg(corner), '既定 SVG 経路でも四隅は背景色のはず: ' + JSON.stringify(corner));
        }
        console.log('ok AC13: スプラッシュが無くてもアイコン元画像から 54 枚そろう（既定 SVG 経路も同じ）');

        // ===== AC16: 退避経路（jimp）でも favicon・mstile を作る =====
        {
          const dest = nodePath.join(timingRoot, 'fallback-png');
          const fallback = await (AppExportService as any).generateFallbackIcons(
            nodePath.join(dataDir, 'icon.png'), dest, APP_ID,
          );
          const names = (await readdir(dest)).sort();
          const expected = [
            'apple-icon-180.png',
            'favicon-196.png',
            'manifest-icon-192.maskable.png',
            'manifest-icon-512.maskable.png',
            'mstile-icon-128.png',
            'mstile-icon-270.png',
            'mstile-icon-558-270.png',
            'mstile-icon-558.png',
          ];
          for (const name of expected) {
            assert.ok(names.includes(name), 'AC16: 退避経路でも ' + name + ' を作るはず: ' + JSON.stringify(names));
          }
          assert.equal(fallback.icons.length, 4, 'AC16: manifest の icons は 192/512 x any/maskable');
          assert.match(fallback.htmlMeta.favicon, /favicon-196\.png/, 'AC16: favicon の htmlMeta が favicon を指すはず');
          assert.match(fallback.htmlMeta.msTileImage, /mstile-icon-558-270\.png/, 'AC16: mstile の htmlMeta を作るはず');
          // 縦横比を保つ（558x270 に四角い画像を引き伸ばさない）: 中央の行の図柄幅は 270（高さいっぱい）
          const wide = await Jimp.read(nodePath.join(dest, 'mstile-icon-558-270.png'));
          const atWide = (x: number) => intToRGBA(wide.getPixelColor(x, 135));
          let left = -1;
          let right = -1;
          for (let x = 0; x < 558; x++) {
            if (atWide(x).g < 120) {
              if (left < 0) left = x;
              right = x;
            }
          }
          assert.ok(Math.abs(right - left + 1 - 270) <= 1,
            'AC16: 四角い元画像は 558x270 に引き伸ばさない（幅 270 で中央寄せ）: 実測 ' + (right - left + 1));

          // SVG のアイコン元画像は「同じ名前の png」を退避に使う（同梱デフォルトに落とさない）
          const svgDir = nodePath.join(timingRoot, 'fallback-svg');
          await mkdir(svgDir, { recursive: true });
          const svgPath = nodePath.join(svgDir, 'icon.svg');
          await writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#00ff00"/></svg>');
          await (new Jimp({ width: 512, height: 512, color: 0x0000ffff })).write(nodePath.join(svgDir, 'icon.png'));
          const svgDest = nodePath.join(timingRoot, 'fallback-svg-out');
          await (AppExportService as any).generateFallbackIcons(svgPath, svgDest, APP_ID);
          const svgFallback = await Jimp.read(nodePath.join(svgDest, 'favicon-196.png'));
          const svgCenter = intToRGBA(svgFallback.getPixelColor(98, 98));
          assert.ok(svgCenter.b > 200 && svgCenter.r < 60,
            'AC16: SVG の退避は同名 png（青）を使うはず: ' + JSON.stringify(svgCenter));
        }
        console.log('ok AC16: 退避経路でも favicon・mstile・apple-icon を作り、SVG は同名 png を使う');

        // ===== AC12: 54 枚の所要を 512px と 4000px で記録（閾値では落とさない）=====
        {
          const bigSource = nodePath.join(timingRoot, 'photo-4000x3000.png');
          await (new Jimp({ width: 4000, height: 3000, color: 0x336699ff })).write(bigSource);
          const sources: Array<[string, string]> = [
            ['512', nodePath.join(dataDir, 'icon.png')],
            ['4000', bigSource],
          ];
          for (const [label, sourcePath] of sources) {
            const dest = nodePath.join(timingRoot, 'out-' + label);
            const t0 = Date.now();
            const result = await renderer.renderPwaAssets({
              iconSourcePath: sourcePath,
              outputDir: dest,
              background: BACKGROUND,
            });
            const elapsed = Date.now() - t0;
            assert.equal(result.iconSaved.length, 8, 'AC12: アイコンは 8 件のはず');
            assert.equal(result.splashSaved.length, 46, 'AC12: スプラッシュは 46 件のはず');
            const files = await readdir(dest);
            assert.equal(files.length, 54, 'AC12: 54 ファイル書けるはず');
            assert.equal(windowCountAfterRender(), baseWindowCount, 'AC14: 描画後にウィンドウが残らないはず');
            console.log('[timing] renderPwaAssets source=' + label + 'px images=54 total=' + elapsed + 'ms');
          }
        }

        console.log('NOV26-RC-EDITOR174 pwa chromium smoke passed');
        clearTimeout(timeout);
        app.exit(0);
      } catch (error) {
        // 失敗は終了コードと標準エラーで伝える（finally で exit するとエラーが消えるため catch にする）
        console.error('NOV26-RC-EDITOR174 pwa chromium smoke failed', error);
        clearTimeout(timeout);
        app.exit(1);
      }
      }

      app.whenReady().then(main).catch((error) => {
        console.error('NOV26-RC-EDITOR174 pwa chromium smoke failed', error);
        app.exit(1);
      });
    `
  );

  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: {
      alias: [{ find: 'electron-store', replacement: electronStoreStubFile }],
    },
    build: {
      emptyOutDir: true,
      outDir,
      ssr: entryFile,
      target: 'node22',
      rollupOptions: {
        external: ['electron', 'jimp', 'node:sqlite', 'adm-zip'],
        output: { entryFileNames: 'entry.mjs', format: 'es' },
      },
    },
  });

  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith('npm_') || key.startsWith('PNPM')) delete childEnv[key];
  }
  // 子プロセスの出力は逐次流す（固まったときにどこで止まったか分かるようにする）
  const child = spawn(electronBin, ['--disable-crash-reporter', `--user-data-dir=${path.join(workDir, 'userData')}`, bundledFile], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...childEnv, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; process.stdout.write(chunk); });
  child.stderr.on('data', (chunk) => { stderr += chunk; process.stderr.write(chunk); });
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('chromium smoke が 15 分で終わらなかった')); }, 900000);
    child.on('error', reject);
    child.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  assert.ok(String(stdout).includes('NOV26-RC-EDITOR174 pwa chromium smoke passed'),
    `chromium smoke が完走しなかった（exit=${JSON.stringify(exit)}）: ${stderr.slice(-2000)}`);
  console.log('nov26-rc-editor174 pwa chromium smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
