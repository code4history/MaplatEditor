// M13-T5 (AC-T5-3): 旧バージョン形状データフォルダからの実 Electron 起動による
// 起動時 migration パイプライン(legacy migration → thumbnail-512 mining →
// originals UUID migration)の一気通貫検証。
// (M12-T18: 旧段階3 trash reconcile は独自 trash の廃止に伴い撤去され、パイプラインは
// 4段階 → 3段階になった。本 spec の assert はマーカー(段階1/2)と originals migration
// 結果のみで reconcile に依存しないため、挙動改修なし・コメントのみ追随)
// tests/e2e/m13-t2-single-instance-lock.spec.ts と同一パターン(mkdtemp + MAPLAT_E2E_ROOT +
// --user-data-dir 必須)を踏襲する。フィクスチャは tests/fixtures/m13-t5-migration-pipeline/
// 配下の実データ由来コピー(takabatake_kozu1/2、人間承認済み)+ 合成タイルを使う。
// タスク設計 `docs/superpowers/specs/2026-07-24-m13-t5-migration-pipeline-design.md` §5.6 準拠。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, cp, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const fixturesRoot = path.join(projectRoot, 'tests/fixtures/m13-t5-migration-pipeline');

async function sha256(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

async function pathExistsBool(p: string): Promise<boolean> {
  const { pathExists } = await import('fs-extra');
  return await pathExists(p);
}

test('M13-T5: legacy migration -> thumbnail-512 mining -> originals UUID migration が実起動で一気通貫する', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m13-t5-migration-pipeline-'));
  const saveFolder = path.join(e2eRoot, 'save-folder');

  // --- §5.6 手順2: フィクスチャを <e2eRoot>/save-folder/ 配下へ配置する ---
  // (テストの隔離実行であり実データには一切触れない。フィクスチャ自体は実装時に
  // 実データフォルダから読み取り専用 grep/コピーで抽出済み。§5.5.1/AC-T5-4)
  await mkdir(saveFolder, { recursive: true });
  // legacy migration 未実行を再現するため、ライブファイル名は "nedb.db"(退避名 "_nedb.db" ではない)
  await cp(path.join(fixturesRoot, 'legacy-nedb-lines.ndjson'), path.join(saveFolder, 'nedb.db'));
  await mkdir(path.join(saveFolder, 'originals'), { recursive: true });
  await cp(
    path.join(fixturesRoot, 'originals/takabatake_kozu1.jpg'),
    path.join(saveFolder, 'originals/takabatake_kozu1.jpg'),
  );
  await cp(
    path.join(fixturesRoot, 'originals/takabatake_kozu2.jpg'),
    path.join(saveFolder, 'originals/takabatake_kozu2.jpg'),
  );
  await mkdir(path.join(saveFolder, 'tiles/takabatake_kozu1/2/0'), { recursive: true });
  await mkdir(path.join(saveFolder, 'tiles/takabatake_kozu2/2/0'), { recursive: true });
  await cp(
    path.join(fixturesRoot, 'tiles/takabatake_kozu1/2/0/0.jpg'),
    path.join(saveFolder, 'tiles/takabatake_kozu1/2/0/0.jpg'),
  );
  await cp(
    path.join(fixturesRoot, 'tiles/takabatake_kozu2/2/0/0.jpg'),
    path.join(saveFolder, 'tiles/takabatake_kozu2/2/0/0.jpg'),
  );
  // tmbs/ は作らない(初期状態で 512px サムネイルが存在しないことを保証する)

  let app: ElectronApplication | null = null;
  let uid1 = '';
  let uid2 = '';

  try {
    // --- §5.6 手順3: --user-data-dir 必須(既存 E2E spec 22本全数指定パターンに揃える) ---
    app = await electron.launch({
      args: [projectRoot, `--user-data-dir=${path.join(e2eRoot, 'user-data')}`],
      cwd: projectRoot,
      env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
    });
    const page: Page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // --- §5.6 手順5: 同期点。window.maplist.request() の resolve は内部で
    // SqliteDataService.getDb() を要求するため、resolve 時点で migrate() の3段階すべてが
    // 完了していることが保証される(positional 契約: request(query, page, pageSize)) ---
    const result: any = await page.evaluate(() => (window as any).maplist.request('', 1, 50));
    const byMapID: Record<string, string> = Object.fromEntries(
      (result.docs as any[]).map((d) => [d.mapID, d.uid]),
    );
    uid1 = byMapID['takabatake_kozu1'];
    uid2 = byMapID['takabatake_kozu2'];
    expect(uid1, 'takabatake_kozu1 は migration により uid を持つはず').toBeTruthy();
    expect(uid2, 'takabatake_kozu2 は migration により uid を持つはず').toBeTruthy();
    expect(uid1).not.toBe(uid2);

    // --- §5.6 手順7: 後続の直接ファイル/DB検証がロック競合しないよう先に app を落とす ---
    await quitElectronApplication(app);
    app = null;

    // --- (AC-T5-3a) sqlite: maps 行 + schema_migrations marker ---
    const db = new DatabaseSync(path.join(saveFolder, 'maplat.sqlite'));
    try {
      const row1: any = db.prepare('SELECT uid, slug FROM maps WHERE uid = ?').get(uid1);
      const row2: any = db.prepare('SELECT uid, slug FROM maps WHERE uid = ?').get(uid2);
      expect(row1?.slug).toBe('takabatake_kozu1');
      expect(row2?.slug).toBe('takabatake_kozu2');

      const legacyMarker = db
        .prepare('SELECT 1 FROM schema_migrations WHERE id = ?')
        .get('2026-07-04-sqlite-write-store-legacy-import');
      const thumbMarker = db
        .prepare('SELECT 1 FROM schema_migrations WHERE id = ?')
        .get('2026-07-21-thumbnail-512-mining-v2');
      expect(legacyMarker, 'legacy migration marker が記録されているはず').toBeTruthy();
      expect(thumbMarker, 'thumbnail-512 mining marker が記録されているはず').toBeTruthy();
    } finally {
      db.close();
    }

    // --- (AC-T5-3b) originals: canonical uid 原本 + legacy slug 原本の無傷(byte一致) ---
    const canonical1 = path.join(saveFolder, 'originals', `${uid1}.jpg`);
    const canonical2 = path.join(saveFolder, 'originals', `${uid2}.jpg`);
    expect(await pathExistsBool(canonical1), 'canonical originals/<uid1>.jpg が生成されているはず').toBe(true);
    expect(await pathExistsBool(canonical2), 'canonical originals/<uid2>.jpg が生成されているはず').toBe(true);

    const legacySlug1 = path.join(saveFolder, 'originals/takabatake_kozu1.jpg');
    const legacySlug2 = path.join(saveFolder, 'originals/takabatake_kozu2.jpg');
    expect(await pathExistsBool(legacySlug1), 'legacy slug 原本 takabatake_kozu1.jpg は引き続き存在するはず').toBe(true);
    expect(await pathExistsBool(legacySlug2), 'legacy slug 原本 takabatake_kozu2.jpg は引き続き存在するはず').toBe(true);

    const [fixtureHash1, legacyHash1, fixtureHash2, legacyHash2] = await Promise.all([
      sha256(path.join(fixturesRoot, 'originals/takabatake_kozu1.jpg')),
      sha256(legacySlug1),
      sha256(path.join(fixturesRoot, 'originals/takabatake_kozu2.jpg')),
      sha256(legacySlug2),
    ]);
    expect(legacyHash1, 'legacy slug 原本1はフィクスチャ由来と byte-for-byte 不変のはず(SI-2)').toBe(fixtureHash1);
    expect(legacyHash2, 'legacy slug 原本2はフィクスチャ由来と byte-for-byte 不変のはず(SI-2)').toBe(fixtureHash2);

    // --- (AC-T5-3c) migration-report-v2.json: originalsUuidMigration.entries ---
    const report = JSON.parse(await readFile(path.join(saveFolder, 'migration-report-v2.json'), 'utf8'));
    expect(report.originalsUuidMigration, 'originalsUuidMigration が additive に書かれているはず').toBeTruthy();
    const entries: any[] = report.originalsUuidMigration.entries;
    const entry1 = entries.find((e) => e.uid === uid1);
    const entry2 = entries.find((e) => e.uid === uid2);
    expect(entry1?.outcome).toBe('migrated');
    expect(entry2?.outcome).toBe('migrated');
    expect(entry1?.sourcePath).toContain('takabatake_kozu1.jpg');
    expect(entry1?.targetPath).toContain(`${uid1}.jpg`);
    expect(entry2?.sourcePath).toContain('takabatake_kozu2.jpg');
    expect(entry2?.targetPath).toContain(`${uid2}.jpg`);

    // --- (512px 生成): 合成タイルにより実際に生成される(§5.5.2) ---
    expect(
      await pathExistsBool(path.join(saveFolder, 'tmbs', `${uid1}_512.jpg`)),
      'tmbs/<uid1>_512.jpg が生成されているはず',
    ).toBe(true);
    expect(
      await pathExistsBool(path.join(saveFolder, 'tmbs', `${uid2}_512.jpg`)),
      'tmbs/<uid2>_512.jpg が生成されているはず',
    ).toBe(true);
  } finally {
    if (app) {
      await quitElectronApplication(app).catch(() => {});
    }
  }
});
