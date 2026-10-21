// nov26-editor-feat2 (コミット2) E2E: 画像アセットの「指定した直後」の一次表示と Undo/Redo 追随、
// 複製の流れ（元アセットの画像 → 選び直し → undo/redo → 保存）。
//
// 設計書 `.nayuta/2026-10-21-nov26-editor-feat2-design.md` §4.3〜§4.8（AC1〜AC7）と、
// 設計レビュー（NOV26-DR-EDITOR-FEATURES-0456 追補）の指示:
//   (a) 既存アセットを複製すると元の画像が app:// で表示
//   (b) 複製の画面で別の画像を選ぶと、保存前に src が data:image/ になり新しい画像に変わる・
//       「保存前のプレビュー」も出る
//   (c) undo で元アセットの画像（app://）に戻る・redo で新しい画像
//   (d) 保存すると新しいアセットとして新しい画像が保存され、元アセットのファイルは変わらない
//
// 2 枚の画像はサイズを変えて作り、naturalWidth で見分ける。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const LOCAL_URL_PREFIX = 'app://bundle/__local';

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
  if (!path.resolve(saveFolder).startsWith(path.resolve(e2eRoot) + path.sep)) {
    throw new Error(`E2E storage isolation failed: ${saveFolder} is outside ${e2eRoot}`);
  }
  return { app, page };
}

// 次のクリックで選ばれる画像を差し替える（実 main の dialog を差し替える。前例 m11-t4 / m19-t12）
async function installDialogHarness(app: ElectronApplication, imagePath: string): Promise<void> {
  await app.evaluate(async ({ dialog }, selectedImage) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [selectedImage] })) as typeof dialog.showOpenDialog;
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
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

/** `app://bundle/__local/<絶対パス>` → ネイティブ絶対パス */
function localPathOf(url: string): string {
  expect(url.startsWith(LOCAL_URL_PREFIX)).toBe(true);
  return decodeURIComponent(url.slice(LOCAL_URL_PREFIX.length));
}

const sha256 = async (filePath: string): Promise<string> =>
  createHash('sha256').update(await readFile(filePath)).digest('hex');

const naturalWidthOf = (locator: ReturnType<Page['getByTestId']>) =>
  locator.evaluate((el: HTMLImageElement) => el.naturalWidth);

const listCount = (page: Page): Promise<number> => page.evaluate(async () => (await window.imageAssets.list()).length);

test('新規登録は指定直後に一次画像（data:）を出し、undo/redo と保存で切り替わる', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-feat2-asset-'));
  const imageA = await makePng(e2eRoot, 'pick-a.png', 300, 200, 0x00ff00ff);
  const imageB = await makePng(e2eRoot, 'pick-b.png', 640, 480, 0x0000ffff);
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.evaluate(() => window.settings.set('lang', 'ja'));
    await page.reload();
    await openHash(page, '#/assets', '[data-master-detail="image-asset"]');
    await page.getByTestId('asset-new').click();
    await expect(page.getByTestId('asset-pick-file')).toBeVisible();

    const preview = page.getByTestId('asset-source-preview');
    const unsavedBadge = page.getByTestId('asset-preview-unsaved');
    // AC2: 指定しただけでは一覧（＝保存済み実体）は増えない
    const before = await listCount(page);

    // AC1: 指定直後に一次画像（data:）が出る。保存前であることも示す
    await installDialogHarness(app, imageA);
    await page.getByTestId('asset-pick-file').click();
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect(preview).toHaveAttribute('src', /^data:image\//);
    await expect.poll(() => naturalWidthOf(preview)).toBe(300);
    await expect(unsavedBadge).toBeVisible();
    expect(await listCount(page)).toBe(before);

    // AC4: 2 枚目を選ぶと保存前に 2 枚目へ変わる（サイズで見分ける）
    await installDialogHarness(app, imageB);
    await page.getByTestId('asset-pick-file').click();
    await expect.poll(() => naturalWidthOf(preview)).toBe(640);

    // AC3: 指定 1 回 = Undo 1 段。undo で 1 枚目・redo で 2 枚目
    await page.getByTestId('editor-undo').click();
    await expect.poll(() => naturalWidthOf(preview)).toBe(300);
    await expect(preview).toHaveAttribute('src', /^data:image\//);
    await page.getByTestId('editor-redo').click();
    await expect.poll(() => naturalWidthOf(preview)).toBe(640);

    // AC5: 保存すると保存済み実体（app://）へ切り替わり、「保存前のプレビュー」が消える
    const slug = page.getByTestId('asset-slug');
    await slug.fill('feat2-new-asset');
    await slug.press('Tab');
    const title = page.getByTestId('asset-title');
    await title.fill('Feat2 新規アセット');
    await title.press('Tab');
    await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId('editor-save').click();
    await expect(page).not.toHaveURL(/new=1/, { timeout: 30_000 });
    await expect(preview).toHaveAttribute('src', /^app:\/\/bundle\/__local\//, { timeout: 30_000 });
    await expect(unsavedBadge).toHaveCount(0);
    await expect.poll(() => naturalWidthOf(preview)).toBe(640);
    expect(await listCount(page)).toBe(before + 1);

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});

test('複製は元アセットの画像を出し、選び直しで一次画像・undo/redo・保存で元の実体を壊さない', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-feat2-dup-'));
  const imageA = await makePng(e2eRoot, 'source.png', 300, 200, 0x00ff00ff);
  const imageB = await makePng(e2eRoot, 'pick.png', 640, 480, 0x0000ffff);
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.evaluate(() => window.settings.set('lang', 'ja'));
    await page.reload();
    await openHash(page, '#/assets', '[data-master-detail="image-asset"]');

    // 元アセットを 1 件用意する（API 経由。UI の新規登録経路は上のテストが見る）
    const seeded = await page.evaluate(async (sourcePath) => {
      const result = await window.imageAssets.add({
        slug: 'feat2-source', title: { ja: '元アセット' }, lang: 'ja',
        sourceName: 'source.png', sourcePath,
      });
      return result;
    }, imageA);
    expect(seeded.result).toBe('Success');
    const sourceUid = (seeded as { uid: string }).uid;
    await page.reload();
    await expect(page.getByTestId('asset-row-feat2-source')).toBeVisible({ timeout: 30_000 });
    const sourceUrl = await page.evaluate((uid) => window.imageAssets.getFilePath(uid), sourceUid);
    expect(sourceUrl).not.toBeNull();
    const sourcePath = localPathOf(sourceUrl as string);
    const sourceHashBefore = await sha256(sourcePath);

    // (a) 複製すると元アセットの画像が app:// で表示される
    await page.getByTestId('asset-row-feat2-source').locator('[data-resource-action-trigger]').click();
    await page.locator('[role="menuitem"]:has-text("複製")').click();
    const preview = page.getByTestId('asset-source-preview');
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect(preview).toHaveAttribute('src', /^app:\/\/bundle\/__local\//);
    await expect.poll(() => naturalWidthOf(preview)).toBe(300);
    const duplicateSrc = await preview.getAttribute('src');
    expect(duplicateSrc).toBe(sourceUrl);

    // (b) 複製の画面で別の画像を選ぶと、保存前に data: へ変わり新しい画像になる
    await installDialogHarness(app, imageB);
    await page.getByTestId('asset-pick-file').click();
    await expect(preview).toHaveAttribute('src', /^data:image\//, { timeout: 30_000 });
    await expect.poll(() => naturalWidthOf(preview)).toBe(640);
    await expect(page.getByTestId('asset-preview-unsaved')).toBeVisible();

    // (c) undo で元アセットの画像（app://）・redo で新しい画像（data:）
    await page.getByTestId('editor-undo').click();
    await expect(preview).toHaveAttribute('src', /^app:\/\/bundle\/__local\//, { timeout: 30_000 });
    await expect.poll(() => naturalWidthOf(preview)).toBe(300);
    await page.getByTestId('editor-redo').click();
    await expect(preview).toHaveAttribute('src', /^data:image\//, { timeout: 30_000 });
    await expect.poll(() => naturalWidthOf(preview)).toBe(640);

    // (d) 保存すると新しいアセットとして新しい画像が保存され、元アセットの実体は変わらない
    await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId('editor-save').click();
    await expect(page).not.toHaveURL(/new=1/, { timeout: 30_000 });
    await expect(preview).toHaveAttribute('src', /^app:\/\/bundle\/__local\//, { timeout: 30_000 });
    await expect.poll(() => naturalWidthOf(preview)).toBe(640);

    const rows = await page.evaluate(async () => window.imageAssets.list());
    const copy = rows.find((row: { slug: string }) => row.slug === 'feat2-source-copy');
    expect(copy).toBeTruthy();
    expect(copy.uid).not.toBe(sourceUid);
    const copyUrl = await page.evaluate((uid) => window.imageAssets.getFilePath(uid), copy.uid);
    const copyPath = localPathOf(copyUrl as string);
    expect(copyPath).not.toBe(sourcePath);
    expect(await readFile(copyPath)).toEqual(await readFile(imageB)); // 新しい画像が保存されている
    expect(await sha256(sourcePath)).toBe(sourceHashBefore); // 元アセットの実体は変わらない

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});

test('表示できない画像は理由を出し、保存は妨げない（20 MB 超 / 読み取り不能）', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-feat2-guard-'));
  // 20 MB を超える「PNG という名前のファイル」。main はデコードせずサイズで弾く
  const tooLarge = path.join(e2eRoot, 'too-large.png');
  await writeFile(tooLarge, Buffer.alloc(21 * 1024 * 1024, 0x89));
  const missing = path.join(e2eRoot, 'deleted.png');
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.evaluate(() => window.settings.set('lang', 'ja'));
    await page.reload();
    await openHash(page, '#/assets', '[data-master-detail="image-asset"]');

    // AC6: 20 MB 超は一次表示せず理由文。保存は押せる（保存時の拒否は既存挙動）
    await page.getByTestId('asset-new').click();
    await installDialogHarness(app, tooLarge);
    await page.getByTestId('asset-pick-file').click();
    const issue = page.getByTestId('asset-preview-issue');
    await expect(issue).toBeVisible({ timeout: 30_000 });
    await expect(issue).toContainText('大きすぎるため');
    await expect(page.getByTestId('asset-source-preview')).toHaveCount(0);
    await expect(page.getByTestId('asset-preview-unsaved')).toHaveCount(0);

    // AC7: 指定後にファイルが消えた（移動・削除）ときは理由文を出し、画面は壊れない
    await page.getByTestId('asset-new').click();
    await installDialogHarness(app, missing);
    await page.getByTestId('asset-pick-file').click();
    await expect(issue).toBeVisible({ timeout: 30_000 });
    await expect(issue).toContainText('表示できません');
    await expect(page.getByTestId('asset-source-preview')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});
