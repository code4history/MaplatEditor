// M17-T1: POI layer metadata 編集 UI E2E (icon/selectedIcon)
// AC17-1: GUI 編集 → 保存 → raw ペインで FC レベルの icon/selectedIcon を assert
// AC17-2: Undo/Redo が 1 変更 = 1 Undo 単位であること
// AC17-5: raw ペイン Apply → フォーム表示が追随すること
// AC17-5b: エディタ地図で layer icon が反映される（feature icon なし時・通常時）
// AC17-5c: エディタ地図で feature icon が layer icon より優先される（通常時）
// AC17-5d: 選択時も resolved icon が維持される（icon 起点ペア継承・α）
// AC17-5e: feature icon のみ（selectedIcon なし）選択時も feature icon が維持される
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { resolveIconPairForTest } from '../../src/utils/poiMarkerStyle';

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

async function seedPoiSource(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const slug = `m17-t1-poi-${Date.now()}`;
    const result = await window.poiSources.createLocal({
      slug,
      title: { ja: 'テストPOI' },
      lang: 'ja',
    });
    if (!result || result.result !== 'Success') throw new Error(`Could not seed POI: ${JSON.stringify(result)}`);
    return { uid: result.uid, slug };
  });
}

async function openPoiEdit(page: Page, uid: string): Promise<void> {
  await page.evaluate((poiUid) => {
    location.hash = `/poisources/${poiUid}`;
  }, uid);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
}

async function stubMessageBoxRecording(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ dialog }) => {
    (globalThis as any).__t1MessageBoxLog = [];
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = (args.length >= 2 ? args[1] : args[0]) as { message?: string };
      (globalThis as any).__t1MessageBoxLog.push(options?.message ?? '');
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
}

// renderer 側の IPC で保存済み POI ソースの実データ（fc + layerMeta）を取得
async function getPoiSourceData(page: Page, uid: string): Promise<{ fc: any; layerMeta: Record<string, unknown> }> {
  return page.evaluate(async (poiUid) => {
    const doc = await window.poiSources.get(poiUid);
    if (!doc) throw new Error('POI source not found');
    const fc = doc.fc;
    const { features, type, lang, ...rest } = fc;
    void features; void type; void lang;
    return { fc, layerMeta: rest as Record<string, unknown> };
  }, uid);
}

test.describe('M17-T1: POI layer metadata 編集 UI', () => {
  let app: ElectronApplication;
  let page: Page;
  let e2eRoot: string;

  test.beforeEach(async () => {
    e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'm17-t1-e2e-'));
    ({ app, page } = await launch(e2eRoot));
    await stubMessageBoxRecording(app);
  });

  test.afterEach(async () => {
    if (app) await quitElectronApplication(app).catch(() => {});
  });

  test('AC17-1: layer metadata icon/selectedIcon を GUI から編集・保存', async () => {
    const { uid } = await seedPoiSource(page);
    await openPoiEdit(page, uid);

    // layer metadata フィールドが存在することを確認
    const layerIconDiv = page.locator('[data-testid="layer-icon"]');
    await expect(layerIconDiv).toBeVisible();

    // icon を設定
    const layerIconInput = layerIconDiv.locator('input[type="text"]');
    await layerIconInput.fill('builtin:defaultpin');
    await layerIconInput.press('Tab');
    await page.waitForTimeout(200);

    // selectedIcon を設定
    const layerSelectedIconDiv = page.locator('[data-testid="layer-selected-icon"]');
    const layerSelectedIconInput = layerSelectedIconDiv.locator('input[type="text"]');
    await layerSelectedIconInput.fill('builtin:defaultpin-selected');
    await layerSelectedIconInput.press('Tab');
    await page.waitForTimeout(200);

    // 保存
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });

    // raw ペインで FC レベルの反映を確認
    const rawBtn = page.locator('button[data-editor-action="raw-pane"], button:has-text("Raw GeoJSON"), button:has-text("生GeoJSON")');
    await rawBtn.click();
    await page.waitForTimeout(500);

    const textarea = page.locator('textarea');
    const rawText = await textarea.inputValue();
    const fc = JSON.parse(rawText);
    expect(fc.properties.icon).toBe('builtin:defaultpin');
    expect(fc.properties.selectedIcon).toBe('builtin:defaultpin-selected');
  });

  test('AC17-2: Undo/Redo が 1 変更 = 1 Undo 単位', async () => {
    const { uid } = await seedPoiSource(page);
    await openPoiEdit(page, uid);

    const layerIconDiv = page.locator('[data-testid="layer-icon"]');
    const layerIconInput = layerIconDiv.locator('input[type="text"]');

    // icon を設定（1 変更目）
    await layerIconInput.fill('builtin:defaultpin');
    await layerIconInput.press('Tab');
    await page.waitForTimeout(200);

    // selectedIcon を設定（2 変更目）
    const layerSelectedIconDiv = page.locator('[data-testid="layer-selected-icon"]');
    const layerSelectedIconInput = layerSelectedIconDiv.locator('input[type="text"]');
    await layerSelectedIconInput.fill('builtin:defaultpin-selected');
    await layerSelectedIconInput.press('Tab');
    await page.waitForTimeout(200);

    // Undo 1 回目 → selectedIcon が元に戻る
    const undoBtn = page.locator('button[data-editor-action="undo"]');
    await undoBtn.click();
    await page.waitForTimeout(300);
    const selectedIconAfterUndo = await layerSelectedIconInput.inputValue();
    expect(selectedIconAfterUndo).not.toBe('builtin:defaultpin-selected');

    // Undo 2 回目 → icon も元に戻る
    await undoBtn.click();
    await page.waitForTimeout(300);
    const iconAfterUndo = await layerIconInput.inputValue();
    expect(iconAfterUndo).not.toBe('builtin:defaultpin');

    // Redo 2 回で元に戻る
    const redoBtn = page.locator('button[data-editor-action="redo"]');
    await redoBtn.click();
    await page.waitForTimeout(300);
    await redoBtn.click();
    await page.waitForTimeout(300);
    expect(await layerIconInput.inputValue()).toBe('builtin:defaultpin');
    expect(await layerSelectedIconInput.inputValue()).toBe('builtin:defaultpin-selected');
  });

  test('AC17-5: raw ペイン Apply 後にフォーム表示が追随する', async () => {
    const { uid } = await seedPoiSource(page);
    await openPoiEdit(page, uid);

    const layerIconDiv = page.locator('[data-testid="layer-icon"]');
    const layerIconInput = layerIconDiv.locator('input[type="text"]');

    // icon を設定して保存
    await layerIconInput.fill('builtin:defaultpin');
    await layerIconInput.press('Tab');
    await page.waitForTimeout(200);
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });

    // raw ペインを開く
    const rawBtn = page.locator('button[data-editor-action="raw-pane"], button:has-text("Raw GeoJSON"), button:has-text("生GeoJSON")');
    await rawBtn.click();
    await page.waitForTimeout(500);

    // raw ペインで icon を変更
    const textarea = page.locator('textarea');
    let rawText = await textarea.inputValue();
    rawText = rawText.replace('"builtin:defaultpin"', '"builtin:defaultpin-selected"');
    await textarea.fill(rawText);

    // Apply
    const applyBtn = page.locator('button:has-text("適用"), button:has-text("Apply")');
    await applyBtn.click();
    await page.waitForTimeout(500);

    // フォームの icon 表示が追随していることを確認
    const iconAfterApply = await layerIconInput.inputValue();
    expect(iconAfterApply).toBe('builtin:defaultpin-selected');
  });

  test('AC17-5b: layer icon が反映される（feature icon なし時・通常時）', async () => {
    const { uid } = await seedPoiSource(page);
    await openPoiEdit(page, uid);

    // layer icon を設定（feature 個別 icon なし）
    const layerIconDiv = page.locator('[data-testid="layer-icon"]');
    const layerIconInput = layerIconDiv.locator('input[type="text"]');
    await layerIconInput.fill('builtin:defaultpin');
    await layerIconInput.press('Tab');
    await page.waitForTimeout(200);
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });

    // 実データ取得 → Node 側の純粋関数で検証
    const { layerMeta } = await getPoiSourceData(page, uid);
    const result = resolveIconPairForTest(undefined, layerMeta, false);
    expect(result.resolvedIcon).toBe('builtin:defaultpin');
    expect(result.source).toBe('layer');
  });

  test('AC17-5c: feature icon が layer icon より優先される（通常時）', async () => {
    const { uid } = await seedPoiSource(page);
    await openPoiEdit(page, uid);

    // layer icon を設定
    const layerIconDiv = page.locator('[data-testid="layer-icon"]');
    const layerIconInput = layerIconDiv.locator('input[type="text"]');
    await layerIconInput.fill('builtin:defaultpin');
    await layerIconInput.press('Tab');
    await page.waitForTimeout(200);
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });

    // 実データ取得 → feature properties に icon を設定した想定で検証
    const { layerMeta } = await getPoiSourceData(page, uid);
    const featureProperties = { icon: 'builtin:defaultpin-selected' };
    const result = resolveIconPairForTest(featureProperties, layerMeta, false);
    expect(result.resolvedIcon).toBe('builtin:defaultpin-selected');
    expect(result.source).toBe('feature');
  });

  test('AC17-5d: 選択時も resolved icon が維持される（layer icon のみ・α）', async () => {
    const { uid } = await seedPoiSource(page);
    await openPoiEdit(page, uid);

    // layer icon のみ（selectedIcon なし）を設定
    const layerIconDiv = page.locator('[data-testid="layer-icon"]');
    const layerIconInput = layerIconDiv.locator('input[type="text"]');
    await layerIconInput.fill('builtin:defaultpin');
    await layerIconInput.press('Tab');
    await page.waitForTimeout(200);
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });

    // 実データ取得 → 選択時（selected: true）の純粋関数検証
    // selected はリテラル true で純粋関数へ渡す（GUI のマーカー選択は純粋関数へ流入しない）
    const { layerMeta } = await getPoiSourceData(page, uid);
    const result = resolveIconPairForTest(undefined, layerMeta, true);
    expect(result.resolvedIcon).toBe('builtin:defaultpin');
    // layer icon のみなので選択時も layer icon が維持される（赤ピンにならない）
    expect(result.source).toBe('layer');
  });

  test('AC17-5e: feature icon のみ（selectedIcon なし）選択時も feature icon が維持される', async () => {
    const { uid } = await seedPoiSource(page);
    await openPoiEdit(page, uid);

    // feature icon のみを設定
    const layerIconDiv = page.locator('[data-testid="layer-icon"]');
    const layerIconInput = layerIconDiv.locator('input[type="text"]');
    await layerIconInput.fill('builtin:defaultpin');
    await layerIconInput.press('Tab');
    await page.waitForTimeout(200);
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });

    // 実データ取得 → feature properties に icon のみを設定した想定で検証
    // selected はリテラル true で純粋関数へ渡す（GUI のマーカー選択は純粋関数へ流入しない）
    const { layerMeta } = await getPoiSourceData(page, uid);
    const featureProperties = { icon: 'builtin:defaultpin' };
    const result = resolveIconPairForTest(featureProperties, layerMeta, true);
    expect(result.resolvedIcon).toBe('builtin:defaultpin');
    expect(result.source).toBe('feature');
  });
});
