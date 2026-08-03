// M5-T6: JPEG デコード上限の設定値化と不足の事前通知 E2E。
//
// 検証する受け入れ条件（設計 §9.2 / §9.3）:
//   AC9   設定ページで2フィールドを変更・保存・再読込でき、isDirty が両方に効く
//   AC13  prediction を持たない失敗は汎用文言（mapedit.error_image_upload）へ落ちる
//   AC14  Canceled はエラー表示せずモーダルを閉じるだけ
//   AC15  UI に**現在の設定値・必要量・推奨値の3数値が実際に描画される**
//
// AC15 が実起動を要する理由: main の構造化エラー → IPC → renderer の分岐 →
// ProgressModal の textParams → i18n 補間、が全部繋がって初めて数値が出る。
// smoke（main 側）では「契約が返ること」までしか確かめられない。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
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
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  return { app, page };
}

async function openHash(page: Page, hash: string, waitFor?: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
  if (waitFor) await expect(page.locator(waitFor)).toBeVisible({ timeout: 15_000 });
}

/** m12-t17 / m1-t6-hotfix-2 と同型のダイアログ差し替えハーネス */
async function installDialogHarness(app: ElectronApplication, imagePath: string | null): Promise<void> {
  await app.evaluate(async ({ dialog }, selectedImage) => {
    dialog.showOpenDialog = (async () => (
      selectedImage === null
        ? { canceled: true, filePaths: [] }
        : { canceled: false, filePaths: [selectedImage] }
    )) as typeof dialog.showOpenDialog;
  }, imagePath);
}

// ProgressModal のルートは `class="modal d-block"`（v-if で出し入れする）。
// このセレクタが実際に一致することは AC15 の2テストが本文を assert して裏取りしている
// （AC14 の「消えている」だけだと、セレクタが誤っていても通ってしまう）。
const MODAL = '.modal.d-block';

/** 進捗モーダルに出ている文言（ProgressModal が t() を通した結果） */
async function modalText(page: Page): Promise<string> {
  return (await page.locator(MODAL).innerText()).replace(/\s+/g, ' ');
}

test.describe('M5-T6 JPEG デコード上限の設定値化と不足の事前通知', () => {
  test('AC9: 設定ページで2フィールドを変更・保存でき、再読込しても保存値が出る', async () => {
    test.setTimeout(120_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m5t6-settings-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await openHash(page, '#/settings', '#langSwitcher');

      const memory = page.locator('#jpegDecodeMaxMemoryMB');
      const resolution = page.locator('#jpegDecodeMaxResolutionMP');
      const saveButton = page.getByRole('button', { name: '保存' });

      // 既定値が出ている
      await expect(memory).toHaveValue('8192');
      await expect(resolution).toHaveValue('800');
      await expect(saveButton).toBeDisabled();

      // isDirty がメモリ側フィールドに効く
      await memory.fill('12288');
      await expect(saveButton).toBeEnabled();

      // リセットで戻る
      await page.getByRole('button', { name: 'リセット' }).click();
      await expect(memory).toHaveValue('8192');
      await expect(saveButton).toBeDisabled();

      // isDirty が解像度側フィールドにも効く（片方だけの比較になっていないこと）
      await resolution.fill('1200');
      await expect(saveButton).toBeEnabled();
      await page.getByRole('button', { name: 'リセット' }).click();
      await expect(saveButton).toBeDisabled();

      // 両方変更して保存
      await memory.fill('12288');
      await resolution.fill('1200');
      await saveButton.click();
      await expect(saveButton).toBeDisabled({ timeout: 10_000 });

      // 画面を離れて戻ると保存値が出る
      await openHash(page, '#/maplist');
      await openHash(page, '#/settings', '#langSwitcher');
      await expect(memory).toHaveValue('12288');
      await expect(resolution).toHaveValue('1200');

      // main 側にも届いている
      const stored = await page.evaluate(async () => ({
        mem: await window.settings.get('jpegDecodeMaxMemoryMB'),
        res: await window.settings.get('jpegDecodeMaxResolutionMP'),
      }));
      expect(stored).toEqual({ mem: 12288, res: 1200 });
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC15: メモリ不足のとき、現在の設定値・必要量・推奨値の3数値が実際に描画される', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m5t6-mem-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 下限（512）まで下げる。8000x6000 = 48 MP の JPEG は 1008 MB を要するので不足する
      await page.evaluate(() => window.settings.set('jpegDecodeMaxMemoryMB', 512));

      const imagePath = path.join(e2eRoot, 'big.jpg');
      const { Jimp } = await import('jimp');
      await new Jimp({ width: 8000, height: 6000, color: 0x3366ccff }).write(imagePath as `${string}.${string}`);

      await openHash(page, '#/mapedit', '[data-testid="map-title"]');
      await installDialogHarness(app, imagePath);
      await page.getByRole('button', { name: '地図画像登録' }).click();

      const okButton = page.getByRole('button', { name: 'OK' });
      await expect(okButton).toBeEnabled({ timeout: 60_000 });

      const text = await modalText(page);
      // 汎用文言ではなく、具体的な数値が出ていること
      expect(text).not.toContain('地図画像登録でエラーが発生しました');
      expect(text).toContain('1008');   // 必要量（予測）
      expect(text).toContain('512');    // 現在の設定値
      expect(text).toContain('1039');   // 推奨値 = ceil(1008 * 1.03)
      await okButton.click();
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC15: 解像度不足のとき、現在の設定値・画像の MP・推奨値が描画される', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m5t6-res-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 下限（100 MP）まで下げる。11000x10000 = 110 MP なので超える
      await page.evaluate(() => window.settings.set('jpegDecodeMaxResolutionMP', 100));

      const imagePath = path.join(e2eRoot, 'huge.jpg');
      const { Jimp } = await import('jimp');
      await new Jimp({ width: 11000, height: 10000, color: 0x3366ccff }).write(imagePath as `${string}.${string}`);

      await openHash(page, '#/mapedit', '[data-testid="map-title"]');
      await installDialogHarness(app, imagePath);
      await page.getByRole('button', { name: '地図画像登録' }).click();

      const okButton = page.getByRole('button', { name: 'OK' });
      await expect(okButton).toBeEnabled({ timeout: 120_000 });

      const text = await modalText(page);
      expect(text).not.toContain('地図画像登録でエラーが発生しました');
      expect(text).toContain('110');    // 画像の MP と推奨値（ceil(110) = 110・マージン無し）
      expect(text).toContain('100');    // 現在の設定値
      await okButton.click();
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC13: prediction を持たない失敗は汎用文言へ落ちる', async () => {
    test.setTimeout(120_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m5t6-generic-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 拡張子は jpg だが中身が壊れている＝上限起因でない失敗（errorCode: 'unknown'）。
      // 予測は SOF を読めず null を返すので prediction が付かない経路になる。
      const brokenPath = path.join(e2eRoot, 'broken.jpg');
      await writeFile(brokenPath, Buffer.alloc(4096, 0x00));

      await openHash(page, '#/mapedit', '[data-testid="map-title"]');
      await installDialogHarness(app, brokenPath);
      await page.getByRole('button', { name: '地図画像登録' }).click();

      const okButton = page.getByRole('button', { name: 'OK' });
      await expect(okButton).toBeEnabled({ timeout: 60_000 });
      expect(await modalText(page)).toContain('地図画像登録でエラーが発生しました');
      await okButton.click();
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC14: キャンセルはエラー表示せずモーダルを閉じる', async () => {
    test.setTimeout(120_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m5t6-cancel-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await openHash(page, '#/mapedit', '[data-testid="map-title"]');
      await installDialogHarness(app, null);   // canceled: true を返す
      await page.getByRole('button', { name: '地図画像登録' }).click();

      // モーダルが閉じ、エラー文言も出ていない
      await expect(page.locator(MODAL)).toBeHidden({ timeout: 30_000 });
      expect(await page.locator('body').innerText()).not.toContain('エラーが発生しました');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
