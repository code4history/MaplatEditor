// アプリの MapLibre GL JS の版（文書の最上位の maplibreMajorVersion）を、値の無い既存のアプリに 5 で書き込む、
// 一回限りの起動時の移行。
//
// 書き出しとプレビューは、値が無ければ 5 系として扱う（providerGlCdn.ts の resolveMaplibreMajor）。この移行は、
// 利用者がアプリを開かなくても「書き出しは常に明示の値で決まる」ことを成り立たせるためのもの。書くのは 5 で、
// 出力も挙動も変わらない（5 系で動いていたものを 5 系と書くだけ）ので、利用者への通知は出さない。
//
// 前例: AssetUuidNamesMigrationService（起動時の一回限り・印・比較と交換・revision と updated_at を進めない）。
// 同じく cold-boot の db を引数で受け、SqliteDataService を import しない（一方向）。
// 印の ID は SqliteDataService.ts の行頭の定数 MAPLIBRE_VERSION_V1_ID が唯一の定義で、引数で受け取る。
//
// 不変条件:
//   - 最上位に maplibreMajorVersion が無い行にだけ 5 を足す。既に値のある行（不正な値を含む）は変えない
//     （不正な値は保存の入口〔SqliteDataService の normalizeAppDocument〕で 5 に直す）
//   - httpSettings・http などの他のキーに触らない（入れ物を作らない。画面と main の読み方を変えない）
//   - revision と updated_at を進めない（開いていた下書きを衝突にしない）
//   - 途中で失敗したら印を付けない（次の起動でもう一度走る。書き終えた行は値があるので飛ばされる）
import type { DatabaseSync } from 'node:sqlite';

export interface MaplibreVersionMigrationOptions {
  /** テスト専用のフック（書き換えの直前）。製品の呼び出しでは渡さない */
  __beforeWrite?: (uid: string) => void;
}

export interface MaplibreVersionMigrationResult {
  skipped?: 'marker';
  written: number;
}

function parse(json: unknown): Record<string, unknown> | null {
  try {
    const value = JSON.parse(String(json ?? ''));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function lacksVersion(data: Record<string, unknown> | null): data is Record<string, unknown> {
  return Boolean(data) && !Object.prototype.hasOwnProperty.call(data, 'maplibreMajorVersion');
}

/** 比較と交換: 書き換えの直前に行を読み直し、まだ値が無ければ 5 を足す。revision・updated_at は書かない */
function writeDefault(db: DatabaseSync, uid: string): boolean {
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT data_json FROM apps WHERE uid = ?').get(uid) as { data_json?: string } | undefined;
    const data = row ? parse(row.data_json) : null;
    const write = lacksVersion(data);
    if (write) {
      db.prepare('UPDATE apps SET data_json = ? WHERE uid = ?').run(JSON.stringify({ ...data, maplibreMajorVersion: 5 }), uid);
    }
    db.exec('COMMIT');
    return write;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* 既に終わっている */ }
    throw e;
  }
}

export async function runMaplibreVersionColdBoot(
  db: DatabaseSync,
  markerId: string,
  options: MaplibreVersionMigrationOptions = {},
): Promise<MaplibreVersionMigrationResult> {
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(markerId)) {
    return { skipped: 'marker', written: 0 };
  }
  const rows = db.prepare('SELECT uid, data_json FROM apps ORDER BY uid').all() as Array<{ uid: string; data_json: string }>;
  let written = 0;
  for (const row of rows) {
    if (!lacksVersion(parse(row.data_json))) continue;
    options.__beforeWrite?.(String(row.uid));
    if (writeDefault(db, String(row.uid))) written++;
  }
  db.prepare('INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)').run(markerId);
  // アプリの中身は書かない（件数だけ）
  console.log(`[MaplibreVersionMigration] wrote maplibreMajorVersion=5 to ${written} app(s)`);
  return { written };
}
