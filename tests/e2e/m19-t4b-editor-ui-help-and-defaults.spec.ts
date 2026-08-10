// m19-t4b: 地図 / ベースマップ / アプリ管理の画面内 UI 微修正。
//
// 設計: docs/superpowers/specs/2026-08-10-m19-t4b-editor-ui-help-and-defaults-design.md §8
//
//   E1  (AC1)  新規アプリで PWA・キャッシュが未チェック / マーカー一覧 UI がチェック済み /
//              マニフェスト設定欄は出ない。PWA をチェックすると現れる
//   E2  (AC2)  既存アプリ（全キー明示）を開くと保存値のまま表示される
//   E2b (AC3)  httpSettings: {} で保存された既存アプリの解釈が変わらない（②の不変）
//   E3  (AC4)  PWA をオフにするとキャッシュが disabled かつ false。Undo 1 回で **両方同時に**
//              復帰し、禁止中間状態（PWA オフ・キャッシュオン）を経由しない。Redo 1 回で再び両方オフ
//   E4  (AC7)  「説明」「他情報」の ContextHelp（人間要望 A）
//   E5  (AC8)  HTTP 設定の 8 チェックボックスすべてに ContextHelp
//   E6  (AC9)  メルカトルタイルセットの見出しヘルプに「ベースマップとして登録」
//   E7  (AC10) ベースマップ編集の帰属・ライセンス・表示ラベル 7 欄に ContextHelp
//   E8  (AC14) プレビュー言語切替がタブ下のバーにあり、地図 iframe と重ならない
//
// 属性名について: 本ファイルは tests/ 配下にあり、m19-t11 smoke の凍結カウント（MC5）が
// src / electron / scripts / tests / public を走査して属性名の絶対数を assert する。
// ∴ **凍結属性名を literal で書かない**（本 spec はそもそも範囲属性を使わない）。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

// ja の期待文言（設計 §6.1 / §6.2 / §7.3.2 の表と 1:1）
const JA = {
  descriptionNote: 'og:description',
  extraInfoNote: 'エディタの中だけに保存され',
  cacheNote: 'Service Worker',
  mercNote: 'ベースマップとして登録',
  displayLabelHelp: 'ビューアの地図切替に表示する短い名称です。',
  imageAttrHelp: '地図画像の帰属表記を入力してください。',
} as const;

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

async function openHash(page: Page, hash: string, ready?: string): Promise<void> {
  await page.evaluate((next: string) => { location.hash = next; }, hash);
  await page.waitForLoadState('domcontentloaded');
  // 遷移先が実際に描画されるまで待つ。待たずに次の遷移を重ねると、同一ルート判定で
  // コンポーネントが再生成されず、前の文書が残ったままになる（flaky の原因）
  if (ready) await expect(page.locator(ready)).toBeVisible({ timeout: 30000 });
}

/** アプリ一覧を経由して別のアプリを開く（同一ルート間の直接遷移では読み込みが走らない） */
async function openAppViaList(page: Page, uid: string): Promise<void> {
  await openHash(page, '#/applist', '[data-testid="app-range-filter"]');
  await openHash(page, `#/appedit?uid=${uid}`, '[data-testid="app-id"]');
}

/** アプリを 1 件 seed する。httpSettings をそのまま渡すことで ①/② の分離を検証できる。 */
async function seedApp(page: Page, slug: string, httpSettings: Record<string, unknown>): Promise<string> {
  const result = await page.evaluate(
    async ({ slug: s, httpSettings: hs }) => await (window as any).appedit.save({
      slug: s,
      document: {
        appID: s,
        appName: { ja: 'T4B アプリ' },
        title: { ja: 'T4B アプリ' },
        description: {},
        keywords: {},
        siteUrl: '',
        lang: 'ja',
        sources: [],
        pois: [],
        httpSettings: hs,
        appSettings: {},
        manifestSettings: {},
      },
    }),
    { slug, httpSettings },
  );
  expect(result?.result, `seedApp(${slug}) failed: ${JSON.stringify(result)}`).toBe('Success');
  return result.uid as string;
}

/** チェックボックスを i18n ラベルから引く（toggle-grid の 8 個） */
function toggle(page: Page, label: string) {
  return page.locator('.toggle-grid label.form-check', { hasText: label }).locator('input[type="checkbox"]');
}

/**
 * ラベル要素の中の「？」を focus して popover を開き、その locator を返す。
 * Bootstrap の popover は hide のフェード中も DOM に残る。連続して別の「？」を開くと
 * `.editor-ui-help-popover` が 2 件に解決して strict mode 違反になるため、
 * 開く前に必ず直前の popover が DOM から消えるまで待つ。
 */
async function openHelp(page: Page, host: ReturnType<Page['locator']>) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(page.locator('.editor-ui-help-popover')).toHaveCount(0, { timeout: 5000 });
  await host.locator('[data-editor-help]').first().focus();
  const popover = page.locator('.editor-ui-help-popover');
  await expect(popover).toBeVisible({ timeout: 5000 });
  return popover;
}

/** 履歴の取り消し / やり直し。チェックボックスに focus があるとキーボード近道は
 *  isEditableElement(INPUT) で無視されるため、ヘッダのボタン（実利用者と同じ経路）を使う */
async function undo(page: Page) { await page.getByTestId('editor-undo').click(); }
async function redo(page: Page) { await page.getByTestId('editor-redo').click(); }

// ---------------------------------------------------------------------------
test.describe('m19-t4b アプリ管理の既定値と説明', () => {
  test('E1/E2/E2b: 新規アプリの既定値（要望 B/C）と、既存アプリの現状維持', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19-t4b-e1-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 既存アプリ 2 件を先に seed し、**既存側を先に検証する**。
      // 新規アプリ（E1）は最後に置く: 新規で PWA をチェックすると未保存の下書きが立ち、
      // そのまま別アプリへ遷移すると読み込みが走らず app-id が空のままになるため
      const slugFull = `m19t4b-full-${Date.now()}`;
      const uidFull = await seedApp(page, slugFull, {
        previewPort: 41781,
        pwaManifest: true,
        overlay: true,
        enableHideMarker: true,
        enableMarkerList: false,
        enableBorder: true,
        enableCache: true,
        stateUrl: true,
        enableShare: true,
        mapboxToken: '',
        googleApiKey: '',
      });
      const slugEmpty = `m19t4b-empty-${Date.now()}`;
      const uidEmpty = await seedApp(page, slugEmpty, {});

      // ---- E2 (AC2): 既存アプリ（全キー明示）は保存値のまま ----
      await openAppViaList(page, uidFull);
      await expect(page.getByTestId('app-id')).toHaveValue(slugFull, { timeout: 30000 });
      await expect(toggle(page, 'PWA'), 'E2/AC2: 保存値 true を維持').toBeChecked();
      await expect(toggle(page, 'キャッシュ'), 'E2/AC2: 保存値 true を維持').toBeChecked();
      await expect(
        toggle(page, 'マーカー一覧UI'),
        'E2/AC2: 保存値 false を維持（新既定 true が既存アプリへ漏れない）',
      ).not.toBeChecked();

      // ---- E2b (AC3): httpSettings: {} の解釈が変わらない（② 不変） ----
      // 同一ルート間の遷移ではコンポーネントが再生成されず読み込みが走らないため、
      // 実利用者と同じく一覧を経由する
      await openAppViaList(page, uidEmpty);
      await expect(page.getByTestId('app-id')).toHaveValue(slugEmpty, { timeout: 30000 });
      await expect(
        toggle(page, 'PWA'),
        'E2b/AC3: キーなし保存形は従来どおり PWA オンとして読まれる（②の欠落補完は不変）',
      ).toBeChecked();
      await expect(
        page.getByTestId('app-manifest-name'),
        'E2b/AC3: ∴ マニフェスト設定欄も従来どおり出る（m11-t3-editor-shell.spec.ts の依存元）',
      ).toBeVisible();
      await expect(
        toggle(page, 'マーカー一覧UI'),
        'E2b/AC3: キーなし保存形のマーカー一覧 UI は従来どおり false',
      ).not.toBeChecked();

      // ---- E1 (AC1): 新規アプリ（人間要望 B / C の中核） ----
      await openHash(page, '#/applist', '[data-testid="app-range-filter"]');
      await openHash(page, '#/appedit', '[data-testid="app-id"]');
      await expect(page.getByTestId('app-id')).toHaveValue('', { timeout: 30000 });

      const pwa = toggle(page, 'PWA');
      const cache = toggle(page, 'キャッシュ');
      const markerList = toggle(page, 'マーカー一覧UI');

      await expect(pwa, 'E1/AC1: 新規アプリの PWA は既定オフ（要望 B）').not.toBeChecked();
      await expect(cache, 'E1/AC1: 新規アプリのキャッシュは既定オフ（要望 B）').not.toBeChecked();
      await expect(markerList, 'E1/AC1: 新規アプリのマーカー一覧 UI は既定オン（要望 C）').toBeChecked();
      await expect(cache, 'E1/AC4: PWA オフのときキャッシュは操作できない').toBeDisabled();
      await expect(
        page.getByTestId('app-manifest-name'),
        'E1/AC1: PWA が既定オフなのでマニフェスト設定欄は出ない',
      ).toBeHidden();

      // PWA をチェックするとマニフェスト設定欄が現れる（設計 §4.2.5 の意図した帰結）
      await pwa.check();
      await expect(page.getByTestId('app-manifest-name')).toBeVisible({ timeout: 5000 });
      await expect(cache, 'E1: PWA オンでキャッシュが操作可能になる').toBeEnabled();
    } finally {
      await quitElectronApplication(app);
    }
  });

  // -------------------------------------------------------------------------
  test('E3: キャッシュの PWA 従属と、Undo 1 回での同時復帰（禁止中間状態を経由しない）', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19-t4b-e3-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const slug = `m19t4b-undo-${Date.now()}`;
      const uid = await seedApp(page, slug, {
        previewPort: 41781,
        pwaManifest: true,
        overlay: true,
        enableHideMarker: true,
        enableMarkerList: true,
        enableBorder: true,
        enableCache: true,
        stateUrl: true,
        enableShare: true,
        mapboxToken: '',
        googleApiKey: '',
      });
      await openHash(page, `#/appedit?uid=${uid}`, '[data-testid="app-id"]');
      await expect(page.getByTestId('app-id')).toHaveValue(slug, { timeout: 30000 });

      const pwa = toggle(page, 'PWA');
      const cache = toggle(page, 'キャッシュ');
      await expect(pwa).toBeChecked();
      await expect(cache).toBeChecked();
      await expect(cache).toBeEnabled();

      // PWA をオフ → キャッシュも同時にオフ + disabled
      await pwa.uncheck();
      await expect(pwa, 'E3/AC4: PWA オフ').not.toBeChecked();
      await expect(cache, 'E3/AC4: キャッシュも false へ落ちる').not.toBeChecked();
      await expect(cache, 'E3/AC4: キャッシュは操作不能になる').toBeDisabled();
      await expect(
        page.getByTestId('app-manifest-name'),
        'E3: マニフェスト設定欄も同じ判定点（pwaEnabled）で消える',
      ).toBeHidden();

      // Undo 1 回で **両方同時に** 復帰する（履歴が 2 レコードに割れていないことの証明）
      await undo(page);
      await expect(pwa, 'E3/AC4: Undo 1 回で PWA が復帰').toBeChecked({ timeout: 5000 });
      await expect(
        cache,
        'E3/AC4: **同じ Undo 1 回で** キャッシュも復帰する（禁止中間状態を経由しない）',
      ).toBeChecked();
      await expect(cache, 'E3/AC4: 復帰後は操作可能に戻る').toBeEnabled();

      // Redo 1 回で再び両方オフ（redo スタックが壊れていないこと）
      await redo(page);
      await expect(pwa, 'E3/AC4: Redo 1 回で PWA が再びオフ').not.toBeChecked({ timeout: 5000 });
      await expect(cache, 'E3/AC4: Redo でキャッシュも再びオフ（redo スタックが健全）').not.toBeChecked();
    } finally {
      await quitElectronApplication(app);
    }
  });

  // -------------------------------------------------------------------------
  test('E4/E5/E8: 説明・他情報の「？」/ HTTP 設定 8 個の「？」/ 言語切替の移設', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19-t4b-e4-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await openHash(page, '#/appedit');
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30000 });

      // ---- E4 (AC7): 「説明」「他情報」（人間要望 A） ----
      const descLabel = page.locator('.form-label', { hasText: '説明' }).first();
      await expect(descLabel).toBeVisible();
      await expect(
        await openHelp(page, descLabel),
        'E4/AC7: 「説明」の ？ が出力先（OGP / meta description）を述べる',
      ).toContainText(JA.descriptionNote);

      const extraLabel = page.locator('label.form-label', { hasText: '他情報' }).first();
      await expect(extraLabel).toBeVisible();
      await expect(
        await openHelp(page, extraLabel),
        'E4/AC7: 「他情報」の ？ が「エディタ内メモ」であることを述べる',
      ).toContainText(JA.extraInfoNote);

      // ---- E5 (AC8): HTTP 設定の 8 チェックボックス ----
      await expect(
        page.locator('.toggle-grid [data-editor-help]'),
        'E5/AC8: HTTP 設定の 8 トグルすべてに ？ がある',
      ).toHaveCount(8);
      const cacheLabel = page.locator('.toggle-grid label.form-check', { hasText: 'キャッシュ' }).first();
      await expect(
        await openHelp(page, cacheLabel),
        'E5/AC8: キャッシュの ？ が Service Worker 同梱と PWA 前提を述べる',
      ).toContainText(JA.cacheNote);

      // ---- E8 (AC14): プレビュー言語切替がタブ下のバーへ移り、地図 iframe と重ならない ----
      await page.locator('[data-testid="app-preview-toolbar"]').waitFor({ state: 'hidden' });
      await page.getByRole('tab', { name: 'プレビュー' }).click();
      const toolbar = page.getByTestId('app-preview-toolbar');
      await expect(toolbar, 'E8/AC14: プレビュータブでバーが現れる').toBeVisible({ timeout: 30000 });
      const select = toolbar.locator('#previewLang');
      await expect(select, 'E8/AC14: #previewLang はバーの中で生存する').toBeVisible();

      // 地図領域との非干渉。iframe（.preview-map）はプレビューサーバが起動して
      // previewUrl が入るまで描画されないため、常に存在する地図領域のペイン
      // （iframe は inset:0 でこのペインを埋める）を相手に測る。
      // 旧実装の .preview-lang は position:absolute でこのペインの中に重なっていたので、
      // この assert は移設前なら必ず落ちる（= 移設の番人になっている）
      const selectBox = await select.boundingBox();
      const paneBox = await page.getByTestId('app-preview-pane').boundingBox();
      expect(selectBox, 'E8/AC14: #previewLang の矩形が取れること').not.toBeNull();
      expect(paneBox, 'E8/AC14: 地図領域の矩形が取れること').not.toBeNull();
      if (paneBox && selectBox) {
        const overlaps =
          selectBox.x < paneBox.x + paneBox.width &&
          selectBox.x + selectBox.width > paneBox.x &&
          selectBox.y < paneBox.y + paneBox.height &&
          selectBox.y + selectBox.height > paneBox.y;
        expect(overlaps, 'E8/AC14: 言語切替が地図領域と重ならない').toBe(false);
      }
    } finally {
      await quitElectronApplication(app);
    }
  });
});

// ---------------------------------------------------------------------------
test.describe('m19-t4b 地図 / ベースマップ管理の説明', () => {
  test('E6: メルカトルタイルセットの見出しヘルプ', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19-t4b-e6-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const mapUid = await page.evaluate(async () => {
        const s = `m19t4b-map-${Date.now()}`;
        const result = await (window as any).mapedit.save({
          slug: s,
          mapObject: {
            mapID: s,
            title: { ja: 'T4B 地図' },
            officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
            attr: {}, dataAttr: {}, description: {},
            license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
            imageExtension: 'jpg', width: 400, height: 300, gcps: [], edges: [], sub_maps: [],
            strictMode: 'strict', vertexMode: 'plain', status: 'New',
          },
          tins: [],
        });
        if (!result || result.result !== 'Success') throw new Error(`seed map failed: ${JSON.stringify(result)}`);
        return result.uid as string;
      });

      await openHash(page, `#/mapedit?uid=${mapUid}`, '[data-testid="map-tab-merc"]');
      await expect(page.getByTestId('map-tab-merc')).toBeVisible({ timeout: 30000 });
      await page.getByTestId('map-tab-merc').click();
      const pane = page.getByTestId('map-merc-tab-pane');
      await expect(pane).toBeVisible();

      await expect(
        pane.locator('p.text-muted.small'),
        'E6/AC9: 旧 <p> の説明文は残っていない',
      ).toHaveCount(0);
      await expect(
        await openHelp(page, pane.locator('.card-header')),
        'E6/AC9: 見出しの ？ が「ベースマップとして登録」を述べる',
      ).toContainText(JA.mercNote);
    } finally {
      await quitElectronApplication(app);
    }
  });

  // -------------------------------------------------------------------------
  test('E7: ベースマップ編集の帰属・ライセンス・表示ラベル 7 欄の「？」', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19-t4b-e7-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const slug = `m19t4b-bm-${Date.now()}`;
      const seeded = await page.evaluate(async (s: string) => await (window as any).baseMaps.saveUser({
        slug: s,
        create: true,
        uid: crypto.randomUUID(),
        tms: {
          lang: 'ja',
          kind: 'tms',
          title: { ja: 'T4B ベースマップ' },
          label: { ja: 'T4B ベースマップ' },
          attr: { ja: '© T4B' },
          dataAttr: {},
          url: 'https://example.com/tiles/{z}/{x}/{y}.png',
          minZoom: 0,
          maxZoom: 18,
          thumbnail: '',
        },
      }), slug);
      expect(seeded?.result, `seedBaseMap failed: ${JSON.stringify(seeded)}`).toBe('Success');

      await openHash(page, '#/basemaps', `[data-testid="basemap-row-${slug}"]`);
      await expect(page.getByTestId(`basemap-row-${slug}`)).toBeVisible({ timeout: 30000 });
      await page.getByTestId(`basemap-row-${slug}`).click();
      await expect(page.getByTestId('basemap-label')).toBeVisible({ timeout: 30000 });

      // 7 欄のラベルに ？ が付いている（既存 3 箇所は種別 / プリセット / 存在範囲）
      for (const label of [
        '表示ラベル',
        '地図画像帰属',
        'データ帰属',
        '地図画像ライセンス',
        '地図画像ライセンス補足',
        'データライセンス',
        'データライセンス補足',
      ]) {
        const host = page.locator('label.form-label', { hasText: label }).first();
        await expect(host, `E7/AC10: 「${label}」のラベルがある`).toBeVisible();
        await expect(
          host.locator('[data-editor-help]'),
          `E7/AC10: 「${label}」に ？ がある`,
        ).toHaveCount(1);
      }

      // 地図管理と同一の説明文が出る（field_help.* への 1 本化の実挙動確認）
      const labelHost = page.locator('label.form-label', { hasText: '表示ラベル' }).first();
      await expect(
        await openHelp(page, labelHost),
        'E7/AC11: 表示ラベルの説明は地図管理と同一文（field_help.display_label）',
      ).toContainText(JA.displayLabelHelp);

      const attrHost = page.locator('label.form-label', { hasText: '地図画像帰属' }).first();
      await expect(
        await openHelp(page, attrHost),
        'E7/AC11: 地図画像帰属の説明は地図管理と同一文（field_help.image_attribution）',
      ).toContainText(JA.imageAttrHelp);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
