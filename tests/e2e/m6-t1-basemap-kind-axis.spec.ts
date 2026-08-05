// m6-t1 種別軸（kind）選択UIの E2E
// AC3: 新規作成時、種別未選択ではフォーム本体が出ず（prompt 表示・merc disabled）、
//      種別を選ぶとフォームが出て5つとも disabled になる
// AC4: 保存済み user ベースマップを開くと kind が tms として強調表示され5つとも disabled。
//      既存編集操作（タイトル・slug・url 等）が現行どおり行える
// AC7: google/mapbox/maplibre を選ぶと provider-incomplete 診断が表示され保存できない
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
  const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
  if (!path.resolve(saveFolder).startsWith(path.resolve(e2eRoot) + path.sep)) {
    throw new Error(`E2E storage isolation failed: ${saveFolder} is outside ${e2eRoot}`);
  }
  return { app, page };
}

async function fillAndCommit(locator: ReturnType<Page['getByTestId']>, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press('Tab');
}

const KIND_BUTTONS = ['tms', 'google', 'mapbox', 'maplibre', 'merc'];

test('Base Map kind selector: prompt→select→lock, save→reopen persists, provider blocks save', async () => {
  test.setTimeout(120_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t1-'));
  const { app, page } = await launch(e2eRoot);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    // 種別選択が「最初の編集」（AC8）。新規作成直後は kind 未選択状態。
    await page.evaluate(() => { location.hash = '/basemaps?page=3'; });
    await page.getByTestId('basemap-new').click();
    await expect(page).toHaveURL(/uid=.*new=1/);
    await expect(page.getByTestId('basemap-editor')).toBeVisible();

    // AC3: kind 未選択 → フォーム本体は非表示・prompt 表示・merc disabled・他4つは活性
    await expect(page.getByTestId('basemap-kind-prompt')).toBeVisible();
    await expect(page.getByTestId('basemap-title')).toHaveCount(0);
    await expect(page.getByTestId('basemap-kind-merc')).toBeDisabled();
    await expect(page.getByTestId('basemap-kind-tms')).toBeEnabled();
    for (const k of ['google', 'mapbox', 'maplibre']) {
      await expect(page.getByTestId(`basemap-kind-${k}`)).toBeEnabled();
    }

    // AC8a: kind 未選択のまま離脱 → フォーム編集なしのため下書きは生まれない（再訪しても prompt の新規）
    await page.evaluate(() => { location.hash = '/basemaps'; });
    await page.getByTestId('basemap-new').click();
    await expect(page.getByTestId('basemap-kind-prompt')).toBeVisible();
    await expect(page.getByTestId('basemap-title')).toHaveCount(0);

    // AC3: tms 選択 → フォーム表示・prompt 消滅・5つとも disabled・tms primary
    await page.getByTestId('basemap-kind-tms').click();
    await expect(page.getByTestId('basemap-kind-prompt')).toHaveCount(0);
    await expect(page.getByTestId('basemap-title')).toBeVisible();
    for (const k of KIND_BUTTONS) {
      await expect(page.getByTestId(`basemap-kind-${k}`)).toBeDisabled();
    }
    await expect(page.getByTestId('basemap-kind-tms')).toHaveClass(/btn-primary/);

    // AC8b: tms 選択で下書きが確定 → reload（beforeUnload で draft flush）→ 下書き復帰で tms ロック状態
    await page.reload();
    await expect(page.getByTestId('basemap-title')).toBeVisible();
    await expect(page.getByTestId('basemap-kind-tms')).toHaveClass(/btn-primary/);
    for (const k of KIND_BUTTONS) {
      await expect(page.getByTestId(`basemap-kind-${k}`)).toBeDisabled();
    }

    // AC11 + AC4: slug/title/url を埋めて保存 → 再オープンで tms 維持・既存編集が現行どおり
    await fillAndCommit(page.getByTestId('basemap-slug'), 'e2e-kind-tms');
    await fillAndCommit(page.getByTestId('basemap-title'), '種別テスト');
    await fillAndCommit(page.getByTestId('basemap-url'), 'https://example.test/{z}/{x}/{y}.png');
    await expect(page.getByTestId('editor-save')).toBeEnabled();
    await page.getByTestId('editor-save').click();
    await expect(page).not.toHaveURL(/new=1/, { timeout: 30_000 });
    await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i);

    // AC4: 再オープン → kind が tms として強調・5つとも disabled
    await page.getByTestId('basemap-row-e2e-kind-tms').click();
    await expect(page.getByTestId('basemap-kind-tms')).toHaveClass(/btn-primary/);
    for (const k of KIND_BUTTONS) {
      await expect(page.getByTestId(`basemap-kind-${k}`)).toBeDisabled();
    }
    await expect(page.getByTestId('basemap-title')).toHaveValue('種別テスト');
    // LangResourceInput は @change（blur 確定）なので fillAndCommit で dirty 化 → save 有効
    await fillAndCommit(page.getByTestId('basemap-title'), '種別テスト2');
    await expect(page.getByTestId('editor-save')).toBeEnabled();
    // 編集を undo して clean に戻す（AC7 の新規作成へ安全に進む）
    await page.getByTestId('editor-undo').click();
    await expect(page.getByTestId('basemap-title')).toHaveValue('種別テスト');
    await expect(page.getByTestId('editor-save')).toBeDisabled();

    // AC7: provider 種別を選ぶと provider-incomplete 診断が表示され保存不可
    // 種別は選択後にロックされるため、google/mapbox/maplibre の対称性は smoke（AC2）で検証する
    await page.getByTestId('basemap-new').click();
    await page.getByTestId('basemap-kind-mapbox').click();
    await expect(page.getByTestId('basemap-kind-provider-incomplete')).toBeVisible();
    await expect(page.getByTestId('basemap-kind-provider-incomplete')).toContainText(/保存できません|cannot be saved/i);
    // slug/title を入れても保存は不可（provider-incomplete）
    await fillAndCommit(page.getByTestId('basemap-slug'), 'e2e-kind-provider');
    await fillAndCommit(page.getByTestId('basemap-title'), 'プロバイダ');
    await expect(page.getByTestId('editor-save')).toBeDisabled();

    expect(pageErrors).toEqual([]);
  } finally {
    await quitElectronApplication(app);
  }
});
