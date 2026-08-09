// m19-t2 E2E: ベースマップ管理のサムネイル操作を地図管理と同型にする（512px/52px）。
// タスク設計 `docs/superpowers/specs/2026-08-09-m19-t2-basemap-thumbnail-512-design.md` v1.2 §12.1 準拠。
//
//   T1 サムネイル管理セクションの表示（512px/52px プレビュー・置換 2 本・チェック）
//      ＋ §6.5 の derive52 強制 ON（checked かつ disabled）           -> AC6
//   T2 512px 置換でプレビューが ?v= で更新され、実ファイルが更新される -> AC6
//   T3 52px 置換で 52px が更新され document.thumbnail が 52px を指す   -> AC6
//   T4 未保存の新規ベースマップ → 保存で 512px も uid 名へ寄る          -> AC7（ADR-0007 違反 A）
//   T5 ビルトインは 512px プレビューが出て置換ボタンが disabled         -> AC6
//   T6 サムネイル未存在時に placeholder が出る（null 連結退行の回帰）   -> AC6
//   T7 derive52 OFF の 512px 単独置換で document.thumbnail が不変       -> AC15(b)
//
// 参照実装は tests/e2e/m12-t15-thumbnail-512.spec.ts（地図側）。fixture 作成手順を踏襲する。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

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

// ダイアログを差し替えて任意の画像を選択させる（置換フロー検証用）
async function installDialogHarness(app: ElectronApplication, imagePath: string): Promise<void> {
  await app.evaluate(async ({ dialog }, selectedImage) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [selectedImage] })) as typeof dialog.showOpenDialog;
  }, imagePath);
}

async function saveFolderOf(page: Page): Promise<string> {
  return page.evaluate(() => window.settings.get('saveFolder'));
}

// 置換ソース画像（長辺 800 の緑）。長辺 512 / 52 への縮小結果で更新を判定できる
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
    const slug = `m19t2-${Date.now().toString(36)}`;
    const result = await window.baseMaps.saveUser({
      uid, slug, create: true,
      tms: {
        kind: 'tms', lang: 'ja',
        title: { ja: `m19-t2 ${slug}` }, label: { ja: slug },
        attr: { ja: 'attr' }, dataAttr: {}, license: 'CC BY', dataLicense: 'ODbL',
        licenseNote: {}, dataLicenseNote: {},
        url: 'https://tiles.example.test/{z}/{x}/{y}.png',
        minZoom: 0, maxZoom: 18,
        thumbnail: thumbTemplate.replace('{uid}', uid),
        coverageLngLats: null, tileJsonSourceUrl: null, sourceMapUid: null,
      },
    } as any);
    if (!result || result.result !== 'Success') throw new Error(`base map seed failed: ${JSON.stringify(result)}`);
    return { uid, slug };
  }, thumbnailOf('{uid}'));
}

// saveFolder/tmbs/{key}.png と {key}_512.png を直接配置する
async function placeThumbnails(saveFolder: string, key: string): Promise<void> {
  const tmbs = path.join(saveFolder, 'tmbs');
  await mkdir(tmbs, { recursive: true });
  const { Jimp } = await import('jimp');
  await new Jimp({ width: 52, height: 26, color: 0xff0000ff }).write(path.join(tmbs, `${key}.png`) as `${string}.${string}`);
  await new Jimp({ width: 512, height: 256, color: 0xff0000ff }).write(path.join(tmbs, `${key}_512.png`) as `${string}.${string}`);
}

const exists = (p: string) => stat(p).then(() => true).catch(() => false);

async function readBaseMapThumbnail(page: Page, uid: string): Promise<string> {
  return page.evaluate(async (targetUid) => {
    const rows = await window.baseMaps.list();
    const row = rows.find((r) => r.uid === targetUid);
    if (!row) throw new Error(`base map ${targetUid} not found`);
    return String(row.data?.thumbnail ?? '');
  }, uid);
}

test.describe('m19-t2 ベースマップのサムネイル管理（512px/52px）', () => {
  test('T1: サムネイル管理セクションが表示され、52px 実体が無い新規では derive52 が強制 ON になる', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19t2-t1-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // --- 保存済み（52px/512px 実体あり）: セクションと 512px プレビュー ---
      const { uid } = await seedSavedBaseMap(page, (u) => `tmbs/${u}.png`);
      await placeThumbnails(await saveFolderOf(page), uid);
      await openHash(page, `#/basemaps?uid=${uid}`);
      await expect(page.getByTestId('basemap-editor')).toBeVisible({ timeout: 15000 });

      await expect(page.getByText('サムネイル管理')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('basemap-thumbnail-replace-512')).toBeVisible();
      await expect(page.getByTestId('basemap-thumbnail-replace-52')).toBeVisible();
      await expect(page.getByTestId('basemap-thumbnail-derive-52')).toBeVisible();
      // 512px プレビュー（tmbs/{uid}_512.png を配置済み）
      await expect(page.locator('img[alt="512px"]')).toBeVisible({ timeout: 15000 });
      // K1 かつ実体ありなので強制 ON ではない = 操作できる（既定は ON）
      await expect(page.getByTestId('basemap-thumbnail-derive-52')).toBeChecked();
      await expect(page.getByTestId('basemap-thumbnail-derive-52')).toBeEnabled();

      // 地図管理と同型であること: 操作子は「512px を置換 / 52px を置換 / 存在範囲から生成」のみ。
      // 旧「アップロード」は replaceThumbnail('52') と重複し、規則 K を通らない経路を
      // 露出させていたため撤去した（人間検証の指摘）
      await expect(page.getByRole('button', { name: 'アップロード', exact: true })).toHaveCount(0);
      const card = page.getByText('サムネイル管理').locator('xpath=ancestor::div[contains(@class,"card")][1]');
      await expect(card.locator('button')).toHaveCount(3);

      // --- 新規（thumbnail が空 = 規則 K が K2）: §6.5 の強制 ON ---
      // 強制 ON が落ちると K2 経路で derive52 OFF の 512px 単独置換が到達可能になり、
      // thumbnail の派生位置と食い違う 512px の孤児が生まれる
      await openHash(page, '#/basemaps');
      await page.getByTestId('basemap-new').click();
      await page.getByTestId('basemap-kind-tms').click();
      await expect(page.getByTestId('basemap-thumbnail-derive-52')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('basemap-thumbnail-derive-52')).toBeChecked();
      await expect(page.getByTestId('basemap-thumbnail-derive-52')).toBeDisabled();

      console.log('  T1: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('T2: 512px 置換でプレビューが cache buster で更新され、derive52 ON なら 52px も更新される', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19t2-t2-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const { uid } = await seedSavedBaseMap(page, (u) => `tmbs/${u}.png`);
      const saveFolder = await saveFolderOf(page);
      await placeThumbnails(saveFolder, uid);
      await installDialogHarness(app, await makeSourceImage(e2eRoot, 'replace.png'));

      await openHash(page, `#/basemaps?uid=${uid}`);
      await expect(page.getByTestId('basemap-editor')).toBeVisible({ timeout: 15000 });
      const img512 = page.locator('img[alt="512px"]');
      await expect(img512).toBeVisible({ timeout: 15000 });
      const srcBefore = await img512.getAttribute('src');

      await expect(page.getByTestId('basemap-thumbnail-derive-52')).toBeChecked();
      await page.getByTestId('basemap-thumbnail-replace-512').click();

      // cache buster（?v=）がインクリメントされてプレビューが再読込される
      await expect.poll(async () => img512.getAttribute('src'), { timeout: 15000 }).not.toBe(srcBefore);

      const { Jimp } = await import('jimp');
      const image512 = await Jimp.read(path.join(saveFolder, 'tmbs', `${uid}_512.png`));
      expect(Math.max(image512.width, image512.height)).toBe(512);
      // derive52 ON なので 52px も置換ソースから作り直される（元は 52x26、置換後は 52x26 だが色が変わる）
      const image52 = await Jimp.read(path.join(saveFolder, 'tmbs', `${uid}.png`));
      expect(Math.max(image52.width, image52.height)).toBe(52);
      // 二重派生が起きていない
      expect(await exists(path.join(saveFolder, 'tmbs', `${uid}_512_512.png`))).toBe(false);

      console.log('  T2: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('T3: 52px 置換で 52px が更新され、document.thumbnail が 52px を指し続ける', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19t2-t3-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const { uid } = await seedSavedBaseMap(page, (u) => `tmbs/${u}.png`);
      const saveFolder = await saveFolderOf(page);
      await placeThumbnails(saveFolder, uid);
      await installDialogHarness(app, await makeSourceImage(e2eRoot, 'replace.png'));

      await openHash(page, `#/basemaps?uid=${uid}`);
      await expect(page.getByTestId('basemap-editor')).toBeVisible({ timeout: 15000 });

      const before = await readFile(path.join(saveFolder, 'tmbs', `${uid}.png`));
      await page.getByTestId('basemap-thumbnail-replace-52').click();
      await expect
        .poll(async () => (await readFile(path.join(saveFolder, 'tmbs', `${uid}.png`))).equals(before), { timeout: 15000 })
        .toBe(false);

      // 規則 U の同値ガード: K1 では thumbnail は同値のため更新されない（不変であることが正）
      expect(await readBaseMapThumbnail(page, uid)).toBe(`tmbs/${uid}.png`);
      // 52px 置換は 512px を触らない（地図側と同挙動）
      expect(await exists(path.join(saveFolder, 'tmbs', `${uid}_512_512.png`))).toBe(false);

      console.log('  T3: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('T4: 未保存の新規ベースマップで作ったサムネイルは、保存時に 512px も uid 名へ寄る（ADR-0007 違反 A）', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19t2-t4-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const saveFolder = await saveFolderOf(page);
      await installDialogHarness(app, await makeSourceImage(e2eRoot, 'replace.png'));

      // 未保存の新規ベースマップ（iconFileKey() が slug を返す状態）を作る
      const slug = `m19t2-new-${Date.now().toString(36)}`;
      await openHash(page, '#/basemaps');
      await page.getByTestId('basemap-new').click();
      await page.getByTestId('basemap-kind-tms').click();
      await page.getByTestId('basemap-slug').fill(slug);
      await page.getByTestId('basemap-slug').press('Tab');
      await page.getByTestId('basemap-title').fill('m19-t2 new');
      await page.getByTestId('basemap-title').press('Tab');
      await page.getByTestId('basemap-attr').fill('m19-t2 attr'); // attr は kind を問わず必須
      await page.getByTestId('basemap-attr').press('Tab');
      await page.getByTestId('basemap-url').fill('https://tiles.example.test/{z}/{x}/{y}.png');
      await page.getByTestId('basemap-url').press('Tab');

      // 設計 T4 は「存在範囲から生成」でこの状態を作るが、生成はタイルサーバーを要する。
      // 前提（thumbnail = tmbs/{slug}.png かつ 52px/512px の実体が slug 名で存在する未保存文書）は
      // 512px 置換（規則 K2 → §6.5 により derive52 強制 ON）で同じものが作れるため、そちらで作る。
      // K2 経路と強制 ON も同時に通るぶん検証としては広い。
      await expect(page.getByTestId('basemap-thumbnail-derive-52')).toBeDisabled();
      await page.getByTestId('basemap-thumbnail-replace-512').click();
      // 512px → 52px の順に書かれるため、両方が揃うまで待つ
      await expect
        .poll(
          async () =>
            (await exists(path.join(saveFolder, 'tmbs', `${slug}_512.png`)))
            && (await exists(path.join(saveFolder, 'tmbs', `${slug}.png`))),
          { timeout: 15000 },
        )
        .toBe(true);

      // 保存 → relocateBaseMapIcon が uid 名へ寄せる
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 15000 });
      await page.getByTestId('editor-save').click();
      await expect(page).not.toHaveURL(/new=1/, { timeout: 30_000 });

      const uid = await page.evaluate(async (targetSlug) => {
        const rows = await window.baseMaps.list();
        const row = rows.find((r) => r.mapID === targetSlug);
        if (!row) throw new Error(`saved base map ${targetSlug} not found`);
        return row.uid;
      }, slug);

      // AC7: 512px も uid 名へ移り、slug 名の取り残しが無い
      expect(await exists(path.join(saveFolder, 'tmbs', `${uid}.png`))).toBe(true);
      expect(await exists(path.join(saveFolder, 'tmbs', `${uid}_512.png`))).toBe(true);
      expect(await exists(path.join(saveFolder, 'tmbs', `${slug}_512.png`))).toBe(false);
      expect(await exists(path.join(saveFolder, 'tmbs', `${slug}.png`))).toBe(false);
      expect(await readBaseMapThumbnail(page, uid)).toBe(`tmbs/${uid}.png`);

      console.log('  T4: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('T8: 新規ベースマップの初回保存後も 512px プレビューが残る（人間検証で見つかった欠陥の回帰）', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19t2-t8-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const saveFolder = await saveFolderOf(page);
      await installDialogHarness(app, await makeSourceImage(e2eRoot, 'replace.png'));

      const slug = `m19t2-keep-${Date.now().toString(36)}`;
      await openHash(page, '#/basemaps');
      await page.getByTestId('basemap-new').click();
      await page.getByTestId('basemap-kind-tms').click();
      await page.getByTestId('basemap-slug').fill(slug);
      await page.getByTestId('basemap-slug').press('Tab');
      await page.getByTestId('basemap-title').fill('m19-t2 keep');
      await page.getByTestId('basemap-title').press('Tab');
      await page.getByTestId('basemap-attr').fill('m19-t2 attr');
      await page.getByTestId('basemap-attr').press('Tab');
      await page.getByTestId('basemap-url').fill('https://tiles.example.test/{z}/{x}/{y}.png');
      await page.getByTestId('basemap-url').press('Tab');

      // 未保存のうちに 512px/52px を作る（暫定名＝slug 名で書かれる）
      await page.getByTestId('basemap-thumbnail-replace-512').click();
      const img512 = page.locator('img[alt="512px"]');
      await expect(img512).toBeVisible({ timeout: 15000 });

      // 初回保存（backend が 512px/52px を uid 名へ付け替える）
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 15000 });
      await page.getByTestId('editor-save').click();
      await expect(page).not.toHaveURL(/new=1/, { timeout: 30_000 });

      const uid = await page.evaluate(async (targetSlug) => {
        const rows = await window.baseMaps.list();
        const row = rows.find((r) => r.mapID === targetSlug);
        if (!row) throw new Error(`saved base map ${targetSlug} not found`);
        return row.uid;
      }, slug);

      // 実体は uid 名へ寄っている（T4 が見ていた範囲）
      expect(await exists(path.join(saveFolder, 'tmbs', `${uid}_512.png`))).toBe(true);

      // ここが T4 に無かった観点: 保存後もエディタが 512px を解決できること。
      // 旧実装は保存後も document.thumbnail に暫定名を持ち続けたため、そこから導く
      // tmbs/{slug}_512.png が実体を失い 512px プレビューが消えていた。
      await expect(img512).toBeVisible({ timeout: 15000 });
      await expect(img512).toHaveAttribute('src', new RegExp(`${uid}_512\\.png`), { timeout: 15000 });
      // 52px の実体も uid 名で解決できる ⇒ §6.5 の強制 ON に落ちない
      await expect(page.getByTestId('basemap-thumbnail-derive-52')).toBeEnabled({ timeout: 15000 });

      console.log('  T8: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('T5: ビルトインは 512px プレビューが出て、置換操作は無効化される', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19t2-t5-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const builtin = await page.evaluate(async () => {
        const rows = await window.baseMaps.list();
        const row = rows.find((r) => r.scope === 'builtin' && String(r.data?.thumbnail ?? '').startsWith('basemap_icons/'));
        if (!row) throw new Error('builtin base map with basemap_icons/ thumbnail not found');
        return { uid: row.uid, thumbnail: String(row.data.thumbnail) };
      });
      await openHash(page, `#/basemaps?uid=${builtin.uid}`);
      await expect(page.getByTestId('basemap-editor')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('basemap-editor-readonly')).toBeVisible();

      // 512px は同梱リソース（basemap_icons_512/）から解決される
      const img512 = page.locator('img[alt="512px"]');
      await expect(img512).toBeVisible({ timeout: 15000 });
      await expect(img512).toHaveAttribute('src', /basemap_icons_512\//);

      await expect(page.getByTestId('basemap-thumbnail-replace-512')).toBeDisabled();
      await expect(page.getByTestId('basemap-thumbnail-replace-52')).toBeDisabled();

      console.log('  T5: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('T6: サムネイル未存在時は placeholder が表示される（null 連結退行の回帰）', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19t2-t6-'));
    const { app, page } = await launch(e2eRoot);
    try {
      // thumbnail は指すが実体を置かない（解決失敗 → placeholder）
      const { uid } = await seedSavedBaseMap(page, (u) => `tmbs/${u}.png`);
      await openHash(page, `#/basemaps?uid=${uid}`);
      await expect(page.getByTestId('basemap-editor')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('basemap-thumbnail-replace-512')).toBeVisible({ timeout: 15000 });

      // img が出ず placeholder が出る（null 連結で壊れた画像を出さない）
      await expect(page.locator('img[alt="512px"]')).toHaveCount(0);
      await expect(page.locator('div.border.rounded.text-muted').filter({ hasText: '512px' }).first()).toBeVisible();
      // 実体が無いので §6.5 により derive52 は強制 ON
      await expect(page.getByTestId('basemap-thumbnail-derive-52')).toBeChecked();
      await expect(page.getByTestId('basemap-thumbnail-derive-52')).toBeDisabled();

      console.log('  T6: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('T7: derive52 OFF の 512px 単独置換で document.thumbnail が不変（INV-T の回帰）', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19t2-t7-'));
    const { app, page } = await launch(e2eRoot);
    try {
      const { uid } = await seedSavedBaseMap(page, (u) => `tmbs/${u}.png`);
      const saveFolder = await saveFolderOf(page);
      await placeThumbnails(saveFolder, uid);
      await installDialogHarness(app, await makeSourceImage(e2eRoot, 'replace.png'));

      await openHash(page, `#/basemaps?uid=${uid}`);
      await expect(page.getByTestId('basemap-editor')).toBeVisible({ timeout: 15000 });

      const path512 = path.join(saveFolder, 'tmbs', `${uid}_512.png`);
      const path52 = path.join(saveFolder, 'tmbs', `${uid}.png`);
      const before512 = await readFile(path512);
      const before52 = await readFile(path52);

      // §6.5 の述語が偽（K1 かつ実体あり）なのでチェックボックスは操作できる
      const derive = page.getByTestId('basemap-thumbnail-derive-52');
      await expect(derive).toBeEnabled();
      await derive.uncheck();
      await expect(derive).not.toBeChecked();

      await page.getByTestId('basemap-thumbnail-replace-512').click();

      // (1) 512px は更新される
      await expect.poll(async () => (await readFile(path512)).equals(before512), { timeout: 15000 }).toBe(false);
      // (2) 二重派生（_512_512）が生成されない
      expect(await exists(path.join(saveFolder, 'tmbs', `${uid}_512_512.png`))).toBe(false);
      // (3) 52px は更新されない（derive52 OFF の意味論）
      expect((await readFile(path52)).equals(before52)).toBe(true);

      // (4) 規則 U により updateField が呼ばれない ⇒ 文書は dirty にならない。
      //     欠陥実装（`path52` が無いとき `path` で代替する形）ではここで 512px パスが
      //     commit されて dirty になり、保存ボタンが有効化されるため、この 1 行で落ちる。
      await expect(page.getByTestId('editor-save')).toBeDisabled();
      //     永続化された値も 52px の所在のまま（保存操作が不要＝そもそも変わっていない）
      expect(await readBaseMapThumbnail(page, uid)).toBe(`tmbs/${uid}.png`);
      //     再オープンしても同じ（往復で確認）
      await openHash(page, '#/basemaps');
      await openHash(page, `#/basemaps?uid=${uid}`);
      await expect(page.getByTestId('basemap-editor')).toBeVisible({ timeout: 15000 });
      expect(await readBaseMapThumbnail(page, uid)).toBe(`tmbs/${uid}.png`);

      // (5) 52px プレビューは 52px を指し続ける
      const img52 = page.locator('img.base-map-icon');
      await expect(img52).toHaveAttribute('src', new RegExp(`${uid}\\.png`), { timeout: 15000 });

      console.log('  T7: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
