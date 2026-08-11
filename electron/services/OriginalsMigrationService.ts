// M13-T3: slug originals -> UUID originals の one-shot migration/report。
// タスク設計 `docs/superpowers/specs/2026-07-24-m13-t3-originals-migration-design.md` §5.1/§5.6 準拠。
//
// §4.1 の実測制約: migrate(db) の実行は「getDb() の初期化 Promise がまだ resolve していない」
// 区間の内部で起きる。したがって migrate(db) の中から SqliteDataService.getDb()(またはそれを
// 内部で呼ぶ readAllMaps() 等の任意のメソッド)を呼ぶと、ResettableSingleFlight.get() が
// 同一 key の進行中 Promise をそのまま await して返すため、自分自身の完了を待つ自己デッドロック
// になる。よって cold-boot 経路は runColdBoot(db) の引数として渡される db を直接使い、
// SqliteDataService.* の getDb() 経由メソッドを一切呼ばない。循環 import を避けるため
// SqliteDataService.ts は import しない(§4.7、§5.3: SqliteDataService.ts -> 本ファイルの
// 一方向 import のみ)。
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs-extra';
import { promises as fsPromises } from 'fs';
import { BrowserWindow } from 'electron';
import SettingsService from './SettingsService';
import MapMutationQueue from './MapMutationQueue';
import { classifyMigrationCandidate, type MigrationCandidateKind } from './MapOriginalImageService';
import { mergeAndWriteReport, type OriginalsUuidMigrationEntry } from './MigrationReportService';

export type MigrationRunMode = 'startup' | 'manual';

// v1.1 (レビュー v1 Minor 4): summary のキー集合を outcome union
// (Exclude<MigrationCandidateKind,'copyable'> | 'migrated' | 'copy_failed') に整合させる
export interface MigrationRunResult {
    mode: MigrationRunMode;
    summary: Record<Exclude<MigrationCandidateKind, 'copyable'> | 'migrated' | 'copy_failed', number>;
    entries: OriginalsUuidMigrationEntry[];
}

interface MapRow { uid: string; slug: string; data_json: string }

function extractImageExtensionHint(dataJson: string): string | undefined {
    try {
        const data = JSON.parse(dataJson);
        return data.imageExtension || data.imageExtention || undefined;
    } catch {
        return undefined; // 壊れた data_json は extHint 無しとして扱う(classify側の allowed set 判定に委ねる)
    }
}

// §5.6: 大容量画像(実データ実測で最大561MB、m13-t2設計§6.4)を含む copy-only migration が
// 長時間かかる場合に備え、既存 sendMigrationProgress (SqliteDataService.ts 559-563行)と同じ
// パターンで進捗を通知する。OriginalsMigrationService.ts は SqliteDataService.ts を import
// しない設計判断(§4.7/§5.3)のため、同等の小関数をここに複製する。
function sendMigrationProgress(text: string, percent: number, progress: string = ''): void {
    BrowserWindow.getAllWindows().forEach((win: any) => {
        win.webContents.send('app:taskProgress', { text, percent, progress });
    });
}

// Minor 2 (milestone review v6): 並走 run が step1 の temp cleanup で互いの
// in-flight temp を壊さないよう、run 全体を single-flight 化する。globalThis 保持で
// HMR 越しにも1本化する(MapMutationQueue と同じパターン)。二重起動は「同じ結果に
// 相乗り」させ、新しい二重の run は開始しない
function getGlobalInFlight(): { promise: Promise<MigrationRunResult> | null } {
    const g = globalThis as any;
    g.__maplatM13OriginalsMigrationInFlight ??= { promise: null };
    return g.__maplatM13OriginalsMigrationInFlight;
}

// v1.1 (レビュー v1 Major 2): copyable 判定 map の copy 手順(fs.copyFile/open+sync/rename)は
// ディスク満杯・権限・OneDrive ファイルロック(既存コード内に実在既知の環境)等で失敗し得る。
// per-map 処理全体を try/catch し、失敗は 'copy_failed' outcome の entry として記録して
// 次の map の処理を継続する(既存 one-shot 群 runThumbnail512MiningIfNeeded の
// 「個別失敗を warnings へ蓄積して継続」方針への整合。§4.2 参照)。
async function runInternal(rows: MapRow[], mode: MigrationRunMode): Promise<MigrationRunResult> {
    const saveFolder = SettingsService.get('saveFolder') as string;
    const originalFolder = path.join(saveFolder, 'originals');
    const tmpRoot = path.join(originalFolder, '.m13-tmp');

    // 手順1: 前回 crash の残留 temp を掃除する (SI-3)。originals/ 自体が無いsaveFolder
    // (地図0件の新規環境)でも安全に no-op する。
    // v1.1 (Major 2c): cleanup 自体の失敗(権限等)も migration 全体を失敗させない。
    // 失敗しても後続の per-map copy は tempPath 個別の open/copyFile 失敗として
    // 各 map の try/catch で捕捉されるため、cleanup 失敗を握りつぶして続行してよい
    try {
        await fs.ensureDir(tmpRoot);
        const staleTemps = await fs.readdir(tmpRoot).catch(() => [] as string[]);
        await Promise.all(
            staleTemps.filter((f) => f.endsWith('.m13tmp')).map((f) => fs.remove(path.join(tmpRoot, f)).catch(() => { })),
        );
    } catch (e) {
        console.error(`[OriginalsMigrationService] stale temp cleanup failed for ${tmpRoot}; continuing without cleanup`, e);
    }

    // rows.length === 0 の場合はここで打ち切る(手順1のcleanupのみ行い、reportは書かない。
    // 既存 thumbnail-512 mining の「対象0件」パターンに倣うが、reportを書かない点は
    // 「移行を実際に実行した時だけ書く」既存 legacy migration の精神とも整合する。
    // マイルストーン §4.5.3 手順7[無条件記述]からの軽微な逸脱だが、新規空環境に report
    // ファイルを作らない合理的判断としてレビュー v1 Info 5 で支持された挙動を維持する)
    if (rows.length === 0) {
        return { mode, summary: {} as Record<Exclude<MigrationCandidateKind, 'copyable'> | 'migrated' | 'copy_failed', number>, entries: [] };
    }

    const entries: OriginalsUuidMigrationEntry[] = [];
    const summary: Record<string, number> = {};

    // 進捗通知: copyable 判定の map が1件以上ある場合のみ送る(既存 thumbnail-512 mining の
    // targets.length===0 早期returnパターンに倣う)。classify を queue の外で事前実行して
    // 「送るべきか」を判定すると二重 classify になり無駄な I/O が増えるため、queue クロージャ内の
    // 実処理結果(entry.outcome が 'migrated'/'copy_failed' = classify が copyable と判定して
    // 実際に copy を試みたことを意味する)を単一パスでそのまま進捗トリガーに使う。
    // 最初の copy 試行を検知した時点で 0% を送り、以降は行進捗を送る(§5.6 の
    // 「copyable 1件以上のときだけ送る」契約は同値だが、事前スキャンなしで満たせる)。
    let progressStarted = false;

    // 手順2-4: map ごとに MapMutationQueue で直列化しながら classify + 実行する。
    // 逐次(for...of + await)で処理する: 並行実行による一時的な I/O 競合や、
    // 大容量画像(実データ実測で最大561MB, m13-t2設計§6.4)の同時コピーによる
    // メモリ/ディスク帯域圧迫を避ける単純さを優先する
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const extHint = extractImageExtensionHint(row.data_json);
        // 設計上の必須制約: classify と 実際の copy は同一の MapMutationQueue.run() クロージャの
        // 中で行う。classify を queue の外で先に呼ぶと、queue に入るまでの間に別の
        // save()/rename()/clone()/delete() が同じ uid の canonical/legacy ファイルを変更し得て
        // TOCTOU (classify 結果が古いまま copy を実行してしまう) になる。
        //
        // 既知の限界(v1.1, レビュー v1 Minor 5): row.slug/extHint は run 開始時に列挙した
        // snapshot であり、queue に入るまでの間に別 uid の rename で slug 空間が変化し得る
        // (cold-boot 中はユーザー操作不可のため実質 manual run のみ想定)。誤内容 copy に至る
        // 条件は極端に人為的(run 中に slug を解放し別 map が同 slug の legacy ファイルを持つ)
        // であり、source 非破壊・後続 run の skip_target_conflict で表面化するため、本設計では
        // db 再読による snapshot 再検証は行わず既知の限界として記録するに留める。
        const entry = await MapMutationQueue.run(row.uid, 'originals-migration', async () => {
            try {
                const candidate = await classifyMigrationCandidate(row.uid, row.slug, extHint);
                if (candidate.kind !== 'copyable') {
                    return { uid: row.uid, slug: row.slug, outcome: candidate.kind, sourcePath: candidate.sourcePath, targetPath: candidate.targetPath, detail: candidate.reason };
                }
                // 手順4 (copyable のみ): temp copy -> fsync -> same-dir atomic rename -> parent fsync
                const tempPath = path.join(tmpRoot, `${row.uid}.${candidate.ext}.m13tmp`);
                await fs.copyFile(candidate.sourcePath!, tempPath);
                const tempHandle = await fsPromises.open(tempPath, 'r+');
                try { await tempHandle.sync(); } finally { await tempHandle.close(); }
                await fsPromises.rename(tempPath, candidate.targetPath!); // classify直後・同一queueターンのため
                // exact target 不在は保証済み(TOCTOUなし)
                try {
                    const dirHandle = await fsPromises.open(originalFolder, 'r');
                    try { await dirHandle.sync(); } finally { await dirHandle.close(); }
                } catch { /* ディレクトリ fsync 非対応環境(一部Windows等)への配慮。rename自体の成否には無関係 */ }
                return { uid: row.uid, slug: row.slug, outcome: 'migrated' as const, sourcePath: candidate.sourcePath, targetPath: candidate.targetPath };
            } catch (e: any) {
                // v1.1 (Major 2): 単一 map の I/O 失敗(ディスク満杯・権限・OneDrive ファイルロック等)で
                // migration 全体・ひいては getDb()/アプリ起動を失敗させない。失敗を記録して次の map へ進む
                const msg = e?.message ?? String(e);
                console.error(`[OriginalsMigrationService] copy_failed: uid=${row.uid} slug=${row.slug}: ${msg}`, e);
                return { uid: row.uid, slug: row.slug, outcome: 'copy_failed' as const, detail: msg };
            }
        });
        entries.push(entry);
        summary[entry.outcome] = (summary[entry.outcome] ?? 0) + 1;
        if (entry.outcome === 'skip_ambiguous_legacy' || entry.outcome === 'skip_target_conflict' || entry.outcome === 'copy_failed') {
            // 人間が後で手動解決できるよう、識別可能な形で残す(端末ログ + report entries の両方。
            // §5.5 のとおり top-level warnings へは積まない=起動毎の再通知/モーダル再表示を避ける)
            console.warn(`[OriginalsMigrationService] ${entry.outcome}: uid=${entry.uid} slug=${entry.slug} ${entry.detail ?? ''}`);
        }
        if (entry.outcome === 'migrated' || entry.outcome === 'copy_failed') {
            if (!progressStarted) {
                progressStarted = true;
                sendMigrationProgress('database.migrating_originals', 0);
            }
            const percent = Math.round(((i + 1) / rows.length) * 100);
            sendMigrationProgress('database.migrating_originals', percent);
        }
    }

    if (progressStarted) sendMigrationProgress('database.migrating_originals_done', 100);

    const result: MigrationRunResult = { mode, summary: summary as Record<Exclude<MigrationCandidateKind, 'copyable'> | 'migrated' | 'copy_failed', number>, entries };

    // 手順7: report を additive merge + atomic write する(unconditional。§4.6/§5.2)。
    // mergeAndWriteReport() 自体の失敗は関数内部で catch され migration を失敗させない(§5.2)
    await mergeAndWriteReport(saveFolder, {
        designVersion: '2.0',
        lastRunAt: new Date().toISOString(),
        mode,
        summary: result.summary,
        entries: result.entries,
    });

    return result;
}

// v1.1 (Major 4): rows.length === 0 のケースも runInternal 内部で処理するため、
// runColdBoot/runManual のどちらの呼び出しも例外なく runWithSingleFlight を経由する。
// これにより 0 件パスが in-flight run の存在確認を迂回して temp cleanup を実行する
// 反例(§12.1 の解決主張・AC-T3-6 との自己矛盾)を解消し、cleanup コードの重複(DRY 違反)も
// 解消される
async function runWithSingleFlight(rows: MapRow[], mode: MigrationRunMode): Promise<MigrationRunResult> {
    const inFlight = getGlobalInFlight();
    if (inFlight.promise) return inFlight.promise; // 相乗り: 新しい run は開始しない
    const p = runInternal(rows, mode).finally(() => {
        if (inFlight.promise === p) inFlight.promise = null;
    });
    inFlight.promise = p;
    return p;
}

// cold-boot 専用エントリポイント。SqliteDataService.migrate(db) の最終ステップから、
// db を直接受け取って呼ぶこと。SqliteDataService.getDb()/readAllMaps() 等の getDb() 経由
// メソッドを内部で一切呼んではならない(§4.1: 呼ぶと自己デッドロックする)
export async function runColdBoot(db: DatabaseSync): Promise<MigrationRunResult> {
    const rows = db.prepare('SELECT uid, slug, data_json FROM maps').all() as unknown as MapRow[];
    return runWithSingleFlight(rows, 'startup');
}

// 明示実行エントリポイント(menu item から呼ぶ)。呼び出し前に SqliteDataService.getDb() が
// 既に resolve していること(= migrate() が完了済みであること)を呼び出し元が保証する
// (main.ts のmenu handlerはこの前提を満たす。§5.4)
export async function runManual(db: DatabaseSync): Promise<MigrationRunResult> {
    const rows = db.prepare('SELECT uid, slug, data_json FROM maps').all() as unknown as MapRow[];
    return runWithSingleFlight(rows, 'manual');
}
