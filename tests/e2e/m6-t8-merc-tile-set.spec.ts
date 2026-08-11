// m6-t8: Mercator Tile Set 生成 E2E。
//   AC3: 新規タブ「メルカトルタイル」から生成すると、既存 merc マスタが0件の場合は
//        確認なしで新規 kind:"merc" ベースマップが作成される（url は保存されず空）
//   AC4: 同じ地図から2回目以降生成すると、既存 merc マスタの一覧＋「新規作成」を選ぶ
//        モーダルが出る。既存を選ぶと revision が進み（tiles/coverageLngLats 更新）、
//        重複作成されず、title は保持される
//   AC10: エディタ内アイコン生成（generateTmsThumbnail）が merc マスタに対して file://
//         経由でタイルを読み、成功する
// 設計 `docs/superpowers/specs/2026-08-06-m6-t8-merc-tile-set-design.md` §6/§7 準拠。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

// 1x1 透明PNG（m12-t1-edge-split 等、既存 E2E フィクスチャ群と同一バイト列）
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

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

// GCP3点（三角形）付きの strict コンパイル済み地図を、実体の originals/{uid}.png を Node fs で
// 直接書き込んだうえで seed する（m13-t2 Part H / m12-t1 seedMapWithEdge と同型の直接fs手法。
// UI 経由の imageCutter アップロードは非決定的なタイミングを要するため避ける。GCP 座標は
// m12-t1 と同じ実測値からの線形補間で、境界内側に置く）
async function seedStrictMap(page: Page, saveFolder: string): Promise<{ uid: string; slug: string }> {
  const slug = `m6-t8-map-${Date.now()}`;
  const toMerc = (x: number, y: number): number[] => [
    15551351.4 + (x / 400) * (15562483.3 - 15551351.4),
    4249117.8 + ((300 - y) / 300) * (4259837.2 - 4249117.8),
  ];
  const gcps = [
    [[50, 250], toMerc(50, 250)],
    [[350, 250], toMerc(350, 250)],
    [[350, 50], toMerc(350, 50)],
  ];

  const seedResult = await page.evaluate(async ({ slug, gcps }) => {
    const mapObject = {
      mapID: slug, title: { ja: 'm6-t8 テスト地図' },
      officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
      attr: { ja: 'm6-t8 attribution' }, dataAttr: {}, description: {},
      license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
      imageExtension: 'png', width: 400, height: 300,
      gcps, edges: [] as unknown[], sub_maps: [] as unknown[],
      strictMode: 'strict', vertexMode: 'plain', status: 'New',
    };
    const r1 = await window.mapedit.save({ slug, mapObject, tins: [] });
    if (!r1 || r1.result !== 'Success') throw new Error(`seed failed: ${JSON.stringify(r1)}`);
    return { uid: r1.uid, mapObject };
  }, { slug, gcps });

  const { uid, mapObject } = seedResult;

  // originals/{uid}.png を直接書き込む（実 UI アップロードを介さない。m13-t2 Part H と同型）
  const originalsDir = path.join(saveFolder, 'originals');
  await mkdir(originalsDir, { recursive: true });
  await writeFile(path.join(originalsDir, `${uid}.png`), Buffer.from(TINY_PNG_BASE64, 'base64'));

  // compiled tin を作って保存する（strict）
  await page.evaluate(async ({ slug, uid, mapObject }) => {
    const tinResult = await window.mapedit.updateTin(
      mapObject.gcps, mapObject.edges, 0, [mapObject.width, mapObject.height],
      mapObject.strictMode, mapObject.vertexMode,
    );
    if (!Array.isArray(tinResult) || !tinResult[1] || typeof tinResult[1] !== 'object') {
      throw new Error(`TIN compile failed: ${JSON.stringify(tinResult)}`);
    }
    const r2 = await window.mapedit.save({ slug, uid, mapObject, tins: [tinResult[1]] });
    if (!r2 || r2.result !== 'Success') throw new Error(`compiled save failed: ${JSON.stringify(r2)}`);
  }, { slug, uid, mapObject });

  return { uid, slug };
}

// 実装レビュー M-1: ProgressReporter のテキストキーが wmtsgenerate.* のままだと
// modalProgress() が本文を上書きし、生成中ずっと「WMTS」表示になる（ADR-0015違反）。
// 実装レビュー Minor m-3: 判定力を持つのは「進捗イベント到達後」のテキストのみ
// （到達前は modalShow の初期文言 merc.generating_tile がまだ残っており、ADR-0015 違反が
// あってもここでは検出できない）。expect.poll で進捗テキスト「(現在/合計)」の出現を
// 構造的に待ってから本文を読むことで、タイミングに依存せず判定力を保証する
// （待たずに読むコードへ「正す」変更をしても黙って壊れない）
async function expectMercProgressText(page: Page): Promise<void> {
  const modalBody = page.locator('.modal.d-block .modal-body').first();
  await expect(modalBody).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => (await modalBody.textContent()) ?? '', { timeout: 15_000 })
    .toMatch(/\(\d+\/\d+\)/); // ProgressReporter の progressText "(current/total)" が来るまで待つ
  const text = (await modalBody.textContent()) ?? '';
  expect(text).toContain('メルカトルタイル');
  expect(text).not.toContain('WMTS');
}

async function generateAndWaitForCompletion(page: Page): Promise<void> {
  const okButton = page.getByRole('button', { name: 'OK' });
  await expect(okButton).toBeEnabled({ timeout: 60_000 });
  await okButton.click();
}

test.describe('M6-T8 メルカトルタイル生成', () => {
  test('AC3/AC4: 新規タブから生成すると新規merc登録、2回目は既存選択でrevisionが進み重複しない', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t8-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
      const { uid: mapUid } = await seedStrictMap(page, saveFolder);
      await openHash(page, `#/mapedit?uid=${mapUid}`);

      await page.getByTestId('map-tab-merc').click();
      const generateButton = page.getByTestId('merc-generate-button');
      await expect(generateButton).toBeEnabled({ timeout: 15_000 });

      // --- 1回目: 既存 merc 0件 → 確認なしで新規作成 (AC3) ---
      await generateButton.click();
      await expectMercProgressText(page); // 実装レビュー M-1 回帰（ADR-0015: UIに"WMTS"を出さない）
      await generateAndWaitForCompletion(page);

      const listAfterFirst = await page.evaluate(() => window.baseMaps.list());
      const mercEntries1 = listAfterFirst.filter(
        (item) => item.data?.kind === 'merc' && item.data?.sourceMapUid === mapUid,
      );
      expect(mercEntries1.length).toBe(1);
      expect(mercEntries1[0].data.url).toBe('');
      // 実装レビュー round3 M-6: 元地図の帰属・ライセンスが既定値として継承されるはず
      // （seedStrictMap の mapObject: attr={ja:'m6-t8 attribution'}, license='PD', dataLicense='CC BY-SA'）
      expect(mercEntries1[0].data.attr).toEqual({ ja: 'm6-t8 attribution' });
      expect(mercEntries1[0].data.license).toBe('PD');
      expect(mercEntries1[0].data.dataLicense).toBe('CC BY-SA');
      const firstUid = mercEntries1[0].uid;
      const firstRevision = mercEntries1[0].revision;
      const firstTitle = mercEntries1[0].data.title;

      // 2回目の生成は「地図が前回生成後に再度dirtyになった」場合にのみ到達可能
      // （wmtsEditReady は mainLayerHash !== wmtsHash を要求する。1回目成功で両者が一致し
      // 直後は無効化される — 正しい抑止動作）。実際のGCP再編集は行わず、testDebug 経由で
      // wmtsHash を古い値へ戻し「再編集後に再生成する」状態を模擬する（m1-t6-hotfix-2 等の
      // 既存 E2E と同型の testDebug 直接操作パターン）
      await page.evaluate(() => {
        (window as any).testDebug.mapData.value.wmtsHash = 'stale-hash-for-e2e';
      });
      await expect(generateButton).toBeEnabled({ timeout: 15_000 });

      // --- 2回目: 既存 merc 1件 → モーダルが開く (AC4) ---
      await generateButton.click();
      const modal = page.getByTestId('merc-tile-set-modal');
      await expect(modal).toBeVisible({ timeout: 15_000 });
      await page.getByTestId(`merc-existing-${firstUid}`).click();
      await generateAndWaitForCompletion(page);

      const listAfterSecond = await page.evaluate(() => window.baseMaps.list());
      const mercEntries2 = listAfterSecond.filter(
        (item) => item.data?.kind === 'merc' && item.data?.sourceMapUid === mapUid,
      );
      expect(mercEntries2.length).toBe(1); // 重複作成されていない
      expect(mercEntries2[0].uid).toBe(firstUid);
      expect(mercEntries2[0].revision).toBeGreaterThan(firstRevision); // 更新された
      expect(mercEntries2[0].data.title).toEqual(firstTitle); // title は保持される
    } finally {
      await quitElectronApplication(app);
    }
  });

  // 実装レビュー round3 M-3/M-4 回帰: 既定 slug は接尾辞形式（{元slug}-merc）で、
  // 衝突時は slugSequence の既存規則どおり連番（-merc2）が振られる。
  test('M-3/M-4回帰: 既定slugが接尾辞規約に従い、衝突時は連番になる', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t8-slug-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
      const { uid: mapUid, slug: mapSlug } = await seedStrictMap(page, saveFolder);

      // {mapSlug}-merc を先に別リソースとして占有し、衝突採番を誘発する
      await page.evaluate(async (slug) => {
        const r = await window.baseMaps.saveUser({
          create: true,
          slug,
          tms: { kind: 'tms', title: {}, label: {}, attr: {}, url: 'https://example.com/{z}/{x}/{y}.png' },
        });
        if (!r || !r.uid) throw new Error(`occupant seed failed: ${JSON.stringify(r)}`);
      }, `${mapSlug}-merc`);

      await openHash(page, `#/mapedit?uid=${mapUid}`);
      await page.getByTestId('map-tab-merc').click();
      const generateButton = page.getByTestId('merc-generate-button');
      await expect(generateButton).toBeEnabled({ timeout: 15_000 });
      await generateButton.click();
      await expectMercProgressText(page);
      await generateAndWaitForCompletion(page);

      const list = await page.evaluate(() => window.baseMaps.list());
      const mercEntry = list.find(
        (item) => item.data?.kind === 'merc' && item.data?.sourceMapUid === mapUid,
      );
      expect(mercEntry).toBeTruthy();
      // M-3: 生成部は必ず "-" で始まる接尾辞形式（slugSequence.ts の不変条件、人間指示 2026-08-03）
      // M-4: {元slug}-merc は占有済みのため、既存 slugSequence 規則どおり -merc2 に採番される
      expect(mercEntry!.mapID).toBe(`${mapSlug}-merc2`);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC10: merc マスタのアイコン生成が file:// 経由で成功する', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m6-t8-icon-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
      const { uid: mapUid } = await seedStrictMap(page, saveFolder);
      await openHash(page, `#/mapedit?uid=${mapUid}`);
      await page.getByTestId('map-tab-merc').click();
      const generateButton = page.getByTestId('merc-generate-button');
      await expect(generateButton).toBeEnabled({ timeout: 15_000 });
      await generateButton.click();
      await generateAndWaitForCompletion(page);

      const list = await page.evaluate(() => window.baseMaps.list());
      const mercEntry = list.find((item) => item.data?.kind === 'merc' && item.data?.sourceMapUid === mapUid);
      expect(mercEntry).toBeTruthy();

      await openHash(page, `#/basemaps?uid=${mercEntry!.uid}`);
      const generateIconButton = page.getByRole('button', { name: '存在範囲から生成' });
      await expect(generateIconButton).toBeEnabled({ timeout: 15_000 });
      await generateIconButton.click();
      await expect(page.locator('img.base-map-icon')).toBeVisible({ timeout: 30_000 });
    } finally {
      await quitElectronApplication(app);
    }
  });
});
