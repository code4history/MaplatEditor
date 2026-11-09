// POI の CSV・JSON 書き出し E2E (実 Electron)。
// ネイティブの保存ダイアログ・メッセージボックスは差し替え、書き出されたファイルを期待値と比べる。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const fixtureDir = path.join(projectRoot, 'tests/fixtures/poi-io');

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

async function stubDialogs(app: ElectronApplication, savePath: string): Promise<void> {
  await app.evaluate(({ dialog }, out) => {
    (globalThis as any).__poiIoMessages = [];
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: out })) as typeof dialog.showSaveDialog;
    dialog.showMessageBox = (async (...args: any[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) ?? {};
      (globalThis as any).__poiIoMessages.push({ message: options.message, detail: options.detail });
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  }, savePath);
}

async function seedRoundtripSource(page: Page, fc: unknown): Promise<string> {
  return page.evaluate(async (source) => {
    const slug = `poi-io-${Date.now()}`;
    const created = await window.poiSources.createLocal({ slug, title: { ja: '書き出し試験' }, lang: 'ja' });
    if (!created || created.result !== 'Success') throw new Error(`create failed: ${JSON.stringify(created)}`);
    const saved = await window.poiSources.save(created.uid, { slug, title: { ja: '書き出し試験' }, fc: source });
    if (!saved || saved.result !== 'Success') throw new Error(`save failed: ${JSON.stringify(saved)}`);
    return created.uid;
  }, fc);
}

async function openSource(page: Page, uid: string): Promise<void> {
  await page.evaluate((hash) => { location.hash = hash; }, `#/poisources/${uid}`);
  await page.waitForSelector('.editor-action-header', { timeout: 15000 });
  await expect(page.locator('[data-editor-action="poi-export-table"]')).toBeEnabled({ timeout: 15000 });
}

async function runExport(app: ElectronApplication, page: Page, format: 'csv' | 'json') {
  await page.locator('[data-editor-action="poi-export-table"]').click();
  await expect(page.getByTestId('poi-export-table-dialog')).toBeVisible();
  await page.getByTestId(`poi-export-format-${format}`).check();
  await page.getByTestId('poi-export-table-confirm').click();
  await expect(page.getByTestId('poi-export-table-dialog')).toBeHidden();
  await expect.poll(() => app.evaluate(() => (globalThis as any).__poiIoMessages.length)).toBeGreaterThan(0);
  return app.evaluate(() => (globalThis as any).__poiIoMessages as { message: string; detail?: string }[]);
}

test.describe('POI の CSV・JSON 書き出し', () => {
  test('CSV: 期待値とバイト単位で一致し、省かれた項目が報告される', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-poi-io-csv-'));
    const out = path.join(e2eRoot, 'out.csv');
    const { app, page } = await launch(e2eRoot);
    try {
      const fc = JSON.parse(await readFile(path.join(fixtureDir, 'roundtrip-source.json'), 'utf8'));
      const uid = await seedRoundtripSource(page, fc);
      await stubDialogs(app, out);
      await openSource(page, uid);
      const messages = await runExport(app, page, 'csv');
      const expected = await readFile(path.join(fixtureDir, 'expected-export.csv'));
      expect(Buffer.compare(await readFile(out), expected)).toBe(0);
      // 省かれた項目 (html・その他の項目・資産の画像) の報告
      expect(messages.at(-1)?.detail ?? '').toContain('HTML');
      expect(messages.at(-1)?.detail ?? '').toContain('GeoJSON');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('JSON: POI の配列で、HTML・独自の項目・資産の参照が保たれる', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-poi-io-json-'));
    const out = path.join(e2eRoot, 'out.json');
    const { app, page } = await launch(e2eRoot);
    try {
      const fc = JSON.parse(await readFile(path.join(fixtureDir, 'roundtrip-source.json'), 'utf8'));
      const uid = await seedRoundtripSource(page, fc);
      await stubDialogs(app, out);
      await openSource(page, uid);
      await runExport(app, page, 'json');
      const expected = JSON.parse(await readFile(path.join(fixtureDir, 'expected-export.json'), 'utf8'));
      expect(JSON.parse(await readFile(out, 'utf8'))).toEqual(expected);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
