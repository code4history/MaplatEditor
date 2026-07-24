import path from 'path';
import fs from 'fs-extra';
import { randomUUID } from 'node:crypto';
import SettingsService from './SettingsService';
import SqliteDataService from './SqliteDataService';
import MapMutationQueue from './MapMutationQueue';
import { resolveDeletionTargets } from './MapOriginalImageService';

// M13-T4 (v1.1、レビュー v1 Major 1 の解消): この import 構造は正当であり循環しない —
// MapDeleteTrashService.ts -> SqliteDataService.ts の一方向 import のみで、
// SqliteDataService.ts は本ファイルを import しない (reconcile 関連の呼び出しは
// MapTrashReconcileService.ts 経由。同ファイル参照)。

interface TrashMoveRecord { from: string; to: string }

function getFolders() {
    const saveFolder = SettingsService.get('saveFolder') as string;
    return {
        saveFolder,
        tileFolder: path.join(saveFolder, 'tiles'),
        thumbFolder: path.join(saveFolder, 'tmbs'),
        trashMapsRoot: path.join(saveFolder, 'trash', 'maps'),
    };
}

async function moveToTrash(filePath: string, trashPath: string, moved: TrashMoveRecord[]): Promise<void> {
    await fs.ensureDir(path.dirname(trashPath));
    await fs.move(filePath, trashPath, { overwrite: false });
    moved.push({ from: filePath, to: trashPath });
}

// DB delete 失敗時のロールバック。live 側に既に何か存在する場合は上書きしない
// (別 mutation が queue 直列化を経ずに割り込むことは無いはずだが、防御的に確認する)
async function rollbackMoves(moved: TrashMoveRecord[]): Promise<void> {
    for (const m of [...moved].reverse()) {
        try {
            if (!(await fs.pathExists(m.from)) && (await fs.pathExists(m.to))) {
                await fs.move(m.to, m.from, { overwrite: false });
            }
        } catch (e) {
            console.error(`[MapDeleteTrashService] rollback move failed: ${m.to} -> ${m.from}`, e);
        }
    }
}

// M13-T4 (AC-T4-3/4): canonical (uid キー、複数拡張子variant全て) と、一意対応すると
// 判定できた legacy (basenameがslugと完全一致する候補がちょうど1件) だけを
// `trash/maps/<uid>/<operationId>/` へ move してから DB delete する。
// DB delete 失敗時のみ live へロールバックする。DB success 後の trash は保持し、
// 自動 purge しない (SI-4)。既存 ImageAssetService._trash パターン (DB delete が先)
// とは意図的に順序を逆にしている (§4.4 参照: map originals の復元コスト高に基づく判断)
export async function deleteMapWithTrash(uidOrMapID: string): Promise<void> {
    const doc = await SqliteDataService.findMapByRef(uidOrMapID);
    const fileKey = doc?.uid || uidOrMapID;
    // 実装レビュー v1 で確定した MapDataService.deleteMap() の意図的 no-op ガードを踏襲する
    // (m13-t2 実装レビュー v1 Minor 1、originals/ の dotfile 誤削除防止)
    if (!fileKey) return;

    return MapMutationQueue.run(fileKey, 'map-delete', async () => {
        const { tileFolder, thumbFolder, trashMapsRoot } = getFolders();
        const slug = doc?.slug || uidOrMapID;
        const moved: TrashMoveRecord[] = [];

        if (doc) {
            const operationId = randomUUID();
            const trashRoot = path.join(trashMapsRoot, fileKey, operationId);
            const { canonicalPaths, legacyPath, legacyCandidateCount } = await resolveDeletionTargets(fileKey, slug);
            // v1.1 (AC-T4-3(c), レビュー v1 Major 2): ambiguous legacy (2件以上) は move せず
            // live に残置する (milestone §4.7.3 手順3)。何が起きたか運用者が追跡できるよう warning を残す
            if (legacyCandidateCount >= 2) {
                console.warn(`[MapDeleteTrashService] delete: ambiguous legacy originals for uid=${fileKey} slug=${slug} (candidates=${legacyCandidateCount}); leaving all legacy files in place (not moved to trash)`);
            }
            for (const c of canonicalPaths) {
                try {
                    await moveToTrash(c.path, path.join(trashRoot, 'originals', path.basename(c.path)), moved);
                } catch (e) {
                    console.error(`[MapDeleteTrashService] failed moving canonical to trash: ${c.path}`, e);
                }
            }
            if (legacyPath) {
                try {
                    await moveToTrash(legacyPath.path, path.join(trashRoot, 'legacy', path.basename(legacyPath.path)), moved);
                } catch (e) {
                    console.error(`[MapDeleteTrashService] failed moving legacy to trash: ${legacyPath.path}`, e);
                }
            }
        }

        try {
            if (doc) await SqliteDataService.deleteMap(doc.uid);
        } catch (e) {
            console.error('[MapDeleteTrashService] DB delete failed; rolling back trash moves', e);
            await rollbackMoves(moved);
            throw e;
        }

        // DB success 後: tiles/tmbs/tmbs_512 を best-effort で削除する。失敗しても warning のみ、
        // rollback しない (milestone §4.7.3 手順7)。既存実装が削除し忘れていた `_512.jpg` も
        // ここで削除する (§4.3 で確認した既存バグの是正)
        const tileDir = path.join(tileFolder, fileKey);
        try { if (await fs.pathExists(tileDir)) await fs.remove(tileDir); }
        catch (e) { console.warn(`[MapDeleteTrashService] failed to remove tile dir: ${tileDir}`, e); }

        const thumbFile = path.join(thumbFolder, `${fileKey}.jpg`);
        try { if (await fs.pathExists(thumbFile)) await fs.remove(thumbFile); }
        catch (e) { console.warn(`[MapDeleteTrashService] failed to remove thumbnail: ${thumbFile}`, e); }

        const thumb512File = path.join(thumbFolder, `${fileKey}_512.jpg`);
        try { if (await fs.pathExists(thumb512File)) await fs.remove(thumb512File); }
        catch (e) { console.warn(`[MapDeleteTrashService] failed to remove 512 thumbnail: ${thumb512File}`, e); }
        // trash は保持する (SI-4)。ここでは何もしない
    });
}
