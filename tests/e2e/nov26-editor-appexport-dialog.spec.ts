// nov26-editor-appexport-dialog: アプリのエクスポートを地図のエクスポートと同じ形
// （ボタン => 確認ダイアログ => 実施）に揃える（人間決定）。
//
//   (a) 「エクスポート」の横にチェックは無く、押すと地図と同じ形の小窓が開く。
//       題は mapedit.export_options_title（「エクスポートする中身」）、
//       「タイル（サムネイルを含む）」が既定でオン、横に地図と同じ ? ヘルプ。取り消すと何もしない
//   (b) 未保存の変更があるときの順序は地図と同じ（保存してエクスポート／保存済み版をエクスポートの選択 → 小窓 → 実施）。
//       その選択で取り消すと小窓は開かない。小窓で取り消しても何も書き出さない
//
// 保存・確認のネイティブダイアログは差し替える（前例 tests/e2e/helpers/mapPackage.ts）。
import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import {
  launch,
  openHash,
  saveFolderOf,
  stubMessageBoxAutoOk,
  seedFullMap,
} from './helpers/mapPackage';

type Launched = Awaited<ReturnType<typeof launch>>;

const TILES_HELP_JA =
  '地図を表示するために、画像を小さな正方形に分けたものです。地図を開くときに使います。サムネイル（一覧に出る小さな画像）も含みます。';

async function stubSaveDialog(app: Launched['app'], zip: string): Promise<void> {
  await app.evaluate(async ({ dialog }, out) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: out })) as typeof dialog.showSaveDialog;
  }, zip);
}

/** 書き出しの完了の進捗モーダル（OK で閉じる）を閉じる。前例 nov26-m6-t8 の closeFinishedModals */
async function closeFinishedModals(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const modal = page.locator('.modal.d-block');
    if (await modal.count() === 0) return;
    const ok = modal.locator('button', { hasText: 'OK' }).first();
    if (await ok.count() === 0) break;
    await ok.click({ timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  await expect(page.locator('.modal.d-block')).toHaveCount(0, { timeout: 20000 });
}

/** 地図 1 件＋それを 1 つめのソースに持つアプリ 1 件を作り、アプリの編集画面を開く */
async function seedApp(launched: Launched, e2eRoot: string, prefix: string): Promise<{ appUid: string; mapSlug: string }> {
  const { page } = launched;
  const seeded = await seedFullMap(page, await saveFolderOf(page), e2eRoot, { prefix, title: `${prefix} の地図` });
  const appUid = await page.evaluate(async ({ mapSlug, mapUid }) => {
    const slug = `appedit-export-${Date.now()}`;
    const uid = crypto.randomUUID();
    const r = await window.appedit.save({
      uid, slug, create: true,
      document: {
        appID: slug, appName: { ja: 'Explain App' }, title: { ja: 'Explain App' },
        description: {}, keywords: '', siteUrl: '', lang: 'ja',
        sources: [{ sourceType: 'maplat', mapUid, mapSlug }],
        startFrom: mapSlug, pois: [], httpSettings: {}, appSettings: {}, manifestSettings: {},
      },
    });
    if (!r || r.result !== 'Success') throw new Error(JSON.stringify(r));
    return uid;
  }, { mapSlug: seeded.mapSlug, mapUid: seeded.mapUid });
  await openHash(page, `#/appedit?uid=${appUid}`);
  await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30000 });
  return { appUid, mapSlug: seeded.mapSlug };
}

test.describe('nov26-editor-appexport-dialog: アプリのエクスポートの確認ダイアログ', () => {
  test('(a) ボタン → 小窓（地図と同じ形）→ 実施。取り消すと何もしない', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-appexport-dialog-'));
    const launched = await launch(e2eRoot);
    const { app, page } = launched;
    try {
      await stubMessageBoxAutoOk(app);
      await seedApp(launched, e2eRoot, 'appexport');

      // ボタンの横のチェック（旧 appExportExcludeTiles）は無い
      await expect(page.getByTestId('app-export-exclude-tiles')).toHaveCount(0);
      await expect(page.locator('#appExportExcludeTiles')).toHaveCount(0);

      const zip = path.join(e2eRoot, 'app-export.zip');
      await stubSaveDialog(app, zip);
      await page.locator('[data-editor-action="export"]').click();

      // 地図と同じ形の小窓
      const modal = page.getByTestId('app-export-options');
      await expect(modal).toBeVisible({ timeout: 30000 });
      await expect(modal.locator('.modal-title')).toHaveText('エクスポートする中身');
      const tiles = page.getByTestId('app-export-option-tiles');
      await expect(tiles).toBeChecked();
      const tilesHelp = modal.getByTestId('app-export-option-tiles-help');
      await expect(tilesHelp).toBeVisible();
      await expect(tilesHelp).toHaveAttribute('aria-label', TILES_HELP_JA);
      await expect(tilesHelp.locator('i.bi-question-circle')).toHaveCount(1);
      await expect(modal.getByText('タイル（サムネイルを含む）')).toBeVisible();

      // 取り消すと何もしない（保存先の選択も呼ばれない）
      await page.getByTestId('app-export-options-cancel').click();
      await expect(modal).toHaveCount(0);
      await page.waitForTimeout(1500);
      expect(existsSync(zip)).toBe(false);
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 30000 });

      // 実施: タイルは既定で入る（地図と同じ既定）
      await page.locator('[data-editor-action="export"]').click();
      await expect(modal).toBeVisible({ timeout: 30000 });
      await expect(tiles).toBeChecked();
      await page.getByTestId('app-export-options-confirm').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 120000 });
      await closeFinishedModals(page);
      const { default: AdmZip } = await import('adm-zip');
      const names = new AdmZip(zip).getEntries().filter((e) => !e.isDirectory).map((e) => e.entryName);
      expect(names.some((n) => n.startsWith('tiles/'))).toBe(true);
      console.log('  (a): PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('(b) 未保存の変更があるときは「保存してエクスポート」の選択が先、小窓が後', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-appexport-dialog-dirty-'));
    const launched = await launch(e2eRoot);
    const { app, page } = launched;
    try {
      await seedApp(launched, e2eRoot, 'appexportdirty');

      // 未保存の変更を作る
      await page.getByTestId('app-title').fill('Explain App 未保存');
      await page.waitForTimeout(500);

      // (1) 未保存のときの選択で取り消す → 小窓は開かない
      const calls: string[] = [];
      await app.evaluate(async ({ dialog }) => {
        const g = globalThis as unknown as { __appExportOrder: string[] };
        g.__appExportOrder = [];
        dialog.showMessageBox = (async () => {
          g.__appExportOrder.push('dirty-choice');
          return { response: 2, checkboxChecked: false };
        }) as unknown as typeof dialog.showMessageBox;
        dialog.showSaveDialog = (async () => {
          g.__appExportOrder.push('save-dialog');
          return { canceled: true, filePath: undefined };
        }) as unknown as typeof dialog.showSaveDialog;
      });
      const canceledZip = path.join(e2eRoot, 'dirty-canceled.zip');
      await stubSaveDialog(app, canceledZip);
      await page.locator('[data-editor-action="export"]').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 60000 });
      await page.waitForTimeout(1000);
      await expect(page.getByTestId('app-export-options')).toHaveCount(0);
      expect(existsSync(canceledZip)).toBe(false);
      const firstOrder = await app.evaluate(async () => (globalThis as unknown as { __appExportOrder: string[] }).__appExportOrder);
      calls.push(...firstOrder);
      expect(calls).toEqual(['dirty-choice']);

      // (2) 「保存してエクスポート」を選ぶ → 保存の後に小窓。小窓で取り消すと書き出さない
      await app.evaluate(async ({ dialog }) => {
        const g = globalThis as unknown as { __appExportOrder: string[] };
        g.__appExportOrder = [];
        dialog.showMessageBox = (async () => {
          g.__appExportOrder.push('dirty-choice');
          return { response: 0, checkboxChecked: false };
        }) as unknown as typeof dialog.showMessageBox;
        dialog.showSaveDialog = (async () => {
          g.__appExportOrder.push('save-dialog');
          return { canceled: true, filePath: undefined };
        }) as unknown as typeof dialog.showSaveDialog;
      });
      await page.locator('[data-editor-action="export"]').click();
      const modal = page.getByTestId('app-export-options');
      await expect(modal).toBeVisible({ timeout: 60000 });
      const orderWhileModal = await app.evaluate(async () => (globalThis as unknown as { __appExportOrder: string[] }).__appExportOrder);
      expect(orderWhileModal).toEqual(['dirty-choice']); // 保存の選択が済んでから小窓が出ている
      await page.getByTestId('app-export-options-cancel').click();
      await expect(modal).toHaveCount(0);
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 60000 });
      await page.waitForTimeout(1000);
      const afterCancel = await app.evaluate(async () => (globalThis as unknown as { __appExportOrder: string[] }).__appExportOrder);
      expect(afterCancel).toEqual(['dirty-choice']); // 小窓で取り消したので保存先の選択は呼ばれない
      console.log('  (b): PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
