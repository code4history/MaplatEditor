// M12-T20: tmp（揮発）× draft（永続）耐久性ギャップの修正 — 下書きタイルの永続 staging 化 E2E。
// 設計 `docs/superpowers/specs/2026-07-27-m12-t20-draft-tmp-durability-design.md` §8 準拠。
// AC20-1: 耐久性（hot exit → OS tmp 清掃模擬 → 復元 → 保存完遂）+ 警告非表示の負命題
// AC20-2: 被害 draft の黙殺禁止（2a: 喪失警告 + DB 行が作られない / 2b: 保存確定直後クラッシュ相当は保存済み告知）
// AC20-3: 下書きの明示破棄（編集画面・一覧）で staging dir が回収される
// AC20-4: 起動時孤児 GC（envelope の無い dir のみ回収・正当な draft の dir は残る）
// AC20-5: 複数下書きの併存（単一スロット衝突の解消）
// AC20-8: パス安全性（assetUid='..' で upload IPC が err・remove が親 dir を削除しない — 番兵ファイル方式）
// AC20-9: Undo→Redo→保存の非退行（dirty→clean は envelope のみ削除・staging 残置）
// AC20-10: i18n 新設3キー × 11 locale の存在
// ハーネスは m12-t17-upload-tile-refresh.spec.ts（dialog harness / testDebug）と
// m11-t2-draft-hot-exit.spec.ts（hot exit → 再起動 → 復元）の様式に従う。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

const LOCALES = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'th', 'vi', 'zh', 'zh-TW'];
const NEW_KEYS = ['mapedit.draft_tiles_lost', 'mapedit.draft_already_saved', 'mapedit.staging.missing_tiles'];

function readLocale(locale: string): Record<string, any> {
  return JSON.parse(readFileSync(path.join(projectRoot, 'public', 'locales', locale, 'translation.json'), 'utf8'));
}

function lookupKey(dict: Record<string, any>, dottedKey: string): unknown {
  return dottedKey.split('.').reduce<any>((node, part) => (node && typeof node === 'object' ? node[part] : undefined), dict);
}

// 復元時ガードの文言（ja）。キー未整備なら undefined になり、依存 assert が RED になる
const jaDict = readLocale('ja');
const LOST_MSG = lookupKey(jaDict, 'mapedit.draft_tiles_lost') as string | undefined;
const ALREADY_MSG = lookupKey(jaDict, 'mapedit.draft_already_saved') as string | undefined;
const MISSING_MSG = lookupKey(jaDict, 'mapedit.staging.missing_tiles') as string | undefined;

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

async function installDialogHarness(app: ElectronApplication, imagePath: string): Promise<void> {
  await app.evaluate(async ({ dialog }, selectedImage) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [selectedImage] })) as typeof dialog.showOpenDialog;
  }, imagePath);
}

// AC20-1（v1.1・Info2）: stubMessageBoxOk だと偽陽性の警告ダイアログが自動 OK で素通りするため、
// 表示された message を main プロセス側に記録する記録型 stub を使う（応答は常に先頭ボタン = OK/削除）
async function stubMessageBoxRecording(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ dialog }) => {
    (globalThis as any).__t20Dialogs = [];
    dialog.showMessageBox = (async (...args: any[]) => {
      const options = args.length > 1 ? args[1] : args[0];
      (globalThis as any).__t20Dialogs.push(String(options?.message ?? ''));
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
}

async function recordedDialogs(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => ((globalThis as any).__t20Dialogs ?? []) as string[]);
}

async function urlOf(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (window as any).testDebug?.mapData?.value?.url_);
}

async function draftUidOf(page: Page): Promise<string | null> {
  return page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('draftUid'));
}

async function pathExists(target: string): Promise<boolean> {
  return stat(target).then(() => true).catch(() => false);
}

async function makeImage(imagePath: string, width: number, height: number, color: number): Promise<void> {
  const { Jimp } = await import('jimp');
  await new Jimp({ width, height, color }).write(imagePath as `${string}.${string}`);
}

async function uploadImageViaUi(page: Page, app: ElectronApplication, imagePath: string): Promise<void> {
  await installDialogHarness(app, imagePath);
  await page.getByRole('button', { name: '地図画像登録' }).click();
  const okButton = page.getByRole('button', { name: 'OK' });
  await expect(okButton).toBeEnabled({ timeout: 60_000 });
  await okButton.click();
}

// 新規地図の必須フィールドを埋める（title / slug / 地図画像コピーライト）
async function fillRequiredFields(page: Page, title: string, slug: string): Promise<void> {
  await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('map-title').fill(title);
  await page.getByTestId('map-slug').fill(slug);
  await page.getByTestId('map-attr').fill('t20 test copyright');
}

async function saveAndWaitUidAssigned(page: Page): Promise<void> {
  await page.getByTestId('editor-save').click();
  await expect.poll(
    async () => page.evaluate(() => (window as any).testDebug?.mapData?.value?.uid),
    { timeout: 30_000 },
  ).toBeTruthy();
}

async function envelopeOf(page: Page, assetUid: string): Promise<any> {
  return page.evaluate(async (uid) => window.assetDrafts.get('map', uid), assetUid);
}

// 既存地図を IPC 直叩きで seed（t17 の seedBareMap と同型）
async function seedBareMap(page: Page, slugPrefix: string): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async (prefix) => {
    const mapSlug = `${prefix}-${Date.now()}`;
    const mapR = await window.mapedit.save({
      slug: mapSlug,
      mapObject: {
        mapID: mapSlug, title: { ja: 't20 seeded map' },
        officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr: { ja: 'attr' }, dataAttr: {}, description: {},
        license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
        imageExtension: 'jpg', width: 400, height: 300,
        gcps: [], edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
      },
      tins: [],
    });
    if (!mapR || !('result' in mapR) || mapR.result !== 'Success') throw new Error(JSON.stringify(mapR));
    return { uid: (mapR as any).uid as string, slug: mapSlug };
  }, slugPrefix);
}

async function requestMapUid(page: Page, uid: string): Promise<string | null> {
  return page.evaluate(async (target) => {
    try {
      const r = await (window as any).mapedit.request(target);
      return r?.uid ?? null;
    } catch {
      return null;
    }
  }, uid);
}

test.describe('M12-T20 下書きタイルの永続 staging 化', () => {
  test('AC20-1: アップロード → hot exit → OS tmp 清掃模擬 → 復元 → 保存が完遂し、復元時に喪失警告が出ない', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t20-ac1-'));
    const draftTileRoot = path.join(e2eRoot, 'draft-tiles');
    const saveFolder = path.join(e2eRoot, 'save-folder');

    // --- セッション1: 新規地図に画像アップロード、未保存のまま hot exit ---
    let { app, page } = await launch(e2eRoot);
    const tmpFolder: string = await page.evaluate(() => window.settings.get('tmpFolder'));
    await stubMessageBoxRecording(app);
    const imagePath = path.join(e2eRoot, 'upload.png');
    await makeImage(imagePath, 400, 300, 0xff0000ff);

    await openHash(page, '#/mapedit');
    await fillRequiredFields(page, 't20 durability map', `t20-ac1-${Date.now()}`);
    await uploadImageViaUi(page, app, imagePath);

    const draftUid = await draftUidOf(page);
    expect(draftUid).toBeTruthy();
    const stagingDir = path.join(draftTileRoot, draftUid!);
    const urlBeforeQuit = await urlOf(page);
    expect(urlBeforeQuit).toBeTruthy();
    // staging は揮発 tmp ではなく永続 draft-tiles 配下を指す
    expect(urlBeforeQuit).toContain(stagingDir);
    expect(await pathExists(stagingDir)).toBe(true);
    await quitElectronApplication(app);

    // --- OS の一時領域清掃を模擬（staging には影響しないことの検証） ---
    await rm(path.join(tmpFolder, 'tiles'), { recursive: true, force: true });
    expect(await pathExists(stagingDir)).toBe(true);

    // --- セッション2: draft 復元 → staging 実在 → 保存完遂 ---
    ({ app, page } = await launch(e2eRoot));
    await stubMessageBoxRecording(app);
    await openHash(page, `#/mapedit?draftUid=${draftUid}`);
    await expect(page.getByTestId('map-title')).toHaveValue('t20 durability map', { timeout: 20_000 });

    const urlRestored = await urlOf(page);
    expect(urlRestored).toBe(urlBeforeQuit);
    expect(await pathExists(stagingDir)).toBe(true);

    // 負命題（v1.1・Info2）: 復元時に喪失警告・保存済み告知が出ないこと
    expect(LOST_MSG).toBeTruthy();
    expect(ALREADY_MSG).toBeTruthy();
    await page.waitForTimeout(1_000);
    const dialogsAfterRestore = await recordedDialogs(app);
    expect(dialogsAfterRestore.some((m) => m.includes(LOST_MSG!))).toBe(false);
    expect(dialogsAfterRestore.some((m) => m.includes(ALREADY_MSG!))).toBe(false);

    await saveAndWaitUidAssigned(page);

    // 保存後: 恒久領域に tiles/originals が実在し、staging dir は move で消滅、draft も消滅
    expect(await pathExists(path.join(saveFolder, 'tiles', draftUid!))).toBe(true);
    expect(await pathExists(path.join(saveFolder, 'originals', `${draftUid}.png`))).toBe(true);
    await expect.poll(async () => pathExists(stagingDir), { timeout: 10_000 }).toBe(false);
    await expect.poll(async () => envelopeOf(page, draftUid!), { timeout: 10_000 }).toBeNull();

    await quitElectronApplication(app);
  });

  test('AC20-2 (2a): 参照先が消えた被害 draft は喪失警告が表示され、保存しても DB 行が作られない', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t20-ac2a-'));

    // --- セッション1: 実アップロードで正規の draft envelope 構造を得る（payload 妥当性の担保） ---
    let { app, page } = await launch(e2eRoot);
    const tmpFolder: string = await page.evaluate(() => window.settings.get('tmpFolder'));
    await stubMessageBoxRecording(app);
    const imagePath = path.join(e2eRoot, 'upload.png');
    await makeImage(imagePath, 400, 300, 0x00ff00ff);
    await openHash(page, '#/mapedit');
    const slugA = `t20-ac2a-${Date.now()}`;
    await fillRequiredFields(page, 't20 template draft', slugA);
    await uploadImageViaUi(page, app, imagePath);
    const draftUidA = await draftUidOf(page);
    expect(draftUidA).toBeTruthy();
    await quitElectronApplication(app);

    // tmp/tiles を実在させない（過去正規形式 = 修正前 draft の tmp が清掃済み、の再現）
    await rm(path.join(tmpFolder, 'tiles'), { recursive: true, force: true });

    // --- セッション2: url_ が消えた tmp を指す被害 draft B を合成して復元 ---
    ({ app, page } = await launch(e2eRoot));
    await stubMessageBoxRecording(app);
    const draftUidB = randomUUID();
    const tmpUrl = `${pathToFileURL(path.join(tmpFolder, 'tiles')).href}/{z}/{x}/{y}.png`;
    await page.evaluate(async ({ srcUid, destUid, url_, slug }) => {
      const src = await window.assetDrafts.get('map', srcUid);
      if (!src) throw new Error('template draft not found');
      const crafted = JSON.parse(JSON.stringify(src));
      crafted.assetUid = destUid;
      crafted.updatedAt = new Date().toISOString();
      crafted.payload.mapData.url_ = url_;
      crafted.payload.mapData.mapID = slug;
      await window.assetDrafts.put(crafted);
    }, { srcUid: draftUidA!, destUid: draftUidB, url_: tmpUrl, slug: `${slugA}-b` });

    await openHash(page, `#/mapedit?draftUid=${draftUidB}`);
    await expect(page.getByTestId('map-title')).toHaveValue('t20 template draft', { timeout: 20_000 });

    // 喪失警告（mapedit.draft_tiles_lost）が表示される。保存済み告知ではない
    expect(LOST_MSG).toBeTruthy();
    await expect.poll(async () => recordedDialogs(app), { timeout: 10_000 })
      .toEqual(expect.arrayContaining([expect.stringContaining(LOST_MSG!)]));
    expect((await recordedDialogs(app)).some((m) => ALREADY_MSG && m.includes(ALREADY_MSG))).toBe(false);

    // そのまま保存 → DB write 前ガードが明示 Error（専用文言）→ DB 行は作られない
    expect(MISSING_MSG).toBeTruthy();
    await page.getByTestId('editor-save').click();
    await expect(page.getByText(MISSING_MSG!)).toBeVisible({ timeout: 30_000 });
    expect(await requestMapUid(page, draftUidB)).toBeNull();

    await quitElectronApplication(app);
  });

  test('AC20-2 (2b): 保存確定直後クラッシュ相当の draft は喪失警告ではなく保存済み告知が表示される', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t20-ac2b-'));
    const draftTileRoot = path.join(e2eRoot, 'draft-tiles');
    const saveFolder = path.join(e2eRoot, 'save-folder');

    const { app, page } = await launch(e2eRoot);
    await stubMessageBoxRecording(app);
    const { uid } = await seedBareMap(page, 't20-ac2b');
    // 保存済み恒久タイルを実在させる（savedTilesExist: true の前提）
    await mkdir(path.join(saveFolder, 'tiles', uid), { recursive: true });
    await writeFile(path.join(saveFolder, 'tiles', uid, 'marker.txt'), 'saved tiles');

    // 実編集で正規の draft envelope を作らせる
    await openHash(page, `#/mapedit?uid=${uid}`);
    await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('map-title').fill('t20 crashed-after-save');
    await page.getByTestId('map-title').blur();
    // editor-back は draftLifecycle.flush()（dirty なら永続化）を通る
    await page.getByTestId('editor-back').click();
    await expect(page.getByTestId('map-title')).toBeHidden();
    await expect.poll(async () => envelopeOf(page, uid), { timeout: 10_000 }).toBeTruthy();

    // 保存確定直後クラッシュ相当へ改変: baseRevision を過去値に・url_ を実在しない staging へ
    const missingStagingUrl = `${pathToFileURL(path.join(draftTileRoot, uid)).href}/{z}/{x}/{y}.png`;
    await page.evaluate(async ({ targetUid, url_ }) => {
      const src = await window.assetDrafts.get('map', targetUid);
      if (!src) throw new Error('draft not found');
      const crafted = JSON.parse(JSON.stringify(src));
      crafted.baseRevision = 0;
      crafted.payload.mapData.url_ = url_;
      crafted.updatedAt = new Date().toISOString();
      await window.assetDrafts.put(crafted);
    }, { targetUid: uid, url_: missingStagingUrl });

    // conflict 分岐で復元し、適用 → 保存済み告知（喪失警告ではない）
    await openHash(page, `#/mapedit?uid=${uid}`);
    await expect(page.getByText('下書きと保存済み版が異なります')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: '下書きを適用する' }).click();
    await expect(page.getByTestId('map-title')).toHaveValue('t20 crashed-after-save', { timeout: 20_000 });

    expect(ALREADY_MSG).toBeTruthy();
    await expect.poll(async () => recordedDialogs(app), { timeout: 10_000 })
      .toEqual(expect.arrayContaining([expect.stringContaining(ALREADY_MSG!)]));
    expect((await recordedDialogs(app)).some((m) => LOST_MSG && m.includes(LOST_MSG))).toBe(false);

    await quitElectronApplication(app);
  });

  test('AC20-3: 下書きの明示破棄（編集画面・一覧）で staging dir が回収される', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t20-ac3-'));
    const draftTileRoot = path.join(e2eRoot, 'draft-tiles');

    const { app, page } = await launch(e2eRoot);
    await stubMessageBoxRecording(app);
    const imagePath = path.join(e2eRoot, 'upload.png');
    await makeImage(imagePath, 400, 300, 0x0000ffff);

    // --- 経路1: 編集画面の破棄 ---
    await openHash(page, '#/mapedit');
    await fillRequiredFields(page, 't20 discard editor', `t20-ac3-a-${Date.now()}`);
    await uploadImageViaUi(page, app, imagePath);
    const draftUidA = await draftUidOf(page);
    expect(draftUidA).toBeTruthy();
    const stagingA = path.join(draftTileRoot, draftUidA!);
    expect(await pathExists(stagingA)).toBe(true);
    await page.getByTestId('editor-back').click();
    await expect(page.getByTestId('map-title')).toBeHidden();

    await openHash(page, `#/mapedit?draftUid=${draftUidA}`);
    await expect(page.getByTestId('map-title')).toHaveValue('t20 discard editor', { timeout: 20_000 });
    await page.getByTestId('editor-discard-draft').click();
    // 破棄確認ダイアログは記録型 stub が先頭ボタン（削除）で自動応答
    await expect.poll(async () => pathExists(stagingA), { timeout: 10_000 }).toBe(false);
    await expect.poll(async () => envelopeOf(page, draftUidA!), { timeout: 10_000 }).toBeNull();

    // --- 経路2: 一覧の draft カード削除 ---
    const draftUidB = randomUUID();
    await openHash(page, `#/mapedit?draftUid=${draftUidB}`);
    await fillRequiredFields(page, 't20 discard list', `t20-ac3-b-${Date.now()}`);
    await uploadImageViaUi(page, app, imagePath);
    const stagingB = path.join(draftTileRoot, draftUidB);
    expect(await pathExists(stagingB)).toBe(true);
    await page.getByTestId('editor-back').click();
    await expect(page.getByTestId('map-title')).toBeHidden();

    // 一覧削除は browser confirm() を使うため自動承諾する
    // （既に閉じられていた場合の accept 失敗はテスト対象外のため握りつぶす。
    //   承諾が実際に効いたことは後続の staging/envelope 消滅 poll が担保する）
    page.on('dialog', (dialog) => { dialog.accept().catch(() => undefined); });
    const cardB = page.locator(`[data-resource-uid="${draftUidB}"]`);
    await expect(cardB).toBeVisible({ timeout: 15_000 });
    await cardB.getByRole('button', { name: '操作メニュー' }).click();
    await page.getByRole('menuitem', { name: '下書きを削除' }).click();
    await expect.poll(async () => pathExists(stagingB), { timeout: 10_000 }).toBe(false);
    await expect.poll(async () => envelopeOf(page, draftUidB), { timeout: 10_000 }).toBeNull();

    await quitElectronApplication(app);
  });

  test('AC20-4: envelope の無い孤児 staging dir が起動時 GC で回収され、正当な draft の dir は残る', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t20-ac4-'));
    const draftTileRoot = path.join(e2eRoot, 'draft-tiles');

    // --- セッション1: 正当な draft（envelope + staging）を作って hot exit ---
    let { app, page } = await launch(e2eRoot);
    await stubMessageBoxRecording(app);
    const imagePath = path.join(e2eRoot, 'upload.png');
    await makeImage(imagePath, 400, 300, 0xffff00ff);
    await openHash(page, '#/mapedit');
    await fillRequiredFields(page, 't20 gc survivor', `t20-ac4-${Date.now()}`);
    await uploadImageViaUi(page, app, imagePath);
    const draftUid = await draftUidOf(page);
    expect(draftUid).toBeTruthy();
    const legitStaging = path.join(draftTileRoot, draftUid!);
    expect(await pathExists(legitStaging)).toBe(true);
    await quitElectronApplication(app);

    // --- アプリ停止中に孤児 dir を外部作成 ---
    const orphanDir = path.join(draftTileRoot, `orphan-${randomUUID()}`);
    await mkdir(orphanDir, { recursive: true });
    await writeFile(path.join(orphanDir, 'garbage.png'), 'orphan tile');

    // --- セッション2: 起動時 GC が孤児のみ回収する ---
    ({ app, page } = await launch(e2eRoot));
    await expect.poll(async () => pathExists(orphanDir), { timeout: 15_000 }).toBe(false);
    expect(await pathExists(legitStaging)).toBe(true);
    await quitElectronApplication(app);
  });

  test('AC20-5: 複数下書きの併存 — 下書きB のアップロードが下書きA の staging を破壊しない', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t20-ac5-'));
    const draftTileRoot = path.join(e2eRoot, 'draft-tiles');
    const saveFolder = path.join(e2eRoot, 'save-folder');

    const { app, page } = await launch(e2eRoot);
    await stubMessageBoxRecording(app);
    const imageA = path.join(e2eRoot, 'upload-a.png');
    const imageB = path.join(e2eRoot, 'upload-b.png');
    await makeImage(imageA, 400, 300, 0xff0000ff);
    await makeImage(imageB, 500, 250, 0x00ff00ff);

    // 下書きA: アップロードして一覧へ
    await openHash(page, '#/mapedit');
    await fillRequiredFields(page, 't20 coexist A', `t20-ac5-a-${Date.now()}`);
    await uploadImageViaUi(page, app, imageA);
    const draftUidA = await draftUidOf(page);
    expect(draftUidA).toBeTruthy();
    const stagingA = path.join(draftTileRoot, draftUidA!);
    expect(await pathExists(stagingA)).toBe(true);
    await page.getByTestId('editor-back').click();
    await expect(page.getByTestId('map-title')).toBeHidden();

    // 下書きB: 別 draftUid でアップロード
    const draftUidB = randomUUID();
    await openHash(page, `#/mapedit?draftUid=${draftUidB}`);
    await fillRequiredFields(page, 't20 coexist B', `t20-ac5-b-${Date.now()}`);
    await uploadImageViaUi(page, app, imageB);
    expect(await pathExists(path.join(draftTileRoot, draftUidB))).toBe(true);

    // A の staging は破壊されていない（単一スロット衝突の解消）
    expect(await pathExists(stagingA)).toBe(true);
    expect((await readdir(stagingA)).length).toBeGreaterThan(0);
    await page.getByTestId('editor-back').click();
    await expect(page.getByTestId('map-title')).toBeHidden();

    // A へ再入場して保存が完遂する
    await openHash(page, `#/mapedit?draftUid=${draftUidA}`);
    await expect(page.getByTestId('map-title')).toHaveValue('t20 coexist A', { timeout: 20_000 });
    const urlA = await urlOf(page);
    expect(urlA).toContain(stagingA);
    await saveAndWaitUidAssigned(page);
    expect(await pathExists(path.join(saveFolder, 'tiles', draftUidA!))).toBe(true);

    await quitElectronApplication(app);
  });

  test('AC20-8: assetUid=".." のパス脱出が拒否される（番兵ファイル方式）', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t20-ac8-'));
    // 画像は e2eRoot の外に置く（変異時に staging クリアが e2eRoot 自体へ向かっても入力が残るように）
    const imageRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t20-ac8-img-'));
    const sentinel = path.join(e2eRoot, 't20-sentinel.txt');
    await writeFile(sentinel, 'sentinel: must survive');

    const { app, page } = await launch(e2eRoot);
    await stubMessageBoxRecording(app);
    const imagePath = path.join(imageRoot, 'upload.png');
    await makeImage(imagePath, 400, 300, 0xff00ffff);
    await installDialogHarness(app, imagePath);

    // (a) upload IPC: ダイアログ・fs 操作へ進まず err を返し、番兵は無傷
    const arg = await page.evaluate(async () =>
      (window as any).mapupload.showMapSelectDialog('map image', '..'));
    expect(arg?.err).toBeTruthy();
    expect(arg?.err).not.toBe('Canceled');
    expect(await pathExists(sentinel)).toBe(true);

    // (b) asset-drafts:remove('map','..'): 親 dir を削除せず、番兵・E2E root は無傷
    await page.evaluate(async () => window.assetDrafts.remove('map', '..'));
    await page.waitForTimeout(1_000);
    expect(await pathExists(sentinel)).toBe(true);
    expect(await pathExists(e2eRoot)).toBe(true);

    await quitElectronApplication(app);
    await rm(imageRoot, { recursive: true, force: true });
  });

  test('AC20-9: アップロード → Undo（envelope のみ削除・staging 残置）→ Redo → 保存が成功する', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t20-ac9-'));
    const draftTileRoot = path.join(e2eRoot, 'draft-tiles');
    const saveFolder = path.join(e2eRoot, 'save-folder');

    const { app, page } = await launch(e2eRoot);
    await stubMessageBoxRecording(app);
    const imagePath = path.join(e2eRoot, 'upload.png');
    await makeImage(imagePath, 400, 300, 0x00ffffff);

    await openHash(page, '#/mapedit');
    await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 15_000 });
    const draftUid = await draftUidOf(page);
    expect(draftUid).toBeTruthy();
    const stagingDir = path.join(draftTileRoot, draftUid!);

    // 最初の編集をアップロードにする（Undo 1回で dirty→clean 遷移を起こすため）
    await uploadImageViaUi(page, app, imagePath);
    expect(await pathExists(stagingDir)).toBe(true);
    // hot-exit と同じ flush 経路で envelope を確実に永続化させてから Undo する
    // （dirty→clean 遷移で envelope が「削除される」ことを観測するための前提）
    await page.evaluate(() => window.dispatchEvent(new Event('maplat:flush-drafts')));
    await expect.poll(async () => envelopeOf(page, draftUid!), { timeout: 15_000 }).toBeTruthy();

    // Undo: dirty→clean → envelope は即時削除・staging dir は残置
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => urlOf(page), { timeout: 15_000 }).toBeFalsy();
    await expect.poll(async () => envelopeOf(page, draftUid!), { timeout: 15_000 }).toBeNull();
    expect(await pathExists(stagingDir)).toBe(true);

    // Redo → url_ 復活 → 保存 Success
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(async () => urlOf(page), { timeout: 15_000 }).toBeTruthy();
    await fillRequiredFields(page, 't20 undo redo', `t20-ac9-${Date.now()}`);
    await saveAndWaitUidAssigned(page);
    expect(await pathExists(path.join(saveFolder, 'tiles', draftUid!))).toBe(true);
    await expect.poll(async () => pathExists(stagingDir), { timeout: 10_000 }).toBe(false);

    await quitElectronApplication(app);
  });

  test('AC20-10: i18n 新設3キーが全 11 locale に存在する', () => {
    for (const locale of LOCALES) {
      const dict = readLocale(locale);
      for (const key of NEW_KEYS) {
        const value = lookupKey(dict, key);
        expect(typeof value, `${locale}: ${key}`).toBe('string');
        expect((value as string).length, `${locale}: ${key}`).toBeGreaterThan(0);
      }
    }
  });
});
