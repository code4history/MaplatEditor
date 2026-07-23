// M13-T3: slug originals -> UUID originals の one-shot migration/report。
// 既存 migration-report-v2.json (renamedSlugs/renamedFiles/warnings) の top-level フィールドは
// 一切変更せず、originalsUuidMigration フィールドだけを additive merge する。
// タスク設計 `docs/superpowers/specs/2026-07-24-m13-t3-originals-migration-design.md` §5.2 準拠。
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

interface LegacyReportShape {
    renamedSlugs: unknown[];
    renamedFiles: unknown[];
    warnings: unknown[];
}

const REPORT_FILE = 'migration-report-v2.json';
const LEGACY_DEFAULTS: LegacyReportShape = { renamedSlugs: [], renamedFiles: [], warnings: [] };

// マイルストーン §4.6: 既存 top-level field(renamedSlugs/renamedFiles/warnings)を保持し、
// originalsUuidMigration だけを additive merge する。direct writeJson() ではなく
// same directory temp write -> file fsync -> atomic rename -> parent directory fsync を使う。
// 既存ファイルの parse 失敗時は上書きせず warn して諦める(migration自体は継続する。
// 呼び出し元は本関数の失敗を migration 全体の失敗にしないこと)
export async function mergeAndWriteReport(saveFolder: string, detail: OriginalsUuidMigrationDetail): Promise<void> {
    const reportPath = path.join(saveFolder, REPORT_FILE);
    let base: LegacyReportShape = LEGACY_DEFAULTS;
    if (await fs.pathExists(reportPath)) {
        try {
            base = JSON.parse(await fsPromises.readFile(reportPath, 'utf8'));
        } catch (e) {
            console.warn(`[MigrationReportService] failed to parse existing ${REPORT_FILE}; leaving it untouched`, e);
            return; // §4.6: 上書きしない。M13 detail 更新のみ諦める
        }
    }
    const merged = { ...base, originalsUuidMigration: detail };

    // 同一ディレクトリの固定名 temp を使う(SI-5準拠の "same-directory" 要件。乱数名にしないのは、
    // クラッシュ後に残っても次回実行で上書き・rename され自然に解消するため、専用cleanupが
    // 不要になる単純さを優先した設計判断)
    const tempPath = path.join(saveFolder, `${REPORT_FILE}.m13tmp`);
    try {
        const fh = await fsPromises.open(tempPath, 'w');
        try {
            await fh.writeFile(JSON.stringify(merged, null, 2));
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
