// M12-T18 (AC18-1/3/6): 地図削除で originals (canonical + 一意 legacy) が本物の OS ゴミ箱
// (shell.trashItem) へ入ることの end-to-end 検証。差し替え機構は使わず (人間指示 2026-07-27)、
// 実行マシンの実ゴミ箱に使い捨てファイル (数バイト×2・一意 basename) を一時的に通過させ、
// テスト自身が afterEach で後始末する (残骸ゼロで原状復帰)。
// タスク設計 `docs/superpowers/specs/2026-07-27-m12-t18-os-trash-migration-design.md` §7.1 準拠。
//
// プラットフォーム前提 (§7.2): 本 spec は process.platform === 'darwin' を前提とする
// (ゴミ箱の物理位置 ~/.Trash は darwin 固有。本プロジェクトの開発・検証環境は macOS のみ)。
// ~/.Trash の readdir は EPERM で拒否され得るため (§4.1 実測)、列挙は一切使わず、
// run ごとに一意な basename (randomUUID 由来) の exact path 判定のみを使う。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

// --- §7.1 手順6: ゴミ箱側パス解決の一元化 ---
// assert (手順4) と後始末 (手順5, afterEach) が「同一の exact path 集合」を共有する。
// basename はシード時に registerTrashedBasename() で登録する。
const OS_TRASH_DIR = path.join(os.homedir(), '.Trash');
const trashedBasenames: string[] = [];
function registerTrashedBasename(basename: string): string {
  trashedBasenames.push(basename);
  return path.join(OS_TRASH_DIR, basename);
}
function osTrashPaths(): string[] {
  return trashedBasenames.map((b) => path.join(OS_TRASH_DIR, b));
}

// --- §7.1 手順5 / AC18-6: 後始末はテストプロセス側 fs の afterEach に置く ---
// (v1.1・レビュー Major 2: 試験本文の try/finally ではなく afterEach に置くことで、
// アプリプロセス死亡時・Playwright test timeout 時にも後始末が実行される)
test.afterEach(async () => {
  // ステップ1: force rm (ENOENT 許容。trashItem まで到達しない失敗 — seed 失敗・
  // M18-1 適用時等 — では対象がゴミ箱に存在しないため。v1.1・レビュー Minor 3)
  for (const p of osTrashPaths()) {
    await rm(p, { recursive: true, force: true });
  }
  // ステップ2: 不在 assert (rm と分離した2ステップ。rm が空振りでも必ず評価される)
  for (const p of osTrashPaths()) {
    await expect(stat(p), `後始末後にゴミ箱へ残骸が残っている: ${p}`).rejects.toMatchObject({ code: 'ENOENT' });
  }
});

test('M12-T18: 地図削除で originals が本物の OS ゴミ箱に入り、live から消え、独自 trash/ は生成されない', async () => {
  test.setTimeout(240_000);
  if (process.platform !== 'darwin') {
    throw new Error('この E2E は darwin 前提 (§7.2: ゴミ箱側 assert が ~/.Trash に依存する)');
  }

  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m12-t18-os-trash-'));
  const saveFolder = path.join(e2eRoot, 'save-folder');

  // --- §7.1 手順1: run ごとに一意な uid/slug (いずれも randomUUID 由来。レビュー v2 Info 3) ---
  // ゴミ箱内 basename の衝突リネーム (§4.2-3) が起きず、exact path での確認・後始末が成立する
  const uid = randomUUID();
  const slug = `m12t18-e2e-${randomUUID()}`;
  const trashedCanonical = registerTrashedBasename(`${uid}.jpg`);
  const trashedLegacy = registerTrashedBasename(`${slug}.jpg`);

  let app: ElectronApplication | null = null;
  try {
    // --- 手順1a: 起動→終了で schema を作らせる (maplist.request の resolve = getDb() 完了) ---
    app = await electron.launch({
      args: [projectRoot, `--user-data-dir=${path.join(e2eRoot, 'user-data')}`],
      cwd: projectRoot,
      env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
    });
    let page: Page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => (window as any).maplist.request('', 1, 50));
    await quitElectronApplication(app);
    app = null;

    // --- 手順1b: maps 行を直接 INSERT (maps スキーマは SqliteDataService.ts 実読。
    // post-quit の直接 DB 操作は m13-t5 spec の確立パターン) + originals/tiles を配置 ---
    const db = new DatabaseSync(path.join(saveFolder, 'maplat.sqlite'));
    try {
      // maps の AFTER INSERT trigger (maps_search_ai) はアプリ実行時に登録されるカスタム
      // SQLite 関数を参照するため、シード接続にも互換スタブを登録する (FTS/R-tree の索引
      // 内容は本テストの検証対象外。delete 検証に必要なのは maps 行の存在のみ)
      db.function('maplat_map_fts_raw', { deterministic: true }, (_dataJson: unknown) => '');
      db.function('maplat_tokenize', { deterministic: true }, (text: unknown) => String(text ?? ''));
      db.function('maplat_map_bbox', { deterministic: true }, (_dataJson: unknown) => null);
      db.prepare('INSERT INTO maps (uid, slug, data_json) VALUES (?, ?, ?)').run(
        uid,
        slug,
        JSON.stringify({ mapID: slug, imageExtension: 'jpg', gcps: [], edges: [], sub_maps: [] }),
      );
    } finally {
      db.close();
    }
    const originalsDir = path.join(saveFolder, 'originals');
    await mkdir(originalsDir, { recursive: true });
    await writeFile(path.join(originalsDir, `${uid}.jpg`), 'm12-t18-canonical-bytes');
    await writeFile(path.join(originalsDir, `${slug}.jpg`), 'm12-t18-legacy-bytes');
    await mkdir(path.join(saveFolder, 'tiles', uid, '0'), { recursive: true });
    await writeFile(path.join(saveFolder, 'tiles', uid, '0', '0.jpg'), 'tile-bytes');

    // --- §7.1 手順2: 再起動し、実 UI 契約そのもの (preload maplist.delete) で削除を実行 ---
    app = await electron.launch({
      args: [projectRoot, `--user-data-dir=${path.join(e2eRoot, 'user-data')}`],
      cwd: projectRoot,
      env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate((u) => (window as any).maplist.delete(u, '', 1), uid);

    // --- §7.1 手順3: live 側 assert ---
    const { pathExists } = await import('fs-extra');
    expect(await pathExists(path.join(originalsDir, `${uid}.jpg`)), 'live canonical は消えているはず').toBe(false);
    expect(await pathExists(path.join(originalsDir, `${slug}.jpg`)), 'live legacy は消えているはず').toBe(false);
    expect(await pathExists(path.join(saveFolder, 'tiles', uid)), 'tiles ディレクトリは直接削除されるはず').toBe(false);
    expect(
      await pathExists(path.join(saveFolder, 'trash')),
      '独自 trash/ ディレクトリは一切生成されないはず (AC18-3)',
    ).toBe(false);

    // --- §7.1 手順4: ゴミ箱側 assert (本物の証明) — テストプロセス側 fs の exact path stat。
    // 列挙 (readdir) は EPERM のため使わない (§4.1) ---
    const canonicalStat = await stat(trashedCanonical);
    expect(canonicalStat.isFile(), `canonical が OS ゴミ箱に実在するはず: ${trashedCanonical}`).toBe(true);
    const legacyStat = await stat(trashedLegacy);
    expect(legacyStat.isFile(), `legacy が OS ゴミ箱に実在するはず: ${trashedLegacy}`).toBe(true);

    // --- DB 側 assert: 終了後に row 消滅を直接確認する ---
    await quitElectronApplication(app);
    app = null;
    const dbAfter = new DatabaseSync(path.join(saveFolder, 'maplat.sqlite'));
    try {
      const row = dbAfter.prepare('SELECT 1 FROM maps WHERE uid = ?').get(uid);
      expect(row, 'DB row は削除されているはず').toBeFalsy();
    } finally {
      dbAfter.close();
    }
  } finally {
    if (app) {
      await quitElectronApplication(app).catch(() => {});
    }
  }
});
