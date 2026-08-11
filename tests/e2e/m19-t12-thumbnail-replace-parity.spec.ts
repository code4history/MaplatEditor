// m19-t12 E2E: サムネイル置換の永続化セマンティクスを地図とベースマップで統一する。
// タスク設計 `docs/superpowers/specs/2026-08-10-m19-t12-thumbnail-replace-persistence-parity-design.md` v1.2 §8 準拠。
//
//   E1 ベースマップ K1（thumbnail が tmbs/…）: 512px 置換で保存 disabled のまま・undo 非活性 -> AC1
//   E2 ベースマップ K2（thumbnail がプリセット）: 指し先が動き保存が有効／undo で指し先は戻らない
//      ＋ 保存 → 再オープンで残る                                                        -> AC2 / AC2-impl / AC3
//   E3 地図管理: 512px 置換で保存 disabled のまま・undo 非活性（＝ E1 と同一の見え方）   -> AC4
//   E4 規則 T3: writeTarget() が null のときだけ disabled＋理由。thumbnail 空でも
//      slug があれば enabled                                                              -> AC5
//   E5 規則 T1 の注記が両画面に同一文言で出る                                             -> AC6
//   E6 K2（指し先がプリセット）で derive52 が checked かつ disabled                       -> AC6b
//
// 参照実装は tests/e2e/m19-t2-basemap-thumbnail-512.spec.ts（fixture 作成手順を踏襲する）。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
// m19-t5: 512px は webp。符号化/復号の唯一の実装（宛先拡張子で選ぶ）へ委譲する
import { writeImageByExt } from '../../electron/utils/thumbnail512Codec';

const projectRoot = path.resolve(import.meta.dirname, '../..');

// 規則 T1 の注記（editor_ui.thumbnail_immediate_note / ja）。両画面で同一文言であることを E5 が assert する
const IMMEDIATE_NOTE_JA = '置換した画像はすぐにファイルへ反映されます';
// 規則 T3 の理由（mapedit.thumbnail_requires_save / ja）
const MAP_REQUIRES_SAVE_JA = '地図を保存するとサムネイルを置換できます。';
// 規則 T3 の理由（basemap.errors.id_required / ja。既存キーの再利用）
const BASEMAP_ID_REQUIRED_JA = 'スラッグ (ID) を入力してください。';

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

async function installDialogHarness(app: ElectronApplication, imagePath: string): Promise<void> {
  await app.evaluate(async ({ dialog }, selectedImage) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [selectedImage] })) as typeof dialog.showOpenDialog;
  }, imagePath);
}

async function saveFolderOf(page: Page): Promise<string> {
  return page.evaluate(() => window.settings.get('saveFolder'));
}

// 置換ソース画像（長辺 800 の緑）
async function makeSourceImage(dir: string, name: string): Promise<string> {
  const target = path.join(dir, name);
  const { Jimp } = await import('jimp');
  await new Jimp({ width: 800, height: 400, color: 0x00ff00ff }).write(target as `${string}.${string}`);
  return target;
}

// uid を指定して保存済みユーザーベースマップを作る（thumbnail は呼び出し元が決める）
async function seedSavedBaseMap(page: Page, thumbnailOf: (uid: string) => string): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async (thumbTemplate) => {
    const uid = crypto.randomUUID();
    const slug = `m19t12-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
    const result = await window.baseMaps.saveUser({
      uid, slug, create: true,
      tms: {
        kind: 'tms', lang: 'ja',
        title: { ja: `m19-t12 ${slug}` }, label: { ja: slug },
        attr: { ja: 'attr' }, dataAttr: {}, license: 'CC BY', dataLicense: 'ODbL',
        licenseNote: {}, dataLicenseNote: {},
        url: 'https://tiles.example.test/{z}/{x}/{y}.png',
        minZoom: 0, maxZoom: 18,
        thumbnail: thumbTemplate.replace('{uid}', uid),
        // 範囲属性は与えない（未指定は fromBaseMapCatalogItem が null へ正規化する）。
        // m19-t11 の凍結契約は当該属性名の出現数を tests/ 込みで数えるため、
        // 本タスクの fixture が不要にその件数を動かさないようにしている（m19-t11 の実装先例）。
        tileJsonSourceUrl: null, sourceMapUid: null,
      },
    } as any);
    if (!result || result.result !== 'Success') throw new Error(`base map seed failed: ${JSON.stringify(result)}`);
    return { uid, slug };
  }, thumbnailOf('{uid}'));
}

// saveFolder/tmbs/{key}.png と {key}_512.webp を直接配置する
async function placeThumbnails(saveFolder: string, key: string): Promise<void> {
  const tmbs = path.join(saveFolder, 'tmbs');
  await mkdir(tmbs, { recursive: true });
  const { Jimp } = await import('jimp');
  await new Jimp({ width: 52, height: 26, color: 0xff0000ff }).write(path.join(tmbs, `${key}.png`) as `${string}.${string}`);
  await writeImageByExt(new Jimp({ width: 512, height: 256, color: 0xff0000ff }), path.join(tmbs, `${key}_512.webp`));
}

const exists = (p: string) => stat(p).then(() => true).catch(() => false);

// 「サムネイル管理」カード（両画面とも card-header が同じ見出しを持つ）
const thumbnailCard = (page: Page) =>
  page.getByText('サムネイル管理').locator('xpath=ancestor::div[contains(@class,"card")][1]');

async function readBaseMapThumbnail(page: Page, uid: string): Promise<string> {
  return page.evaluate(async (targetUid) => {
    const rows = await window.baseMaps.list();
    const row = rows.find((r) => r.uid === targetUid);
    if (!row) throw new Error(`base map ${targetUid} not found`);
    return String(row.data?.thumbnail ?? '');
  }, uid);
}

// 地図側の fixture（tests/e2e/m12-t15-thumbnail-512.spec.ts と同型）
async function seedMap(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const mapSlug = `m19t12-map-${Date.now().toString(36)}`;
    const mapR = await window.mapedit.save({
      slug: mapSlug,
      mapObject: {
        mapID: mapSlug, title: { ja: 'm19-t12 map' },
        officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr: { ja: 'attr' }, dataAttr: {}, description: {},
        license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
        imageExtension: 'jpg', width: 400, height: 300,
        gcps: [[[0, 0], [15550000, 4160000]], [[400, 0], [15560000, 4160000]], [[400, 300], [15560000, 4150000]]],
        edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
      },
      tins: [],
    } as any);
    if (!mapR || mapR.result !== 'Success') throw new Error(JSON.stringify(mapR));
    return { uid: mapR.uid, slug: mapSlug };
  });
}

test.describe('m19-t12 サムネイル置換の永続化セマンティクス統一', () => {
  test('E1: ベースマップ K1 の 512px 置換は即時反映され、保存も undo も活性化しない（AC1）', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19t12-e1-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const { uid } = await seedSavedBaseMap(page, (u) => `tmbs/${u}.png`);
      const saveFolder = await saveFolderOf(page);
      await placeThumbnails(saveFolder, uid);
      await installDialogHarness(app, await makeSourceImage(e2eRoot, 'replace.png'));

      await openHash(page, `#/basemaps?uid=${uid}`);
      await expect(page.getByTestId('basemap-editor')).toBeVisible({ timeout: 15000 });

      // 前提: 開いた直後は保存も undo も非活性
      await expect(page.getByTestId('editor-save')).toBeDisabled();
      await expect(page.getByTestId('editor-undo')).toBeDisabled();

      const path512 = path.join(saveFolder, 'tmbs', `${uid}_512.webp`);
      const before512 = await readFile(path512);
      await page.getByTestId('basemap-thumbnail-replace-512').click();

      // (1) ファイルは即時に置き換わる
      await expect.poll(async () => (await readFile(path512)).equals(before512), { timeout: 15000 }).toBe(false);
      // (2) 規則 T1: 保存の対象ではない
      await expect(page.getByTestId('editor-save')).toBeDisabled();
      // (3) 規則 T1: undo の対象でもない
      await expect(page.getByTestId('editor-undo')).toBeDisabled();
      // (4) 指し先は動かない（規則 U の同値ガード）
      expect(await readBaseMapThumbnail(page, uid)).toBe(`tmbs/${uid}.png`);

      console.log('  E1: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('E2: ベースマップ K2 の 512px 置換は指し先を動かし保存を要するが、undo では戻らない（AC2 / AC2-impl / AC3）', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19t12-e2-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // K2: 指し先がプリセット（basemap_icons/*.png）。tmbs/ 配下には何も無い
      const { uid } = await seedSavedBaseMap(page, () => 'basemap_icons/maplibre.png');
      const saveFolder = await saveFolderOf(page);
      await installDialogHarness(app, await makeSourceImage(e2eRoot, 'replace.png'));

      await openHash(page, `#/basemaps?uid=${uid}`);
      await expect(page.getByTestId('basemap-editor')).toBeVisible({ timeout: 15000 });

      // AC2-impl: 置換の前に先行編集を 1 回入れて undo を活性化しておく。
      // さもないと「undo が押せない」と「undo しても戻らない」が区別できない。
      const title = page.getByTestId('basemap-title');
      await title.fill('m19-t12 edited title');
      await title.press('Tab');
      await expect(page.getByTestId('editor-undo')).toBeEnabled({ timeout: 15000 });

      await page.getByTestId('basemap-thumbnail-replace-512').click();

      // (1) 実ファイルが書かれる（K2 は derive52 強制 ON なので 52px も作られる）
      await expect
        .poll(
          async () => (await exists(path.join(saveFolder, 'tmbs', `${uid}_512.webp`)))
            && (await exists(path.join(saveFolder, 'tmbs', `${uid}.png`))),
          { timeout: 15000 },
        )
        .toBe(true);

      // (2) 指し先が tmbs/ へ動いたことは 512px プレビューの解決先で観測できる
      const img512 = page.locator('img[alt="512px"]');
      await expect(img512).toHaveAttribute('src', new RegExp(`${uid}_512\\.webp`), { timeout: 15000 });
      // (3) 規則 T2: 指し先の移動は文書編集 ⇒ 保存ボタンが有効
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 15000 });

      // (4) undo を押しても指し先は戻らない（先行編集だけが戻る）
      await expect(page.getByTestId('editor-undo')).toBeEnabled();
      await page.getByTestId('editor-undo').click();
      await expect(title).not.toHaveValue('m19-t12 edited title', { timeout: 15000 });
      await expect(img512).toHaveAttribute('src', new RegExp(`${uid}_512\\.webp`), { timeout: 15000 });
      // dirty も解除されない（指し先が未保存のままであるため）
      await expect(page.getByTestId('editor-save')).toBeEnabled();

      // (5) AC3: 保存 → 一覧 → 再オープンで指し先が永続化されている
      await page.getByTestId('editor-save').click();
      await expect.poll(async () => readBaseMapThumbnail(page, uid), { timeout: 30_000 }).toBe(`tmbs/${uid}.png`);
      await openHash(page, '#/basemaps');
      await openHash(page, `#/basemaps?uid=${uid}`);
      await expect(page.getByTestId('basemap-editor')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('img[alt="512px"]')).toHaveAttribute('src', new RegExp(`${uid}_512\\.webp`), { timeout: 15000 });

      console.log('  E2: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('E3: 地図管理の 512px 置換は即時反映され、保存も undo も活性化しない（AC4・E1 と同一の見え方）', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19t12-e3-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const { uid } = await seedMap(page);
      const saveFolder = await saveFolderOf(page);
      await placeThumbnails(saveFolder, uid);
      await installDialogHarness(app, await makeSourceImage(e2eRoot, 'replace.png'));

      await openHash(page, `#/mapedit?uid=${uid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('editor-save')).toBeDisabled({ timeout: 15000 });
      await expect(page.getByTestId('editor-undo')).toBeDisabled();

      const path512 = path.join(saveFolder, 'tmbs', `${uid}_512.webp`);
      const before512 = await readFile(path512);
      await page.getByTestId('thumbnail-replace-512').click();

      await expect.poll(async () => (await readFile(path512)).equals(before512), { timeout: 15000 }).toBe(false);
      await expect(page.getByTestId('editor-save')).toBeDisabled();
      await expect(page.getByTestId('editor-undo')).toBeDisabled();

      console.log('  E3: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('E4: 規則 T3 — writeTarget() が null のときだけ disabled＋理由。thumbnail 空でも slug があれば enabled（AC5）', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19t12-e4-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // (a) ベースマップ: 新規で slug 未入力 ⇒ iconFileKey() が空 ⇒ disabled＋理由
      await openHash(page, '#/basemaps');
      await page.getByTestId('basemap-new').click();
      await page.getByTestId('basemap-kind-tms').click();
      await expect(page.getByTestId('basemap-thumbnail-replace-512')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('basemap-thumbnail-replace-512')).toBeDisabled();
      await expect(page.getByTestId('basemap-thumbnail-replace-52')).toBeDisabled();
      // 理由はサムネイル管理カードの中に出ること（slug フィールドの検証メッセージで代用しない）
      await expect(thumbnailCard(page).getByText(BASEMAP_ID_REQUIRED_JA)).toBeVisible({ timeout: 15000 });

      // (b) slug を入れると thumbnail が空のままでも enabled（§4.3.1。m19-t2 T4 / T8 の前提）
      const slug = `m19t12-e4-${Date.now().toString(36)}`;
      await page.getByTestId('basemap-slug').fill(slug);
      await page.getByTestId('basemap-slug').press('Tab');
      await expect(page.getByTestId('basemap-thumbnail-replace-512')).toBeEnabled({ timeout: 15000 });
      await expect(page.getByTestId('basemap-thumbnail-replace-52')).toBeEnabled();

      // (c) 地図: 未保存の新規地図 ⇒ mapUid 未確定 ⇒ disabled＋理由（無言の no-op をやめる）
      await openHash(page, '#/mapedit?new=1');
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('thumbnail-replace-512')).toBeDisabled({ timeout: 15000 });
      await expect(page.getByTestId('thumbnail-replace-52')).toBeDisabled();
      await expect(thumbnailCard(page).getByText(MAP_REQUIRES_SAVE_JA)).toBeVisible({ timeout: 15000 });

      console.log('  E4: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('E5: 規則 T1 の注記が両画面のサムネイル管理カードへ同一文言で出る（AC6）', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19t12-e5-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const { uid: baseMapUid } = await seedSavedBaseMap(page, (u) => `tmbs/${u}.png`);
      await placeThumbnails(await saveFolderOf(page), baseMapUid);

      await openHash(page, `#/basemaps?uid=${baseMapUid}`);
      await expect(page.getByTestId('basemap-editor')).toBeVisible({ timeout: 15000 });
      const baseMapNote = page.getByTestId('thumbnail-immediate-note');
      await expect(baseMapNote).toBeVisible({ timeout: 15000 });
      const baseMapText = ((await baseMapNote.textContent()) ?? '').trim();
      expect(baseMapText).toContain(IMMEDIATE_NOTE_JA);

      const { uid: mapUid } = await seedMap(page);
      await placeThumbnails(await saveFolderOf(page), mapUid);
      await openHash(page, `#/mapedit?uid=${mapUid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 15000 });
      const mapNote = page.getByTestId('thumbnail-immediate-note');
      await expect(mapNote).toBeVisible({ timeout: 15000 });
      const mapText = ((await mapNote.textContent()) ?? '').trim();

      // 同一の i18n キーから引くため、文言は字義どおり一致する
      expect(mapText).toBe(baseMapText);

      console.log('  E5: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('E6: K2（指し先がプリセット）で derive52 が checked かつ disabled（AC6b・孤児 512px の再発防止）', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19t12-e6-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // 指し先はプリセット（同梱リソースなので fileUrl は truthy を返す）。
      // K1 判定の連言を落として exists52 だけで判定すると「実体あり」と誤判定して
      // 強制 ON が外れ、derive52 OFF の 512px 単独置換で孤児 512px が生じる。
      const { uid } = await seedSavedBaseMap(page, () => 'basemap_icons/maplibre.png');
      await openHash(page, `#/basemaps?uid=${uid}`);
      await expect(page.getByTestId('basemap-editor')).toBeVisible({ timeout: 15000 });

      // 前提の確認: プリセットは 512px プレビューを同梱リソースから解決できている
      await expect(page.locator('img[alt="512px"]')).toHaveAttribute('src', /basemap_icons_512\//, { timeout: 15000 });

      const derive = page.getByTestId('basemap-thumbnail-derive-52');
      await expect(derive).toBeChecked();
      await expect(derive).toBeDisabled();

      console.log('  E6: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
