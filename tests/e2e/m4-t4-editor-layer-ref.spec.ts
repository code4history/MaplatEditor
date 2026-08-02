// M4-T4: Editor が URLレイヤ・上書きレイヤを読み書きできるようにする — E2E
// 設計 docs/superpowers/specs/2026-08-02-m4-t4-editor-layer-ref-support-design.md v1.1 §7 準拠。
//
// 検証範囲:
//   AC2: 上書きレイヤ行に viewer-fatal 注記（poiref-key-missing）が出ない
//   AC3: 上書きレイヤ行のバッジ・注記が「外部ファイル参照」になる
//   AC4: 上書きレイヤ行で上書き（hide / title）を編集でき、保存形に載る
//   AC5: 裸 URL 行の「上書きを追加」で {layer:URL} へ変わり、上書き編集が開く
//   AC6: 単独形（URL 文字列）が read-only にならず警告も出ない（m4-t1 spec と分担）
//   AC7: 単独形の文書は要素数1のままなら単独形で保存される（配列化しない）
//   AC9: 単独形 URL の文書で POI が黙って消えない
//
// 【設計 §5.6 / AC8 の実測による訂正】設計は「単独形 URL の文書で POI を追加 → 可能。
// 元の URL は要素として残り配列化して2要素になる」としていたが、**UI からこの経路には到達
// できない**。PoiReferenceEditor の hasNonReferenceEntries（:356）が非参照要素の存在で真に
// なり、POI ソース選択ペインが m3-t6 の既存制約（poiref.add_blocked_note）で無効化される
// ためである。t4 が解除するのは readOnly だけで、この制約は別物であり t4 の範囲外。
// ∴ 「黙って消えない」（t1 の約束）は、追加時に上書きされる経路がそもそも存在しないという
// より強い形で維持される。単独形→配列化の写像そのものは純関数の契約として
// smoke m4-t4 Part D が表駆動で検証する（UI から到達できない分岐でも契約は正しく持つ）。
//
// 待機はすべて状態ベース（固定スリープ禁止）。seed 手順は m4-t1 spec と同一
// （GCP 4点 + updateTin の compiled が無いと viewer runtime ゲートで保存が通らない）。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

const URL_A = 'morioka_one_poi.json';
const URL_B = 'another_poi.json';

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash: string) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

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

async function stubMessageBoxOk(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
}

async function seedMap(page: Page, slug: string, pois: unknown): Promise<string> {
  return await page.evaluate(async ({ slug, pois }: any) => {
    const mapObject: any = {
      mapID: slug, title: { ja: 'M4-T4 地図' },
      officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: { ja: 'attr' }, dataAttr: {}, description: {},
      license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
      imageExtension: 'png', width: 400, height: 300,
      url_: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      gcps: [
        [[0, 300], [15728000, 5316000]],
        [[400, 300], [15740000, 5316000]],
        [[400, 0], [15740000, 5326000]],
        [[0, 0], [15728000, 5326000]],
      ],
      edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
    };
    if (pois !== undefined) mapObject.pois = pois;
    const r1: any = await (window as any).mapedit.save({ slug, mapObject, tins: [] });
    if (!r1 || r1.result !== 'Success') throw new Error(`map save failed: ${JSON.stringify(r1)}`);
    const tinResult: any = await (window as any).mapedit.updateTin(
      mapObject.gcps, mapObject.edges, 0, [mapObject.width, mapObject.height],
      mapObject.strictMode, mapObject.vertexMode,
    );
    if (!Array.isArray(tinResult) || !tinResult[1] || typeof tinResult[1] !== 'object') {
      throw new Error(`TIN compile failed: ${JSON.stringify(tinResult)}`);
    }
    const r2: any = await (window as any).mapedit.save({ uid: r1.uid, slug, mapObject, tins: [tinResult] });
    if (!r2 || r2.result !== 'Success') throw new Error(`map save (compiled) failed: ${JSON.stringify(r2)}`);
    return r1.uid as string;
  }, { slug, pois } as any);
}

async function readSavedMapPois(page: Page, uid: string): Promise<unknown> {
  return await page.evaluate(async (mapUid: string) => {
    const doc: any = await (window as any).mapedit.request(mapUid);
    return doc?.pois;
  }, uid);
}

async function openMapPoisTab(page: Page, uid: string, slug: string) {
  await openHash(page, `#/mapedit?uid=${uid}`);
  await expect(page.getByTestId('map-slug')).toHaveValue(slug, { timeout: 30000 });
  await page.getByTestId('map-tab-pois').click();
  const poisPane = page.getByTestId('map-pois-tab-pane');
  return { poisPane, cards: poisPane.locator('.selected-source') };
}

async function saveEditor(page: Page): Promise<void> {
  await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 60000 });
}

test.describe('M4-T4: URLレイヤ・上書きレイヤの読み書き', () => {
  test('AC2/AC3/AC4: 上書きレイヤ行は誤警告なし・外部ファイル参照バッジ・上書き編集が保存形へ載る', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m4-t4-wrapper-'));
    const { app, page } = await launch(e2eRoot);
    await stubMessageBoxOk(app);
    const slug = `m4-t4-wrapper-${Date.now()}`;

    try {
      // t2/t3 が出力する形そのもの: 先頭が生 FC、2件目が上書きレイヤ。
      // t4 以前はこの配列で「複層モード index>=1 の key 欠落」= viewer 全損の誤警告が出ていた
      const fc = {
        type: 'FeatureCollection', id: 'layer-a', lang: 'ja',
        features: [{
          type: 'Feature', id: 'f1',
          geometry: { type: 'Point', coordinates: [141.35, 43.06] },
          properties: { name: { ja: 'FC の POI' } },
        }],
      };
      const uid = await seedMap(page, slug, [fc, { layer: URL_A }]);
      const { poisPane, cards } = await openMapPoisTab(page, uid, slug);
      await expect(cards, '前提: 2件のカードが表示される').toHaveCount(2, { timeout: 30000 });

      const wrapperCard = cards.nth(1);

      // ---- AC2: viewer-fatal 注記が出ない（t4 以前はここが誤警告の発生点だった）----
      await expect(
        poisPane.getByTestId('poiref-key-missing'),
        'AC2: 上書きレイヤに viewer 全損の誤警告が出ない',
      ).toHaveCount(0);

      // ---- AC3: バッジ・注記が「外部ファイル参照」になる（「地図内定義POI」ではない）----
      await expect(wrapperCard, 'AC3: 上書きレイヤのバッジは外部ファイル参照').toContainText('外部ファイル参照');
      await expect(wrapperCard, 'AC3: 旧分類（地図内定義POI）へ落ちない').not.toContainText('地図内定義POI');

      // ---- AC4: 上書き（hide）を編集でき、保存形に載る ----
      const hide = wrapperCard.getByTestId('poiref-hide-override');
      await expect(hide, 'AC4: 上書きレイヤ行に hide 上書きの UI が開いている').toHaveCount(1);
      await hide.locator('input[type="checkbox"]').check();
      await saveEditor(page);

      const saved: any = await readSavedMapPois(page, uid);
      expect(Array.isArray(saved), 'AC4: 配列のまま保存される').toBe(true);
      expect(saved[1], 'AC4: 上書きがラッパーへ載る（参照先の中身は変えない）')
        .toEqual({ layer: URL_A, hide: true });
      expect(saved[0]?.id, 'AC4: 先頭の生 FC は変わらない').toBe('layer-a');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC5: 裸 URL 行の「上書きを追加」でラッパーへ変わり上書き編集が開く', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m4-t4-addoverride-'));
    const { app, page } = await launch(e2eRoot);
    await stubMessageBoxOk(app);
    const slug = `m4-t4-add-${Date.now()}`;

    try {
      // 配列 [URL] は実データ7件に実在する形（親設計 §2.5）
      const uid = await seedMap(page, slug, [URL_A, URL_B]);
      const { poisPane, cards } = await openMapPoisTab(page, uid, slug);
      await expect(cards, '前提: 2件の裸 URL カード').toHaveCount(2, { timeout: 30000 });

      const first = cards.nth(0);
      await expect(first, '前提: 裸 URL のバッジは外部URL参照').toContainText('外部URL参照');
      await expect(
        first.getByTestId('poiref-hide-override'),
        '前提: 裸 URL には上書きを載せる場所が無いので UI は閉じている',
      ).toHaveCount(0);

      await first.getByTestId('poiref-add-override').click();

      // ---- AC5: ラッパーへ変わり、上書き編集ブロックが開く ----
      await expect(
        cards.nth(0).getByTestId('poiref-hide-override'),
        'AC5: 上書きを追加すると上書き編集が開く',
      ).toHaveCount(1, { timeout: 10000 });
      await expect(cards.nth(0), 'AC5: バッジも外部ファイル参照へ変わる').toContainText('外部ファイル参照');
      await expect(cards.nth(1), 'AC5: 他の行は裸 URL のまま').toContainText('外部URL参照');

      await saveEditor(page);
      const saved: any = await readSavedMapPois(page, uid);
      expect(saved, 'AC5: 保存形は先頭だけがラッパーになる').toEqual([{ layer: URL_A }, URL_B]);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC6/AC7/AC9: 単独形は編集可能・保存形が維持され・黙って消えない', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m4-t4-single-'));
    const { app, page } = await launch(e2eRoot);
    await stubMessageBoxOk(app);
    const stamp = Date.now();
    const slug = `m4-t4-single-${stamp}`;
    const poiSlug = `m4-t4-poi-${stamp}`;

    try {
      const poiUid = await page.evaluate(async (s: string) => {
        const created: any = await (window as any).poiSources.createLocal({ slug: s, title: { ja: 'M4-T4 POI' }, lang: 'ja' });
        if (!created || created.result !== 'Success') throw new Error(`poi create failed: ${JSON.stringify(created)}`);
        await (window as any).poiSources.save(created.uid, {
          slug: s, title: { ja: 'M4-T4 POI' },
          fc: {
            type: 'FeatureCollection', lang: 'ja',
            features: [{
              type: 'Feature', id: 'p1',
              geometry: { type: 'Point', coordinates: [141.35, 43.06] },
              properties: { _maplatUid: crypto.randomUUID(), name: { ja: 'テストPOI' } },
            }],
          },
        });
        return created.uid as string;
      }, poiSlug);

      // 実データ maps/morioka.json と同形の単独形
      const uid = await seedMap(page, slug, URL_A);

      // メタデータタブ（初期表示）で先に dirty にしておく。POI タブへ移ると map-title は
      // 非表示になるため、m4-t1 spec と同じ順序で行う
      await openHash(page, `#/mapedit?uid=${uid}`);
      await expect(page.getByTestId('map-slug')).toHaveValue(slug, { timeout: 30000 });
      await page.getByTestId('map-title').fill('M4-T4 地図（編集後）');

      const { poisPane, cards } = await openMapPoisTab(page, uid, slug);

      // ---- AC6（再掲）: 単独形は read-only にならず警告も出ない ----
      await expect(cards, 'AC6: 単独形が1件のカードとして編集可能に出る').toHaveCount(1, { timeout: 30000 });
      await expect(
        poisPane.locator('.editor-diagnostic__message'),
        'AC6: 未対応形式の警告は出ない',
      ).toHaveCount(0);

      // ---- AC7: 要素数1のままの編集は単独形で保存される（配列化しない）----
      await saveEditor(page);
      expect(await readSavedMapPois(page, uid), 'AC7: 単独形のまま保存される').toBe(URL_A);

      // ---- AC9(a): POI 追加による上書き喪失の経路が存在しない ----
      // 非参照要素（ここでは URLレイヤ）がある間は POI ソースの追加自体が塞がれている
      // （m3-t6 の既存制約。t4 が解除するのは readOnly だけ）
      await page.getByTestId('map-tab-pois').click();
      await expect(cards, '前提: カードは1件のまま').toHaveCount(1, { timeout: 30000 });
      await expect(
        poisPane.locator('.poi-selector-disabled'),
        'AC9(a): 非参照要素がある間は POI ソース選択が無効化される（追加で上書きされる経路が無い）',
      ).toHaveCount(1);
      const rows = poisPane.locator('.source-pane .resource-master-row');
      await expect(rows.first(), '前提: 一覧には登録済み POI ソースが出ている').toBeVisible({ timeout: 30000 });
      await rows.first().click({ force: true });
      await expect(cards, 'AC9(a): クリックしてもカードは増えない').toHaveCount(1);

      // ---- AC9(b): 削除は確認ダイアログを経る明示操作である ----
      await poisPane.locator('.selected-source .btn-outline-danger').first().click();
      await expect(
        page.getByTestId('delete-confirm-button'),
        'AC9(b): 非参照要素の × は削除確認を経る（黙って消えない）',
      ).toBeVisible({ timeout: 10000 });

      // 参照した poiUid は seed の前提確認にのみ使う（追加経路が塞がれているため選択はしない）
      expect(typeof poiUid, '前提: POI ソースが seed されている').toBe('string');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
