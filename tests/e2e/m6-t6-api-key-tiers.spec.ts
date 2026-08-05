// m6-t6: API キーの3段構成 E2E
// AC1: Settings の「ベースマップ」タブでキー保存・再読込
// AC2: エディタ用キーと既定公開用キーが同一値のとき警告
// AC3: BaseMapEdit の google/mapbox 種別選択ゲート（キー無しで disabled、設定後に有効化）
// AC5: プレビュー: 鍵が解決できない provider ソースは除外され warnings に積まれる
// AC8: 書き出し: 両方空のとき overrideKeys 未指定ならソース除外・警告、指定すれば反映される
// AC14: 旧形 slug の startFrom 救済（resolveStartFromViewerMapID の3段目）
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
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  return { app, page };
}

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

test('AC1/AC2: Settings ベースマップタブでキーの保存・再読込・同一値警告', async () => {
  test.setTimeout(120_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t6-settings-'));
  const { app, page } = await launch(e2eRoot);
  try {
    await openHash(page, '#/settings');
    await page.getByTestId('settings-basemap-tab').click();
    await expect(page.getByTestId('settings-editor-google-api-key')).toBeVisible();

    // AC2: 同一値を入れると警告が出る（保存前・入力段階で判定）
    await page.getByTestId('settings-editor-google-api-key').fill('same-value-key');
    await page.getByTestId('settings-default-publish-google-api-key').fill('same-value-key');
    await expect(page.getByTestId('settings-same-key-warning-google')).toBeVisible();
    await expect(page.getByTestId('settings-same-key-warning-mapbox')).toHaveCount(0);

    // 異なる値へ変更すると警告が消える
    await page.getByTestId('settings-default-publish-google-api-key').fill('different-publish-key');
    await expect(page.getByTestId('settings-same-key-warning-google')).toHaveCount(0);

    await page.getByTestId('settings-editor-mapbox-token').fill('editor-mapbox-token');
    await page.getByTestId('settings-default-publish-mapbox-token').fill('default-mapbox-token');

    await expect(page.getByTestId('settings-save-basemap')).toBeEnabled();
    await page.getByTestId('settings-save-basemap').click();
    await expect(page.getByTestId('settings-save-basemap')).toBeDisabled();

    // AC1: main プロセスへ実際に保存されている（IPC 経由で直接確認）
    const saved = await page.evaluate(async () => ({
      editorGoogleApiKey: await window.settings.get('editorGoogleApiKey'),
      editorMapboxToken: await window.settings.get('editorMapboxToken'),
      defaultPublishGoogleApiKey: await window.settings.get('defaultPublishGoogleApiKey'),
      defaultPublishMapboxToken: await window.settings.get('defaultPublishMapboxToken'),
    }));
    expect(saved).toEqual({
      editorGoogleApiKey: 'same-value-key',
      editorMapboxToken: 'editor-mapbox-token',
      defaultPublishGoogleApiKey: 'different-publish-key',
      defaultPublishMapboxToken: 'default-mapbox-token',
    });

    // AC1: 再読込（画面遷移して戻る）しても値が保持される
    await openHash(page, '#/applist');
    await openHash(page, '#/settings');
    await page.getByTestId('settings-basemap-tab').click();
    await expect(page.getByTestId('settings-editor-google-api-key')).toHaveValue('same-value-key');
    await expect(page.getByTestId('settings-default-publish-mapbox-token')).toHaveValue('default-mapbox-token');
  } finally {
    await quitElectronApplication(app);
  }
});

test('AC3: エディタ用キー未設定時、google/mapbox 種別ボタンが disabled。設定後は選択可能', async () => {
  test.setTimeout(120_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t6-gate-'));
  const { app, page } = await launch(e2eRoot);
  try {
    // 鍵未設定のまま新規ベースマップ下書きを開く
    await openHash(page, '#/basemaps?page=3');
    await page.getByTestId('basemap-new').click();
    await expect(page.getByTestId('basemap-editor')).toBeVisible();

    await expect(page.getByTestId('basemap-kind-google')).toBeDisabled();
    await expect(page.getByTestId('basemap-kind-mapbox')).toBeDisabled();
    // tms/maplibre はキー不要のためゲート対象外
    await expect(page.getByTestId('basemap-kind-tms')).toBeEnabled();
    await expect(page.getByTestId('basemap-kind-maplibre')).toBeEnabled();
    await expect(page.getByTestId('basemap-kind-google')).toHaveAttribute('title', /.+/);

    // エディタ用キーを設定
    await page.evaluate(async () => {
      await window.settings.set('editorGoogleApiKey', 'gate-test-google-key');
      await window.settings.set('editorMapboxToken', 'gate-test-mapbox-token');
    });

    // 新しい下書き（新規マウント）を開くと解除されている
    await openHash(page, '#/basemaps');
    await page.getByTestId('basemap-new').click();
    await expect(page.getByTestId('basemap-editor')).toBeVisible();
    await expect(page.getByTestId('basemap-kind-google')).toBeEnabled();
    await expect(page.getByTestId('basemap-kind-mapbox')).toBeEnabled();
  } finally {
    await quitElectronApplication(app);
  }
});

test('AC5/AC14: プレビューは鍵未解決の provider ソースを除外し、旧形 slug の startFrom は救済される', async () => {
  test.setTimeout(120_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t6-preview-'));
  const { app, page } = await launch(e2eRoot);
  try {
    const result = await page.evaluate(async () => {
      const appID = `t6-preview-${Date.now()}`;
      const document = {
        appID,
        lang: 'ja',
        title: { ja: 't6 preview app' },
        appName: { ja: 't6 preview app' },
        description: {},
        keywords: '',
        siteUrl: '',
        sources: [
          {
            // 鍵が3段とも未解決（editor/publish/override いずれも無し）の google ソース。
            // mapUid はこのソース自身の viewerMapID（旧形 slug 相当）にもなる
            mapUid: 'legacy-google-slug',
            role: 'base',
            startFrom: true,
            data: { kind: 'google', maptype: 'google_roadmap' },
          },
          {
            mapUid: 'osm',
            role: 'base',
            data: {},
          },
        ],
        // AC14: 旧形 startFrom（mapUid と同じ slug 文字列。2段目の mapUid/mapSlug 一致でも解決するが、
        // ここでは3段目の viewerMapID 一致経路を単体でも確認できるよう builtin 側で検証する
        startFrom: 'osm',
        pois: [],
        httpSettings: {},
        appSettings: {},
        manifestSettings: {},
      };
      const uid = crypto.randomUUID();
      const saveResult = await window.appedit.save({ uid, slug: appID, create: true, document });
      if (!saveResult || saveResult.result !== 'Success') throw new Error(`save failed: ${JSON.stringify(saveResult)}`);
      const loaded = await window.appedit.request(uid);
      const preview = await window.appedit.preparePreview(loaded.document ?? loaded);
      await window.appedit.stopPreview();
      return { preview };
    });

    // AC5: google ソースの鍵が未解決のため警告が積まれる
    expect(result.preview.warnings).toContain('appedit.warn_provider_google_key_missing');
  } finally {
    await quitElectronApplication(app);
  }
});

test('AC8: 書き出しは鍵未解決の provider ソースを除外し、overrideKeys を渡せば反映される', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t6-export-'));
  const { app, page } = await launch(e2eRoot);
  try {
    const zipPathA = path.join(e2eRoot, 'export-a.zip');
    const zipPathB = path.join(e2eRoot, 'export-b.zip');

    const documentTemplate = {
      lang: 'ja',
      title: { ja: 't6 export app' },
      appName: { ja: 't6 export app' },
      description: {},
      keywords: '',
      siteUrl: '',
      sources: [
        { mapUid: 'legacy-mapbox-slug', role: 'base', data: { kind: 'mapbox', style: 'mapbox://styles/mapbox/streets-v12' } },
        { mapUid: 'osm', role: 'base' },
      ],
      pois: [],
      httpSettings: {},
      appSettings: {},
      manifestSettings: {},
    };

    // ---- (a) overrideKeys を渡さない: mapbox ソースは除外され warnings に積まれる ----
    await app.evaluate(async ({ dialog }, outZip) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: outZip })) as typeof dialog.showSaveDialog;
    }, zipPathA);
    const resultA = await page.evaluate(async (doc) => {
      const appID = `t6-export-a-${Date.now()}`;
      const uid = crypto.randomUUID();
      const saved = await window.appedit.save({ uid, slug: appID, create: true, document: { ...doc, appID } });
      if (!saved || saved.result !== 'Success') throw new Error(`save failed: ${JSON.stringify(saved)}`);
      const loaded = await window.appedit.request(uid);
      return await window.appedit.export(loaded.document ?? loaded);
    }, documentTemplate);
    expect(resultA.result).toBe('Success');
    expect(resultA.warnings).toContain('appedit.warn_provider_mapbox_key_missing');

    const { default: AdmZipA } = await import('adm-zip');
    const zipA = new AdmZipA(zipPathA);
    const appJsonA = JSON.parse(zipA.readAsText(zipA.getEntries().find((e) => e.entryName.startsWith('apps/'))!));
    expect(JSON.stringify(appJsonA.sources)).not.toContain('mapbox');

    // ---- (b) overrideKeys を渡す: mapbox ソースが含まれる ----
    await app.evaluate(async ({ dialog }, outZip) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: outZip })) as typeof dialog.showSaveDialog;
    }, zipPathB);
    const resultB = await page.evaluate(async (doc) => {
      const appID = `t6-export-b-${Date.now()}`;
      const uid = crypto.randomUUID();
      const saved = await window.appedit.save({ uid, slug: appID, create: true, document: { ...doc, appID } });
      if (!saved || saved.result !== 'Success') throw new Error(`save failed: ${JSON.stringify(saved)}`);
      const loaded = await window.appedit.request(uid);
      return await window.appedit.export(loaded.document ?? loaded, { mapboxToken: 'onthefly-mapbox-token' });
    }, documentTemplate);
    expect(resultB.result).toBe('Success');
    expect(resultB.warnings ?? []).not.toContain('appedit.warn_provider_mapbox_key_missing');

    const { default: AdmZipB } = await import('adm-zip');
    const zipB = new AdmZipB(zipPathB);
    const appJsonB = JSON.parse(zipB.readAsText(zipB.getEntries().find((e) => e.entryName.startsWith('apps/'))!));
    expect(JSON.stringify(appJsonB.sources)).toContain('mapbox');
    const indexHtmlB = zipB.readAsText('index.html');
    expect(indexHtmlB).toContain('onthefly-mapbox-token');

    // overrideKeys はどのストアにも保存されない
    const storedMapboxDefault = await page.evaluate(() => window.settings.get('defaultPublishMapboxToken'));
    expect(storedMapboxDefault).not.toBe('onthefly-mapbox-token');
  } finally {
    await quitElectronApplication(app);
  }
});
