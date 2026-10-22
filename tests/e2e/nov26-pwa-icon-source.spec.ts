// NOV26-IM-PWA-ICON-SOURCE-0481 E2E:
//   PWA のアイコン群（apple-icon・manifest-icon・favicon・mstile）と iOS の起動画面（apple-splash）は
//   **PWA アイコン用の画像**（manifestSettings.iconSource）から作る。スプラッシュ画像からは作らない。
//
// 確かめること:
//   (1) 書き出した zip の pwa/{appID}/ は基準（scripts/fixtures/nov26-rc-editor174-pwa-baseline.json）の
//       54 枚そろう（favicon-196.png・mstile-icon-* が含まれる）
//   (2) apple-splash の中央の画素が **アイコン元画像の色**（スプラッシュ画像の色ではない）
//   (3) 「PWA アイコン用の画像」に SVG を登録できる（拡張子フィルタ・縦横比を問わない・
//       退避用の同名 PNG・保存前のプレビュー）
//   (4) SVG をアイコン元画像にしても 54 枚そろい、zip に元の SVG は入らない
//   (5) 未登録で書き出すと、既定 Maplat ロゴを使った旨の警告が 1 つ出る
//   (5b) 登録はあるが実体が無いときも同じ警告が 1 つ出る
//   (6) 登録済みならその警告は出ない（NOV26-IM-PWA-ICON-SOURCE-0482）
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch, openHash, saveFolderOf, stubMessageBoxAutoOk } from './helpers/mapPackage';

const APP_ID = 'nov26-pwa-icon-source-app';
const BASELINE = path.resolve(import.meta.dirname, '../../scripts/fixtures/nov26-rc-editor174-pwa-baseline.json');
/** アイコンの色（赤）。スプラッシュ（青）・背景色と区別できる色を選ぶ */
const ICON = { r: 255, g: 0, b: 0 };
/** スプラッシュ画像の色（青）。apple-splash にこの色が出たら「スプラッシュから描いている」 */
const SPLASH = { r: 0, g: 0, b: 255 };
const SVG_COLOR = { r: 0, g: 255, b: 0 };
const SVG_SIDE = 512;
const SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_SIDE}" height="${SVG_SIDE}" viewBox="0 0 ${SVG_SIDE} ${SVG_SIDE}">
  <rect x="0" y="0" width="${SVG_SIDE}" height="${SVG_SIDE}" fill="#00ff00"/>
</svg>
`;

type Baseline = {
  appIdPlaceholder: string;
  icons: { path: string; width: number; height: number }[];
  splash: { path: string; width: number; height: number }[];
};

function pngInfo(data: Buffer): { width: number; height: number } {
  expect(data.subarray(1, 4).toString('latin1'), 'PNG のはず').toBe('PNG');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

const near = (a: number, b: number) => Math.abs(a - b) <= 8;

/** 保存ダイアログを差し替えて書き出す（前例 tests/e2e/nov26-rc-editor174-pwa-export.spec.ts） */
async function exportTo(
  app: Awaited<ReturnType<typeof launch>>['app'],
  page: Awaited<ReturnType<typeof launch>>['page'],
  zipPath: string,
) {
  await app.evaluate(async ({ dialog }, out) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: out })) as typeof dialog.showSaveDialog;
  }, zipPath);
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
}

// NOV26-IM-PWA-ICON-SOURCE-0482: アイコン元画像が未登録（または実体なし）のとき、
// 黙って既定の Maplat ロゴになるのではなく警告を 1 つ出す。文言は i18n（ja）の正本。
const DEFAULT_ICON_WARNING =
  'PWA アイコン用の画像が登録されていないため、既定の Maplat ロゴでアイコンと起動画面を作りました。';

type ExportDialog = { message?: string; detail?: string };

/**
 * 書き出し結果のダイアログを捕まえる。
 * 警告は warnings 配列のキーをレンダラ側で t(key) して detail に並べるので、
 * 「ユーザーに警告が出たか」はこの detail を見るのが実経路（AppEdit.exportSavedApp）。
 */
async function stubExportDialogRecorder(app: Awaited<ReturnType<typeof launch>>['app']) {
  await app.evaluate(async ({ dialog }) => {
    const g = globalThis as unknown as { __exportDialogs?: ExportDialog[] };
    g.__exportDialogs = [];
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.find(
        (arg): arg is ExportDialog => !!arg && typeof arg === 'object' && 'message' in (arg as object),
      );
      g.__exportDialogs!.push({ message: options?.message, detail: options?.detail });
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
}

/** 直前の書き出しまでに記録したダイアログを取出し、記録を空にする */
async function takeExportDialogs(
  app: Awaited<ReturnType<typeof launch>>['app'],
): Promise<ExportDialog[]> {
  return app.evaluate(async () => {
    const g = globalThis as unknown as { __exportDialogs?: ExportDialog[] };
    const captured = g.__exportDialogs ?? [];
    g.__exportDialogs = [];
    return captured;
  });
}

/** 書き出し完了ダイアログの detail に並んだ警告行（1 警告 = 1 行） */
function warningLines(dialogs: ExportDialog[]): string[] {
  const done = dialogs.filter((entry) => (entry.message ?? '').includes('エクスポートが完了しました'));
  return done.flatMap((entry) => (entry.detail ?? '').split('\n').filter((line) => line.trim() !== ''));
}

/** アプリを 1 件作る（iconSource は null で「未登録」） */
async function seedApp(
  page: Awaited<ReturnType<typeof launch>>['page'],
  slug: string,
  iconSource: string | null,
): Promise<string> {
  return page.evaluate(async ({ slug, iconSource }) => {
    const uid = crypto.randomUUID();
    const manifestSettings: Record<string, string> = { backgroundColor: '#f6f0d3' };
    if (iconSource !== null) manifestSettings.iconSource = iconSource;
    const r = await window.appedit.save({
      uid, slug, create: true,
      document: {
        appID: slug, appName: { ja: slug }, title: { ja: slug },
        description: {}, keywords: '', siteUrl: '', lang: 'ja',
        sources: [],
        startFrom: '', pois: [],
        httpSettings: { pwaManifest: true },
        appSettings: {},
        manifestSettings,
      },
    });
    if (!r || r.result !== 'Success') throw new Error(JSON.stringify(r));
    return uid;
  }, { slug, iconSource });
}

/** 書き出して、完了ダイアログに出た警告行を返す（zip も実在を確かめる） */
async function exportAndCollectWarnings(
  app: Awaited<ReturnType<typeof launch>>['app'],
  page: Awaited<ReturnType<typeof launch>>['page'],
  zipPath: string,
): Promise<string[]> {
  await exportTo(app, page, zipPath);
  const dialogs = await takeExportDialogs(app);
  expect(dialogs.length, '書き出し完了ダイアログが記録されているはず').toBeGreaterThan(0);
  expect(await readFile(zipPath).then((data) => data.length), `${zipPath} が作られているはず`).toBeGreaterThan(0);
  return warningLines(dialogs);
}

test.describe('nov26-pwa-icon-source: PWA の画像はアイコン元画像から作る', () => {
  test('(1)(2)(3)(4) 54 枚そろい、apple-splash はアイコンの色で、SVG のアイコンも登録できる', async () => {
    test.setTimeout(360_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-pwa-icon-source-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxAutoOk(app);
      const saveFolder = await saveFolderOf(page);
      expect(saveFolder).toBeTruthy();

      // アイコン元画像（赤 512）とスプラッシュ（青 512）を保存フォルダへ置く（どちらも UUID 名）
      const iconRel = `pwa/${randomUUID()}.png`;
      const splashName = `${randomUUID()}.png`;
      const { Jimp, intToRGBA } = await import('jimp');
      await mkdir(path.join(saveFolder, 'pwa'), { recursive: true });
      await mkdir(path.join(saveFolder, 'img'), { recursive: true });
      await new Jimp({ width: 512, height: 512, color: 0xff0000ff }).write(path.join(saveFolder, iconRel) as `${string}.png`);
      await new Jimp({ width: 512, height: 512, color: 0x0000ffff }).write(path.join(saveFolder, 'img', splashName) as `${string}.png`);

      const appUid = await page.evaluate(async ({ slug, icon, splash }) => {
        const uid = crypto.randomUUID();
        const r = await window.appedit.save({
          uid, slug, create: true,
          document: {
            appID: slug, appName: { ja: 'PWA Icon Source' }, title: { ja: 'PWA Icon Source' },
            description: {}, keywords: '', siteUrl: '', lang: 'ja',
            sources: [],
            startFrom: '', pois: [],
            httpSettings: { pwaManifest: true },
            appSettings: { splash },
            manifestSettings: { iconSource: icon, backgroundColor: '#f6f0d3' },
          },
        });
        if (!r || r.result !== 'Success') throw new Error(JSON.stringify(r));
        return uid;
      }, { slug: APP_ID, icon: iconRel, splash: splashName });

      await openHash(page, `#/appedit?uid=${appUid}`);
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30_000 });

      // (1)(2) PNG のアイコン元画像で書き出す
      const zipPath = path.join(e2eRoot, 'pwa-icon-source-png.zip');
      await exportTo(app, page, zipPath);

      const baseline = JSON.parse(await readFile(BASELINE, 'utf8')) as Baseline;
      const { default: AdmZip } = await import('adm-zip');
      const zip = new AdmZip(zipPath);
      const entries = new Map(zip.getEntries().filter((e) => !e.isDirectory).map((e) => [e.entryName, e]));
      const pwaNames = [...entries.keys()].filter((n) => n.startsWith(`pwa/${APP_ID}/`));
      expect(pwaNames.length).toBe(54);
      for (const spec of [...baseline.icons, ...baseline.splash]) {
        const entryName = spec.path.split(`pwa/${baseline.appIdPlaceholder}`).join(`pwa/${APP_ID}`);
        const entry = entries.get(entryName);
        expect(entry, `${entryName} が zip に無い`).toBeTruthy();
        const info = pngInfo(zip.readFile(entry!) as Buffer);
        expect([entryName, info.width, info.height]).toEqual([entryName, spec.width, spec.height]);
      }
      // 人間の報告（favicon 系・mstile- が作られない）の回帰: 名前で直接確かめる
      for (const name of [
        'favicon-196.png',
        'mstile-icon-128.png',
        'mstile-icon-270.png',
        'mstile-icon-558.png',
        'mstile-icon-558-270.png',
      ]) {
        expect(entries.has(`pwa/${APP_ID}/${name}`), `${name} が zip に無い`).toBe(true);
      }
      expect(entries.has('favicon.ico'), 'favicon.ico が zip のルートに無い').toBe(true);

      // (2) apple-splash の中央はアイコンの色（赤）。スプラッシュ（青）ではない
      {
        const image = await Jimp.read(zip.readFile(entries.get(`pwa/${APP_ID}/apple-splash-640-1136.png`)!) as Buffer);
        const center = intToRGBA(image.getPixelColor(320, 568));
        expect(
          [near(center.r, ICON.r), near(center.g, ICON.g), near(center.b, ICON.b)],
          `apple-splash の中央はアイコン元画像の色（赤）のはず: ${JSON.stringify(center)}`,
        ).toEqual([true, true, true]);
        const corner = intToRGBA(image.getPixelColor(0, 0));
        expect(
          [near(corner.r, 0xf6), near(corner.g, 0xf0), near(corner.b, 0xd3)],
          `apple-splash の四隅は背景色のはず: ${JSON.stringify(corner)}`,
        ).toEqual([true, true, true]);
      }

      // (3) SVG をアイコン元画像に登録する
      const svgPath = path.join(e2eRoot, 'icon-source.svg');
      await writeFile(svgPath, SVG_TEXT, 'utf8');
      const iconSourceInput = page.getByTestId('appedit-icon-source');
      await expect(iconSourceInput).toHaveValue(iconRel);
      await app.evaluate(async ({ dialog }, selected) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [selected] })) as typeof dialog.showOpenDialog;
      }, svgPath);
      await page.getByTestId('appedit-icon-upload').click();
      await expect(iconSourceInput).toHaveValue(/^pwa\/[0-9a-f-]{36}\.svg$/, { timeout: 30_000 });
      const svgRel = await iconSourceInput.inputValue();
      // 保存前のプレビューが SVG でも表示される（naturalWidth = SVG の幅）
      const iconPreview = page.getByTestId('appedit-icon-preview');
      await expect(iconPreview).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => iconPreview.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(SVG_SIDE);
      // SVG はそのまま、退避用の同名 PNG（512x512）も保存される
      expect(await readFile(path.join(saveFolder, svgRel), 'utf8')).toBe(SVG_TEXT);
      const backupPng = await readFile(path.join(saveFolder, svgRel.replace(/\.svg$/, '.png')));
      expect(pngInfo(backupPng)).toEqual({ width: 512, height: 512 });

      // 保存してから書き出す（exportSavedApp は DB の文書を読む）
      await page.getByTestId('editor-save').click();
      await expect.poll(
        () => page.evaluate(async (uid) => (await window.appedit.request(uid))?.manifestSettings?.iconSource, appUid),
        { timeout: 60_000 },
      ).toBe(svgRel);

      // (4) SVG のアイコン元画像でも 54 枚そろい、zip に元の SVG は入らない
      const zipPath2 = path.join(e2eRoot, 'pwa-icon-source-svg.zip');
      await exportTo(app, page, zipPath2);
      const zip2 = new AdmZip(zipPath2);
      const names2 = zip2.getEntries().filter((e) => !e.isDirectory).map((e) => e.entryName);
      const pwaNames2 = names2.filter((n) => n.startsWith(`pwa/${APP_ID}/`));
      expect(pwaNames2.length).toBe(54);
      expect(pwaNames2.filter((n) => n.endsWith('.svg'))).toEqual([]);
      expect(names2.filter((n) => n.endsWith('.svg'))).toEqual([]);
      {
        const image = await Jimp.read(zip2.readFile(`pwa/${APP_ID}/apple-splash-640-1136.png`) as Buffer);
        const center = intToRGBA(image.getPixelColor(320, 568));
        expect(
          [near(center.r, SVG_COLOR.r), near(center.g, SVG_COLOR.g), near(center.b, SVG_COLOR.b)],
          `SVG のアイコン元画像でも apple-splash の中央はアイコンの色（緑）のはず: ${JSON.stringify(center)}`,
        ).toEqual([true, true, true]);
      }
      // スプラッシュ（青）が apple-splash に混ざっていないこと
      {
        const image = await Jimp.read(zip2.readFile(`pwa/${APP_ID}/apple-splash-1320-2868.png`) as Buffer);
        const center = intToRGBA(image.getPixelColor(660, 1434));
        expect(center.b, `apple-splash にスプラッシュ画像の青が出ている: ${JSON.stringify(center)}`).toBeLessThan(200);
      }
    } finally {
      await quitElectronApplication(app);
    }
  });

  // (5) NOV26-IM-PWA-ICON-SOURCE-0482: 未登録のとき、黙って既定の Maplat ロゴになるのではなく
  //     警告を 1 つ出す（「実体が無い」を別キーで伝える既存の警告は無いので同じキーでよい）
  test('(5) 未登録で書き出すと既定ロゴの警告が 1 つ出る', async () => {
    test.setTimeout(360_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-pwa-icon-unregistered-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubExportDialogRecorder(app);
      const saveFolder = await saveFolderOf(page);
      expect(saveFolder).toBeTruthy();

      // manifestSettings.iconSource を持たないアプリ
      const unregisteredUid = await seedApp(page, 'nov26-pwa-icon-unregistered', null);
      await openHash(page, `#/appedit?uid=${unregisteredUid}`);
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('appedit-icon-source')).toHaveValue('');
      const unregistered = await exportAndCollectWarnings(
        app, page, path.join(e2eRoot, 'pwa-icon-unregistered.zip'),
      );
      expect(
        unregistered.filter((line) => line === DEFAULT_ICON_WARNING).length,
        `未登録の書き出しは既定ロゴの警告を 1 つ出すはず: ${JSON.stringify(unregistered)}`,
      ).toBe(1);
    } finally {
      await quitElectronApplication(app);
    }
  });

  // (5b) 登録はあるが実体が無い（保存フォルダからファイルが消えた）ときも同じ警告を 1 つ出す
  test('(5b) アイコン元画像の実体が無いときも既定ロゴの警告が 1 つ出る', async () => {
    test.setTimeout(360_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-pwa-icon-missing-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubExportDialogRecorder(app);
      const saveFolder = await saveFolderOf(page);
      expect(saveFolder).toBeTruthy();

      // 登録だけしてファイルは置かない
      const missingRel = `pwa/${randomUUID()}.png`;
      const missingUid = await seedApp(page, 'nov26-pwa-icon-missing', missingRel);
      await openHash(page, `#/appedit?uid=${missingUid}`);
      await expect(page.getByTestId('appedit-icon-source')).toHaveValue(missingRel);
      const missing = await exportAndCollectWarnings(
        app, page, path.join(e2eRoot, 'pwa-icon-missing.zip'),
      );
      expect(
        missing.filter((line) => line === DEFAULT_ICON_WARNING).length,
        `実体が無い登録も同じ警告を 1 つ出すはず: ${JSON.stringify(missing)}`,
      ).toBe(1);
    } finally {
      await quitElectronApplication(app);
    }
  });

  // (6) 登録済み（実体あり）なら既定ロゴへ落ちないので警告は出ない
  test('(6) アイコン元画像が登録済みなら既定ロゴの警告は出ない', async () => {
    test.setTimeout(360_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-pwa-icon-registered-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubExportDialogRecorder(app);
      const saveFolder = await saveFolderOf(page);
      expect(saveFolder).toBeTruthy();

      const iconRel = `pwa/${randomUUID()}.png`;
      const { Jimp } = await import('jimp');
      await mkdir(path.join(saveFolder, 'pwa'), { recursive: true });
      await new Jimp({ width: 512, height: 512, color: 0xff0000ff })
        .write(path.join(saveFolder, iconRel) as `${string}.png`);

      const registeredUid = await seedApp(page, 'nov26-pwa-icon-registered', iconRel);
      await openHash(page, `#/appedit?uid=${registeredUid}`);
      await expect(page.getByTestId('appedit-icon-source')).toHaveValue(iconRel);
      const registered = await exportAndCollectWarnings(
        app, page, path.join(e2eRoot, 'pwa-icon-registered.zip'),
      );
      expect(
        registered.filter((line) => line === DEFAULT_ICON_WARNING),
        `登録済みの書き出しは既定ロゴの警告を出さないはず: ${JSON.stringify(registered)}`,
      ).toEqual([]);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
