import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launch, openHash, saveFolderOf, seedFullMap, projectRoot } from './helpers/mapPackage';
import { quitElectronApplication } from './helpers/electronLifecycle';

// UI 文法（docs/ui-grammar.md）の代表画面を、同じ隔離データ・画面サイズで撮って確かめる。
// 既定の実行は変更後（after）の回帰検査。before は変更前のコードで撮るときだけ
// UI_GRAMMAR_BASELINE=1 で動かす（変更前のコードにこの spec を写して実行する）。
// 写真の出力先は UI_GRAMMAR_SHOTS_DIR（既定は test-results/ui-grammar）。リポジトリには入れない。
for (const phase of ['before', 'after']) {
  test(`UI grammar ${phase}`, async ({ browserName: _browserName }, testInfo) => {
    test.skip(phase === 'before' && process.env.UI_GRAMMAR_BASELINE !== '1', '変更前の撮影時だけ UI_GRAMMAR_BASELINE=1 を指定する');
    test.setTimeout(180_000);
    const root = await mkdtemp(path.join(os.tmpdir(), 'maplat-ui-grammar-'));
    const artifacts = path.join(process.env.UI_GRAMMAR_SHOTS_DIR || path.join(projectRoot, 'test-results/ui-grammar'), phase);
    await mkdir(artifacts, { recursive: true });
    const { app, page } = await launch(root);
    try {
      await page.reload();
      await app.evaluate(({ BrowserWindow, dialog }) => {
        BrowserWindow.getAllWindows()[0].setSize(1280, 900);
        (globalThis as any).__grammarMessages = [];
        dialog.showMessageBox = (async (...args: any[]) => {
          const options = args.length > 1 ? args[1] : args[0];
          (globalThis as any).__grammarMessages.push(options);
          return { response: 0, checkboxChecked: false };
        }) as typeof dialog.showMessageBox;
      });
      const shot = async (name: string) => {
        const file = path.join(artifacts, `${name}.png`);
        await page.screenshot({ path: file });
        await testInfo.attach(name, { path: file, contentType: 'image/png' });
      };
      const uid = await page.evaluate(async () => {
        const source = await window.poiSources.createLocal({ slug: 'grammar-poi', title: { ja: '街歩きの地点' }, lang: 'ja' });
        if (source.result !== 'Success') throw new Error('POI seed failed');
        await window.poiSources.save(source.uid, { slug: 'grammar-poi', title: { ja: '街歩きの地点' }, fc: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'walk-1', geometry: { type: 'Point', coordinates: [139.7, 35.7] }, properties: { name: '散歩の出発点' } }] } });
        return source.uid;
      });
      await openHash(page, `#/poisources/${uid}`);
      await page.locator('[data-editor-action="export"]').click();
      await expect(page.getByTestId('poi-export-options')).toBeVisible();
      await shot('poi-export');
      if (phase === 'after') {
        await expect(page.getByTestId('poi-export-options').locator('[data-editor-help]')).toHaveCount(4);
        await page.getByTestId('poi-export-options').locator('[data-editor-help]').first().focus();
        await expect(page.locator('.popover.show')).toBeVisible();
        // 表示の fade（Bootstrap の 0.15 秒）が終わってから撮る
        await expect.poll(() => page.locator('.popover').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
        await shot('poi-export-help');
      }
      await page.getByTestId('poi-export-options-cancel').click();
      await page.getByTestId('poi-title').locator('input').fill('街歩きの地点（更新）');
      await page.getByTestId('poi-title').locator('input').blur();
      await page.getByTestId('editor-save').click();
      if (phase === 'before') {
        await expect.poll(() => app.evaluate(() => (globalThis as any).__grammarMessages.length)).toBeGreaterThan(0);
      } else {
        await expect(page.getByTestId('operation-notice')).toContainText('保存');
        expect(await app.evaluate(() => (globalThis as any).__grammarMessages.length)).toBe(0);
      }
      await shot('poi-save-notice');
      await writeFile(path.join(artifacts, 'native-notifications.json'), JSON.stringify(await app.evaluate(() => (globalThis as any).__grammarMessages), null, 2));
      const seeded = await seedFullMap(page, await saveFolderOf(page), root, { prefix: 'grammar', title: '街歩きの地図' });
      await openHash(page, `#/mapedit?uid=${seeded.mapUid}`);
      await expect(page.getByTestId('map-title')).toBeVisible();
      await page.locator('[data-editor-action="export"]').click();
      await expect(page.getByTestId('map-export-options')).toBeVisible();
      if (phase === 'after') {
        // POI のソースを保存した通知は、地図の編集画面へ移ったら消えている（ui-grammar §5.3）
        await expect(page.getByTestId('operation-notice')).toHaveCount(0);
        await expect(page.getByTestId('map-export-option-originals-help').locator('i.bi-question-circle')).toHaveCount(1);
        // ファイルサイズ・写真の付帯情報の注意は ? に入れず、オリジナル画像を選んだときに黄色の警告で出す（§2.4）
        await expect(page.getByTestId('map-export-option-originals-warning')).toHaveCount(0);
        await page.getByTestId('map-export-option-originals').check();
        await expect(page.getByTestId('map-export-option-originals-warning')).toHaveAttribute('data-diagnostic-scope', 'field');
        await expect(page.getByTestId('map-export-option-originals-warning')).toHaveAttribute('data-diagnostic-severity', 'warning');
      }
      await shot('map-export');
      if (phase === 'after') {
        await page.getByTestId('map-export-option-tiles').uncheck();
        await page.getByTestId('map-export-option-json').uncheck();
        await expect(page.getByTestId('map-export-options-confirm')).toBeDisabled();
        await expect(page.getByTestId('map-export-options-none-selected').locator('i.bi-question-circle')).toHaveCount(1);
      }
      await page.getByTestId('map-export-options-cancel').click();
      await openHash(page, '#/settings');
      await page.getByTestId('settings-basemap-tab').click();
      await page.getByTestId('settings-editor-google-api-key').fill('sample-key');
      await page.locator('#defaultPublishGoogleApiKey').fill('sample-key');
      await expect(page.getByTestId('settings-same-key-warning-google')).toBeVisible();
      await shot('settings');
      if (phase === 'after') await expect(page.getByTestId('settings-same-key-warning-google')).toHaveAttribute('data-diagnostic-scope', 'field');
      // POI の保存の通知は、画面を 2 回移った後には残っていない
      if (phase === 'after') await expect(page.getByTestId('operation-notice')).toHaveCount(0);
      await page.getByTestId('settings-mcp-tab').click();
      await expect(page.getByTestId('settings-mcp-docs-url')).toBeVisible();
      await shot('settings-mcp');
      if (phase === 'after') {
        await expect(page.getByTestId('settings-mcp-external-notice')).toHaveAttribute('data-diagnostic-scope', 'field');
        await expect(page.getByTestId('settings-mcp-recommend-loopback')).toHaveCount(1);
        // ? の読み上げ名は、何の説明かが分かる名前（隣のタブの名前ではない）
        await expect(page.getByTestId('settings-mcp-recommend-loopback')).toHaveAttribute('aria-label', '「クライアントへの登録」の説明');
      }
      if (phase === 'after') {
        // 移行レポートのバナー: 行が多くても画面を押し下げず、中をスクロールする（PR #246 のレビュー Minor 6）
        await openHash(page, '#/maplist');
        await app.evaluate(({ BrowserWindow }) => {
          const renamedSlugs = Array.from({ length: 24 }, (_, index) => ({ kind: 'map', from: `old-map-${index + 1}`, to: `old-map-${index + 1}-2` }));
          BrowserWindow.getAllWindows()[0].webContents.send('app:migrationReport', { renamedSlugs, warnings: ['w1', 'w2', 'w3'] });
        });
        const report = page.getByTestId('migration-report');
        await expect(report).toBeVisible();
        const list = report.locator('.editor-diagnostic__list');
        const box = await list.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, overflow: getComputedStyle(el).overflowY, viewport: window.innerHeight }));
        expect(box.overflow).toBe('auto');
        expect(box.scroll).toBeGreaterThan(box.client);
        expect(box.client).toBeLessThanOrEqual(Math.ceil(box.viewport * 0.3));
        // 閉じるボタンはスクロールの外にあり、見えたまま
        await expect(report.locator('[data-diagnostic-dismiss]')).toBeInViewport();
        await shot('migration-report');
      }
    } finally {
      await quitElectronApplication(app);
    }
  });
}
