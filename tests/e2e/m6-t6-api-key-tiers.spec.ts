// m6-t6: API キーの3段構成 E2E
// AC1: Settings の「ベースマップ」タブでキー保存・再読込
// AC2: エディタ用キーと既定公開用キーが同一値のとき警告
// AC3: BaseMapEdit の google/mapbox 種別選択ゲート（キー無しで disabled、設定後に有効化）
// AC5(a): プレビュー: 鍵が解決できない provider ソースは sources から除外され warnings に積まれる。
//         startFrom(2段目)は生存ソースへ解決され、overlay は生存ソースがあれば true のまま
// AC5(b): 唯一の背景ソースが除外されたとき、startFrom は出力されず overlay は false になる
// AC8: 書き出し: 両方空のとき overrideKeys 未指定ならソース除外・警告、指定すれば反映される
// AC14: 旧形 slug の startFrom 救済（resolveStartFromViewerMapID の3段目・実 maplat ソースで検証。
//       L-1 是正: 従来テストは builtin(osm) で2段目しか通っていなかった）
//
// m6-t10（ADR-0018）追随: AC5/AC8 の provider ソースは、**ベースマップマスタを実際に登録した
// 状態**でなければ検証できない。差分保持モデルでソースから kind が消え、マスタ所有になったため、
// マスタ未登録のソースは resolveAppSource が master-missing として鍵判定より **先に** 除外して
// しまう（AppPreviewService.ts / AppExportService.ts。設計 §3.6）。旧テストはソース自身の
// data.kind で判定されていた m6-t6 当時の形のまま残っており、m6-t10 以降は
// warn_missing_base_map_master へ落ちて鍵3段の経路を1行も踏んでいなかった。
// ∴ マスタを seed したうえで「鍵だけが無い」状態を作る（seed しても鍵は一切設定しない）。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { baseMapMasterDoc, seedBaseMap } from './helpers/baseMapSeed';

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

// L-1 是正: AC5/AC14 を AC8 と同水準（実際に配信された JSON/HTML を検証）へ引き上げるためのヘルパー。
// prepare() が返す url (http://localhost:<port>/preview/<token>/) からトークンを取り出し、
// AppPreviewService.ts:410 の /apps/{token}.json ルートで composed app JSON を取得する
function tokenFromPreviewUrl(previewUrl: string): string {
  const segments = new URL(previewUrl).pathname.split('/').filter(Boolean);
  return segments[1];
}

async function fetchPreviewJson(page: Page, previewUrl: string, relativePath: string): Promise<any> {
  const url = previewUrl.replace(/\/$/, '') + '/' + relativePath;
  return page.evaluate(async (u) => {
    const resp = await fetch(u);
    if (!resp.ok) throw new Error(`fetch ${u} failed: ${resp.status}`);
    return await resp.json();
  }, url);
}

// AppPreviewService.ts:442 が埋め込む `const option = {...};` を取り出す。
// JSON.stringify の出力は1行にまとまるため、行単位で前後を切り落とせば安全
// (option 値の中身に "};" 等の文字列が混じっても壊れない)
async function fetchPreviewOption(page: Page, previewUrl: string): Promise<any> {
  const html = await page.evaluate(async (u) => {
    const resp = await fetch(u);
    if (!resp.ok) throw new Error(`fetch ${u} failed: ${resp.status}`);
    return await resp.text();
  }, previewUrl);
  const line = html.split('\n').find((l) => l.trim().startsWith('const option = '));
  if (!line) throw new Error('preview HTML に option スクリプトが見つからない');
  return JSON.parse(line.trim().replace(/^const option = /, '').replace(/;$/, ''));
}

test('AC1/AC2: Settings ベースマップタブでキーの保存・再読込・同一値警告', async () => {
  test.setTimeout(120_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t6-settings-'));
  const { app, page } = await launch(e2eRoot);
  try {
    await openHash(page, '#/settings');
    await page.getByTestId('settings-basemap-tab').click();
    await expect(page.getByTestId('settings-editor-google-api-key')).toBeVisible();

    // m6-t9 §3.6/AC8: 説明文が ContextHelp（? アイコン）で表示される
    // （m12-t11-description-grammar.spec.ts:68-70 の確立済みパターン）
    const editorKeyHelp = page.getByTestId('settings-editor-api-key-help');
    await expect(editorKeyHelp).toBeVisible();
    await editorKeyHelp.click();
    await expect(page.locator('.popover')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-default-publish-api-key-help')).toBeVisible();

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

test('AC5(a): プレビューは鍵未解決の provider ソースを sources から除外し、startFrom(2段目)は生存ソースへ解決される', async () => {
  test.setTimeout(120_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t6-preview-exclude-'));
  const { app, page } = await launch(e2eRoot);
  try {
    // マスタは登録するが、エディタ用キー・既定公開用キーはいずれも設定しない
    // （= 鍵3段すべてが未解決。seedE2EProviderKeys は**呼ばない**）
    const googleSlug = 'legacy-google-slug';
    await seedBaseMap(page, googleSlug, baseMapMasterDoc({ kind: 'google', maptype: 'google_roadmap', url: '' }));

    const appID = `t6-preview-exclude-${Date.now()}`;
    const document = {
      appID,
      lang: 'ja',
      title: { ja: 't6 preview app' },
      appName: { ja: 't6 preview app' },
      description: {},
      keywords: '',
      siteUrl: '',
      sources: [
        // 鍵が3段とも未解決（editor/publish/override いずれも無し）の google ソース。
        // 旧保存形（data にマスタ全コピー・baseMapUid 無し）のまま置き、resolveAppSource の
        // slug 経由フォールバック（mapUid → bySlug）と legacyData 移行も併せて踏ませる
        { mapUid: googleSlug, role: 'base', data: { kind: 'google', maptype: 'google_roadmap' } },
        { mapUid: 'osm', role: 'base', data: {} },
      ],
      // 2段目（mapUid/mapSlug 一致）で解決される旧形 startFrom
      startFrom: 'osm',
      pois: [],
      // overlay=true でも生存ソース(osm)がある限り true のまま維持されることを併せて確認する
      httpSettings: { overlay: true },
      appSettings: {},
      manifestSettings: {},
    };
    const { preview } = await page.evaluate(async (doc) => {
      const uid = crypto.randomUUID();
      const saveResult = await window.appedit.save({ uid, slug: doc.appID, create: true, document: doc });
      if (!saveResult || saveResult.result !== 'Success') throw new Error(`save failed: ${JSON.stringify(saveResult)}`);
      const loaded = await window.appedit.request(uid);
      const preview = await window.appedit.preparePreview(loaded.document ?? loaded);
      return { preview };
    }, document);

    expect(preview.warnings).toContain('appedit.warn_provider_google_key_missing');
    // 退行止め: マスタ欠落による除外が先に成立していると、鍵3段の経路を1行も踏まないまま
    // 「除外された」ことだけが偶然一致してしまう（m6-t10 で実際に起きた沈黙した被覆喪失）
    expect(preview.warnings).not.toContain('appedit.warn_missing_base_map_master');

    const token = tokenFromPreviewUrl(preview.url);
    const appJson = await fetchPreviewJson(page, preview.url, `apps/${token}.json`);
    // 除外: google ソースが sources に現れない
    expect(JSON.stringify(appJson.sources)).not.toContain('google');
    // 非除外: osm ソースは維持される
    expect(JSON.stringify(appJson.sources)).toContain('osm');
    // startFrom: 除外ソースを指していないため、生存ソース(osm)の viewerMapID(=mapUid)へ解決される
    expect(appJson.startFrom).toBe('osm');

    const option = await fetchPreviewOption(page, preview.url);
    expect(option.overlay).toBe(true);

    await page.evaluate(() => window.appedit.stopPreview());
  } finally {
    await quitElectronApplication(app);
  }
});

test('AC5(b): 唯一の背景ソースが鍵未解決で除外されたとき、overlay は false になり startFrom も出力されない（クラッシュしない）', async () => {
  test.setTimeout(120_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t6-preview-empty-'));
  const { app, page } = await launch(e2eRoot);
  try {
    const soloSlug = 'legacy-google-solo';
    await seedBaseMap(page, soloSlug, baseMapMasterDoc({ kind: 'google', maptype: 'google_roadmap', url: '' }));

    const appID = `t6-preview-empty-${Date.now()}`;
    const document = {
      appID,
      lang: 'ja',
      title: { ja: 't6 preview app (sole source excluded)' },
      appName: { ja: 't6 preview app' },
      description: {},
      keywords: '',
      siteUrl: '',
      // 唯一の背景ソースが鍵未解決の google。他にフォールバック可能なソースが無い
      sources: [
        { mapUid: soloSlug, role: 'base', startFrom: true, data: { kind: 'google', maptype: 'google_roadmap' } },
      ],
      pois: [],
      httpSettings: { overlay: true },
      appSettings: {},
      manifestSettings: {},
    };
    const { preview } = await page.evaluate(async (doc) => {
      const uid = crypto.randomUUID();
      const saveResult = await window.appedit.save({ uid, slug: doc.appID, create: true, document: doc });
      if (!saveResult || saveResult.result !== 'Success') throw new Error(`save failed: ${JSON.stringify(saveResult)}`);
      const loaded = await window.appedit.request(uid);
      const preview = await window.appedit.preparePreview(loaded.document ?? loaded);
      return { preview };
    }, document);

    expect(preview.warnings).toContain('appedit.warn_provider_google_key_missing');
    expect(preview.warnings).not.toContain('appedit.warn_missing_base_map_master');

    const token = tokenFromPreviewUrl(preview.url);
    const appJson = await fetchPreviewJson(page, preview.url, `apps/${token}.json`);
    expect(appJson.sources).toEqual([]);
    // 除外ソースを指していた startFrom は出力されない(undefined)
    expect(appJson.startFrom).toBeUndefined();

    // httpSettings.overlay=true でも、生存する背景ソースが無いため overlay は false に落ちる
    // (AppPreviewService.ts:468 hasViewerBasemapSource(previewableSources) が false を返す)
    const option = await fetchPreviewOption(page, preview.url);
    expect(option.overlay).toBe(false);

    await page.evaluate(() => window.appedit.stopPreview());
  } finally {
    await quitElectronApplication(app);
  }
});

test('AC14: 旧形 slug の startFrom 救済（mapUid=uuid・viewerMapID=slug 一致による3段目照合）', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t6-tier3-'));
  const { app, page } = await launch(e2eRoot);
  try {
    // 実地図を1件作る。mapUid(uuid) と viewerMapID(slug=mapID) が異なることを利用し、
    // 3段目 (viewerMapID === document.startFrom) だけが一致する状況を作る
    const mapSlug = `t6-tier3-map-${Date.now()}`;
    const { uid: mapUid } = await page.evaluate(async (slug) => {
      const mapR = await window.mapedit.save({
        slug,
        mapObject: {
          mapID: slug, title: { ja: 't6 tier3 map' },
          officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
          attr: { ja: 'attr' }, dataAttr: {}, description: {},
          license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
          imageExtension: 'jpg', width: 400, height: 300,
          gcps: [[[0, 0], [15550000, 4160000]], [[400, 0], [15560000, 4160000]], [[400, 300], [15560000, 4150000]]],
          edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
        },
        tins: [],
      });
      if (!mapR || mapR.result !== 'Success') throw new Error(`seed map failed: ${JSON.stringify(mapR)}`);
      return { uid: mapR.uid as string };
    }, mapSlug);

    const appID = `t6-tier3-app-${Date.now()}`;
    const document = {
      appID,
      lang: 'ja',
      title: { ja: 't6 tier3 app' },
      appName: { ja: 't6 tier3 app' },
      description: {},
      keywords: '',
      siteUrl: '',
      // mapSlug を持たせず、ソース自身の startFrom フラグも立てない
      // → 1段目(フラグ)・2段目(mapUid/mapSlug一致)はいずれも不一致になる
      sources: [{ sourceType: 'maplat', mapUid }],
      // document.startFrom を viewerMapID(=地図の slug) に一致させ、3段目でのみ解決させる
      startFrom: mapSlug,
      pois: [],
      httpSettings: {},
      appSettings: {},
      manifestSettings: {},
    };
    const { preview } = await page.evaluate(async (doc) => {
      const uid = crypto.randomUUID();
      const saveResult = await window.appedit.save({ uid, slug: doc.appID, create: true, document: doc });
      if (!saveResult || saveResult.result !== 'Success') throw new Error(`save failed: ${JSON.stringify(saveResult)}`);
      const loaded = await window.appedit.request(uid);
      const preview = await window.appedit.preparePreview(loaded.document ?? loaded);
      return { preview };
    }, document);

    const token = tokenFromPreviewUrl(preview.url);
    const appJson = await fetchPreviewJson(page, preview.url, `apps/${token}.json`);
    // 3段目が実際に発火していることの確認: mapUid(uuid) ではなく viewerMapID(slug) が出力される
    expect(appJson.startFrom).toBe(mapSlug);
    expect(appJson.startFrom).not.toBe(mapUid);

    await page.evaluate(() => window.appedit.stopPreview());
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

    // 鍵は一切設定しない（アプリ単位・既定公開用とも空）。(b) の overrideKeys だけが解決手段になる
    const mapboxSlug = 'legacy-mapbox-slug';
    await seedBaseMap(page, mapboxSlug, baseMapMasterDoc({
      kind: 'mapbox', maptype: 'mapbox', style: 'mapbox://styles/mapbox/streets-v12', url: '',
    }));

    const documentTemplate = {
      lang: 'ja',
      title: { ja: 't6 export app' },
      appName: { ja: 't6 export app' },
      description: {},
      keywords: '',
      siteUrl: '',
      sources: [
        { mapUid: mapboxSlug, role: 'base', data: { kind: 'mapbox', style: 'mapbox://styles/mapbox/streets-v12' } },
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
    expect(resultA.warnings).not.toContain('appedit.warn_missing_base_map_master');

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
