// nov26-m6-t5 (#109・HR-15): 既存データの画像の内部名を UUID（ベースマップは uid）へ複製で移行する、
// 一回限りの起動時の移行。タスク設計 `docs/superpowers/specs/2026-10-11-nov26-m6-t5-task-design.md` §4.2〜§4.4。
//
// 前例: OriginalsMigrationService（M13-T3）と同じく cold-boot の db を引数で受け、SqliteDataService の
// getDb() 経由のメソッドを呼ばない（自己デッドロック）。SqliteDataService を import しない（一方向）。
// 印（schema_migrations）は runThumbnail512MiningIfNeeded と同じく持つ。印の ID は SqliteDataService.ts の
// 行頭の定数 ASSET_UUID_NAMES_V1_ID が唯一の定義で、引数で受け取る（T5-R2-MIN-1）。
//
// 本移行は「0.7.0 の取込行を 1.0.0 の形へ直す段」ではない（§4.2『m19-t7 との関係』）:
// 対象は 1.0.0〜1.1.x の利用で作られたすべてのアプリ・ユーザーのベースマップの行で、到達先は 1.2.0 の
// 命名の契約。スキーマ・語彙を変えず、3 つのキーの参照の値だけを同じ内容の複製の名前へ付け替える。
//
// 不変条件:
//   - 旧ファイルは消さない（複製方式）。消すのは「この件で overwrite: false で作ったファイル」だけ
//   - 参照の形を変えない（読んだキーそのものを書き換える）
//   - revision と updated_at を進めない（§4.4。移行前の下書きを衝突にしない）
//   - 比較と交換: 書き換えの直前に行を読み直し、該当キーが手順 1 で見た旧値のときだけ置き換える
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs-extra';
import { thumb512PathFor, thumb52PathFor } from '../../src/utils/thumbnailPaths';
import {
  checkSource,
  collectAppImageRefs,
  copyVerified,
  isUuidForm,
  lowerExtOf,
  newNameFor,
  readField,
  sourceRelOf,
  withField,
  type AppImageRef,
} from './assetImageRefs';
import {
  mergeAssetUuidNamesReport,
  type AssetUuidNamesEntry,
  type AssetUuidNamesOutcome,
} from './MigrationReportService';

export interface AssetUuidNamesOptions {
  /** テスト専用のフック（複製の後・書き換えの前）。製品の呼び出しでは渡さない */
  __beforeSwap?: (uid: string, kind: AssetUuidNamesEntry['kind']) => void;
}

export interface AssetUuidNamesResult {
  skipped?: 'marker' | 'no-save-folder';
  summary: Record<AssetUuidNamesOutcome, number>;
  entries: AssetUuidNamesEntry[];
}

const BASE_MAP_THUMBNAIL = /^tmbs\/([^/]+)\.([A-Za-z0-9]+)$/;

interface AppCandidate extends AppImageRef {
  uid: string;
  rel: string;
}

interface BaseMapCandidate {
  uid: string;
  thumbnail: string;
  ext: string;
}

function emptySummary(): Record<AssetUuidNamesOutcome, number> {
  return {
    migrated: 0,
    already_uuid: 0,
    shared_split: 0,
    source_missing: 0,
    outside_folder: 0,
    copy_failed: 0,
    cas_mismatch: 0,
    unsupported_form: 0,
  };
}

function parse(json: unknown): any | null {
  try {
    const value = JSON.parse(String(json ?? ''));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function abs(saveFolder: string, rel: string): string {
  return path.join(saveFolder, ...rel.split('/'));
}

/**
 * 比較と交換（§4.2 の 6）。SqliteDataService.withTransaction は private で使えないので、同じ SQL を書く。
 * `revision` と `updated_at` は書かない（§4.4）。
 */
function compareAndSwap(
  db: DatabaseSync,
  table: 'apps' | 'base_maps',
  uid: string,
  replace: (data: any) => any | null,
): boolean {
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare(`SELECT data_json FROM ${table} WHERE uid = ?`).get(uid) as any;
    const data = row ? parse(row.data_json) : null;
    const next = data ? replace(data) : null;
    if (next) {
      db.prepare(`UPDATE ${table} SET data_json = ? WHERE uid = ?`).run(JSON.stringify(next), uid);
    }
    db.exec('COMMIT');
    return Boolean(next);
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* 既に終わっている */ }
    throw e;
  }
}

function collectApps(db: DatabaseSync): AppCandidate[] {
  const rows = db.prepare('SELECT uid, data_json FROM apps ORDER BY uid').all() as any[];
  const out: AppCandidate[] = [];
  for (const row of rows) {
    const data = parse(row.data_json);
    if (!data) continue;
    for (const ref of collectAppImageRefs(data)) {
      out.push({ ...ref, uid: String(row.uid), rel: sourceRelOf(ref) });
    }
  }
  return out;
}

function collectBaseMaps(db: DatabaseSync): BaseMapCandidate[] {
  const rows = db
    .prepare("SELECT uid, data_json FROM base_maps WHERE scope = 'user' ORDER BY uid")
    .all() as any[];
  const out: BaseMapCandidate[] = [];
  for (const row of rows) {
    const data = parse(row.data_json);
    const thumbnail = data?.thumbnail;
    if (typeof thumbnail !== 'string') continue;
    const match = BASE_MAP_THUMBNAIL.exec(thumbnail);
    if (!match) continue; // basemap_icons/ 等の同梱の参照は対象外
    out.push({ uid: String(row.uid), thumbnail, ext: match[2] });
  }
  return out;
}

async function migrateApp(
  db: DatabaseSync,
  saveFolder: string,
  ref: AppCandidate,
  shared: boolean,
  keepAsIs: boolean,
  options: AssetUuidNamesOptions,
): Promise<AssetUuidNamesEntry> {
  const base = { kind: ref.kind, uid: ref.uid, from: ref.value } as const;
  if (keepAsIs) return { ...base, outcome: 'already_uuid' };
  const ext = lowerExtOf(ref.value);
  if (!ext) return { ...base, outcome: 'unsupported_form', detail: 'extension' };
  const source = await checkSource(saveFolder, ref.rel);
  if (!source.ok) return { ...base, outcome: source.outcome, detail: source.detail };
  const target = newNameFor(ref.kind, ext);
  const copied = await copyVerified(source.abs, abs(saveFolder, target.rel));
  if (!copied.ok) return { ...base, to: target.value, outcome: 'copy_failed', detail: copied.detail };
  options.__beforeSwap?.(ref.uid, ref.kind);
  const swapped = compareAndSwap(db, 'apps', ref.uid, (data) =>
    readField(data, ref.field) === ref.value ? withField(data, ref.field, target.value) : null,
  );
  if (!swapped) return { ...base, to: target.value, outcome: 'cas_mismatch', detail: 'orphan copy kept' };
  return { ...base, to: target.value, outcome: shared ? 'shared_split' : 'migrated' };
}

async function migrateBaseMap(
  db: DatabaseSync,
  saveFolder: string,
  item: BaseMapCandidate,
  options: AssetUuidNamesOptions,
): Promise<AssetUuidNamesEntry> {
  const base = { kind: 'thumbnail', uid: item.uid, from: item.thumbnail } as const;
  const new52 = thumb52PathFor(item.uid, item.ext);
  if (item.thumbnail === new52) return { ...base, outcome: 'already_uuid' };
  const source = await checkSource(saveFolder, item.thumbnail);
  if (!source.ok) return { ...base, outcome: source.outcome, detail: source.detail };

  // 512px を先に（R2-MAJ-1・relocateBaseMapIcon の前例）。失敗なら 52px を複製せず参照も変えない
  const old512 = thumb512PathFor(item.thumbnail);
  const new512 = thumb512PathFor(new52);
  let created512: string | null = null;
  if (old512 && new512) {
    const large = await checkSource(saveFolder, old512);
    if (large.ok) {
      const copied = await copyVerified(large.abs, abs(saveFolder, new512));
      if (!copied.ok) return { ...base, to: new52, outcome: 'copy_failed', detail: `512px: ${copied.detail}` };
      if (copied.created) created512 = abs(saveFolder, new512);
    } else if (large.outcome === 'outside_folder') {
      return { ...base, to: new52, outcome: 'copy_failed', detail: `512px: ${large.detail}` };
    }
  }
  const copied52 = await copyVerified(source.abs, abs(saveFolder, new52));
  if (!copied52.ok) {
    // この件で overwrite: false で作った new512 に限って消す（旧ファイル・既にあったファイルには触れない）
    if (created512) await fs.remove(created512).catch(() => undefined);
    return { ...base, to: new52, outcome: 'copy_failed', detail: `52px: ${copied52.detail}` };
  }
  options.__beforeSwap?.(item.uid, 'thumbnail');
  const swapped = compareAndSwap(db, 'base_maps', item.uid, (data) =>
    data.thumbnail === item.thumbnail ? { ...data, thumbnail: new52 } : null,
  );
  if (!swapped) return { ...base, to: new52, outcome: 'cas_mismatch', detail: 'orphan copy kept' };
  return { ...base, to: new52, outcome: 'migrated' };
}

export async function runAssetUuidNamesColdBoot(
  db: DatabaseSync,
  saveFolder: string,
  markerId: string,
  options: AssetUuidNamesOptions = {},
): Promise<AssetUuidNamesResult> {
  const summary = emptySummary();
  const entries: AssetUuidNamesEntry[] = [];
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(markerId)) {
    return { skipped: 'marker', summary, entries };
  }
  const markDone = () => db.prepare('INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)').run(markerId);

  // 1. 収集（§4.2 の 1）
  const apps = collectApps(db);
  const baseMaps = collectBaseMaps(db);
  if (apps.length + baseMaps.length === 0) {
    markDone();
    return { summary, entries };
  }
  if (!saveFolder) {
    console.warn('[AssetUuidNamesMigration] save folder is not set; will retry on next start');
    return { skipped: 'no-save-folder', summary, entries };
  }

  // 3. 共有の検出を先に（§4.2 の 3・R2-MIN-3）。複製元の正規化した相対パス → 参照の一覧（uid の昇順）
  const groups = new Map<string, AppCandidate[]>();
  for (const ref of apps) {
    const key = path.posix.normalize(ref.rel);
    groups.set(key, [...(groups.get(key) ?? []), ref]);
  }
  for (const ref of apps) {
    const group = groups.get(path.posix.normalize(ref.rel))!;
    const shared = group.length > 1;
    // 共有なら、最初の参照だけが「既に UUID の形なら移行しない」。それ以外は（UUID の形でも）複製する
    const keepAsIs = shared ? group[0] === ref && isUuidForm(ref) : isUuidForm(ref);
    entries.push(await migrateApp(db, saveFolder, ref, shared, keepAsIs, options));
  }
  // ベースマップは複製先が自分の uid 名なので、共有は自動的に解ける（共有の表に入れない）
  for (const item of baseMaps) {
    entries.push(await migrateBaseMap(db, saveFolder, item, options));
  }

  for (const entry of entries) summary[entry.outcome] += 1;
  // 7. 報告（失敗しても移行を失敗させない）
  await mergeAssetUuidNamesReport(saveFolder, { lastRunAt: new Date().toISOString(), summary, entries });
  // 印は最後に（途中で落ちたら次の起動でやり直す。やり直しは複製の冪等で安全）
  markDone();
  return { summary, entries };
}
