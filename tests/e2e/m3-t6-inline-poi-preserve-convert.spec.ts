// M3-T6: inline POI の保全パネル完成と GeoJSON 変換 E2E (設計 §11.1 — v1.3 レイヤ単位ペイン)。
// フィクスチャは §4.2 の完全分割表から導出 (shape 列は smoke Part I のクラス転記表と同一表):
//   手順1-6 = C4 単層クリーン [object, object] / 手順4b = C2a [fc, fc] → C3 [fc, fc, object] /
//   手順4c = C5 [object, object, fc, string] / 手順4d = C6b [string, object, fc]
// 手順: seed → 表示(レイヤペイン+バッジ2種+項目数 AC6-1/6-12/6-13) → 制約(AC6-3)
//       → 変換(レイヤ単位 AC6-4/6-8(b)/6-12) → ドラフト編集保存(AC6-4後半)
//       → 削除確認(AC6-6)+再有効化(AC6-3後半) → zip インポートアラート(AC6-2, dialog stub)
//       → heal 警告 UI 面(AC6-9)
// dialog stub 基盤は m11-t10-dedup-import.spec.ts の実績文法 (app.evaluate で main 側 dialog 差し替え)。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import AdmZip from 'adm-zip';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

// 1x1 透明 PNG (タイル/サムネイルのダミー実体)
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot, env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
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

// seed / 更新: 指定 pois を持つ地図を保存する (uid 指定時は更新 — m11-t8b の実績文法)
async function saveMapWithPois(
  page: Page,
  args: { slug: string; uid?: string; title: string; pois: unknown[] },
): Promise<{ uid: string; slug: string; pois: unknown[] }> {
  return page.evaluate(async ({ slug, uid, title, pois }) => {
    const payload: Record<string, unknown> = { slug, mapObject: {
      mapID: slug, title: { ja: title }, officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: { ja: 'T6 attribution' }, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA',
      reference: '', url: '', lang: 'ja', imageExtension: 'jpg', width: 400, height: 300,
      gcps: [
        [[100, 100], [15550000, 4160000]],
        [[300, 100], [15560000, 4160000]],
        [[200, 250], [15555000, 4150000]],
      ],
      edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
      pois,
    }, tins: [] };
    if (uid) payload.uid = uid;
    const result = await window.mapedit.save(payload as never);
    if (!result || result.result !== 'Success') throw new Error(`seed map failed: ${JSON.stringify(result)}`);
    return { uid: (result.uid ?? uid) as string, slug, pois };
  }, args);
}

// 手順1 seed (C4 単層クリーン): 旧 POI オブジェクト 2 件のみ (lat/lng + 任意キー start/memo + 旧相対名 image)
function singleLayerCleanPois(): unknown[] {
  return [
    { name: '旧POI甲', lat: 39.7052, lng: 141.1592, start: 1599, image: 'mitsuishi_jinja.jpg' },
    { name: '旧POI乙', lat: 39.7060, lng: 141.1600, memo: '任意キー' },
  ];
}

// 生 FC 要素 (id = レイヤ key。name は指定時のみ)
function rawFc(id: string | null, name: string | null, featureCount: number): Record<string, unknown> {
  const fc: Record<string, unknown> = {
    type: 'FeatureCollection',
    features: Array.from({ length: featureCount }, (_, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [141.15 + i * 0.01, 39.70 + i * 0.01] },
      properties: { name: `F${i + 1}` },
    })),
  };
  if (id !== null) fc.id = id;
  if (name !== null) fc.name = name;
  return fc;
}

async function seedPoiSource(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const slug = `t6-src-${Date.now()}`;
    const r = await window.poiSources.createLocal({ slug, title: { ja: 'T6 参照用' }, lang: 'ja' });
    if (!r || r.result !== 'Success') throw new Error(`createLocal: ${JSON.stringify(r)}`);
    // 座標は seed 地図の GCP 範囲 (merc ≈ [15550000-15560000, 4150000-4160000] ≈ lng 139.7 / lat 34.9)
    // 近傍に置く — MapEdit の POI selector は GCP 由来の範囲フィルタが自動有効のため、圏外だと一覧に出ない
    await window.poiSources.save(r.uid, {
      slug, title: { ja: 'T6 参照用' },
      fc: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'p1', geometry: { type: 'Point', coordinates: [139.72, 34.95] }, properties: { name: { ja: 'T6F' } } }] },
    });
    return { uid: r.uid, slug };
  });
}

// main 側 dialog.showMessageBox を記録 stub に差し替える (OK 自動応答 + message 記録)
async function stubMessageBoxRecording(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ dialog }) => {
    (globalThis as any).__t6MessageBoxLog = [];
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = (args.length >= 2 ? args[1] : args[0]) as { message?: string };
      (globalThis as any).__t6MessageBoxLog.push(options?.message ?? '');
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
}

async function recordedMessages(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(async () => ((globalThis as any).__t6MessageBoxLog ?? []) as string[]);
}

async function clearRecordedMessages(app: ElectronApplication): Promise<void> {
  await app.evaluate(async () => { (globalThis as any).__t6MessageBoxLog = []; });
}

// POIデータタブを開いてペインスコープの locator を返す共通手順
async function openPoisTab(page: Page, uid: string, slug: string) {
  await openHash(page, `#/mapedit?uid=${uid}`);
  await expect(page.getByTestId('map-slug')).toHaveValue(slug, { timeout: 30000 });
  await page.getByTestId('map-tab-pois').click();
  // ベースマップタブ等の別 ResourceSelector が v-show で DOM 共存するため、POI タブペインへスコープする
  const poisPane = page.getByTestId('map-pois-tab-pane');
  return { poisPane, cards: poisPane.locator('.selected-source') };
}

// 削除確認 dialog を confirm して 1 件消す
async function confirmDeleteCard(page: Page, cards: ReturnType<Page['locator']>, index: number, remainAfter: number): Promise<void> {
  await cards.nth(index).locator('.btn-outline-danger').click();
  await page.getByTestId('delete-confirm-button').click();
  await expect(cards).toHaveCount(remainAfter);
}

// fixture zip (maps/<slug>.json + tiles/<slug>/0/0/0.png + tmbs/<slug>.jpg) をテスト内生成
async function buildMapZip(dir: string, slug: string, pois: unknown[] | undefined): Promise<string> {
  const store: Record<string, unknown> = {
    title: { ja: `${slug} タイトル` }, attr: { ja: 'attr' }, officialTitle: {}, dataAttr: {},
    author: {}, createdAt: {}, era: {}, license: 'PD', dataLicense: 'CC BY-SA', contributor: {}, mapper: {},
    reference: '', description: {}, url: '', lang: 'ja', imageExtension: 'png', width: 400, height: 300,
    gcps: [], edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain',
    homePosition: [141.15, 39.70], mercZoom: 15,
  };
  if (pois) store.pois = pois;
  const zip = new AdmZip();
  zip.addFile(`maps/${slug}.json`, Buffer.from(JSON.stringify(store)));
  zip.addFile(`tiles/${slug}/0/0/0.png`, TINY_PNG);
  zip.addFile(`tmbs/${slug}.jpg`, TINY_PNG);
  const zipPath = path.join(dir, `${slug}.zip`);
  await writeFile(zipPath, zip.toBuffer());
  return zipPath;
}

test.describe('M3-T6 inline POI 保全・変換', () => {
  test('手順1-6: 単層クリーン(C4) — レイヤペイン・項目数・制約・レイヤ変換・ドラフト編集保存・削除確認・再有効化', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t6-main-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxRecording(app);
      const seeded = await saveMapWithPois(page, { slug: `t6-map-${Date.now()}`, title: 'T6 地図', pois: singleLayerCleanPois() });
      const source = await seedPoiSource(page);

      // --- 手順2: 単層モード = レイヤペイン 1 枚 + バッジ「地図内定義POI」 + 項目数 (AC6-1, 6-12, 6-13) ---
      const { poisPane, cards } = await openPoisTab(page, seeded.uid, seeded.slug);
      await expect(poisPane.getByTestId('poiref-layer-pane')).toHaveCount(1, { timeout: 15000 });
      await expect(cards).toHaveCount(2);
      await expect(poisPane.locator('.selected-source .badge', { hasText: '地図内定義POI' })).toHaveCount(2);
      const counts = poisPane.getByTestId('poiref-item-count');
      await expect(counts).toHaveCount(2);
      await expect(counts.nth(0)).toHaveText(/1 項目/); // 旧オブジェクト = 1
      await expect(counts.nth(1)).toHaveText(/1 項目/);
      // 中身確認 UI (フォーム等) は追加されていない: 非参照メンバー行に上書きフォームが無い
      await expect(cards.first().locator('input')).toHaveCount(0);
      // 単層クリーン = 混在警告なし (C4 — §4.2)
      await expect(poisPane.getByTestId('poiref-mixed-warning')).toHaveCount(0);

      // --- 手順3: 相互排他制約 (AC6-3 前半) ---
      const selectorPane = poisPane.locator('.source-pane-body');
      await expect(selectorPane).toHaveClass(/poi-selector-disabled/);
      await expect(selectorPane).toHaveAttribute('aria-disabled', 'true');
      // ContextHelp (i) ボタンが見出し脇に出る (理由 = add_blocked_note)
      await expect(poisPane.locator(`[aria-label*="GeoJSON POIを追加できません"]`).first()).toBeVisible();

      // --- 手順3b (実装レビュー Minor-2): 視覚無効化 (pointer-events:none) を迂回する操作でも
      // 追加が阻止されること。選択行は role="button" で Enter keydown が select を emit するため
      // (ResourceMasterRow @keydown.enter)、キーボード操作は CSS の pointer-events では防げない。
      // focus + Enter keydown を直接発火し、addPoiSource 冒頭の機能ガード
      // (hasNonReferenceEntries early return — PoiReferenceEditor.vue) が最終防衛線として
      // 参照追加を阻止することを assert する ---
      const guardTargetRow = selectorPane.locator(`[data-resource-uid="${source.uid}"]`);
      await expect(guardTargetRow).toHaveCount(1); // 空振り防止: 選択行の実在を先に確認
      await guardTargetRow.evaluate((el) => {
        (el as HTMLElement).focus();
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      });
      // 参照は追加されない: メンバー行 2 (非参照のみ) のまま・参照カード化した行なし
      await expect(cards).toHaveCount(2);
      await expect(poisPane.locator('.selected-source .badge', { hasText: '地図内定義POI' })).toHaveCount(2);

      // --- 手順4: レイヤ変換 (単層 = ペインヘッダのボタン 1 個で配列全体を 1 ドラフト。AC6-4, 6-8(b), 6-12) ---
      const groupButton = poisPane.getByTestId('poiref-convert-group');
      await expect(groupButton).toHaveText(/旧POI 2 件/); // count = メンバー総数
      await expect(groupButton).toBeEnabled(); // C4 クリーン = 変換可能 (§4.4)
      // 変換ボタンはレイヤに 1 個のみ (一括 + 個別の二重構造なし — AC6-4)
      await expect(poisPane.getByTestId('poiref-convert-group')).toHaveCount(1);
      await expect(poisPane.getByTestId('poiref-convert-fc')).toHaveCount(0);
      await groupButton.click();
      await expect(poisPane.locator('.editor-diagnostic__message', { hasText: `POIドラフト「${seeded.slug}-poi」を作成しました` }))
        .toBeVisible({ timeout: 15000 });
      // document (pois 配列) は不変: メンバー行 2 のまま + DB 上も seed と同一
      await expect(cards).toHaveCount(2);
      const storedPois = await page.evaluate(async (uid) => (await (window as any).mapedit.request(uid)).pois, seeded.uid);
      expect(storedPois).toEqual(seeded.pois);
      // ドラフト出現 (kind 'poi' / baseRevision null / slug 自動採番 — slug 入力 UI なし)
      const draftsAfterGroup = await page.evaluate(async () => window.assetDrafts.list('poi'));
      expect(draftsAfterGroup.length).toBe(1);
      expect(draftsAfterGroup[0].slug).toBe(`${seeded.slug}-poi`);
      expect(draftsAfterGroup[0].baseRevision).toBeNull();

      // --- 手順4' (実装レビュー Minor-3 / 設計 §11.1): document 不変は「保存 → 再読込で同一」で
      // 確認する。上の DB 値比較は保存を挟まないため、変換がメモリ上の mapData.pois を変異させて
      // いても検出できない。無関係編集 (title) で dirty 化 → UI 保存 (確認 dialog は stub が
      // 自動 OK) → 保存後の再読取値が seed と deep-equal であることを assert する ---
      // map-title はメタデータ編集タブ内 (v-show) のため先にタブを切り替える
      await page.locator('[role="tab"]', { hasText: 'メタデータ編集' }).click();
      await page.getByTestId('map-title').fill('T6 地図 (保存検証)');
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 10000 });
      await page.getByTestId('editor-save').click();
      await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });
      const poisAfterSaveReload = await page.evaluate(async (uid) => (await (window as any).mapedit.request(uid)).pois, seeded.uid);
      expect(poisAfterSaveReload).toEqual(seeded.pois);

      // --- 手順5: POI 一覧のドラフトカード → PoiEdit 復元 → 保存 (AC6-4 後半) ---
      const groupDraftUid = draftsAfterGroup[0].assetUid;
      await openHash(page, '#/poisources');
      await expect(page.locator(`[data-resource-uid="${groupDraftUid}"]`)).toBeVisible({ timeout: 15000 });
      await page.locator(`[data-resource-uid="${groupDraftUid}"] a`).click();
      await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.poi-feature-row')).toHaveCount(2, { timeout: 15000 }); // 旧POI 2 件が復元される
      const saveButton = page.getByTestId('editor-save');
      await expect(saveButton).toBeEnabled({ timeout: 10000 });
      await saveButton.click();
      // 保存済みソース化 (createLocal promote — 予約 slug がそのまま採用される)
      await expect.poll(async () => page.evaluate(async (slug) => {
        const r = await (window as any).search.poiSources({ page: 1, pageSize: 50 });
        return (r.docs ?? []).some((doc: any) => doc.slug === slug);
      }, `${seeded.slug}-poi`), { timeout: 20000 }).toBe(true);

      // --- 手順6: 削除確認 (AC6-6) + 再有効化 (AC6-3 後半) ---
      await openHash(page, '#/maplist');
      const reopened = await openPoisTab(page, seeded.uid, seeded.slug);
      await expect(reopened.cards).toHaveCount(2, { timeout: 15000 });
      // × → 確認 dialog (body = 変換導線つき Undo 可能文言) → cancel で残存
      await reopened.cards.nth(0).locator('.btn-outline-danger').click();
      const dialogBody = page.locator('.modal-body p', { hasText: 'この外部データを一覧から削除します' });
      await expect(dialogBody).toBeVisible();
      await expect(dialogBody).toHaveText(/Undoで取り消せます/);
      await expect(dialogBody).toHaveText(/GeoJSONへの変換/);
      // 確認 title に項目数が併記される
      await expect(page.locator('.modal-title')).toHaveText(/旧POI甲（1 項目）/);
      await page.locator('.modal-footer .btn-outline-secondary').click(); // cancel
      await expect(reopened.cards).toHaveCount(2);
      // confirm で削除 ×2 (全非参照要素の削除)
      await confirmDeleteCard(page, reopened.cards, 0, 1);
      await confirmDeleteCard(page, reopened.cards, 0, 0);
      // 追加が自動で再有効化される → 参照を追加できる
      const selectorPane2 = reopened.poisPane.locator('.source-pane-body');
      await expect(selectorPane2).not.toHaveClass(/poi-selector-disabled/);
      await selectorPane2.locator(`[data-resource-uid="${source.uid}"]`).click();
      await expect(reopened.cards).toHaveCount(1, { timeout: 10000 });
      await expect(reopened.poisPane.locator('.selected-source .badge', { hasText: '地図内定義POI' })).toHaveCount(0);
      // 参照のみ (= 先頭 fc 写像 → 複層モード) になったため単層レイヤペインは消える (AC6-12)
      await expect(reopened.poisPane.getByTestId('poiref-layer-pane')).toHaveCount(0);

      console.log('  手順1-6: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('手順4b: 複層(C2a) — 要素ごと 1 ペイン・FC ごとの変換 → 壊れ要素追加で C3 (混在警告 + key 欠落注記)', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t6-multi-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const poisMulti = [
        rawFc('layer-a', '生FCレイヤA', 2),
        rawFc('layer-b', null, 1),
      ];
      const seeded = await saveMapWithPois(page, { slug: `t6-multi-${Date.now()}`, title: 'T6 複層', pois: poisMulti });

      // --- C2a: ペインは要素ごと (単層レイヤペインなし)・各生 FC カードに変換ボタン・混在警告なし ---
      const { poisPane, cards } = await openPoisTab(page, seeded.uid, seeded.slug);
      await expect(cards).toHaveCount(2, { timeout: 15000 });
      await expect(poisPane.getByTestId('poiref-layer-pane')).toHaveCount(0);
      await expect(poisPane.getByTestId('poiref-convert-group')).toHaveCount(0); // レイヤ一括ボタンは出ない
      await expect(poisPane.getByTestId('poiref-convert-fc')).toHaveCount(2); // 1 カード = 1 レイヤ = 変換 1 個
      await expect(poisPane.getByTestId('poiref-mixed-warning')).toHaveCount(0);
      await expect(poisPane.getByTestId('poiref-key-missing')).toHaveCount(0); // 両 FC とも key (id) あり
      // 項目数 = features 数
      const counts = poisPane.getByTestId('poiref-item-count');
      await expect(counts.nth(0)).toHaveText(/2 項目/);
      await expect(counts.nth(1)).toHaveText(/1 項目/);

      // --- FC カードごとに変換 → <slug>-poi / <slug>-poi2 の 2 ドラフト (AC6-4, 6-8(b), 6-12) ---
      await poisPane.getByTestId('poiref-convert-fc').nth(0).click();
      await expect(poisPane.locator('.editor-diagnostic__message', { hasText: `POIドラフト「${seeded.slug}-poi」を作成しました` }))
        .toBeVisible({ timeout: 15000 });
      await poisPane.getByTestId('poiref-convert-fc').nth(1).click();
      await expect(poisPane.locator('.editor-diagnostic__message', { hasText: `POIドラフト「${seeded.slug}-poi2」を作成しました` }))
        .toBeVisible({ timeout: 15000 });
      const drafts = await page.evaluate(async () => window.assetDrafts.list('poi'));
      expect(drafts.map((d) => d.slug).sort()).toEqual([`${seeded.slug}-poi`, `${seeded.slug}-poi2`]);
      // title は FC.name 優先 (POI-114) / name 無し FC はホストタイトル fallback (§5.4 手順4)
      expect(drafts.find((d) => d.slug === `${seeded.slug}-poi`)?.label).toBe('生FCレイヤA');
      expect(drafts.find((d) => d.slug === `${seeded.slug}-poi2`)?.label).toBe('T6 複層');
      // document は不変
      const storedPois = await page.evaluate(async (uid) => (await (window as any).mapedit.request(uid)).pois, seeded.uid);
      expect(storedPois).toEqual(seeded.pois);

      // --- C3 遷移: 末尾へ key 無し旧 POI object を 1 件追加して再表示 (v1.3 手順4b 拡張) ---
      const poisBroken = [...poisMulti, { name: '壊れ旧POI', lat: 39.71, lng: 141.17 }];
      await saveMapWithPois(page, { slug: seeded.slug, uid: seeded.uid, title: 'T6 複層', pois: poisBroken });
      await openHash(page, '#/maplist');
      const reopened = await openPoisTab(page, seeded.uid, seeded.slug);
      await expect(reopened.cards).toHaveCount(3, { timeout: 15000 });
      // 依然として複層 (先頭 fc) = 単層レイヤペインなし・FC カードのみ変換可
      await expect(reopened.poisPane.getByTestId('poiref-layer-pane')).toHaveCount(0);
      await expect(reopened.poisPane.getByTestId('poiref-convert-fc')).toHaveCount(2);
      // 壊れ要素 (非 FC object) カード: 変換ボタンなし + 混在警告 + key 欠落注記 (AC6-12)
      const brokenCard = reopened.cards.nth(2);
      await expect(brokenCard.getByTestId('poiref-convert-fc')).toHaveCount(0);
      await expect(brokenCard.getByTestId('poiref-mixed-warning')).toBeVisible();
      await expect(brokenCard.getByTestId('poiref-key-missing')).toBeVisible();
      // 混在警告・key 欠落注記は壊れ要素カードのみ (FC カードには出ない)
      await expect(reopened.poisPane.getByTestId('poiref-mixed-warning')).toHaveCount(1);
      await expect(reopened.poisPane.getByTestId('poiref-key-missing')).toHaveCount(1);

      console.log('  手順4b: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('手順4c/4d: 混在(C5) は単層 1 ペイン + 警告 + 変換 disabled → 整理で自動有効化 / 先頭 URL(C6b) も同様', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t6-mixed-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // --- 手順4c (C5 — 人間指摘の症状ケース): [旧POI甲, 旧POI乙, 生FC, URL] ---
      const seededMixed = await saveMapWithPois(page, {
        slug: `t6-mixed-${Date.now()}`, title: 'T6 混在',
        pois: [...singleLayerCleanPois(), rawFc(null, '生FCレイヤ', 2), 'https://example.com/pois.json'],
      });
      const { poisPane, cards } = await openPoisTab(page, seededMixed.uid, seededMixed.slug);
      await expect(cards).toHaveCount(4, { timeout: 15000 });
      // 単層扱いで 1 ペイン (FC も URL もメンバー行として内包 — AC6-12)
      await expect(poisPane.getByTestId('poiref-layer-pane')).toHaveCount(1);
      // バッジ 2 種: 地図内定義POI × 3 (旧POI×2 + 生FC) / 外部URL参照 × 1 (AC6-13)
      await expect(poisPane.locator('.selected-source .badge', { hasText: '地図内定義POI' })).toHaveCount(3);
      await expect(poisPane.locator('.selected-source .badge', { hasText: '外部URL参照' })).toHaveCount(1);
      // 混在警告 (ペイン上部・共有述語 = C5 警告あり) + 変換 disabled + 理由注記 (§4.4)
      await expect(poisPane.getByTestId('poiref-mixed-warning')).toHaveCount(1);
      const groupButton = poisPane.getByTestId('poiref-convert-group');
      await expect(groupButton).toBeDisabled();
      await expect(poisPane.locator('[aria-label*="まとめて変換できません"]').first()).toBeVisible();
      // 複層用の FC 個別変換ボタンは出ない (変換単位は常にレイヤ = このペインの 1 個のみ)
      await expect(poisPane.getByTestId('poiref-convert-fc')).toHaveCount(0);

      // FC メンバーを削除 → まだ disabled (URL 残存)。C4 化により混在警告は消える (§4.2 C4 行)
      await confirmDeleteCard(page, cards, 2, 3);
      await expect(groupButton).toBeDisabled();
      await expect(poisPane.getByTestId('poiref-mixed-warning')).toHaveCount(0);
      // URL メンバーを削除 → 変換が自動有効化 (computed — §4.4)
      await confirmDeleteCard(page, cards, 2, 2);
      await expect(groupButton).toBeEnabled();
      await groupButton.click();
      await expect(poisPane.locator('.editor-diagnostic__message', { hasText: `POIドラフト「${seededMixed.slug}-poi」を作成しました` }))
        .toBeVisible({ timeout: 15000 });
      // 甲乙 2 features の 1 ドラフト
      const draftFeatures = await page.evaluate(async () => {
        const drafts = await window.assetDrafts.list('poi');
        if (drafts.length !== 1) throw new Error(`draft count: ${drafts.length}`);
        const envelope = await window.assetDrafts.get('poi', drafts[0].assetUid);
        return ((envelope?.payload as { features?: unknown[] })?.features ?? []).length;
      });
      expect(draftFeatures).toBe(2);

      // --- 手順4d (C6b — v1.3 新設): [URL, 旧POI甲, 生FC] = indeterminate ---
      const seededUrlHead = await saveMapWithPois(page, {
        slug: `t6-urlhead-${Date.now()}`, title: 'T6 先頭URL',
        pois: ['https://example.com/pois.json', { name: '旧POI甲', lat: 39.7052, lng: 141.1592 }, rawFc(null, '生FC', 1)],
      });
      await openHash(page, '#/maplist');
      const urlHead = await openPoisTab(page, seededUrlHead.uid, seededUrlHead.slug);
      await expect(urlHead.cards).toHaveCount(3, { timeout: 15000 });
      // 単層と同じ 1 ペイン (indeterminate — §4.2 C6b)
      await expect(urlHead.poisPane.getByTestId('poiref-layer-pane')).toHaveCount(1);
      // 混在警告あり (tail に fc と object の両方 — Major-1(c) 是正後の警告挙動)
      await expect(urlHead.poisPane.getByTestId('poiref-mixed-warning')).toHaveCount(1);
      // 変換ボタン disabled (URL メンバー含み恒常 — §4.4)
      await expect(urlHead.poisPane.getByTestId('poiref-convert-group')).toBeDisabled();
      await expect(urlHead.poisPane.getByTestId('poiref-convert-fc')).toHaveCount(0);

      console.log('  手順4c/4d: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('手順7: map zip インポート時アラート (AC6-2)', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t6-zip-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxRecording(app);
      const fixtureDir = path.join(e2eRoot, 'fixtures');
      await mkdir(fixtureDir, { recursive: true });
      const inlineZip = await buildMapZip(fixtureDir, `t6-zip-a-${Date.now()}`, [
        { name: '旧POI', lat: 39.7, lng: 141.15, start: 1599 },
        'https://example.com/pois.json',
      ]);
      const plainZip = await buildMapZip(fixtureDir, `t6-zip-b-${Date.now()}`, undefined);

      // inline pois 入り zip → 成功後にアラートが出る
      await app.evaluate(async ({ dialog }, filePath) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as typeof dialog.showOpenDialog;
      }, inlineZip);
      await openHash(page, '#/mapedit?import=1');
      await expect.poll(async () => (await recordedMessages(app)).some((m) => m.includes('地図内定義型のPOI指定は編集に対応していません')),
        { timeout: 60000 }).toBe(true);

      // pois 無し zip → アラート非呼出
      await clearRecordedMessages(app);
      await app.evaluate(async ({ dialog }, filePath) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as typeof dialog.showOpenDialog;
      }, plainZip);
      await openHash(page, '#/maplist');
      await openHash(page, '#/mapedit?import=1');
      // インポート完了 (地図一覧に 2 件目が載る) まで待ってから、アラートが出ていないことを確認
      await expect.poll(async () => page.evaluate(async () => (await window.maplist.request('', 1)).docs.length),
        { timeout: 60000 }).toBe(2);
      expect((await recordedMessages(app)).some((m) => m.includes('地図内定義型のPOI指定は編集に対応していません'))).toBe(false);

      console.log('  手順7: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('手順8: app heal 失敗時の警告表示 + タブ read-only (AC6-9 UI面)', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t6-heal-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 保存成功 dialog (appedit.success_save) を自動 OK するため stub を先に仕込む (手順8' 用)
      await stubMessageBoxRecording(app);
      // 破損 pois (heal 復元不能な生値) を持つ app を seed
      const seeded = await page.evaluate(async () => {
        const slug = `t6-heal-${Date.now()}`;
        const uid = crypto.randomUUID();
        const r = await window.appedit.save({
          uid, slug, create: true,
          document: { appID: slug, appName: { ja: 'T6 Heal' }, title: { ja: 'T6 Heal' }, description: {}, keywords: '', siteUrl: '', lang: 'ja', sources: [], pois: 'https://example.com/legacy-pois.json', httpSettings: {}, appSettings: {}, manifestSettings: {} },
        });
        if (!r || r.result !== 'Success') throw new Error(`create: ${JSON.stringify(r)}`);
        return { uid, slug };
      });
      await openHash(page, `#/appedit?uid=${seeded.uid}`);
      await expect(page.getByTestId('app-id')).toHaveValue(seeded.slug, { timeout: 30000 });
      await page.locator('[role="tab"]', { hasText: 'POI選択' }).click();
      const appPoisPane = page.getByTestId('app-pois-tab-pane');
      // 警告 (M12-T30 更新後文言: 「復元失敗」ではなく「エディタ未対応の形式」。
      // 保存で失われない・編集無効化・preview/export 非反映の3点は不変)
      await expect(appPoisPane.locator('.editor-diagnostic__message', { hasText: 'POIデータがエディタ未対応の形式です' })).toBeVisible({ timeout: 15000 });
      // タブ read-only (selector 無効化)
      await expect(appPoisPane.locator('.source-pane-body')).toHaveClass(/poi-selector-disabled/);

      // --- 手順8' (実装レビュー Minor-1 / AC6-9 の本体保証): 保存 → request で生値残存。
      // 「POI タブに触れずに保存しただけでデータが消えない」が守るべき不変条件。
      // 旧挙動 (heal 失敗でも normalize が pois: [] を document へ書込) では保存で生値が
      // 消失するため、警告表示だけでなく保存 round-trip 後の残存を assert する ---
      await page.locator('[role="tab"]', { hasText: 'メタデータ編集' }).click();
      await page.getByTestId('app-title').fill('T6 Heal 保存検証');
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 10000 });
      await page.getByTestId('editor-save').click();
      await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 30000 });
      const storedApp = await page.evaluate(async (uid) => (window as any).appedit.request(uid), seeded.uid);
      expect(storedApp.pois).toBe('https://example.com/legacy-pois.json');

      console.log('  手順8: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
