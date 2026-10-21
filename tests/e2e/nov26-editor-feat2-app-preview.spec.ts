// nov26-editor-feat2 (コミット1) E2E: アプリ編集のスプラッシュ画像・PWA アイコンのプレビューが
// 指定直後に切り替わり、Undo/Redo で指定前・指定後へ追随する。
//
// 設計書 `.nayuta/2026-10-21-nov26-editor-feat2-design.md` §3.4-2 / §4.6（AC8）と、
// 設計レビュー（NOV26-DR-EDITOR-FEATURES-0456 追補）の指示:
//   「スプラッシュと PWA アイコンを 2 回選ぶと、保存前に表示（img の src と naturalWidth）が
//     2 枚目に変わる・undo で 1 枚目・redo で 2 枚目」
//
// 2 枚の画像はサイズを変えて作り、naturalWidth で見分ける（PWA アイコンは 512 固定へ
// 正規化されるため、アイコンは src（ファイル名 = uuid）の変化で見分ける）。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // 隔離 root の外（実ユーザーデータ）へ接続していないことを確かめる
  const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
  if (!path.resolve(saveFolder).startsWith(path.resolve(e2eRoot) + path.sep)) {
    throw new Error(`E2E storage isolation failed: ${saveFolder} is outside ${e2eRoot}`);
  }
  return { app, page };
}

// 次のクリックで選ばれる画像を差し替える（実 main の dialog を差し替える。前例 m19-t12）
async function installDialogHarness(app: ElectronApplication, imagePath: string): Promise<void> {
  await app.evaluate(async ({ dialog }, selectedImage) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [selectedImage] })) as typeof dialog.showOpenDialog;
  }, imagePath);
}

async function openHash(page: Page, hash: string, ready: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await expect(page.locator(ready)).toBeVisible();
}

async function makePng(dir: string, name: string, width: number, height: number, color: number): Promise<string> {
  const target = path.join(dir, name);
  const { Jimp } = await import('jimp');
  await new Jimp({ width, height, color }).write(target as `${string}.${string}`);
  return target;
}

const naturalWidthOf = (locator: ReturnType<Page['getByTestId']>) =>
  locator.evaluate((el: HTMLImageElement) => el.naturalWidth);

test('AppEdit previews follow the picked splash/PWA icon and undo/redo', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-feat2-app-'));
  // スプラッシュ: サイズの違う 2 枚（300x200 / 640x480）。naturalWidth で見分ける
  const splashA = await makePng(e2eRoot, 'splash-a.png', 300, 200, 0x00ff00ff);
  const splashB = await makePng(e2eRoot, 'splash-b.png', 640, 480, 0x0000ffff);
  // PWA アイコン: 512 以上の正方形 2 枚（色違い = 保存名 uuid が変わる）
  const iconA = await makePng(e2eRoot, 'icon-a.png', 512, 512, 0xff0000ff);
  const iconB = await makePng(e2eRoot, 'icon-b.png', 512, 512, 0x00ffffff);

  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.evaluate(() => window.settings.set('lang', 'ja'));
    await page.reload();
    await openHash(page, '#/appedit', '[data-testid="app-id"]');

    const splashPreview = page.getByTestId('appedit-splash-preview');
    const iconPreview = page.getByTestId('appedit-icon-preview');

    // --- スプラッシュ: 1 枚目（指定直後に見える） ---
    await installDialogHarness(app, splashA);
    await page.getByTestId('appedit-splash-upload').click();
    await expect(splashPreview).toBeVisible({ timeout: 30_000 });
    await expect(splashPreview).toHaveAttribute('src', /^app:\/\/bundle\/__local\//);
    await expect.poll(() => naturalWidthOf(splashPreview)).toBe(300);
    const splashSrcA = await splashPreview.getAttribute('src');

    // --- スプラッシュ: 2 枚目（保存前でも 2 枚目に変わる） ---
    await installDialogHarness(app, splashB);
    await page.getByTestId('appedit-splash-upload').click();
    await expect.poll(() => naturalWidthOf(splashPreview)).toBe(640);
    const splashSrcB = await splashPreview.getAttribute('src');
    expect(splashSrcB).not.toBe(splashSrcA);

    // --- Undo で 1 枚目 / Redo で 2 枚目 ---
    await page.getByTestId('editor-undo').click();
    await expect.poll(() => naturalWidthOf(splashPreview)).toBe(300);
    await expect(splashPreview).toHaveAttribute('src', splashSrcA as string);
    await page.getByTestId('editor-redo').click();
    await expect.poll(() => naturalWidthOf(splashPreview)).toBe(640);
    await expect(splashPreview).toHaveAttribute('src', splashSrcB as string);

    // --- PWA アイコン: PWA 設定セクション（v-if="pwaEnabled"）と appID が必要なので先に用意する ---
    const appId = page.getByTestId('app-id');
    await appId.fill('feat2-preview-app');
    await appId.press('Tab');
    await page.getByTestId('app-pwa-toggle').check();
    await expect(page.getByTestId('appedit-icon-upload')).toBeVisible();

    await installDialogHarness(app, iconA);
    await page.getByTestId('appedit-icon-upload').click();
    await expect(iconPreview).toBeVisible({ timeout: 30_000 });
    await expect(iconPreview).toHaveAttribute('src', /^app:\/\/bundle\/__local\//);
    await expect.poll(() => naturalWidthOf(iconPreview)).toBe(512);
    const iconSrcA = await iconPreview.getAttribute('src');

    await installDialogHarness(app, iconB);
    await page.getByTestId('appedit-icon-upload').click();
    await expect.poll(async () => iconPreview.getAttribute('src')).not.toBe(iconSrcA);
    await expect.poll(() => naturalWidthOf(iconPreview)).toBe(512);
    const iconSrcB = await iconPreview.getAttribute('src');

    // --- Undo で 1 枚目 / Redo で 2 枚目（アイコンも追随する） ---
    await page.getByTestId('editor-undo').click();
    await expect(iconPreview).toHaveAttribute('src', iconSrcA as string);
    await page.getByTestId('editor-redo').click();
    await expect(iconPreview).toHaveAttribute('src', iconSrcB as string);

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});
