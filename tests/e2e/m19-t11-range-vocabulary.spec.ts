// m19-t11: 存在範囲 / 利用範囲 / アプリ対象範囲 / 絞り込み範囲 の語彙と提示の統一。
//
// 設計: docs/superpowers/specs/2026-08-10-m19-t11-range-vocabulary-unification-design.md §12.2
//
//   E1: ベースマップ編集の「存在範囲」ラベルと「？」本文（②への言及を含む）
//   E2: アプリ編集メタデータの app-coverage-label が「アプリ対象範囲」（(参考) を含まない）
//   E3: アプリ編集の地図タブで app-source-envelope-help を開き、3 概念が 1 段落に並ぶ（AC13）
//   E4: 一覧 4 画面で範囲フィルタボタン → モーダルの envelope-modal-title が
//       「絞り込み範囲を指定」であり「存在範囲を指定」ではない
//   E5: 地図編集のベースマップ選択・POI 選択でモーダルタイトルが同じであり、
//       POI 側のヘルプが「ベースマップ」を語らない（設計 §5.7 の是正）
//   E6: **手動の絞り込み範囲を確定すると、リストが実際にその範囲で絞られる**（AC15）
//
// ---------------------------------------------------------------------------
// E6 が本 spec の主眼である（設計 §5.6 の警告 / 設計レビュー v1 Major-4）。
//
// MapEdit.vue の `baseMapSpatialContext` は
//     if (manual) { return { bbox: manual, enabled: true }; }
// という形をしており、この return 文は `if (manual) {` の**唯一の中身**である。
// t11 はこの行から `labelKey` プロパティを除去したが、**行ごと削除すると**
// if ブロックが空になり、手動設定した絞り込み範囲が握り潰されて GCP 自動範囲へ
// フォールスルーする。
//
// **この回帰は既存の検証面では 1 つも検出できない**:
//   - 型検査（pnpm run build の vue-tsc）— 空ブロックは合法で型も通る
//   - m11-t11-geocoder-estimate.spec.ts の「手動設定範囲で絞り込み中」— このラベルは
//     `baseMapRangeState`（MapEdit.vue の別 computed）が baseMapFilterRegion を**直接**読んで
//     決めており、baseMapSpatialContext を経由しない。∴ **表示は正しいまま実際の絞り込みだけが壊れる**
//   - m12-t10-base-map-selector.spec.ts — 手動範囲確定後にリストが実際に絞られることを見ていない
//   - m11-t8b-search-ui.spec.ts — ボタンの**表示**のみ
//
// ∴ E6 は**ボタン文言ではなくリストの中身**を assert する。これが唯一の番人である。
//
// 実装注意（設計レビュー v2 Info-3）: baseMapVisibilityListAdapter は
// `if (item.enabled) return true;` でチェック済み項目を bbox フィルタから**バイパス**する。
// ∴「近傍側が消える」を成立させるには、近傍ベースマップを**未チェックのまま**用意する必要がある。
// ---------------------------------------------------------------------------
//
// 属性名について: 本ファイルは tests/ 配下にあり、smoke の MC5（凍結契約 §4.6.2-1 の機械証明）が
// src / electron / scripts / tests / public を走査して属性名の絶対数 472 / 43 / 6 を assert する。
// ∴ **凍結属性名を literal で書かない**。断片から組み立てる（下の COVERAGE_ATTR）。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

// 凍結属性名（MC5 の走査に引っかからないよう断片から組み立てる。上のコメント参照）
const COVERAGE_ATTR = 'coverage' + 'LngLats';

// §4.1 呼称確定表（ja）。本 spec の期待値はすべてここを参照する。
const NAME = {
  coverage: '存在範囲',
  usage: '利用範囲',
  appTarget: 'アプリ対象範囲',
  filterModalTitle: '絞り込み範囲を指定',
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

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((next: string) => { location.hash = next; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

/** ベースマップマスタを 1 件 seed する。coverage は [w,s,e,n] の矩形で与える。 */
async function seedBaseMapWithCoverage(
  page: Page, slug: string, title: string, rect: [number, number, number, number] | null,
): Promise<string> {
  const result = await page.evaluate(
    async ({ slug: s, title: ti, rect: r, attr }) => {
      const tms: Record<string, unknown> = {
        lang: 'ja',
        kind: 'tms',
        title: { ja: ti },
        label: { ja: ti },
        attr: {},
        dataAttr: {},
        url: 'https://example.com/tiles/{z}/{x}/{y}.png',
        minZoom: 0,
        maxZoom: 18,
        thumbnail: '',
      };
      tms[attr] = r
        ? [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]
        : null;
      return await (window as any).baseMaps.saveUser({
        slug: s, create: true, uid: crypto.randomUUID(), tms,
      });
    },
    { slug, title, rect, attr: COVERAGE_ATTR },
  );
  expect(result?.result, `seedBaseMap(${slug}) failed: ${JSON.stringify(result)}`).toBe('Success');
  return result.uid as string;
}

/** 東京の GCP を持つ地図を作る（m11-t11-geocoder-estimate.spec.ts と同一の GCP 定義）。 */
async function createMapWithGcps(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const slug = `m19-t11-map-${Date.now()}`;
    const mapObject = {
      mapID: slug,
      title: { ja: '語彙統一テスト地図' },
      officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: {}, dataAttr: {}, description: {},
      license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
      imageExtension: 'png', width: 400, height: 300,
      url_: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      gcps: [
        [[0, 300], [15551351.4, 4249117.8]],
        [[400, 300], [15562483.3, 4249117.8]],
        [[400, 0], [15562483.3, 4259837.2]],
        [[0, 0], [15551351.4, 4259837.2]],
      ],
      edges: [], sub_maps: [],
      strictMode: 'strict', vertexMode: 'plain', status: 'New',
    };
    const r1 = await window.mapedit.save({ slug, mapObject, tins: [] });
    if (!r1 || r1.result !== 'Success') throw new Error(`Map seed failed: ${JSON.stringify(r1)}`);
    const tinResult = await window.mapedit.updateTin(
      mapObject.gcps, mapObject.edges, 0, [mapObject.width, mapObject.height],
      mapObject.strictMode, mapObject.vertexMode,
    );
    if (!Array.isArray(tinResult) || !tinResult[1]) throw new Error('TIN compile failed');
    const r2 = await window.mapedit.save({ slug, uid: r1.uid, mapObject, tins: [tinResult[1]] });
    if (!r2 || r2.result !== 'Success') throw new Error(`Compiled map save failed: ${JSON.stringify(r2)}`);
    return r2.uid;
  });
}

async function openMapEditSettings(page: Page, uid: string): Promise<void> {
  await page.evaluate((next) => { location.hash = `#/mapedit?uid=${next}`; }, uid);
  await page.waitForFunction(() => !!(window as any).testDebug?.mapData?.value?.mapID);
  const tab = page.locator('[data-testid="map-tab-settings"]');
  await expect(tab).toBeVisible({ timeout: 30000 });
  await tab.click();
  await expect(page.getByTestId('map-base-map-selector')).toBeVisible({ timeout: 30000 });
}

/** ベースマップ選択の左ペインに今見えている行の uid 一覧。 */
async function visibleSelectorUids(page: Page): Promise<string[]> {
  return page.getByTestId('map-base-map-selector')
    .locator('.source-pane .resource-master-row')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-resource-uid')).filter(Boolean) as string[]);
}

test.describe('m19-t11 範囲語彙の統一', () => {
  // -------------------------------------------------------------------------
  test('E1: ベースマップ編集の「存在範囲」ラベルと「？」本文が②との関係を述べる', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19-t11-e1-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const slug = `m19t11-e1-${Date.now()}`;
      const uid = await seedBaseMapWithCoverage(page, slug, 'E1 ベースマップ', [139.7, 35.6, 139.8, 35.7]);
      await openHash(page, `#/basemaps?uid=${uid}`);
      await expect(page.locator('[data-testid="basemap-editor"]')).toBeVisible({ timeout: 30000 });

      // ①のラベルは据置（ADR-0004 と m19-t3 が確定した基準点）
      const label = page.locator('label', { hasText: NAME.coverage }).first();
      await expect(label).toBeVisible({ timeout: 30000 });

      // ①の「？」本文に、②へ切り詰められる関係が書かれている（設計 §6.2 の第 3 文）
      await label.locator('[data-editor-help]').first().focus();
      const popover = page.locator('.editor-ui-help-popover');
      await expect(popover).toBeVisible({ timeout: 5000 });
      await expect(popover, 'E1: ①の説明が②との関係を述べる').toContainText(NAME.usage);
    } finally {
      await quitElectronApplication(app);
    }
  });

  // -------------------------------------------------------------------------
  test('E2/E3: アプリ編集の③ラベルが「アプリ対象範囲」で、②の「？」に 3 概念が並ぶ', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19-t11-e23-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const bmSlug = `m19t11-e3-bm-${Date.now()}`;
      await seedBaseMapWithCoverage(page, bmSlug, 'E3 ベースマップ', [139.7, 35.6, 139.8, 35.7]);

      await openHash(page, '#/appedit');
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30000 });
      await page.getByTestId('app-id').fill(`m19t11-app-${Date.now()}`);
      await page.getByTestId('app-id').press('Tab');
      await page.getByTestId('app-title').fill('M19T11 App');
      await page.getByTestId('app-title').press('Tab');

      // ---- E2: ③のラベル（メタデータタブ） ----
      const covLabel = page.getByTestId('app-coverage-label');
      await expect(covLabel).toBeVisible({ timeout: 30000 });
      await expect(covLabel, 'E2: ③は確定呼称「アプリ対象範囲」').toContainText(NAME.appTarget);
      await expect(covLabel, 'E2: 廃止呼称「アプリ提供範囲」が残っていない')
        .not.toContainText('アプリ提供範囲');
      await expect(covLabel, 'E2: (参考) は落ちている').not.toContainText('(参考)');

      // ---- E3: ②の「？」（AC13。3 概念が 1 段落に並ぶ唯一の場所） ----
      await page.getByTestId('app-sources-tab').click();
      await page.getByTestId('app-basemap-mode').click();
      await page.getByTestId('app-basemap-search').fill(bmSlug);
      await expect(page.getByTestId(`app-basemap-row-${bmSlug}`)).toBeVisible({ timeout: 30000 });
      await page.getByTestId(`app-basemap-row-${bmSlug}`).click();
      const card = page.getByTestId(`app-selected-source-${bmSlug}`);
      await expect(card).toBeVisible();

      // ②のラベルは括弧を落とした「利用範囲」
      const envLabel = card.locator('label', { hasText: NAME.usage }).first();
      await expect(envLabel).toBeVisible();
      await expect(envLabel, 'E3: 「(経緯度)」は落ちている').not.toContainText('(経緯度)');

      const help = card.getByTestId('app-source-envelope-help');
      await expect(help, 'E3: ②に「？」が新設されている').toBeVisible();
      await help.click();
      const popover = page.locator('.popover');
      await expect(popover).toBeVisible({ timeout: 5000 });
      // AC13: 本文に確定呼称 3 語が含まれる
      for (const name of [NAME.coverage, NAME.usage, NAME.appTarget]) {
        await expect(popover, `AC13: ②の説明に「${name}」が含まれる`).toContainText(name);
      }
    } finally {
      await quitElectronApplication(app);
    }
  });

  // -------------------------------------------------------------------------
  test('E4: 一覧 4 画面の絞り込みモーダルが「絞り込み範囲を指定」（①の語を借りない）', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19-t11-e4-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const screens: { hash: string; testId: string; name: string }[] = [
        { hash: '#/maplist', testId: 'map-range-filter', name: '地図一覧' },
        { hash: '#/applist', testId: 'app-range-filter', name: 'アプリ一覧' },
        { hash: '#/poisources', testId: 'poi-source-range-filter', name: 'POIソース一覧' },
        { hash: '#/basemaps', testId: 'basemap-range-filter', name: 'ベースマップ一覧' },
      ];
      for (const s of screens) {
        await openHash(page, s.hash);
        const btn = page.getByTestId(s.testId);
        await expect(btn, `${s.name}: 範囲フィルタボタン`).toBeVisible({ timeout: 30000 });
        await btn.click();

        const title = page.getByTestId('envelope-modal-title');
        await expect(title, `${s.name}: モーダルが開く`).toBeVisible({ timeout: 15000 });
        await expect(title, `E4: ${s.name} のモーダルは④の確定呼称`)
          .toContainText(NAME.filterModalTitle);
        await expect(title, `E4: ${s.name} が①の語「存在範囲を指定」を借りていない`)
          .not.toContainText('存在範囲を指定');

        await page.locator('.envelope-modal .btn-close').first().click();
        await expect(page.locator('.envelope-modal')).not.toBeVisible();
      }
    } finally {
      await quitElectronApplication(app);
    }
  });

  // -------------------------------------------------------------------------
  test('E5: 地図編集の 2 つの絞り込みモーダルが同一呼称で、POI 側がベースマップを語らない', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19-t11-e5-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const mapUid = await createMapWithGcps(page);
      await openMapEditSettings(page, mapUid);

      // --- ベースマップ選択側 ---
      await page.getByTestId('map-base-map-region-button').click();
      const bmTitle = page.getByTestId('envelope-modal-title');
      await expect(bmTitle).toBeVisible({ timeout: 15000 });
      await expect(bmTitle, 'E5: ベースマップ選択側も④の確定呼称').toContainText(NAME.filterModalTitle);
      // ベースマップ選択なので help は _basemap 版（存在範囲に言及してよい）
      const bmHelp = page.locator('.envelope-modal .modal-title [data-editor-help]').first();
      await bmHelp.click();
      await expect(page.locator('.popover')).toContainText('ベースマップ', { timeout: 5000 });
      await page.keyboard.press('Escape');
      await page.locator('.envelope-modal .btn-close').first().click();
      await expect(page.locator('.envelope-modal')).not.toBeVisible();

      // --- POI 選択側（設計 §5.7 の是正: 中立文へ切り替えた） ---
      const poiTab = page.locator('[data-testid="map-tab-pois"]');
      await expect(poiTab).toBeVisible({ timeout: 15000 });
      await poiTab.click();
      const poiRangeBtn = page.getByTestId('map-poi-range-button');
      await expect(poiRangeBtn).toBeVisible({ timeout: 30000 });
      await poiRangeBtn.click();

      const poiTitle = page.getByTestId('envelope-modal-title');
      await expect(poiTitle).toBeVisible({ timeout: 15000 });
      await expect(poiTitle, 'E5: POI 選択側も同じ④の確定呼称').toContainText(NAME.filterModalTitle);
      const poiHelp = page.locator('.envelope-modal .modal-title [data-editor-help]').first();
      await poiHelp.click();
      const poiPopover = page.locator('.popover');
      await expect(poiPopover).toBeVisible({ timeout: 5000 });
      await expect(
        poiPopover,
        'E5: POI ソースを絞り込む画面でベースマップの話をしない（設計 §5.7 の是正）',
      ).not.toContainText('ベースマップ');
    } finally {
      await quitElectronApplication(app);
    }
  });

  // -------------------------------------------------------------------------
  // AC15 / E6 — 本 spec の主眼。ファイル冒頭の長いコメントを参照のこと。
  // -------------------------------------------------------------------------
  test('E6/AC15: 手動の絞り込み範囲を確定すると、リストが実際にその範囲で絞られる', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19-t11-e6-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const stamp = Date.now();
      // 近傍: 東京（GCP 自動範囲＝東京の内側）。**未チェックのまま**にする
      //   （チェック済みは adapter が bbox フィルタをバイパスするため消えない。レビュー v2 Info-3）
      const nearUid = await seedBaseMapWithCoverage(
        page, `m19t11-near-${stamp}`, `近傍テスト ${stamp}`, [139.75, 35.62, 139.78, 35.67],
      );
      // 遠方: 大阪（GCP 自動範囲と交差しない）
      const farUid = await seedBaseMapWithCoverage(
        page, `m19t11-far-${stamp}`, `遠方テスト ${stamp}`, [135.49, 34.66, 135.51, 34.68],
      );

      const mapUid = await createMapWithGcps(page);
      await openMapEditSettings(page, mapUid);

      // --- 前提: 自動（GCP 範囲）では近傍が出て遠方が出ない ---
      await expect(page.getByTestId('map-base-map-region-button')).toContainText('GCP範囲で絞り込み中');
      await expect
        .poll(async () => (await visibleSelectorUids(page)).includes(nearUid), { timeout: 30000 })
        .toBe(true);
      const autoUids = await visibleSelectorUids(page);
      expect(autoUids, '前提: 自動範囲（東京）では遠方（大阪）が出ない').not.toContain(farUid);

      // --- 手動の絞り込み範囲を「遠方だけを含む矩形」で確定する ---
      // 描画 UI を経由せず親 ref を直接書き換える（m11-t11-geocoder-estimate.spec.ts と同一手法）
      await page.getByTestId('map-base-map-region-button').click();
      await expect(page.locator('.envelope-modal')).toBeVisible({ timeout: 15000 });
      await page.evaluate(() => {
        (window as any).testDebug.baseMapFilterRegion.value = [
          [135.40, 34.60],
          [135.60, 34.60],
          [135.60, 34.75],
          [135.40, 34.75],
        ];
      });
      await page.locator('.envelope-modal .btn-close').first().click();
      await expect(page.locator('.envelope-modal')).not.toBeVisible();

      // --- AC15 の本体: **ボタン文言ではなくリストの中身**を見る ---
      //
      // ここでボタン文言だけを見ると、395 行を行ごと削除した壊れた実装でも緑になる。
      // baseMapRangeState は baseMapFilterRegion を直接読むため、絞り込みが壊れていても
      // 「手動設定範囲で絞り込み中」と表示し続けるからである（設計 §5.6）。
      await expect
        .poll(async () => (await visibleSelectorUids(page)).includes(farUid), { timeout: 30000 })
        .toBe(true);

      const manualUids = await visibleSelectorUids(page);
      expect(
        manualUids,
        'AC15: 手動の絞り込み範囲（大阪）に入る遠方ベースマップが一覧に現れる。'
        + ' ここが落ちる場合、baseMapSpatialContext の if (manual) 経路が死んでいる'
        + '（MapEdit.vue の 395 行を行ごと削除すると起きる。設計 §5.6）',
      ).toContain(farUid);
      expect(
        manualUids,
        'AC15: 手動の絞り込み範囲の外にある近傍ベースマップは一覧から消える。'
        + ' ここが落ちる場合、手動範囲が握り潰されて GCP 自動範囲へフォールスルーしている',
      ).not.toContain(nearUid);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
