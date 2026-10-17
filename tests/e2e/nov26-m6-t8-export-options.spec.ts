// nov26-m6-t8（#113・HR-19）: 書き出す中身の選択の実 UI（タスク設計 v2 §6・AC3・AC5）。
//
//   (a) 地図の書き出しで選択の画面が既定の状態（タイル・JSON が入り、原画像は外れている）で開き、
//       原画像を入れタイルを外して書き出す → もう一度開くと既定に戻っている。3 つとも外すと押せない
//   (b) アプリの書き出しで「タイルを含めない」を入れて書き出す → zip にタイルが無く、書き出しの後は外れている
//   (c) タイルも原画像も外して書き出した zip を取り込み、その地図を一覧と編集画面で開いて、
//       renderer の pageerror・main の console.error に例外が出ない（T8-MIN-2）
//
// 保存・開くのネイティブダイアログは差し替える（前例 tests/e2e/helpers/mapPackage.ts）。
import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import {
  launch,
  openHash,
  saveFolderOf,
  stubMessageBoxAutoOk,
  seedFullMap,
  PNG_B64,
} from './helpers/mapPackage';

type Launched = Awaited<ReturnType<typeof launch>>;

async function stubSaveDialog(app: Launched['app'], zip: string): Promise<void> {
  await app.evaluate(async ({ dialog }, out) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: out })) as typeof dialog.showSaveDialog;
  }, zip);
}

async function expectDefaultMapOptions(page: Page): Promise<void> {
  const modal = page.getByTestId('map-export-options');
  await expect(modal).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('map-export-option-tiles')).toBeChecked();
  await expect(page.getByTestId('map-export-option-json')).toBeChecked();
  await expect(page.getByTestId('map-export-option-originals')).not.toBeChecked();
  await expect(page.getByTestId('map-export-options-confirm')).toBeEnabled();
}

/** 書き出しの完了の進捗モーダル（OK で閉じる）を閉じる。前例 m19-t1 の dismissStartupModals */
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

async function zipNames(zip: string): Promise<string[]> {
  const { default: AdmZip } = await import('adm-zip');
  return new AdmZip(zip).getEntries().filter((e) => !e.isDirectory).map((e) => e.entryName).sort();
}

test.describe('nov26-m6-t8: 書き出す中身の選択', () => {
  test('(a)(c) 地図: 既定で開き・選んだ中身だけ書き出し・毎回既定へ戻り、タイル無しの zip を取り込んで開ける', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6t8-map-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxAutoOk(app);
      const saveFolder = await saveFolderOf(page);
      const seeded = await seedFullMap(page, saveFolder, e2eRoot, { prefix: 'm6t8', title: 'M6T8 地図' });
      // 原画像の実体（内部は uid キー。seed の imageExtension は jpg）
      await mkdir(path.join(saveFolder, 'originals'), { recursive: true });
      await writeFile(path.join(saveFolder, 'originals', `${seeded.mapUid}.jpg`), Buffer.from(PNG_B64, 'base64'));

      // ---- (a) 既定の状態で開き、原画像を入れタイルを外して書き出す ----
      const zipA = path.join(e2eRoot, 'map-a.zip');
      await stubSaveDialog(app, zipA);
      await openHash(page, `#/mapedit?uid=${seeded.mapUid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 30000 });
      await page.locator('[data-editor-action="export"]').click();
      await expectDefaultMapOptions(page);
      await expect(page.getByTestId('map-export-option-originals-note')).toBeVisible();
      await page.getByTestId('map-export-option-originals').check();
      await page.getByTestId('map-export-option-tiles').uncheck();
      await page.getByTestId('map-export-options-confirm').click();
      await expect(page.getByTestId('map-export-options')).toBeHidden();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 120000 });
      await closeFinishedModals(page);
      const namesA = await zipNames(zipA);
      expect(namesA).toContain(`maps/${seeded.mapSlug}.json`);
      expect(namesA).toContain(`originals/${seeded.mapSlug}.jpg`);
      expect(namesA).toContain('export-manifest.json');
      expect(namesA.filter((n) => n.startsWith('tiles/') || n.startsWith('tmbs/'))).toEqual([]);

      // ---- (a) もう一度開くと既定に戻っている。3 つとも外すと押せない ----
      await page.locator('[data-editor-action="export"]').click();
      await expectDefaultMapOptions(page);
      await page.getByTestId('map-export-option-tiles').uncheck();
      await page.getByTestId('map-export-option-json').uncheck();
      await expect(page.getByTestId('map-export-options-confirm')).toBeDisabled();
      await expect(page.getByTestId('map-export-options-none-selected')).toBeVisible();
      await page.getByTestId('map-export-option-json').check();
      await expect(page.getByTestId('map-export-options-confirm')).toBeEnabled();
      await page.getByTestId('map-export-options-cancel').click();
      await expect(page.getByTestId('map-export-options')).toBeHidden();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 30000 });

      // ---- (c) タイルも原画像も外した zip を作る ----
      const zipC = path.join(e2eRoot, 'map-c.zip');
      await stubSaveDialog(app, zipC);
      await page.locator('[data-editor-action="export"]').click();
      await expectDefaultMapOptions(page);
      await page.getByTestId('map-export-option-tiles').uncheck();
      await page.getByTestId('map-export-options-confirm').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 120000 });
      await closeFinishedModals(page);
      const namesC = await zipNames(zipC);
      expect(namesC.filter((n) => /^(tiles|tmbs|originals)\//.test(n))).toEqual([]);
      expect(namesC).toContain('export-manifest.json');

      // ---- (c) 取り込んで一覧と編集画面で開き、例外が出ないこと ----
      const pageErrors: string[] = [];
      const mainErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(String(err?.stack ?? err)));
      app.on('console', (msg) => { if (msg.type() === 'error') mainErrors.push(msg.text()); });
      // 見張りが空振りしていないことの確認（main の console.error が実際に拾えること）
      await app.evaluate(() => { console.error('m6t8-probe'); });
      await expect.poll(() => mainErrors.includes('m6t8-probe'), { timeout: 10000 }).toBe(true);
      mainErrors.length = 0;

      await app.evaluate(async ({ dialog }, zip) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [zip] })) as typeof dialog.showOpenDialog;
      }, zipC);
      await openHash(page, '#/maplist');
      const importButton = page.locator('[data-resource-import]');
      await expect(importButton).toBeVisible({ timeout: 30000 });
      await importButton.click();
      await expect(page.getByText('正常に地図データが登録できました。')).toBeVisible({ timeout: 120000 });
      await expect(page.getByTestId('map-title')).toHaveValue('M6T8 地図', { timeout: 30000 });

      const importedSlug = `${seeded.mapSlug}-2`;
      const imported = await page.evaluate((slug) => window.mapedit.request(slug), importedSlug);
      expect(imported.mapID).toBe(importedSlug);
      expect(imported.uid).not.toBe(seeded.mapUid);

      // 一覧で開く
      await openHash(page, '#/maplist');
      const listSlugs = await page.evaluate(async () =>
        (await window.maplist.request('', 1, 100)).docs.map((d: { mapID: string }) => d.mapID));
      expect(listSlugs).toContain(importedSlug);
      await expect(page.getByText('M6T8 地図').first()).toBeVisible({ timeout: 30000 });
      // 編集画面で開く
      await openHash(page, `#/mapedit?uid=${imported.uid}`);
      await expect(page.getByTestId('map-title')).toHaveValue('M6T8 地図', { timeout: 30000 });
      await page.waitForTimeout(2000);

      expect(pageErrors, 'renderer に例外が出ない').toEqual([]);
      expect(mainErrors, 'main に console.error が出ない').toEqual([]);
      console.log('  (a)(c): PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('(b) アプリ: 「タイルを含めない」で書き出すと zip にタイルが無く、書き出しの後は外れている', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6t8-app-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxAutoOk(app);
      const seeded = await seedFullMap(page, await saveFolderOf(page), e2eRoot, { prefix: 'm6t8app', title: 'M6T8 アプリの地図' });
      const appUid = await page.evaluate(async ({ mapSlug, mapUid }) => {
        const slug = `m6t8-app-${Date.now()}`;
        const uid = crypto.randomUUID();
        const r = await window.appedit.save({
          uid, slug, create: true,
          document: {
            appID: slug, appName: { ja: 'M6T8 App' }, title: { ja: 'M6T8 App' },
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
      const exclude = page.getByTestId('app-export-exclude-tiles');
      await expect(exclude).not.toBeChecked();

      // 既定（含める）
      const zipWith = path.join(e2eRoot, 'app-with.zip');
      await stubSaveDialog(app, zipWith);
      await page.locator('[data-editor-action="export"]').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 120000 });
      await closeFinishedModals(page);
      const namesWith = await zipNames(zipWith);
      expect(namesWith.some((n) => n.startsWith(`tiles/${seeded.mapSlug}/`))).toBe(true);

      // 「タイルを含めない」
      const zipWithout = path.join(e2eRoot, 'app-without.zip');
      await stubSaveDialog(app, zipWithout);
      await exclude.check();
      await page.locator('[data-editor-action="export"]').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 120000 });
      await closeFinishedModals(page);
      const namesWithout = await zipNames(zipWithout);
      expect(namesWithout.filter((n) => n.startsWith('tiles/'))).toEqual([]);
      expect(namesWithout).toContain(`maps/${seeded.mapSlug}.json`);
      // 書き出しの後は外れている（AC5）
      await expect(exclude).not.toBeChecked();

      // 取消（保存先の選択で取り消す）でも外れる
      await app.evaluate(async ({ dialog }) => {
        dialog.showSaveDialog = (async () => ({ canceled: true, filePath: undefined })) as unknown as typeof dialog.showSaveDialog;
      });
      await exclude.check();
      await page.locator('[data-editor-action="export"]').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 60000 });
      await closeFinishedModals(page);
      await expect(exclude).not.toBeChecked();
      console.log('  (b): PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
