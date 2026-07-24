// M12-T17: 新規アップロード地図のタイル化直後にタイルが表示されない回帰の修正 E2E。
// AC2（新規地図: 画像アップロード→保存→保存直後にタイルが恒久パスで読める）/
// AC3（保存直後の参照が恒久パスを指し旧tmpパスを指さない）/
// AC4（既存地図の画像差し替えでも同一シーケンスで壊れない）を検証する。
// 設計 `docs/superpowers/specs/2026-07-24-m12-t17-upload-tile-ref-design.md` §11 準拠。
// 案B（テスト専用フック不要。既存 window.testDebug の mapData ref を直接読む）を採用
// (設計レビューv2 Info2: file:// ロードの Playwright ネットワークイベント計測は不確実なため)。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

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

// ダイアログを差し替えて任意の画像を選択させる（m12-t15 と同型のダイアログ差し替えハーネス）
async function installDialogHarness(app: ElectronApplication, imagePath: string): Promise<void> {
  await app.evaluate(async ({ dialog }, selectedImage) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [selectedImage] })) as typeof dialog.showOpenDialog;
  }, imagePath);
}

// 保存確認・保存成功ダイアログを常に「OK（先頭ボタン）」で応答させる (m11-t8 等と同型)
async function stubMessageBoxOk(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
}

async function saveFolderOf(page: Page): Promise<string> {
  return page.evaluate(() => window.settings.get('saveFolder'));
}

async function tmpFolderOf(page: Page): Promise<string> {
  return page.evaluate(() => window.settings.get('tmpFolder'));
}

async function urlOf(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (window as any).testDebug?.mapData?.value?.url_);
}

async function tileSourceIdentity(page: Page): Promise<number> {
  // illstMapInfo().source は OL のソースオブジェクト参照。identity 比較用に
  // グローバルカウンタへ登録した WeakMap ではなく、単純な participant object の
  // 有無切り替わりを検出するため、page 内で一意 id を振って比較する
  return page.evaluate(() => {
    const w = window as any;
    const source = w.testDebug?.illstMapInfo?.().source;
    if (!source) return -1;
    if (!w.__t17SourceIds) w.__t17SourceIds = new WeakMap();
    if (!w.__t17SourceIds.has(source)) {
      w.__t17SourceIds.set(source, (w.__t17SourceCounter = (w.__t17SourceCounter || 0) + 1));
    }
    return w.__t17SourceIds.get(source);
  });
}

// 既存地図を IPC 直叩きで seed する (t15 の seedMap と同型。画像は未アップロードのまま)
async function seedBareMap(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const mapSlug = `t17-existing-${Date.now()}`;
    const mapR = await window.mapedit.save({
      slug: mapSlug,
      mapObject: {
        mapID: mapSlug, title: { ja: 't17 existing map' },
        officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr: { ja: 'attr' }, dataAttr: {}, description: {},
        license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
        imageExtension: 'jpg', width: 400, height: 300,
        gcps: [], edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
      },
      tins: [],
    });
    if (!mapR || mapR.result !== 'Success') throw new Error(JSON.stringify(mapR));
    return { uid: mapR.uid, slug: mapSlug };
  });
}

// 実 imageCutter を走らせる画像アップロード操作 (実際のボタンクリック + dialog harness)。
// アップロード完了(進捗モーダルの OK 活性化)まで待ち、OK を押してモーダルを閉じる
async function uploadImageViaUi(page: Page, app: ElectronApplication, imagePath: string): Promise<void> {
  await installDialogHarness(app, imagePath);
  await page.getByRole('button', { name: '地図画像登録' }).click();
  const okButton = page.getByRole('button', { name: 'OK' });
  await expect(okButton).toBeEnabled({ timeout: 60_000 });
  await okButton.click();
}

// 保存ボタンをクリックし、保存確認/保存成功ダイアログ(stub済み)を経て保存完了を待つ。
// 完了は mapData.value.uid が result.uid で埋まること(新規保存)、または
// url_ の変化(既存地図の画像差替え)を目印にする代わりに、単純に isDirty 相当の
// 保存反映(mapData.uid 非空)をポーリングする
async function saveAndWaitUidAssigned(page: Page): Promise<void> {
  await page.getByTestId('editor-save').click();
  await expect.poll(
    async () => page.evaluate(() => (window as any).testDebug?.mapData?.value?.uid),
    { timeout: 30_000 },
  ).toBeTruthy();
}

test.describe('M12-T17 保存直後のタイル参照リフレッシュ', () => {
  test('AC2/AC3: 新規地図の画像アップロード直後に保存すると、保存直後(遷移なし)にタイル参照が恒久パスへ切り替わる', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t17-new-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxOk(app);

      const imagePath = path.join(e2eRoot, 'upload.png');
      const { Jimp } = await import('jimp');
      await new Jimp({ width: 400, height: 300, color: 0xff0000ff }).write(imagePath);

      await openHash(page, '#/mapedit');
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 15_000 });
      const slug = `t17-new-${Date.now()}`;
      await page.getByTestId('map-title').fill('t17 new map');
      await page.getByTestId('map-slug').fill(slug);
      // 地図画像コピーライト(必須項目、saveError.attr)を埋めないと保存ボタンが disabled のまま
      await page.getByPlaceholder('地図画像のコピーライト表記を入力してください').fill('t17 test copyright');

      // 実 imageCutter を走らせる (dialog harness 経由の実 UI 操作)
      await uploadImageViaUi(page, app, imagePath);

      const tmpFolder = await tmpFolderOf(page);
      const saveFolder = await saveFolderOf(page);
      const urlBeforeSave = await urlOf(page);
      expect(urlBeforeSave).toBeTruthy();
      expect(urlBeforeSave).toContain(path.join(tmpFolder, 'tiles'));
      const sourceIdBeforeSave = await tileSourceIdentity(page);

      // 保存 (確認ダイアログ・成功ダイアログは stub 済みで自動応答)
      await saveAndWaitUidAssigned(page);
      const uid: string = await page.evaluate(() => (window as any).testDebug.mapData.value.uid);

      // AC3: 保存直後、url_ は恒久パス(tiles/{uid}/...)を指し、旧tmpパスを指さない
      await expect.poll(async () => urlOf(page), { timeout: 15_000 }).not.toBe(urlBeforeSave);
      const urlAfterSave = await urlOf(page);
      expect(urlAfterSave).toBeTruthy();
      expect(urlAfterSave).not.toContain(tmpFolder);
      const permanentTileDir = path.join(saveFolder, 'tiles', uid);
      expect(urlAfterSave!.replace(/\\/g, '/')).toContain(encodeURI(permanentTileDir.replace(/\\/g, '/')));

      // AC2: タイルソースが実際に再生成されている(遷移なしで表示が壊れないことの直接的根拠)
      await expect.poll(async () => tileSourceIdentity(page), { timeout: 15_000 }).not.toBe(sourceIdBeforeSave);

      // バックエンドのファイル移動が完了していること(disk実態、旧tmp参照残りの直接確認)
      const permanentTileStat = await stat(permanentTileDir).catch(() => null);
      expect(permanentTileStat?.isDirectory()).toBe(true);
      const tmpTileDir = path.join(tmpFolder, 'tiles');
      await expect.poll(async () => stat(tmpTileDir).then(() => true).catch(() => false), { timeout: 5_000 }).toBe(false);

      console.log('  AC2/AC3 (new map): PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC4: 既存地図の画像差し替え(re-upload)でも同一シーケンス(差し替え→保存→保存直後)でタイル参照が壊れない', async () => {
    test.setTimeout(240_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t17-replace-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxOk(app);
      const { uid } = await seedBareMap(page);

      const replaceImagePath = path.join(e2eRoot, 'replace.png');
      const { Jimp } = await import('jimp');
      await new Jimp({ width: 500, height: 250, color: 0x00ff00ff }).write(replaceImagePath);

      await openHash(page, `#/mapedit?uid=${uid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 15_000 });

      await uploadImageViaUi(page, app, replaceImagePath);

      const tmpFolder = await tmpFolderOf(page);
      const saveFolder = await saveFolderOf(page);
      const urlBeforeSave = await urlOf(page);
      expect(urlBeforeSave).toContain(path.join(tmpFolder, 'tiles'));

      await saveAndWaitUidAssigned(page);

      await expect.poll(async () => urlOf(page), { timeout: 15_000 }).not.toBe(urlBeforeSave);
      const urlAfterSave = await urlOf(page);
      expect(urlAfterSave).toBeTruthy();
      expect(urlAfterSave).not.toContain(tmpFolder);

      const permanentTileDir = path.join(saveFolder, 'tiles', uid);
      const permanentTileStat = await stat(permanentTileDir).catch(() => null);
      expect(permanentTileStat?.isDirectory()).toBe(true);
      const entries = await readdir(permanentTileDir).catch(() => []);
      expect(entries.length).toBeGreaterThan(0);

      console.log('  AC4 (existing map replace): PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});
