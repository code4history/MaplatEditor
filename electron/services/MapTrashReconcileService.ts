import path from 'path';
import fs from 'fs-extra';
import type { DatabaseSync } from 'node:sqlite';
import SettingsService from './SettingsService';

// M13-T4 (v1.1, レビュー v1 Major 1 の解消): reconcileDeletedMapsTrash() は
// SqliteDataService.migrate() の cold-boot 経路から db を直接渡されて呼ばれる
// (T3 の OriginalsMigrationService.ts と同じ再入制約、§4.5/§4.1)。循環 import を避けるため
// SqliteDataService.ts は import しない(SqliteDataService.ts -> 本ファイルの一方向 import のみ、
// OriginalsMigrationService.ts と同一パターン)。MapDeleteTrashService.ts が SqliteDataService.ts
// を import すること自体とは独立 — 本ファイルは MapDeleteTrashService.ts も import しない
// (2つの新規ファイル間に依存を作らないことで import グラフを最小化する)。

function getFolders() {
    const saveFolder = SettingsService.get('saveFolder') as string;
    return {
        originalFolder: path.join(saveFolder, 'originals'),
        trashMapsRoot: path.join(saveFolder, 'trash', 'maps'),
    };
}

// M13-T4 (AC-T4-5, SI-8): cold-boot 専用。SqliteDataService.migrate(db) から
// db を直接受け取って呼ぶこと。getDb() 経由メソッドを内部で一切呼んではならない
// (T3 §4.1 と同じ再入制約。db.prepare() で raw SQL を直接実行する)
export async function reconcileDeletedMapsTrash(db: DatabaseSync): Promise<void> {
    const { originalFolder, trashMapsRoot } = getFolders();
    let uidDirs: string[];
    try {
        uidDirs = await fs.readdir(trashMapsRoot);
    } catch {
        return; // trash/maps/ 自体が無い(delete が一度も実行されていない環境) — no-op
    }

    for (const uid of uidDirs) {
        const uidDir = path.join(trashMapsRoot, uid);
        let opDirs: string[];
        try {
            opDirs = await fs.readdir(uidDir);
        } catch {
            continue;
        }
        // DB row がまだ存在する = DB delete が完了していない (crash 等)。明白なケースのみ復元する
        const row = db.prepare('SELECT 1 FROM maps WHERE uid = ?').get(uid);
        if (!row) continue; // DB row 不在 = 削除は正しく完了している。trash はそのまま保持する

        for (const operationId of opDirs) {
            const opDir = path.join(uidDir, operationId);
            for (const sub of ['originals', 'legacy']) {
                const subDir = path.join(opDir, sub);
                let files: string[];
                try {
                    files = await fs.readdir(subDir);
                } catch {
                    continue;
                }
                for (const file of files) {
                    const trashedPath = path.join(subDir, file);
                    const livePath = path.join(originalFolder, file);
                    try {
                        if (await fs.pathExists(livePath)) {
                            console.warn(`[MapTrashReconcileService] reconcile: live path already exists, keeping trash copy: ${livePath}`);
                            continue;
                        }
                        await fs.move(trashedPath, livePath, { overwrite: false });
                    } catch (e) {
                        console.error(`[MapTrashReconcileService] reconcile: failed to restore ${trashedPath} -> ${livePath}`, e);
                    }
                }
            }
        }
    }
}
