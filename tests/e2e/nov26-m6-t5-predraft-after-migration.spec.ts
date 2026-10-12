// nov26-m6-t5 (#109・HR-15) E2E: 移行前の下書きが、移行後に開くと衝突にならず自動で復元され、保存できる。
// タスク設計 `docs/superpowers/specs/2026-10-11-nov26-m6-t5-task-design.md` v2 §7 の 2（e2e）・§8 AC10（2 回保存）・AC11。
//
// 新しいコードでは保存の IPC で旧名の行を作れない（保存の入口で正規化される）ので、次の順でシードする（T5-MIN-1）:
//   1. 1 回目の起動: 空の保存フォルダ（本移行は対象 0 件で印を付ける）で、アプリ 1 件・ベースマップ 1 件を、
//      旧名の参照を持たせて IPC で作る。この時点では旧名のファイルが無いので、保存の入口の正規化も新規作成の
//      付け替えも起きず、旧名のまま保存される（apps・base_maps は検索索引のトリガーが独自関数を使うため、
//      起動の外から node:sqlite で行を書き換えない）
//   2. 起動の外で: 1.1.0 相当の旧名のファイルを置く
//   3. 2 回目の起動（印があるので移行は走らない）: 画面で 2 件を開いて編集し、旧名の参照を含む下書きを作らせる
//      （下書きの形は画面の serialize に任せる。baseRevision は今の revision）
//   4. 起動の外で: 本移行の印の行を消す（前例: tests/e2e/m12-t15-mining-512.spec.ts）
//   5. 3 回目の起動: 本移行が走る（DB の参照が UUID 名／uid 名になり、revision は進まない）。下書きを開き、
//      衝突にならず自動で復元され、保存でき、DB の参照が UUID 名／uid 名で、下書きの編集が DB に入っていること。
//      続けてもう 1 回保存し、img/・pwa/ のファイル数が増えない（imageRefs の反映）
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Jimp } from 'jimp';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { thumb512PathFor, thumb52PathFor } from '../../src/utils/thumbnailPaths';
import { writeImageByExt } from '../../electron/utils/thumbnail512Codec';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const MARKER_ID = '2026-10-11-asset-uuid-names-v1';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CONFLICT_TITLE_JA = '下書きと保存済み版が異なります';

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  // 保存成功のダイアログ等は先頭ボタンで閉じる（既存 e2e と同型）
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  return { app, page };
}

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

const APP_SLUG = 'nov26-t5-app';
const BM_SLUG = 'nov26-t5-bm';
const OLD_SPLASH = '旧スプラッシュ.png';
const OLD_ICON = `pwa/${APP_SLUG}_icon.png`;
const OLD_THUMB = `tmbs/${BM_SLUG}.png`;

test('nov26-m6-t5 AC11: 移行前の下書きは移行後に衝突にならず復元・保存でき、参照は UUID／uid 名になる', async () => {
  test.setTimeout(600_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-nov26-t5-'));

  // ---------- 1 回目の起動: アプリ・ベースマップを作る ----------
  let saveFolder = '';
  let appUid = '';
  const bmUid = crypto.randomUUID();
  {
    const { app, page } = await launch(e2eRoot);
    try {
      saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
      appUid = await page.evaluate(async ({ slug, oldSplash, oldIcon }: any) => {
        const r = await window.appedit.save({
          document: {
            appID: slug, appName: { ja: 'T5 アプリ' }, title: { ja: 'T5 アプリ' }, description: {}, keywords: '', siteUrl: '',
            lang: 'ja', sources: [], pois: [], httpSettings: {},
            appSettings: { splash: oldSplash }, manifestSettings: { iconSource: oldIcon },
          },
          slug,
        });
        if (!r || !('result' in r) || r.result !== 'Success') throw new Error(JSON.stringify(r));
        if ((r as any).imageRefs) throw new Error('旧名のファイルが無いので正規化されないはず: ' + JSON.stringify(r));
        return r.uid;
      }, { slug: APP_SLUG, oldSplash: OLD_SPLASH, oldIcon: OLD_ICON } as any);
      await page.evaluate(async ({ uid, slug, oldThumb }) => {
        const r = await window.baseMaps.saveUser({
          uid, slug, create: true,
          tms: {
            kind: 'tms', lang: 'ja', title: { ja: 'T5 ベースマップ' }, label: { ja: 'T5' },
            attr: { ja: 'attr' }, dataAttr: {}, license: 'CC BY', dataLicense: 'ODbL', licenseNote: {}, dataLicenseNote: {},
            url: 'https://tiles.example.test/{z}/{x}/{y}.png', minZoom: 0, maxZoom: 18,
            thumbnail: oldThumb, coverageLngLats: null, tileJsonSourceUrl: null, sourceMapUid: null,
          },
        } as any);
        if (!r || r.result !== 'Success') throw new Error(JSON.stringify(r));
        if (r.thumbnail !== oldThumb) throw new Error('旧名のファイルが無いので付け替わらないはず: ' + JSON.stringify(r));
      }, { uid: bmUid, slug: BM_SLUG, oldThumb: OLD_THUMB });
    } finally {
      await quitElectronApplication(app);
    }
  }

  // ---------- 起動の外で: 1.1.0 相当の旧名のファイルと参照 ----------
  const sqliteFile = path.join(saveFolder, 'maplat.sqlite');
  const revisions: Record<string, number> = {};
  {
    await mkdir(path.join(saveFolder, 'img'), { recursive: true });
    await mkdir(path.join(saveFolder, 'pwa'), { recursive: true });
    await mkdir(path.join(saveFolder, 'tmbs'), { recursive: true });
    await new Jimp({ width: 64, height: 48, color: 0x336699ff }).write(path.join(saveFolder, 'img', OLD_SPLASH) as `${string}.${string}`);
    await new Jimp({ width: 512, height: 512, color: 0x993366ff }).write(path.join(saveFolder, OLD_ICON) as `${string}.${string}`);
    await new Jimp({ width: 52, height: 26, color: 0xff0000ff }).write(path.join(saveFolder, OLD_THUMB) as `${string}.${string}`);
    await writeImageByExt(new Jimp({ width: 512, height: 256, color: 0xff0000ff }), path.join(saveFolder, thumb512PathFor(OLD_THUMB)!));
    const db = new DatabaseSync(sqliteFile, { readOnly: true });
    try {
      expect(db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(MARKER_ID)).toBeTruthy();
      const appRow = db.prepare('SELECT data_json, revision FROM apps WHERE uid = ?').get(appUid) as any;
      const bmRow = db.prepare('SELECT data_json, revision FROM base_maps WHERE uid = ?').get(bmUid) as any;
      expect(JSON.parse(appRow.data_json).appSettings.splash).toBe(OLD_SPLASH);
      expect(JSON.parse(bmRow.data_json).thumbnail).toBe(OLD_THUMB);
      revisions.app = Number(appRow.revision);
      revisions.bm = Number(bmRow.revision);
    } finally {
      db.close();
    }
  }

  // ---------- 2 回目の起動: 画面で編集し、旧名の参照を含む下書きを作らせる ----------
  {
    const { app, page } = await launch(e2eRoot);
    try {
      await openHash(page, `#/appedit?uid=${appUid}`);
      await expect(page.getByTestId('app-title')).toHaveValue('T5 アプリ', { timeout: 30_000 });
      await expect(page.getByTestId('editor-save-state')).toBeVisible({ timeout: 30_000 });
      // onMounted（読み込み → 履歴の基点 → 下書きの open）が終わる前に入力すると、入力が基点に吸われて
      // dirty にならない。基点の確立を待ってから入力する
      await page.waitForTimeout(2_000);
      await page.getByTestId('app-title').fill('下書きで編集したアプリ');
      await page.getByTestId('app-title').blur();
      // 一覧へ戻ると下書きが書き出される（m11-t2 の hot exit と同じ経路）
      await page.getByTestId('editor-back').click();
      await expect
        .poll(async () => page.evaluate(async (uid) => (await window.assetDrafts.get('app', uid))?.baseRevision ?? null, appUid), { timeout: 30_000 })
        .toBe(revisions.app);

      await openHash(page, `#/basemaps?uid=${bmUid}`);
      await expect(page.getByTestId('basemap-editor')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('basemap-title')).toHaveValue('T5 ベースマップ', { timeout: 30_000 });
      await page.waitForTimeout(2_000);
      await page.getByTestId('basemap-title').fill('下書きで編集したベースマップ');
      await page.getByTestId('basemap-title').blur();
      await expect(page.getByTestId('editor-save-state')).toContainText('未保存', { timeout: 15_000 });
    } finally {
      await quitElectronApplication(app);
    }
  }

  // ---------- 起動の外で: 本移行の印を消す ----------
  {
    const db = new DatabaseSync(sqliteFile);
    try {
      db.prepare('DELETE FROM schema_migrations WHERE id = ?').run(MARKER_ID);
    } finally {
      db.close();
    }
  }

  // ---------- 3 回目の起動: 本移行が走る。下書きを開いて保存する ----------
  {
    const { app, page } = await launch(e2eRoot);
    try {
      // 移行前に作られた下書きは旧名の参照を持つ（ベースマップの下書きは終了時に書き出された）
      const drafts = await page.evaluate(async ({ a, b }) => ({
        app: (await window.assetDrafts.get('app', a)) as any,
        bm: (await window.assetDrafts.get('base-map', b)) as any,
      }), { a: appUid, b: bmUid });
      expect(drafts.app?.baseRevision).toBe(revisions.app);
      expect(drafts.bm?.baseRevision).toBe(revisions.bm);
      expect(drafts.app.payload.appSettings.splash).toBe(OLD_SPLASH);
      expect(drafts.app.payload.manifestSettings.iconSource).toBe(OLD_ICON);
      expect(drafts.bm.payload.thumbnail).toBe(OLD_THUMB);

      // 本移行の結果（revision は進まない）。DB は最初の読み書きで開かれ、そのとき migrate() が走る
      await page.evaluate(async () => { await window.baseMaps.list(); });
      const afterMigration = (() => {
        const db = new DatabaseSync(sqliteFile, { readOnly: true });
        try {
          const a = db.prepare('SELECT data_json, revision FROM apps WHERE uid = ?').get(appUid) as any;
          const b = db.prepare('SELECT data_json, revision FROM base_maps WHERE uid = ?').get(bmUid) as any;
          const marker = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(MARKER_ID);
          return { app: JSON.parse(a.data_json), appRev: Number(a.revision), bm: JSON.parse(b.data_json), bmRev: Number(b.revision), marker: Boolean(marker) };
        } finally {
          db.close();
        }
      })();
      expect(afterMigration.marker).toBe(true);
      expect(afterMigration.app.appSettings.splash).toMatch(new RegExp(`^${UUID}\\.png$`));
      expect(afterMigration.app.manifestSettings.iconSource).toMatch(new RegExp(`^pwa/${UUID}\\.png$`));
      expect(afterMigration.bm.thumbnail).toBe(thumb52PathFor(bmUid, 'png'));
      expect(afterMigration.appRev).toBe(revisions.app);
      expect(afterMigration.bmRev).toBe(revisions.bm);

      // --- アプリ: 衝突にならず自動で復元され、保存できる ---
      await openHash(page, `#/appedit?uid=${appUid}`);
      await expect(page.getByTestId('app-title')).toHaveValue('下書きで編集したアプリ', { timeout: 30_000 });
      await expect(page.getByText(CONFLICT_TITLE_JA)).toHaveCount(0);
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 15_000 });
      await page.getByTestId('editor-save').click();
      await expect
        .poll(async () => page.evaluate(async (uid) => {
          const doc = await window.appedit.request(uid);
          return doc?.revision ?? null;
        }, appUid), { timeout: 30_000 })
        .toBe(revisions.app + 1);
      const savedApp = await page.evaluate(async (uid) => window.appedit.request(uid), appUid);
      const titleOf = (v: any) => (typeof v === 'string' ? v : v?.ja);
      expect(titleOf(savedApp.appName ?? savedApp.title)).toBe('下書きで編集したアプリ');
      expect(savedApp.appSettings.splash).toMatch(new RegExp(`^${UUID}\\.png$`));
      expect(savedApp.manifestSettings.iconSource).toMatch(new RegExp(`^pwa/${UUID}\\.png$`));
      await expect(page.getByText(CONFLICT_TITLE_JA)).toHaveCount(0);

      // --- AC10: もう 1 回保存しても img/・pwa/ のファイル数が増えない（imageRefs の反映）---
      const count = async () => ({
        img: (await readdir(path.join(saveFolder, 'img'))).length,
        pwa: (await readdir(path.join(saveFolder, 'pwa'))).length,
      });
      const before = await count();
      await page.getByTestId('app-title').fill('2 回目の保存');
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 15_000 });
      await page.getByTestId('editor-save').click();
      await expect
        .poll(async () => page.evaluate(async (uid) => (await window.appedit.request(uid))?.revision ?? null, appUid), { timeout: 30_000 })
        .toBe(revisions.app + 2);
      expect(await count()).toEqual(before);
      const savedApp2 = await page.evaluate(async (uid) => window.appedit.request(uid), appUid);
      expect(savedApp2.appSettings.splash).toBe(savedApp.appSettings.splash);
      expect(savedApp2.manifestSettings.iconSource).toBe(savedApp.manifestSettings.iconSource);

      // --- ベースマップ: 衝突にならず自動で復元され、保存でき、thumbnail は uid 名 ---
      await openHash(page, `#/basemaps?uid=${bmUid}`);
      await expect(page.getByTestId('basemap-editor')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('basemap-title')).toHaveValue('下書きで編集したベースマップ', { timeout: 30_000 });
      await expect(page.getByText(CONFLICT_TITLE_JA)).toHaveCount(0);
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 15_000 });
      await page.getByTestId('editor-save').click();
      await expect
        .poll(async () => page.evaluate(async (uid) => {
          const rows = await window.baseMaps.list();
          return rows.find((r) => r.uid === uid)?.revision ?? null;
        }, bmUid), { timeout: 30_000 })
        .toBe(revisions.bm + 1);
      const savedBm = await page.evaluate(async (uid) => (await window.baseMaps.list()).find((r) => r.uid === uid)?.data as any, bmUid);
      expect(savedBm.thumbnail).toBe(thumb52PathFor(bmUid, 'png'));
      expect(titleOf(savedBm.title)).toBe('下書きで編集したベースマップ');
      await expect(page.getByText(CONFLICT_TITLE_JA)).toHaveCount(0);
    } finally {
      await quitElectronApplication(app);
    }
  }
});
