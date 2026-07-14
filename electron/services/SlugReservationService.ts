// Slug Reservation Service (M11-T7)。
// 複数 MaplatEditor instance 間で slug を予約・移動・解放・昇格する機構。
// 予約帰属の正本は asset_uid（§7.2/D2改）。draft_uid は GC の draft 存在判定専用、
// instance_id は lease 管理専用で、いずれも所有判定には使わない。
// electron の app/ipcMain には依存させず、DB 接続・instanceId・now を注入で受ける
// 純関数ファクトリ（createSlugReservationService）にする。これにより service unit が
// electron 起動なしで node 実行でき、本体（SqliteDataService/ipc）は接続と
// crypto.randomUUID() を渡すだけになる。
import type { DatabaseSync } from 'node:sqlite';

export type SlugReservationResult =
  | { result: 'ok' }
  | { result: 'conflict' }
  | { result: 'error'; message: string };

export type SlugCheckResult = 'available' | 'reserved-by-other' | 'taken';

interface Deps {
  db: DatabaseSync;
  instanceId: string;
  now: () => string; // ISO 文字列
  leaseMs?: number;  // 既定 120000 (2分)
}

const LEASE_MS = 120_000;
const GC_STALE_MS = 24 * 60 * 60 * 1000;

export function createSlugReservationService(deps: Deps) {
  const { db, instanceId, now } = deps;
  const leaseMs = deps.leaseMs ?? LEASE_MS;
  const leaseUntil = (): string => new Date(Date.parse(now()) + leaseMs).toISOString();

  // 有効(=lease 未失効)かつ他 asset_uid の予約が存在するか。asset_uid が正本(D2改)。
  const activeOtherOwner = (slug: string, assetUid: string): boolean => {
    const row = db.prepare('SELECT asset_uid, lease_expires_at FROM slug_reservations WHERE slug = ?').get(slug) as any;
    if (!row) return false;
    if (String(row.asset_uid) === assetUid) return false; // 自己所有
    return String(row.lease_expires_at) > now(); // lease 有効な他者
  };

  return {
    reserve(p: { slug: string; assetUid: string; assetKind: string; draftUid: string }): SlugReservationResult {
      try {
        const existing = db.prepare('SELECT asset_uid FROM slug_reservations WHERE slug = ?').get(p.slug) as any;
        if (existing && String(existing.asset_uid) !== p.assetUid) return { result: 'conflict' };
        // 自 asset_uid の既予約は冪等 ok + instance/lease/draft を現 instance へ付け替え(=claim, §7.2)
        db.prepare(
          `INSERT INTO slug_reservations (slug, asset_uid, asset_kind, instance_id, draft_uid, lease_expires_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(slug) DO UPDATE SET
             asset_kind = excluded.asset_kind,
             instance_id = excluded.instance_id,
             draft_uid = excluded.draft_uid,
             lease_expires_at = excluded.lease_expires_at,
             updated_at = excluded.updated_at`
        ).run(p.slug, p.assetUid, p.assetKind, instanceId, p.draftUid, leaseUntil(), now());
        return { result: 'ok' };
      } catch (e: any) {
        return { result: 'error', message: String(e?.message ?? e) };
      }
    },

    move(p: { fromSlug: string | null; toSlug: string; assetUid: string; assetKind: string; draftUid: string }): SlugReservationResult {
      try {
        if (activeOtherOwner(p.toSlug, p.assetUid)) return { result: 'conflict' };
        // 旧予約解放 + 新予約を単一実行(AC15)。個別 DB 呼び出しだが SlugReservationService は
        // 単一接続のため、呼び出し側(save)は withTransaction 内で使う場面のみ。ここは lifecycle 用。
        if (p.fromSlug && p.fromSlug !== p.toSlug) {
          db.prepare('DELETE FROM slug_reservations WHERE slug = ? AND asset_uid = ?').run(p.fromSlug, p.assetUid);
        }
        db.prepare(
          `INSERT INTO slug_reservations (slug, asset_uid, asset_kind, instance_id, draft_uid, lease_expires_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(slug) DO UPDATE SET
             instance_id = excluded.instance_id, draft_uid = excluded.draft_uid,
             lease_expires_at = excluded.lease_expires_at, updated_at = excluded.updated_at`
        ).run(p.toSlug, p.assetUid, p.assetKind, instanceId, p.draftUid, leaseUntil(), now());
        return { result: 'ok' };
      } catch (e: any) {
        return { result: 'error', message: String(e?.message ?? e) };
      }
    },

    release(p: { slug: string; assetUid: string }): void {
      db.prepare('DELETE FROM slug_reservations WHERE slug = ? AND asset_uid = ?').run(p.slug, p.assetUid);
    },

    check(p: { slug: string; excludeUid?: string }): SlugCheckResult {
      const row = db.prepare('SELECT asset_uid, lease_expires_at FROM slug_reservations WHERE slug = ?').get(p.slug) as any;
      if (row && String(row.lease_expires_at) > now() && (p.excludeUid == null || String(row.asset_uid) !== p.excludeUid)) {
        return 'reserved-by-other';
      }
      return 'available'; // registry 側の taken 判定は呼び出し側(isSlugAvailable 合成)が担う
    },

    // save 6 経路が withTransaction 内から呼ぶ promote 検証(D12/D13、IPC 非公開)。
    // 対象 slug の有効予約が「無い」or「asset_uid 一致」なら成立。他 asset_uid の有効予約は conflict。
    promoteWithin(txDb: DatabaseSync, p: { slug: string; assetUid: string }): { ok: true } | { ok: false; reason: 'conflict' } {
      const row = txDb.prepare('SELECT asset_uid, lease_expires_at FROM slug_reservations WHERE slug = ?').get(p.slug) as any;
      if (row && String(row.asset_uid) !== p.assetUid && String(row.lease_expires_at) > now()) {
        return { ok: false, reason: 'conflict' };
      }
      // 成立: 自 asset_uid の予約を消化(registry unique 制約が最終防衛)
      txDb.prepare('DELETE FROM slug_reservations WHERE slug = ? AND asset_uid = ?').run(p.slug, p.assetUid);
      return { ok: true };
    },

    // 自 instance の予約 lease を一括更新(main の 30 秒 timer から呼ぶ)。
    renewOwn(): void {
      db.prepare('UPDATE slug_reservations SET lease_expires_at = ?, updated_at = ? WHERE instance_id = ?')
        .run(leaseUntil(), now(), instanceId);
    },

    // GC(D4): lease 失効 かつ draft なし かつ updated_at から 24h 経過の予約を削除。
    gc(opts: { draftExists: (kind: string, draftUid: string | null) => boolean }): void {
      const rows = db.prepare('SELECT slug, asset_kind, draft_uid, lease_expires_at, updated_at FROM slug_reservations').all() as any[];
      const nowStr = now();
      const staleBefore = new Date(Date.parse(nowStr) - GC_STALE_MS).toISOString();
      for (const row of rows) {
        const leaseLive = String(row.lease_expires_at) > nowStr;
        if (leaseLive) continue;
        if (opts.draftExists(String(row.asset_kind), row.draft_uid == null ? null : String(row.draft_uid))) continue;
        if (String(row.updated_at) > staleBefore) continue; // 24h 未経過は保持
        db.prepare('DELETE FROM slug_reservations WHERE slug = ?').run(row.slug);
      }
    },
  };
}

export type SlugReservationService = ReturnType<typeof createSlugReservationService>;
