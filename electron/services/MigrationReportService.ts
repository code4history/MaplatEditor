// M13-T3: slug originals -> UUID originals の one-shot migration/report。
// 既存 migration-report-v2.json (renamedSlugs/renamedFiles/warnings) の top-level フィールドは
// 一切変更せず、originalsUuidMigration フィールドだけを additive merge する。
// タスク設計 `docs/superpowers/specs/2026-07-24-m13-t3-originals-migration-design.md` §5.2 準拠。
// M13-T5: 低レベル atomic write primitive (readReportSafe/writeReportAtomic) をここから
// 切り出し、legacy migration (writeLegacyMigrationReport) / thumbnail-512 mining
// (appendMigrationWarnings) からも再利用する。公開シグネチャ・観測可能な挙動は無変更。
// タスク設計 `docs/superpowers/specs/2026-07-24-m13-t5-migration-pipeline-design.md` §5.1 準拠。
import path from 'path';
import fs from 'fs-extra';
import { promises as fsPromises } from 'fs';
import type { MigrationCandidateKind } from './MapOriginalImageService';

// v1.1 (レビュー v1 Minor 4): union をマイルストーン §4.6 契約
// (Exclude<MigrationCandidateKind,'copyable'> | 'migrated') に整合させ、
// 到達不能な 'copyable' を除外・到達し得る 'migrated' を含め、
// Major 2 で追加した失敗 outcome 'copy_failed' も additive に含める
export interface OriginalsUuidMigrationEntry {
    uid: string;
    slug: string;
    outcome: Exclude<MigrationCandidateKind, 'copyable'> | 'migrated' | 'copy_failed';
    sourcePath?: string;
    targetPath?: string;
    detail?: string;
}

export interface OriginalsUuidMigrationDetail {
    designVersion: '2.0';
    lastRunAt: string;
    mode: 'startup' | 'manual';
    summary: Record<string, number>;
    entries: OriginalsUuidMigrationEntry[];
}

export interface LegacyReportShape {
    renamedSlugs: unknown[];
    renamedFiles: unknown[];
    warnings: unknown[];
}

const REPORT_FILE = 'migration-report-v2.json';
const LEGACY_DEFAULTS: LegacyReportShape = { renamedSlugs: [], renamedFiles: [], warnings: [] };

// M13-T5 §5.1: 既存ファイルを読む。存在しなければ LEGACY_DEFAULTS の複製を返す。
// parse 失敗時は null を返す。
// null 時に abandon する(既存ファイルを上書きせず、その回の更新を諦める)か上書き回復する
// (新しい正しい内容で上書きする)かは呼び出し元のポリシーによる:
//   - mergeAndWriteReport / appendMigrationWarnings は abandon
//     (前者は既存 top-level field を保護する additive merger、後者は既存 warnings 配列への
//     追記が前提のため、既存内容が読めなければ追記自体が成立しない)
//   - writeLegacyMigrationReport は上書き回復
//     (one-shot の legacy report が恒久的に失われることを防ぐため。§5.1 参照)
async function readReportSafe(saveFolder: string): Promise<Record<string, any> | null> {
    const reportPath = path.join(saveFolder, REPORT_FILE);
    if (!(await fs.pathExists(reportPath))) return { ...LEGACY_DEFAULTS };
    try {
        return JSON.parse(await fsPromises.readFile(reportPath, 'utf8'));
    } catch (e) {
        console.warn(`[MigrationReportService] failed to parse existing ${REPORT_FILE}`, e);
        return null;
    }
}

// M13-T5 §5.1: 低レベル atomic write (既存 mergeAndWriteReport の手順3-6をそのまま切り出した
// もの。same directory temp write -> file fsync -> atomic rename -> parent directory fsync。
// 失敗しても throw しない = 呼び出し元を失敗させない)
async function writeReportAtomic(saveFolder: string, content: Record<string, any>): Promise<void> {
    const reportPath = path.join(saveFolder, REPORT_FILE);
    // 同一ディレクトリの固定名 temp を使う(SI-5準拠の "same-directory" 要件。乱数名にしないのは、
    // クラッシュ後に残っても次回実行で上書き・rename され自然に解消するため、専用cleanupが
    // 不要になる単純さを優先した設計判断)
    const tempPath = path.join(saveFolder, `${REPORT_FILE}.m13tmp`);
    try {
        const fh = await fsPromises.open(tempPath, 'w');
        try {
            await fh.writeFile(JSON.stringify(content, null, 2));
            await fh.sync();
        } finally {
            await fh.close();
        }
        await fsPromises.rename(tempPath, reportPath);
        try {
            const dirHandle = await fsPromises.open(saveFolder, 'r');
            try { await dirHandle.sync(); } finally { await dirHandle.close(); }
        } catch { /* ディレクトリ fsync 非対応環境への配慮 */ }
    } catch (e) {
        console.error(`[MigrationReportService] failed to write ${REPORT_FILE}`, e);
        // 書込み失敗は migration 自体を失敗させない(既存 legacy migration の 947-949行と同じ方針)
    }
}

// マイルストーン §4.6: 既存 top-level field(renamedSlugs/renamedFiles/warnings)を保持し、
// originalsUuidMigration だけを additive merge する。direct writeJson() ではなく
// same directory temp write -> file fsync -> atomic rename -> parent directory fsync を使う。
// 既存ファイルの parse 失敗時は上書きせず warn して諦める(abandon。migration自体は継続する。
// 呼び出し元は本関数の失敗を migration 全体の失敗にしないこと)
export async function mergeAndWriteReport(saveFolder: string, detail: OriginalsUuidMigrationDetail): Promise<void> {
    const base = await readReportSafe(saveFolder);
    if (base === null) return; // §4.6/§5.1: 上書きしない(abandon)。M13 detail 更新のみ諦める
    const merged = { ...base, originalsUuidMigration: detail };
    await writeReportAtomic(saveFolder, merged);
}

// M13-T5 §5.1: legacy migration 専用。report は「実際に移行を実行した起動でのみ・1度だけ」
// 書かれる(呼び出し元の one-shot marker により保証される)。既存ファイルが読めれば defensive
// に spread してから自分のフィールドで上書きする(通常は base=LEGACY_DEFAULTS の新規作成)。
// readReportSafe が null (parse失敗)を返した場合、abandon ポリシーを継承せず、旧実装
// (差し替え前の SqliteDataService.ts の直接 fs.writeJson())と同じ「新しい正しい report で
// 上書き回復」を維持する: legacy migration は report ファイルの創出者であり、one-shot の
// ため次回以降再実行されない。ここで abandon すると report が恒久的に失われる。parse失敗＝
// 内容が読めない＝そもそも利用不能なため、上書きで失われる有効な情報はない
// (mergeAndWriteReport/appendMigrationWarnings の abandon とは意図的に非対称)。
export async function writeLegacyMigrationReport(saveFolder: string, report: LegacyReportShape): Promise<void> {
    const base = await readReportSafe(saveFolder);
    const merged = base === null ? { ...report } : { ...base, ...report };
    await writeReportAtomic(saveFolder, merged);
}

// M13-T5 §5.1: thumbnail-512 mining 専用。既存 report を読み、warnings 配列だけへ追記する。
// readReportSafe が null (parse失敗)を返した場合は mergeAndWriteReport と同じ abandon
// ポリシーを適用する(既存 warnings への追記が前提のため、既存内容が読めなければ追記自体が
// 成立しない)
export async function appendMigrationWarnings(saveFolder: string, warnings: string[]): Promise<void> {
    const base = await readReportSafe(saveFolder);
    if (base === null) return; // abandon
    const existingWarnings = Array.isArray(base.warnings) ? base.warnings : [];
    const merged = { ...base, warnings: [...existingWarnings, ...warnings] };
    await writeReportAtomic(saveFolder, merged);
}
