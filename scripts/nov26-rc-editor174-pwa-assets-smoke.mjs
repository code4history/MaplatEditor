// nov26-rc-editor174（code4history/MaplatEditor#174）スモーク（Electron を使わない部分）:
// PWA 画像生成を「Electron 自身の Chromium」で描く実装の、純関数・基準・文言・封じ込めを検証する。
//
// 固定する受け入れ条件（設計書 v3 §8）:
//   AC6   AppExportService / pwaAssets / pwaChromiumRenderer のソースに
//         pwa-asset-generator・puppeteer・chrome-launcher が無い（generateImages を呼ばない）
//   AC7   同梱の electron/pwa_apple_splash_devices.json が依存側 apple-fallback-data.json と同一
//   AC10  11 言語の appedit.export.pwa_fallback が Chrome/Chromium に触れない文言
//   AC14  専用 session のリクエスト封じ込め（file:/data: 以外を cancel）の単体
//   ＋ 仕様（名前・順序）・manifest icons・htmlMeta が基準と完全一致
//   ＋ 作図の寸法式（pwaLayout）が px 明示で「パディング 10%（W 基準）＋ contain 中央寄せ」
//
// 実 Electron を要する検証（AC1〜AC5・AC12・AC13）は
// scripts/nov26-rc-editor174-pwa-chromium-smoke.mjs が担う。
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const baselinePath = path.join(projectRoot, 'scripts/fixtures/nov26-rc-editor174-pwa-baseline.json');
const APP_ID_PLACEHOLDER = '__APPID__';
const pagDistDir = path.join(path.dirname(require.resolve('pwa-asset-generator/package.json')), 'dist');
const importPag = (rel) => import(pathToFileURL(path.join(pagDistDir, rel)).href);

// --- 基準の生成（ブラウザ無し。設計書 v3 §9-2）---------------------------------
// 「基準＝ライブラリ関数を Chrome 無しで直接呼んだ出力」であることを毎回突き合わせる。
// 依存を撤去する 12 月にこのブロックごと消す。
async function buildBaseline() {
  const images = (await importPag('helpers/images.js')).default;
  const meta = (await importPag('helpers/meta.js')).default;
  const file = (await importPag('helpers/file.js')).default;
  const constants = (await importPag('config/constants.js')).default;

  const iconList = images.getIconImages({ favicon: true, mstile: true, maskable: true });
  const splashList = images.getSplashScreenImages(constants.APPLE_HIG_SPLASH_SCREEN_FALLBACK_DATA, {});
  const pathOverride = `pwa/${APP_ID_PLACEHOLDER}`;
  const toSaved = (list) =>
    list.map((image) => ({
      name: image.name,
      width: image.width,
      height: image.height,
      scaleFactor: image.scaleFactor,
      orientation: image.orientation,
      path: file.getImageSavePath(image.name, pathOverride, 'png', true, image.name.includes('manifest-icon')),
    }));
  const iconSaved = toSaved(iconList);
  const splashSaved = toSaved(splashList);
  const manifestIcons = meta.generateIconsContentForManifest(iconSaved, { pathOverride, maskable: true });
  const htmlMetaIcon = meta.generateHtmlForIndexPage(iconSaved, {
    pathOverride, maskable: true, favicon: true, mstile: true, xhtml: false, iconOnly: true, splashOnly: false,
  });
  const htmlMetaSplash = meta.generateHtmlForIndexPage(splashSaved, {
    pathOverride, maskable: true, xhtml: false, iconOnly: false, splashOnly: true, favicon: false, mstile: false,
  });
  const merged = { ...htmlMetaSplash, ...htmlMetaIcon };
  const htmlMeta = {};
  for (const key of ['favicon', 'appleTouchIcon', 'msTileImage', 'appleLaunchImage']) htmlMeta[key] = merged[key];
  return { icons: iconSaved, splash: splashSaved, manifestIcons, htmlMeta, pathOverride };
}

const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
{
  const live = await buildBaseline();
  assert.equal(live.icons.length, baseline.icons.length, '基準: アイコン件数がライブラリの生出力と一致するはず');
  assert.equal(live.splash.length, baseline.splash.length, '基準: スプラッシュ件数がライブラリの生出力と一致するはず');
  assert.deepEqual(live.manifestIcons, baseline.manifestIcons, '基準: manifest icons がライブラリの生出力と一致するはず');
  assert.deepEqual(live.htmlMeta, baseline.htmlMeta, '基準: htmlMeta がライブラリの生出力と一致するはず');
  assert.deepEqual(live.icons.map((i) => i.path), baseline.icons.map((i) => i.path),
    '基準: アイコンの保存名がライブラリの生出力と一致するはず');
  assert.deepEqual(live.splash.map((i) => i.path), baseline.splash.map((i) => i.path),
    '基準: スプラッシュの保存名がライブラリの生出力と一致するはず');
  console.log('ok 基準: 基準ファイルはライブラリの生出力（ブラウザ無し）と一致');
}

// AC6: 実行時に旧依存を読み込まない（ソーステキスト assert）
{
  const targets = [
    'electron/services/AppExportService.ts',
    'electron/utils/pwaAssets.ts',
    'electron/utils/pwaChromiumRenderer.ts',
  ];
  for (const rel of targets) {
    const text = await readFile(path.join(projectRoot, rel), 'utf8');
    for (const needle of ['pwa-asset-generator', 'puppeteer', 'chrome-launcher']) {
      assert.equal(text.includes(needle), false, `AC6: ${rel} に "${needle}" が残っているはず`);
    }
  }
  console.log('ok AC6: AppExportService / pwaAssets / pwaChromiumRenderer は旧依存の名前を含まない');
}

// AC7: 同梱の端末寸法表が依存側と同一（依存撤去時にこの AC を消す）
{
  const bundled = JSON.parse(await readFile(path.join(projectRoot, 'electron/pwa_apple_splash_devices.json'), 'utf8'));
  const upstream = JSON.parse(await readFile(path.join(pagDistDir, 'config/apple-fallback-data.json'), 'utf8'));
  assert.deepEqual(bundled, upstream,
    'AC7: electron/pwa_apple_splash_devices.json は依存側 apple-fallback-data.json と同一のはず（生成器を再実行する）');
  console.log(`ok AC7: 同梱の端末寸法表は依存側と同一（${bundled.length} 端末）`);
}

// AC10: 11 言語の警告文言が Chrome に触れない
{
  const localesDir = path.join(projectRoot, 'public/locales');
  const langs = readdirSync(localesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
  assert.equal(langs.length, 11, 'AC10: ロケールは 11 言語のはず');
  for (const lang of langs) {
    const json = JSON.parse(await readFile(path.join(localesDir, lang, 'translation.json'), 'utf8'));
    const fallback = json?.appedit?.export?.pwa_fallback;
    assert.equal(typeof fallback, 'string', `AC10: ${lang} に appedit.export.pwa_fallback があるはず`);
    assert.ok(fallback.trim().length > 0, `AC10: ${lang} の pwa_fallback が空でないはず`);
    for (const needle of ['Chrome', 'Chromium', 'chrome', 'chromium', 'pwa-asset-generator']) {
      assert.equal(fallback.includes(needle), false,
        `AC10: ${lang} の pwa_fallback が "${needle}" に触れている（修正後は誤案内）: ${fallback}`);
    }
  }
  console.log('ok AC10: 11 言語の pwa_fallback は Chrome に触れない文言');
}

// --- 純関数（Electron を import しないモジュール）-----------------------------
await mkdir(path.join(projectRoot, '.tmp-smoke'), { recursive: true });
const workDir = await mkdtemp(path.join(projectRoot, '.tmp-smoke', 'rc-editor174-pwa-'));
const entryFile = path.join(workDir, 'pure.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'pure.mjs');

try {
  const p = (rel) => JSON.stringify(path.join(projectRoot, rel));
  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';
      import { readFile } from 'node:fs/promises';
      const pwaAssets = await import(${p('electron/utils/pwaAssets.ts')});
      const guard = await import(${p('electron/utils/pwaRequestGuard.ts')});
      const baseline = JSON.parse(await readFile(${JSON.stringify(baselinePath)}, 'utf8'));
      const APP_ID = 'pwa_assets_app';
      const OUT = '/tmp/pwa-out';
      const withAppId = (value: any) =>
        JSON.parse(JSON.stringify(value).split('pwa/' + baseline.appIdPlaceholder).join('pwa/' + APP_ID));

      // 仕様（名前・順序）が基準と一致する
      const iconSpecs = pwaAssets.getPwaIconSpecs(OUT);
      assert.equal(iconSpecs.length, 8, '仕様: アイコンは 8 件のはず');
      assert.deepEqual(iconSpecs.map((s: any) => [s.name + '.png', s.width, s.height]),
        baseline.icons.map((i: any) => [i.path.split('/').pop(), i.width, i.height]),
        '仕様: アイコンの名前・寸法・順序が基準と一致するはず');
      const splashSpecs = pwaAssets.getPwaSplashSpecs(OUT);
      assert.equal(splashSpecs.length, 46, '仕様: スプラッシュは 46 件のはず');
      assert.deepEqual(splashSpecs.map((s: any) => [s.name + '.png', s.width, s.height, s.scaleFactor, s.orientation]),
        baseline.splash.map((i: any) => [i.path.split('/').pop(), i.width, i.height, i.scaleFactor, i.orientation]),
        '仕様: スプラッシュの名前・寸法・順序が基準と一致するはず');

      // manifest / htmlMeta が基準と完全一致
      assert.deepEqual(pwaAssets.composePwaManifestIcons(iconSpecs, 'pwa/' + APP_ID), withAppId(baseline.manifestIcons),
        'manifest: composePwaManifestIcons は基準と一致するはず');
      const htmlMeta = pwaAssets.composePwaHtmlMeta({ icon: iconSpecs, splash: splashSpecs },
        'pwa/' + APP_ID, { favicon: true, mstile: true });
      assert.deepEqual(htmlMeta, withAppId(baseline.htmlMeta), 'htmlMeta: composePwaHtmlMeta は基準と一致するはず');
      assert.equal(htmlMeta.appleLaunchImage.split('\\n').filter((l: string) => l.trim()).length, 46,
        'htmlMeta: apple-touch-startup-image は 46 行のはず');

      // 作図の寸法式: 余白は px 明示・パディングは W 基準・contain 中央寄せ
      assert.equal(typeof pwaAssets.pwaContainBox, 'function', '作図: contain の寸法式が公開されているはず');
      for (const spec of [...iconSpecs, ...splashSpecs]) {
        const box = pwaAssets.pwaContainBox(spec, 512, 512);
        const pad = Math.round(0.1 * spec.width);
        assert.equal(box.padding, pad, '作図: 余白は round(0.1*W) のはず: ' + spec.name);
        assert.equal(box.x, pad, '作図: x は左右とも 0.1W のはず: ' + spec.name);
        assert.equal(box.width, spec.width - 2 * pad, '作図: 内容幅は W-2*pad のはず: ' + spec.name);
        const expectedHeight = Math.min(spec.height - 2 * pad, box.width);
        assert.equal(box.height, expectedHeight, '作図: 内容高は contain のはず: ' + spec.name);
      }
      // 元画像が横長でも縦長でも contain（はみ出さない）
      const wide = pwaAssets.pwaContainBox({ name: 'x', width: 640, height: 1136, scaleFactor: 1, orientation: null, path: '' }, 1200, 400);
      assert.ok(wide.width <= 640 - 2 * 64 + 1, '作図: 横長の元画像は幅に収まるはず');
      assert.ok(wide.height <= 1136 - 2 * 64 + 1, '作図: 横長の元画像は高さに収まるはず');

      // シェル HTML: 背景色と img、% パディングを使わない
      const shell = pwaAssets.buildPwaShellHtml('#f6f0d3');
      assert.ok(shell.includes('#f6f0d3'), 'シェル: 背景色が入るはず');
      assert.ok(shell.includes('id="pwa-src"'), 'シェル: 元画像の img があるはず');
      assert.equal(/%/.test(shell.split('<style>')[1].split('</style>')[0]), false,
        'シェル: CSS に % を使わない（余白は px 明示）');

      // 適用スクリプト: px で寸法を当てる
      const apply = pwaAssets.buildPwaApplyScript({ padding: 18, x: 18, y: 36, width: 144, height: 108 });
      for (const token of ['18px', '36px', '108px', 'requestAnimationFrame']) {
        assert.ok(apply.includes(token), '適用スクリプト: "' + token + '" が入るはず: ' + apply);
      }

      // 画面より大きいウィンドウが作れないときの縮小倍率（設計書 v3 §5.4 S2）
      for (const spec of [...iconSpecs, ...splashSpecs]) {
        assert.equal(pwaAssets.pwaZoomFor(spec, 2868, 2868), 1, '縮小: 収まるなら等倍のはず: ' + spec.name);
        const z = pwaAssets.pwaZoomFor(spec, 2048, 796);
        assert.ok(z > 0 && z <= 1, '縮小: 倍率は (0,1] のはず: ' + spec.name + ' z=' + z);
        assert.ok(Math.round(spec.width * z) <= 2048 + 1, '縮小: 縮めた幅が収まるはず: ' + spec.name);
        assert.ok(Math.round(spec.height * z) <= 796 + 1, '縮小: 縮めた高さが収まるはず: ' + spec.name);
      }
      assert.ok(Math.abs(pwaAssets.pwaZoomFor({ width: 2868, height: 1320 }, 2048, 796) - 796 / 1320) < 1e-9,
        '縮小: 倍率は幅・高さの小さい方のはず');

      // AC14: 専用 session の封じ込め（file: と data: 以外は cancel）
      assert.equal(guard.isAllowedPwaRequestUrl('file:///tmp/a.png'), true, 'AC14: file: は許可');
      assert.equal(guard.isAllowedPwaRequestUrl('data:image/png;base64,AAA'), true, 'AC14: data: は許可');
      for (const url of ['https://example.com/a.png', 'http://127.0.0.1:1/x', 'blob:file:///x', 'chrome://version', 'app://bundle/x.png', 'ws://localhost:8080/']) {
        assert.equal(guard.isAllowedPwaRequestUrl(url), false, 'AC14: ' + url + ' は拒否のはず');
      }
      let listener: any = null;
      let filter: any = null;
      guard.installPwaRequestGuard({ onBeforeRequest(f: any, l: any) { filter = f; listener = l; } });
      assert.ok(listener, 'AC14: onBeforeRequest が登録されるはず');
      assert.ok(filter && Array.isArray(filter.urls), 'AC14: フィルタは urls 配列を持つはず');
      assert.deepEqual(listener({ url: 'https://example.com/x.png' }), { cancel: true },
        'AC14: 外部 URL は cancel のはず');
      assert.equal(listener({ url: 'file:///tmp/x.png' })?.cancel, undefined,
        'AC14: file: は cancel しないはず');

      console.log('ok 純関数: 仕様・manifest・htmlMeta は基準と一致し、寸法式・シェル・封じ込めも設計どおり');
      console.log('NOV26-RC-EDITOR174 pwa assets smoke passed');
    `
  );

  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      emptyOutDir: true,
      outDir,
      ssr: entryFile,
      target: 'node22',
      rollupOptions: { external: [], output: { entryFileNames: 'pure.mjs', format: 'es' } },
    },
  });

  const { stdout, stderr } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 300000,
    maxBuffer: 1024 * 1024 * 8,
  });
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
  console.log('nov26-rc-editor174 pwa assets smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
