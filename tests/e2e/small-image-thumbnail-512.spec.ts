// 地図の画像を取り込んだとき、512px のサムネイルが画像の大きさによらず作られることの e2e。
//
// 以前は、512px のサムネイルをズーム 2 のタイルからだけ作り、長辺が 512px 以下の画像
// （タイルが z1 までしか無いもの）では作らずに飛ばしていた。この試験は次の 2 つの道で、
// 小さい画像と大きい画像を入れ、保存後の tmbs/{uid}_512.webp を確かめる。
//
// - 普通の画像の取り込み（新しい地図の編集画面で「地図画像登録」）
// - 書誌だけの道（IIIF の書誌だけを写し、画像は利用者が選ぶ）
//
// 期待する大きさ: 長辺は min(元の長辺, 512)。512px より小さい画像は拡大せず元の大きさのまま。
// 縦横の比は元の画像と同じ（丸めの 1px は許す）。
//
// 取得は本物のネットワークに出さない（iiif-metadata-only.spec.ts と同じ差し替え）。
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';
import { readImageMeta } from '../../electron/utils/thumbnail512Codec';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const fixtureDir = path.join(projectRoot, 'tests', 'fixtures', 'iiif');

const MANIFEST_URL = 'https://dl.ndl.go.jp/api/iiif/948741/manifest.json';
const CANVAS_3_INFO_URL = 'https://dl.ndl.go.jp/api/iiif/948741/R0000003/info.json';

const TRANSPARENT_TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// 長辺 256 以下（z0 のみ）・257〜512（z1 まで）・513〜1024（z2 が原寸）・それより大きい（縮小あり）
const SIZES: Array<{ width: number; height: number }> = [
  { width: 200, height: 150 },
  { width: 512, height: 384 },
  { width: 600, height: 400 },
  { width: 3000, height: 2000 },
];

async function writeMainResponses(root: string): Promise<void> {
  const table = {
    [MANIFEST_URL]: {
      status: 200,
      headers: { 'content-type': 'application/json' },
      file: path.join(fixtureDir, 'ndl-948741.manifest.json'),
    },
    [CANVAS_3_INFO_URL]: {
      status: 200,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      file: path.join(fixtureDir, 'no-region.info.json'),
    },
  };
  await writeFile(path.join(root, 'iiif-responses.json'), JSON.stringify(table), 'utf8');
}

// 画像の選択だけに手元の画像を返す（ZIP の選択は取り消す）
async function installOpenDialog(app: ElectronApplication, imagePath: string): Promise<void> {
  await app.evaluate(async ({ dialog }, selected) => {
    dialog.showOpenDialog = (async (...args: any[]) => {
      const options = (args[args.length - 1] ?? {}) as any;
      const extensions = ((options.filters ?? []) as Array<{ extensions?: string[] }>)
        .flatMap((filter) => filter.extensions ?? [])
        .map((entry) => String(entry).toLowerCase());
      if (!extensions.some((entry) => ['jpg', 'jpeg', 'png'].includes(entry))) {
        return { canceled: true, filePaths: [] };
      }
      return { canceled: false, filePaths: [selected] };
    }) as typeof dialog.showOpenDialog;
  }, imagePath);
}

async function stubMessageBox(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
}

async function routeBaseMaps(page: Page): Promise<void> {
  for (const pattern of [
    '**/tile.openstreetmap.org/**',
    '**/cyberjapandata.gsi.go.jp/**',
    '**/t.tilemap.jp/**',
    '**/basemaps.cartocdn.com/**',
  ]) {
    await page.route(pattern, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_TILE }),
    );
  }
}

async function forceJapanese(page: Page): Promise<void> {
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

async function openMapList(page: Page): Promise<void> {
  await page.evaluate(() => {
    location.hash = '#/maplist';
  });
  await page.locator('[data-resource-list="map"]').waitFor({ state: 'visible', timeout: 30_000 });
}

// 画像の取り込みの完了の知らせを OK で閉じる
async function closeUploadModal(page: Page): Promise<void> {
  const progressModal = page.locator('.modal.d-block');
  await expect(progressModal).toContainText('正常に地図画像が登録できました。', { timeout: 120_000 });
  await progressModal.getByRole('button', { name: 'OK' }).click();
  await expect(progressModal).toHaveCount(0);
}

async function saveNewMap(page: Page, slug: string): Promise<string> {
  await page.getByRole('tab', { name: 'メタデータ編集' }).click();
  await page.getByTestId('map-slug').fill(slug);
  await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('editor-save').click();
  await page.waitForFunction(() => !!(window as any).testDebug?.mapData?.value?.uid, undefined, { timeout: 60_000 });
  return page.evaluate(() => (window as any).testDebug.mapData.value.uid as string);
}

// 普通の画像の取り込み: 新しい地図の編集画面で画像を入れて保存する
async function importPlain(page: Page, slug: string): Promise<string> {
  await page.evaluate(() => {
    location.hash = '#/mapedit';
  });
  await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('map-title').fill('small image thumbnail');
  await page.getByTestId('map-attr').fill('test copyright');
  await page.getByRole('button', { name: '地図画像登録' }).click();
  await closeUploadModal(page);
  return saveNewMap(page, slug);
}

// 書誌だけの道: 配信できないコマを選んで書誌だけ写し、開いた画像の選択で画像を入れて保存する
async function importMetadataOnly(page: Page, slug: string): Promise<string> {
  await openMapList(page);
  await page.getByTestId('map-import-iiif').click();
  await expect(page.getByTestId('iiif-import-dialog')).toBeVisible();
  await page.getByTestId('iiif-import-url').fill(MANIFEST_URL);
  await page.getByTestId('iiif-import-inspect').click();
  await expect(page.getByTestId('iiif-canvas-option')).toHaveCount(9);
  await page.getByTestId('iiif-canvas-option').nth(2).click();
  await expect(page.getByTestId('iiif-verdict-kind')).toHaveText('書誌だけ IIIF から');
  await page.getByTestId('iiif-metadata-only').click();
  await page.waitForFunction(() => location.hash.startsWith('#/mapedit'), undefined, { timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const md = (window as any).testDebug?.mapData?.value;
      return !!md?.url_ && !!md?.iiif?.copiedAt;
    },
    undefined,
    { timeout: 120_000 },
  );
  await closeUploadModal(page);
  return saveNewMap(page, slug);
}

const ROUTES = [
  { name: '普通の画像の取り込み', run: importPlain },
  { name: '書誌だけの道', run: importMetadataOnly },
] as const;

test.describe('512px のサムネイルは画像の大きさによらず作られる', () => {
  for (const route of ROUTES) {
    for (const size of SIZES) {
      test(`${route.name}: ${size.width}x${size.height}`, async () => {
        test.setTimeout(300_000);
        const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-small-thumb512-'));
        await writeMainResponses(e2eRoot);
        const imagePath = path.join(e2eRoot, `image-${size.width}x${size.height}.png`);
        const { Jimp } = await import('jimp');
        await new Jimp({ width: size.width, height: size.height, color: 0x3366ccff })
          .write(imagePath as `${string}.${string}`);

        let app: ElectronApplication | null = null;
        try {
          const launched = await launch(e2eRoot);
          app = launched.app;
          const page = launched.page;
          await stubMessageBox(app);
          await installOpenDialog(app, imagePath);
          await routeBaseMaps(page);
          await forceJapanese(page);

          const uid = await route.run(page, `thumb512-${size.width}x${size.height}-${Date.now()}`);
          expect(uid).toBeTruthy();
          const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
          const thumbPath = path.join(saveFolder, 'tmbs', `${uid}_512.webp`);

          // 保存のときに tmbs へ移す ∴ 保存の直後に置かれている
          await expect.poll(async () => (await readImageMeta(thumbPath)) !== null, { timeout: 15_000 }).toBe(true);
          const meta = (await readImageMeta(thumbPath))!;
          const longSide = Math.max(size.width, size.height);
          const expectedLong = Math.min(longSide, 512);
          const scale = expectedLong / longSide;
          const expectedW = Math.round(size.width * scale);
          const expectedH = Math.round(size.height * scale);
          console.log(`  ${route.name} ${size.width}x${size.height} -> ${meta.width}x${meta.height}`);
          expect(Math.abs(meta.width - expectedW)).toBeLessThanOrEqual(1);
          expect(Math.abs(meta.height - expectedH)).toBeLessThanOrEqual(1);
        } finally {
          if (app) await quitElectronApplication(app);
        }
      });
    }
  }
});
