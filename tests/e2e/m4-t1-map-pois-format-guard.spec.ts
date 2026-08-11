// M4-T1: MapEdit の POI 扱いを AppEdit と同一の共通実装へ統一する — E2E
// 設計 docs/superpowers/specs/2026-08-02-m4-t1-map-pois-format-guard-design.md v1.3 §9 準拠。
//
// 検証範囲:
//   AC3/AC4: 【M4-T4 で契約が変わった】pois が URL 文字列（実データ maps/morioka.json と同形）の
//        地図は「単独形の URLレイヤ」として **編集可能** になった（viewer 正本が受容する形のため）。
//        read-only と未対応形式の警告は出ない。t1 の read-only はこの形を扱えなかった時点の
//        暫定であり、t4 の対応で不要になった
//   AC5: 同じ地図で他タブを編集して保存しても pois の生値がそのまま残る
//        （= 本タスクが塞ぐデータ喪失経路そのものの回帰テスト。**M4-T4 でも維持される** —
//        単独形は要素数1のまま単独形で保存されるため、文字列がそのまま残る）
//   AC6: 全解除の保存形が両画面ともキーなし／既存の空配列は配列のまま維持される
//
// read-only の判定について: m12-t30 は「左ペインの poi-selector-disabled は非参照要素の
// 相互排他制約でも立つため read-only の判定には使えない」と注記している。ただしそれは
// 非参照要素が存在する場合の話で、未対応形式では表示用配列が空（entries 0件）になるため
// hasNonReferenceEntries は必ず false であり、poi-selector-disabled が立つ原因は readOnly
// だけになる。本 spec はこの状態でのみ当該クラスを read-only の証跡として使う。
//
// 待機はすべて状態ベース（固定スリープ禁止）。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

// 実データ maps/morioka.json / maps/morioka_ndl_affine.json と同形の URL 文字列参照
const URL_STRING_POIS = 'morioka_one_poi.json';

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

// MapEdit の保存は confirm ダイアログを挟むため OK 自動応答へ差し替える（m18-t1 と同方式）
async function stubMessageBoxOk(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
}

// GCP 4点 + updateTin による compiled を持つ地図を seed する（m18-t1 / m11-t11 と同一手順。
// compiled が無いと viewer runtime ゲートに掛かるため保存が通らない）
async function seedMap(page: Page, slug: string, pois: unknown): Promise<string> {
  return await page.evaluate(async ({ slug, pois }: any) => {
    const mapObject: any = {
      mapID: slug, title: { ja: 'M4-T1 地図' },
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
    const r2: any = await (window as any).mapedit.save({ slug, uid: r1.uid, mapObject, tins: [tinResult[1]] });
    if (!r2 || r2.result !== 'Success') throw new Error(`compiled map save failed: ${JSON.stringify(r2)}`);
    return r2.uid as string;
  }, { slug, pois });
}

// 保存形の pois を main 側から直接読む（DOM ではなく永続形の検証）。
// 注: request の戻り値は IPC の structured clone を通るため、値が undefined のキーが
// own-property として観測されることがある。永続形（data_json）は JSON なので、
// JSON 化した後のキー有無が「保存されたか」の正しい判定になる。両方を返して区別する。
async function readSavedMapPois(
  page: Page,
  uid: string,
): Promise<{ persistedHasKey: boolean; value: unknown }> {
  return await page.evaluate(async (mapUid: string) => {
    const doc: any = await (window as any).mapedit.request(mapUid);
    const persisted = JSON.parse(JSON.stringify(doc ?? {}));
    return {
      persistedHasKey: Object.prototype.hasOwnProperty.call(persisted, 'pois'),
      value: doc?.pois,
    };
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

test.describe('M4-T1: pois 受け入れ関所と判定ガードの共通化', () => {
  test('AC3/AC4/AC5: URL 文字列の地図は編集可能（M4-T4）＋生値温存', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m4-t1-url-'));
    const { app, page } = await launch(e2eRoot);
    await stubMessageBoxOk(app);
    const slug = `m4-t1-url-${Date.now()}`;

    try {
      const uid = await seedMap(page, slug, URL_STRING_POIS);
      // seed 直後の保存形が URL 文字列のままであること（前提の確認）
      const seeded = await readSavedMapPois(page, uid);
      expect(seeded.value, 'seed: pois は URL 文字列として保存されている').toBe(URL_STRING_POIS);

      // メタデータタブ（初期表示）で先にタイトルを編集して dirty にしておく。
      // metadata タブには testid が無いため、POI タブへ移る前に済ませる
      await openHash(page, `#/mapedit?uid=${uid}`);
      await expect(page.getByTestId('map-slug')).toHaveValue(slug, { timeout: 30000 });
      await page.getByTestId('map-title').fill('M4-T1 地図（編集後）');

      const { poisPane, cards } = await openMapPoisTab(page, uid, slug);

      // ---- AC4（M4-T4 改訂）: 単独形は supported なので未対応形式の警告は出ない ----
      const warning = poisPane.locator('.editor-diagnostic__message');
      await expect(warning, 'AC4: 単独形の URLレイヤに未対応形式の警告は出ない').toHaveCount(0, { timeout: 30000 });

      // ---- AC3（M4-T4 改訂）: read-only ではなく、1件のカードとして編集可能に表示される ----
      await expect(cards, 'AC3: 単独形の URLレイヤが1件のカードとして表示される').toHaveCount(1, { timeout: 30000 });
      // 左ペインは無効化されたままだが、原因が readOnly から「非参照要素があるので POI ソースを
      // 追加できない」（m3-t6 の既存制約 poiref.add_blocked_note）へ変わっている。
      // read-only でないことは「カードが表示され操作できる」で示す（上の toHaveCount(1)）
      await expect(
        poisPane.locator('.poi-selector-disabled'),
        'AC3: 左ペインの無効化は残る（原因は readOnly ではなく非参照要素の存在）',
      ).toHaveCount(1);
      await expect(
        poisPane.locator('.selected-source .btn-outline-danger').first(),
        'AC3: read-only ではないので行の操作ボタンは有効',
      ).toBeEnabled();

      // ---- AC5: 他タブの編集を保存しても pois の生値が失われない（t4 でも維持される）----
      await saveEditor(page);

      const afterSave = await readSavedMapPois(page, uid);
      expect(afterSave.persistedHasKey, 'AC5: 保存後も pois キーが永続形に残る').toBe(true);
      expect(afterSave.value, 'AC5: 単独形は配列化されず URL 文字列のまま残る（sp-0006）').toBe(URL_STRING_POIS);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC6: 全解除の保存形はキーなし／既存の空配列は維持される', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m4-t1-empty-'));
    const { app, page } = await launch(e2eRoot);
    await stubMessageBoxOk(app);
    const stamp = Date.now();
    const poiSlug = `m4-t1-poi-${stamp}`;
    const mapSlug = `m4-t1-map-${stamp}`;
    const appSlug = `m4-t1-app-${stamp}`;

    try {
      // ---- Map: 参照1件 → × で全解除 → 保存 → pois キーが消える ----
      const poiUid = await page.evaluate(async (slug: string) => {
        const created: any = await (window as any).poiSources.createLocal({ slug, title: { ja: 'M4-T1 POI' }, lang: 'ja' });
        if (!created || created.result !== 'Success') throw new Error(`poi create failed: ${JSON.stringify(created)}`);
        await (window as any).poiSources.save(created.uid, {
          slug, title: { ja: 'M4-T1 POI' },
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

      const mapUid = await seedMap(page, mapSlug, [{ poiUid, cachedTitle: 'M4-T1 POI' }]);
      const { poisPane, cards } = await openMapPoisTab(page, mapUid, mapSlug);
      await expect(cards, '前提: 参照カードが1件表示される').toHaveCount(1, { timeout: 30000 });
      // 参照要素の × は確認ダイアログなしで解除される（PoiReferenceEditor requestRemove:481-483）
      await poisPane.locator('.selected-source .btn-outline-danger').first().click();
      await expect(cards, '全解除でカードが0件になる').toHaveCount(0);
      await saveEditor(page);

      const mapAfter = await readSavedMapPois(page, mapUid);
      expect(mapAfter.value, 'AC6(Map): 全解除で pois 配列が残らない').toBeUndefined();
      expect(mapAfter.persistedHasKey, 'AC6(Map): 全解除の保存結果は pois キーごと消える').toBe(false);

      // ---- App: 既存の pois: [] は配列のまま維持される（実データ19件を壊さない）----
      const appUid = await page.evaluate(async (slug: string) => {
        const uid = crypto.randomUUID();
        const r: any = await (window as any).appedit.save({
          uid, slug, create: true,
          document: {
            appID: slug, appName: { ja: 'M4-T1 App' }, title: { ja: 'M4-T1 App' },
            description: {}, keywords: '', siteUrl: '', lang: 'ja', sources: [],
            pois: [], httpSettings: {}, appSettings: {}, manifestSettings: {},
          },
        });
        if (!r || r.result !== 'Success') throw new Error(`app create failed: ${JSON.stringify(r)}`);
        return uid;
      }, appSlug);

      await openHash(page, `#/appedit?uid=${appUid}`);
      await expect(page.getByTestId('app-id')).toHaveValue(appSlug, { timeout: 30000 });
      await page.getByTestId('app-title').fill('M4-T1 App（編集後）');
      await saveEditor(page);

      const appAfter = await page.evaluate(async (uid: string) => {
        const doc: any = await (window as any).appedit.request(uid);
        const persisted = JSON.parse(JSON.stringify(doc ?? {}));
        return { persistedHasKey: Object.prototype.hasOwnProperty.call(persisted, 'pois'), value: doc?.pois };
      }, appUid);
      expect(appAfter.persistedHasKey, 'AC6(App): 既存の pois キーは維持される').toBe(true);
      expect(appAfter.value, 'AC6(App): 既存の空配列は配列のまま（キー削除の正規化はしない）').toEqual([]);

      // ---- App: pois キーを持たない文書には空配列を生やさない（M4-T1 で変わる挙動）----
      // 旧実装は defaultApp() の pois: [] がそのまま残り、保存すると pois: [] が生えていた。
      // 受け入れ関所は「元に無いキーを生やさない」ため、保存後もキーは現れない。
      const bareSlug = `m4-t1-bare-${stamp}`;
      const bareUid = await page.evaluate(async (slug: string) => {
        const uid = crypto.randomUUID();
        const r: any = await (window as any).appedit.save({
          uid, slug, create: true,
          document: {
            appID: slug, appName: { ja: 'M4-T1 Bare' }, title: { ja: 'M4-T1 Bare' },
            description: {}, keywords: '', siteUrl: '', lang: 'ja', sources: [],
            httpSettings: {}, appSettings: {}, manifestSettings: {},
          },
        });
        if (!r || r.result !== 'Success') throw new Error(`bare app create failed: ${JSON.stringify(r)}`);
        return uid;
      }, bareSlug);

      // 同一ルートで uid だけを差し替えても再マウントされないため、一度アプリ一覧へ戻る
      await openHash(page, '#/apps');
      await expect(page.getByTestId('app-id')).toHaveCount(0, { timeout: 30000 });
      await openHash(page, `#/appedit?uid=${bareUid}`);
      await expect(page.getByTestId('app-id')).toHaveValue(bareSlug, { timeout: 30000 });
      await page.getByTestId('app-title').fill('M4-T1 Bare（編集後）');
      await saveEditor(page);

      const bareAfter = await page.evaluate(async (uid: string) => {
        const doc: any = await (window as any).appedit.request(uid);
        const persisted = JSON.parse(JSON.stringify(doc ?? {}));
        return { persistedHasKey: Object.prototype.hasOwnProperty.call(persisted, 'pois'), value: doc?.pois };
      }, bareUid);
      expect(bareAfter.value, 'AC6(App): 元に無い pois に配列を生やさない').toBeUndefined();
      expect(bareAfter.persistedHasKey, 'AC6(App): 保存後も pois キーは現れない').toBe(false);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
