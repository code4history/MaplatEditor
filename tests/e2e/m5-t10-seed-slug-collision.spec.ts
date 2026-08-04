// M5-T10 (AC15): ビルトインベースマップ再シードで slug 衝突が起きたときの、
// 生成 slug の規則と、再起動をまたいだ安定性を実起動で検証する。
//
// 実起動を要する理由: 再シードは **起動経路**（getDb → applyBuiltinBaseMapSeed）であり、
// node:sqlite の同期トランザクション内で走る。設計 §3.2 の同期制約（findAvailableSlugSync を
// 足した理由）が実アプリでも成立していることの裏取りを兼ねる — 同期版が正しく働かなければ
// そもそも起動しない。
//
// 【衝突の作り方】`slugTaken` は `asset_registry` だけを見る（SqliteDataService:1723 実読）。
// ∴ builtin の `base_maps` 行だけを消し、registry 行を残せば「slug は取られているが
// ビルトイン行は無い」状態になり、次回起動の再シードが衝突回避へ入る。
// 1文の DELETE で作れる最小の細工である。
//
// 【なぜ app.evaluate を使わないか】`app.evaluate` の中では動的 import が main のバンドルへ
// 解決されて使えない（m5-t8 で実測）。∴ DB ファイルをテストプロセスから直接操作する
// （m13-t5-migration-pipeline-e2e と同じ方式）。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

/** 先取りさせるカタログ ID。常時表示ではない builtin を選ぶ（m8-t2 (h) と同じ理由） */
const VICTIM_CATALOG_ID = 'muroran00';

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // 一覧を開いて DB 初期化（getDb → applyBuiltinBaseMapSeed）を確実に走らせる。
  // 起動しただけでは DB がまだ作られていないことがある（実測）
  await page.evaluate(() => { location.hash = '#/maplist'; });
  await page.waitForLoadState('domcontentloaded');
  // settings 経由で main を1往復させ、DB 初期化の完了を待つ
  await page.evaluate(async () => await (window as any).settings.get('saveFolder'));
  return { app, page };
}

/** 実アプリが使っている saveFolder を renderer から取得し、DB ファイルのパスを組む */
async function resolveDbFile(page: Page): Promise<string> {
  const saveFolder = await page.evaluate(async () => await (window as any).settings.get('saveFolder'));
  return path.join(String(saveFolder), 'maplat.sqlite');
}

/** listBaseMaps 相当を DB から直接読む（scope / slug / builtinId） */
function readBaseMaps(dbFile: string): { slug: string; scope: string; builtinId: string | null }[] {
  const db = new DatabaseSync(dbFile);
  try {
    return (db.prepare(
      `SELECT slug, scope, json_extract(data_json, '$.builtinId') AS builtinId FROM base_maps`,
    ).all() as any[]).map((r) => ({
      slug: String(r.slug),
      scope: String(r.scope),
      builtinId: r.builtinId == null ? null : String(r.builtinId),
    }));
  } finally {
    db.close();
  }
}

test('AC15: 再シードで衝突した builtin が正本規則の slug を得て、再起動をまたいで安定する', async () => {
  test.setTimeout(180_000);
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m5t10-seed-collision-'));
  let dbFile = '';

  // --- 1回目の起動: ビルトインが素の状態でシードされる ---
  {
    const { app, page } = await launch(e2eRoot);
    try {
      dbFile = await resolveDbFile(page);
      const before = readBaseMaps(dbFile);
      const victim = before.find((b) => b.scope === 'builtin' && b.slug === VICTIM_CATALOG_ID);
      expect(victim, `前提: builtin ${VICTIM_CATALOG_ID} がシードされている`).toBeTruthy();
      // 前提の裏取り: この時点では衝突回避が一度も起きていない
      expect(before.filter((b) => b.scope === 'builtin' && b.slug.includes('-2'))).toEqual([]);
    } finally {
      await quitElectronApplication(app);
    }
  }

  // --- 衝突状態を作る: base_maps 行だけ消し、asset_registry は残す ---
  {
    const db = new DatabaseSync(dbFile);
    try {
      const info = db.prepare("DELETE FROM base_maps WHERE scope = 'builtin' AND slug = ?").run(VICTIM_CATALOG_ID);
      expect(Number(info.changes), '細工: builtin 行を1件だけ消した').toBe(1);
      const stillTaken = db.prepare('SELECT 1 FROM asset_registry WHERE slug = ?').get(VICTIM_CATALOG_ID);
      expect(stillTaken, '細工: registry には slug が残っている（＝取られている状態）').toBeTruthy();
    } finally {
      db.close();
    }
  }

  // --- 2回目の起動: 再シードが衝突回避へ入る ---
  {
    const { app } = await launch(e2eRoot);
    try {
      const after = readBaseMaps(dbFile);
      const revived = after.find((b) => b.scope === 'builtin' && b.builtinId === VICTIM_CATALOG_ID);
      expect(revived, `builtinId=${VICTIM_CATALOG_ID} の builtin が再シードで復活している`).toBeTruthy();

      // AC15-1: 生成 slug が正本規則（'-' 始まり）である
      expect(revived!.slug).toBe(`${VICTIM_CATALOG_ID}-2`);
      // 形の退行検出（旧規則で発行されていない）
      expect(revived!.slug).not.toContain('_2');

      // AC15-2: 先取りされていた slug は builtin に奪い返されていない
      expect(after.some((b) => b.scope === 'builtin' && b.slug === VICTIM_CATALOG_ID)).toBe(false);
    } finally {
      await quitElectronApplication(app);
    }
  }

  // --- 3回目の起動: uid/slug が安定し、再シードのたびに増えない ---
  {
    const { app } = await launch(e2eRoot);
    try {
      const reopened = readBaseMaps(dbFile);
      const revived = reopened.filter((b) => b.scope === 'builtin' && b.builtinId === VICTIM_CATALOG_ID);
      // AC15-3: 同じ slug のまま1件（起動のたびに -3, -4 と増えない）
      expect(revived.map((b) => b.slug)).toEqual([`${VICTIM_CATALOG_ID}-2`]);
    } finally {
      await quitElectronApplication(app);
    }
  }
});
