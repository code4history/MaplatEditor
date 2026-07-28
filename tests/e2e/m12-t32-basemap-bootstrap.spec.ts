// M12-T32: 新規データフォルダ起動時のベースマップ重複（electron-store tmsList 誤取り込み）修正
// 設計 docs/superpowers/specs/2026-07-28-m12-t32-bootstrap-basemap-duplication-fix-design.md §12 準拠
// 3 シナリオ: (1) 全く新規の空フォルダ起動 (2) 設定済み→空フォルダ切替+復帰 (3) 設定済みフォルダ間往復
// 共通: mkdtemp e2eRoot → MAPLAT_E2E_ROOT + --user-data-dir 隔離起動（m13-t5/launchIsolated パターン）。
// 起動前に <e2eRoot>/electron-store/settings/config.json へ { saveFolder, tmsList: <fixture> } を書き込み
// 残骸を再現。検証は window.* API と app 終了後の node:sqlite 直接検証（5 テーブル）の両方。
// ビルトイン件数は builtin_base_maps.json から動的導出（329 ハードコード禁止）。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const fixturePath = path.join(projectRoot, 'tests/fixtures/m12-t32-basemap-bootstrap/legacy-tmslist.json');
const builtinPath = path.join(projectRoot, 'electron/builtin_base_maps.json');

async function readJson(p: string): Promise<any> {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(p, 'utf8'));
}

// 5 テーブルの件数・uid 集合スナップショット（AC32-6/7 検証用）
interface TableSnapshot {
  counts: { maps: number; base_maps: number; apps: number; poi_sources: number; assets: number };
  uids: { maps: string[]; base_maps_user: string[]; apps: string[]; poi_sources: string[]; assets: string[] };
  builtinCount: number;
  marker: boolean;
}
function snapshotDb(dbPath: string): TableSnapshot {
  const db = new DatabaseSync(dbPath);
  try {
    const tables = ['maps', 'base_maps', 'apps', 'poi_sources', 'assets'] as const;
    const counts: Record<string, number> = {};
    for (const t of tables) counts[t] = (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as any).c;
    const maps = (db.prepare('SELECT uid FROM maps').all() as any[]).map((r) => r.uid).sort();
    const baseUser = (db.prepare("SELECT uid FROM base_maps WHERE scope='user'").all() as any[]).map((r) => r.uid).sort();
    const apps = (db.prepare('SELECT uid FROM apps').all() as any[]).map((r) => r.uid).sort();
    const pois = (db.prepare('SELECT uid FROM poi_sources').all() as any[]).map((r) => r.uid).sort();
    const assets = (db.prepare('SELECT uid FROM assets').all() as any[]).map((r) => r.uid).sort();
    const builtinCount = (db.prepare("SELECT COUNT(*) AS c FROM base_maps WHERE scope='builtin'").get() as any).c;
    const marker = !!db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get('2026-07-04-sqlite-write-store-legacy-import');
    return {
      counts: { maps: counts.maps, base_maps: counts.base_maps, apps: counts.apps, poi_sources: counts.poi_sources, assets: counts.assets },
      uids: { maps, base_maps_user: baseUser, apps, poi_sources: pois, assets },
      builtinCount,
      marker,
    };
  } finally {
    db.close();
  }
}

// 起動前に隔離 electron-store settings config.json へ残骸 tmsList を書き込む
async function writeIsolatedConfig(e2eRoot: string, saveFolder: string, tmsList: any): Promise<void> {
  const configDir = path.join(e2eRoot, 'electron-store', 'settings');
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, tmsList }));
}

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const saveFolder = await page.evaluate(() => (window as any).settings.get('saveFolder'));
  if (!path.resolve(saveFolder).startsWith(path.resolve(e2eRoot) + path.sep)) {
    throw new Error(`E2E storage isolation failed: ${saveFolder} outside ${e2eRoot}`);
  }
  return { app, page };
}

const LEGACY_MARKER = '2026-07-04-sqlite-write-store-legacy-import';

test.describe('M12-T32 ベースマップ重複修正', () => {
  test.setTimeout(240_000);

  test('シナリオ1（AC32-1/2）: 全く新規の空フォルダで起動 — 残骸 tmsList があってもユーザー定義 0 件', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m12-t32-s1-'));
    const fixture = await readJson(fixturePath);
    const builtinCatalog = await readJson(builtinPath);
    const builtinCount = builtinCatalog.length;
    const saveFolder = path.join(e2eRoot, 'new-empty'); // 存在しない（完全新規）

    await writeIsolatedConfig(e2eRoot, saveFolder, fixture);

    let app: ElectronApplication | null = null;
    try {
      ({ app } = await launch(e2eRoot));
      const page = await app.firstWindow();
      // 同期点: maplist.request の resolve で migrate 完了が保証される
      const result: any = await page.evaluate(() => (window as any).maplist.request('', 1, 50));
      expect(result.docs.length).toBe(0);

      const baseMaps: any[] = await page.evaluate(() => (window as any).baseMaps.list());
      const users = baseMaps.filter((b) => b.scope === 'user');
      const builtins = baseMaps.filter((b) => b.scope === 'builtin');
      expect(users.length, 'user 0 件').toBe(0);
      expect(builtins.length, 'builtin カタログ件数（動的導出）').toBe(builtinCount);

      // 地図・アプリ・POI・アセット一覧の 0 件は DB 直接検証（下）で 5 テーブルまとめて確認

      await quitElectronApplication(app);
      app = null;

      // DB 直接検証: 5 テーブル + marker
      const snap = snapshotDb(path.join(saveFolder, 'maplat.sqlite'));
      expect(snap.counts.maps, 'maps 0').toBe(0);
      expect(snap.counts.apps, 'apps 0').toBe(0);
      expect(snap.counts.poi_sources, 'poi_sources 0').toBe(0);
      expect(snap.counts.assets, 'assets 0').toBe(0);
      expect(snap.counts.base_maps, 'base_maps = builtin のみ').toBe(builtinCount);
      expect(snap.builtinCount, 'builtin カタログ件数').toBe(builtinCount);
      expect(snap.marker, 'LEGACY_MIGRATION_ID marker 記録').toBe(true);
    } finally {
      if (app) await quitElectronApplication(app).catch(() => {});
    }
  });

  test('シナリオ2（AC32-5/6/8）: 設定済みフォルダ → 空フォルダ切替 → 復帰。ドラフト全消去・保存済み不変', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m12-t32-s2-'));
    const fixture = await readJson(fixturePath);
    const builtinCatalog = await readJson(builtinPath);
    const builtinCount = builtinCatalog.length;
    const folderA = path.join(e2eRoot, 'save-folder'); // launchIsolated 既定
    const folderB = path.join(e2eRoot, 'folder-b');

    await writeIsolatedConfig(e2eRoot, folderA, fixture);

    let app: ElectronApplication | null = null;
    try {
      ({ app } = await launch(e2eRoot));
      const page = await app.firstWindow();
      await page.evaluate(() => (window as any).maplist.request('', 1, 50));

      // フォルダ A: 地図 1 件 + ユーザーベースマップ 1 件 + 下書き 1 件
      const mapResult: any = await page.evaluate(async () => {
        const slug = `t32-s2-map-${Date.now()}`;
        const r = await (window as any).mapedit.save({
          slug,
          mapObject: {
            mapID: slug, title: { ja: 't32 s2 map' },
            officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
            attr: { ja: 'attr' }, dataAttr: {}, description: {},
            license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
            imageExtension: 'jpg', width: 400, height: 300,
            gcps: [], edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
          },
          tins: [],
        });
        return r;
      });
      expect(mapResult?.result).toBe('Success');
      const mapUid = mapResult.uid;

      const bmResult: any = await page.evaluate(async () => {
        return await (window as any).baseMaps.saveUser({
          slug: `t32-s2-bm-${Date.now()}`,
          tms: { mapID: `t32-s2-bm`, title: 't32 s2 basemap', url: 'https://example.test/{z}/{x}/{y}.png' },
        });
      });
      expect(bmResult?.result).toBe('Success');
      const bmUid = bmResult.uid;

      // 下書き 1 件（IPC 直叩き・map kind・baseRevision null = 新規カード）
      const draftUid = await page.evaluate(async () => {
        const uid = crypto.randomUUID();
        await (window as any).assetDrafts.put({
          schemaVersion: 1, kind: 'map', assetUid: uid, baseRevision: null,
          updatedAt: '2026-07-28T12:00:00.000Z', payload: { mapID: 't32-s2-draft', title: 't32 s2 draft' },
        });
        return uid;
      });

      // 下書きカードが /maplist に表示される（remount で refreshDrafts を走らせるため
      // 別ルートへ一旦抜けて戻る）
      await page.evaluate((h) => { location.hash = h; }, '#/applist');
      await page.waitForLoadState('domcontentloaded');
      await page.evaluate((h) => { location.hash = h; }, '#/maplist');
      await page.waitForLoadState('domcontentloaded');
      await expect.poll(
        async () => await page.locator(`[data-resource-uid="${draftUid}"]`).count(),
        { timeout: 15_000 },
      ).toBe(1);

      // A → B 切替
      await page.evaluate((b) => (window as any).settings.set('saveFolder', b), folderB);
      // resolve 時点で切替完了（settings:set → switchDataFolder await）

      // B: user 0 件・builtin カタログ件数・地図 0 件・ドラフト全消去
      const bMaps: any[] = await page.evaluate(() => (window as any).baseMaps.list());
      expect(bMaps.filter((b) => b.scope === 'user').length, 'B: user 0').toBe(0);
      expect(bMaps.filter((b) => b.scope === 'builtin').length, 'B: builtin カタログ件数').toBe(builtinCount);
      const bList: any = await page.evaluate(() => (window as any).maplist.request('', 1, 50));
      expect(bList.docs.length, 'B: 地図 0 件').toBe(0);
      // ドラフト全消去（IPC 経由で store を直接検証 — AC32-8 の確実な確認）
      const bDrafts: any[] = await page.evaluate(() => (window as any).assetDrafts.list());
      expect(bDrafts.length, 'B: ドラフト index 空（全消去）').toBe(0);
      await expect.poll(
        async () => await page.locator(`[data-resource-uid="${draftUid}"]`).count(),
        { timeout: 10_000 },
      ).toBe(0);

      // B → A 復帰
      await page.evaluate((a) => (window as any).settings.set('saveFolder', a), folderA);

      // A: 保存済み地図・ベースマップが件数・uid 不変。ドラフトは消えたまま
      const aList: any = await page.evaluate(() => (window as any).maplist.request('', 1, 50));
      expect(aList.docs.length, 'A 復帰: 地図 1 件不変').toBe(1);
      expect(aList.docs[0].uid, 'A 復帰: 地図 uid 不変').toBe(mapUid);
      const aMaps: any[] = await page.evaluate(() => (window as any).baseMaps.list());
      const aUsers = aMaps.filter((b) => b.scope === 'user');
      expect(aUsers.length, 'A 復帰: user 1 件不変').toBe(1);
      expect(aUsers[0].uid, 'A 復帰: basemap uid 不変').toBe(bmUid);
      // ドラフトは消えたまま（IPC 直接検証で確実に）
      const aDrafts: any[] = await page.evaluate(() => (window as any).assetDrafts.list());
      expect(aDrafts.length, 'A 復帰: ドラフトは消えたまま（仕様）').toBe(0);
      await expect.poll(
        async () => await page.locator(`[data-resource-uid="${draftUid}"]`).count(),
        { timeout: 10_000 },
      ).toBe(0);

      await quitElectronApplication(app);
      app = null;

      // DB 直接検証: A / B 両 DB の 5 テーブル
      const snapA = snapshotDb(path.join(folderA, 'maplat.sqlite'));
      const snapB = snapshotDb(path.join(folderB, 'maplat.sqlite'));
      expect(snapA.counts.maps).toBe(1);
      expect(snapA.uids.maps).toContain(mapUid);
      expect(snapA.uids.base_maps_user).toEqual([bmUid]);
      expect(snapA.builtinCount).toBe(builtinCount);
      expect(snapA.marker).toBe(true);
      expect(snapB.counts.maps).toBe(0);
      expect(snapB.uids.base_maps_user).toEqual([]);
      expect(snapB.builtinCount).toBe(builtinCount);
      expect(snapB.marker).toBe(true);
    } finally {
      if (app) await quitElectronApplication(app).catch(() => {});
    }
  });

  test('シナリオ3（AC32-7）: 設定済みフォルダ間往復切替 — 5 テーブル件数・uid 不変・相互混入なし', async () => {
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m12-t32-s3-'));
    const fixture = await readJson(fixturePath);
    const builtinCatalog = await readJson(builtinPath);
    const builtinCount = builtinCatalog.length;
    const folderA = path.join(e2eRoot, 'folder-a');
    const folderB = path.join(e2eRoot, 'folder-b');

    // A を初期 saveFolder として起動
    await writeIsolatedConfig(e2eRoot, folderA, fixture);

    let app: ElectronApplication | null = null;
    try {
      ({ app } = await launch(e2eRoot));
      const page = await app.firstWindow();
      await page.evaluate(() => (window as any).maplist.request('', 1, 50));

      // フォルダ A: 地図 1 + user-in-a
      const mapA: any = await page.evaluate(async () => {
        const slug = `t32-s3-mapa-${Date.now()}`;
        const r = await (window as any).mapedit.save({
          slug, mapObject: { mapID: slug, title: { ja: 's3 A' }, officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {}, attr: { ja: 'a' }, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja', imageExtension: 'jpg', width: 400, height: 300, gcps: [], edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New' }, tins: [],
        });
        return r;
      });
      expect(mapA?.result).toBe('Success');
      const mapAUid = mapA.uid;
      const bmA: any = await page.evaluate(async () => {
        return await (window as any).baseMaps.saveUser({ slug: `user-in-a-${Date.now()}`, tms: { mapID: 'user-in-a', title: 'A bm', url: 'https://a.test/{z}/{x}/{y}.png' } });
      });
      expect(bmA?.result).toBe('Success');
      const bmAUid = bmA.uid;

      // A → B 切替（B は空 → ブートストラップ）
      await page.evaluate((b) => (window as any).settings.set('saveFolder', b), folderB);
      await page.evaluate(() => (window as any).maplist.request('', 1, 50));
      // フォルダ B: 地図 1 + user-in-b
      const mapB: any = await page.evaluate(async () => {
        const slug = `t32-s3-mapb-${Date.now()}`;
        const r = await (window as any).mapedit.save({
          slug, mapObject: { mapID: slug, title: { ja: 's3 B' }, officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {}, attr: { ja: 'b' }, dataAttr: {}, description: {}, license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja', imageExtension: 'jpg', width: 400, height: 300, gcps: [], edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New' }, tins: [],
        });
        return r;
      });
      expect(mapB?.result).toBe('Success');
      const mapBUid = mapB.uid;
      const bmB: any = await page.evaluate(async () => {
        return await (window as any).baseMaps.saveUser({ slug: `user-in-b-${Date.now()}`, tms: { mapID: 'user-in-b', title: 'B bm', url: 'https://b.test/{z}/{x}/{y}.png' } });
      });
      expect(bmB?.result).toBe('Success');
      const bmBUid = bmB.uid;

      // A → B → A 往復
      // 現在 B。B のスナップショット（window API 経由）
      const bSnap1: any = await page.evaluate(async () => ({
        maps: await (window as any).maplist.request('', 1, 50),
        bm: await (window as any).baseMaps.list(),
      }));
      const bMapUids1 = bSnap1.maps.docs.map((d: any) => d.uid).sort();
      const bUserUids1 = bSnap1.bm.filter((b: any) => b.scope === 'user').map((b: any) => b.uid).sort();

      // B → A
      await page.evaluate((a) => (window as any).settings.set('saveFolder', a), folderA);
      const aSnapAfterReturn: any = await page.evaluate(async () => ({
        maps: await (window as any).maplist.request('', 1, 50),
        bm: await (window as any).baseMaps.list(),
      }));
      const aMapUids = aSnapAfterReturn.maps.docs.map((d: any) => d.uid).sort();
      const aUserUids = aSnapAfterReturn.bm.filter((b: any) => b.scope === 'user').map((b: any) => b.uid).sort();
      // A は往復前後で不変・B のデータが混入しない
      expect(aMapUids).toEqual([mapAUid]);
      expect(aUserUids).toEqual([bmAUid]);
      expect(aUserUids).not.toContain(bmBUid);

      // A → B
      await page.evaluate((b) => (window as any).settings.set('saveFolder', b), folderB);
      const bSnap2: any = await page.evaluate(async () => ({
        maps: await (window as any).maplist.request('', 1, 50),
        bm: await (window as any).baseMaps.list(),
      }));
      const bMapUids2 = bSnap2.maps.docs.map((d: any) => d.uid).sort();
      const bUserUids2 = bSnap2.bm.filter((b: any) => b.scope === 'user').map((b: any) => b.uid).sort();
      expect(bMapUids2).toEqual([mapBUid]);
      expect(bUserUids2).toEqual([bmBUid]);
      expect(bUserUids2).not.toContain(bmAUid);
      expect(bMapUids2).toEqual(bMapUids1);
      expect(bUserUids2).toEqual(bUserUids1);

      await quitElectronApplication(app);
      app = null;

      // DB 直接検証: 両 DB の 5 テーブル
      const snapA = snapshotDb(path.join(folderA, 'maplat.sqlite'));
      const snapB = snapshotDb(path.join(folderB, 'maplat.sqlite'));
      expect(snapA.uids.maps).toEqual([mapAUid]);
      expect(snapA.uids.base_maps_user).toEqual([bmAUid]);
      expect(snapA.builtinCount).toBe(builtinCount);
      expect(snapA.marker).toBe(true);
      expect(snapB.uids.maps).toEqual([mapBUid]);
      expect(snapB.uids.base_maps_user).toEqual([bmBUid]);
      expect(snapB.builtinCount).toBe(builtinCount);
      expect(snapB.marker).toBe(true);
      // 相互混入なし
      expect(snapA.uids.base_maps_user).not.toContain(bmBUid);
      expect(snapB.uids.base_maps_user).not.toContain(bmAUid);
      expect(snapA.uids.maps).not.toContain(mapBUid);
      expect(snapB.uids.maps).not.toContain(mapAUid);
    } finally {
      if (app) await quitElectronApplication(app).catch(() => {});
    }
  });
});
