// POI エディタの欠落アセットの診断に、アイコン（POI ごと・レイヤ）のアセット参照も入ることを確かめる。
//
// - 実体の無いアセット UID をアイコンに持つと「参照先が存在しないアセット参照が N 件」に数える
// - 実体のあるアセット UID・組み込みのアイコン（builtin:…）・URL・相対パスは数えない
// - レイヤのアイコンを組み込みに替えると、その場で数え直す
//
// 画面の写真: ICON_ASSET_DIAG_SCREENSHOT_DIR を指定するとそこへ、無ければ test-results の下へ撮る。
// ICON_ASSET_DIAG_SHOT_TAG（既定 after）を名前に付ける。変更前の画面を撮るときは before を渡す。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { pickImageToken } from './helpers/pickedImage';
import { takeScreenshot } from './helpers/screenshot';

const projectRoot = path.resolve(import.meta.dirname, '../..');

// 1x1 pixel transparent PNG (base64)
const MINI_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// 実体の無いアセット UID（架空）
const MISSING_LAYER_ICON = '00000000-0000-4000-a000-0000000000a1';
const MISSING_FEATURE_ICON = '00000000-0000-4000-a000-0000000000a2';

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

test('アイコンのアセット参照の欠落を数え、実体のあるもの・組み込み・URL は数えない', async () => {
  test.setTimeout(180_000);
  const testInfo = test.info();
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-icon-asset-diag-'));
  const shotDir = process.env.ICON_ASSET_DIAG_SCREENSHOT_DIR || testInfo.outputPath('screenshots');
  const shotTag = process.env.ICON_ASSET_DIAG_SHOT_TAG || 'after';
  await mkdir(shotDir, { recursive: true });
  const { app, page } = await launch(e2eRoot);
  try {
    // 実体のあるアセット（アイコンの参照先として使う）
    const imgPath = path.join(e2eRoot, 'icon-1x1.png');
    await writeFile(imgPath, Buffer.from(MINI_PNG_BASE64, 'base64'));
    const assetToken = await pickImageToken(app, page, imgPath);

    const seeded = await page.evaluate(async (params) => {
      const asset = await window.imageAssets.add({
        slug: params.assetSlug, title: { ja: '架空のアイコン' }, lang: 'ja',
        sourceName: 'icon-1x1.png', token: params.assetToken,
      });
      if (!asset || asset.result !== 'Success') throw new Error(`asset: ${JSON.stringify(asset)}`);
      const point = (x: number) => ({ type: 'Point', coordinates: [139.76 + x / 1000, 35.68] });
      const save = async (slug: string, fc: unknown): Promise<string> => {
        const created = await window.poiSources.createLocal({ slug, title: { ja: '架空の地点' }, lang: 'ja' });
        if (!created || created.result !== 'Success') throw new Error(`poi: ${JSON.stringify(created)}`);
        const saved = await window.poiSources.save(created.uid, { slug, title: { ja: '架空の地点' }, fc });
        if (!saved || saved.result !== 'Success') throw new Error(`save: ${JSON.stringify(saved)}`);
        return created.uid as string;
      };

      // 欠落 2 件: レイヤの既定のアイコン（FC.properties）と、POI ごとのアイコン
      // 数えないもの: 実体のあるアセット・builtin・URL・相対パス
      const missingUid = await save(`${params.assetSlug}-missing`, {
        type: 'FeatureCollection',
        properties: { icon: params.missingLayer, selectedIcon: 'builtin:defaultpin-selected' },
        features: [
          { type: 'Feature', id: 'p1', geometry: point(1), properties: { name: { ja: '架空の地点 1' }, icon: params.missingFeature, selectedIcon: asset.uid } },
          { type: 'Feature', id: 'p2', geometry: point(2), properties: { name: { ja: '架空の地点 2' }, icon: 'builtin:defaultpin-red' } },
          { type: 'Feature', id: 'p3', geometry: point(3), properties: { name: { ja: '架空の地点 3' }, icon: 'https://example.org/icons/pin.png', selectedIcon: 'icons/pin.png' } },
        ],
      });

      // 欠落 0 件: 実体のあるアセット・builtin・URL だけ
      const okUid = await save(`${params.assetSlug}-ok`, {
        type: 'FeatureCollection',
        properties: { icon: asset.uid, selectedIcon: 'https://example.org/icons/selected.png' },
        features: [
          { type: 'Feature', id: 'q1', geometry: point(1), properties: { name: { ja: '架空の地点 4' }, icon: 'builtin:defaultpin', selectedIcon: asset.uid } },
          { type: 'Feature', id: 'q2', geometry: point(2), properties: { name: { ja: '架空の地点 5' }, icon: 'https://example.org/icons/pin.png' } },
        ],
      });
      return { missingUid, okUid };
    }, {
      assetSlug: `icon-diag-${Date.now()}`,
      assetToken,
      missingLayer: MISSING_LAYER_ICON,
      missingFeature: MISSING_FEATURE_ICON,
    });

    const sidePane = page.locator('.poi-side-pane');
    const warningText = /参照先が存在しないアセット参照が\d+件/;

    // 欠落 2 件のソース
    await page.evaluate((hash) => { location.hash = hash; }, `#/poisources/${seeded.missingUid}`);
    await expect(sidePane).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="layer-icon"] input')).toHaveValue(MISSING_LAYER_ICON, { timeout: 15000 });
    await expect(page.getByText(/参照先が存在しないアセット参照が2件/)).toBeVisible({ timeout: 10000 });
    await takeScreenshot(page, path.join(shotDir, `poi-icon-asset-diagnostics-${shotTag}-missing.png`));

    // レイヤのアイコンを組み込みに替えると 1 件に数え直す
    const layerInput = page.locator('[data-testid="layer-icon"] input');
    await layerInput.fill('builtin:defaultpin');
    await layerInput.press('Enter');
    await layerInput.blur();
    await expect(page.getByText(/参照先が存在しないアセット参照が1件/)).toBeVisible({ timeout: 10000 });
    await takeScreenshot(page, path.join(shotDir, `poi-icon-asset-diagnostics-${shotTag}-layer-fixed.png`));

    // 欠落 0 件のソース: 警告が出ている状態から移り、警告が消えるのを待つ
    // （照会が終わるのを固定の待ち時間ではなく、表示の変化で待つ）
    await page.evaluate((hash) => { location.hash = hash; }, `#/poisources/${seeded.okUid}`);
    await expect(page.locator('[data-testid="layer-icon"] input')).toHaveValue(/^[0-9a-f-]{36}$/i, { timeout: 10000 });
    await expect(page.getByText(warningText)).toHaveCount(0, { timeout: 10000 });
  } finally {
    await quitElectronApplication(app);
  }
});
