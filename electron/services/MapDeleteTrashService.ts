import path from 'path';
import fs from 'fs-extra';
import { shell } from 'electron';
import SettingsService from './SettingsService';
import SqliteDataService from './SqliteDataService';
import MapMutationQueue from './MapMutationQueue';
import { resolveDeletionTargets } from './MapOriginalImageService';

// M12-T18: この import 構造は正当であり循環しない —
// MapDeleteTrashService.ts -> SqliteDataService.ts の一方向 import のみで、
// SqliteDataService.ts は本ファイルを import しない。

function getFolders() {
    const saveFolder = SettingsService.get('saveFolder') as string;
    return {
        tileFolder: path.join(saveFolder, 'tiles'),
        thumbFolder: path.join(saveFolder, 'tmbs'),
    };
}

// M12-T18 (SI-4 OS Trash Delegation): 地図削除時の originals 退避先を、独自 trash
// ディレクトリ (m13-t4) から Electron `shell.trashItem` による OS ゴミ箱へ変更する。
// - 順序は「DB delete 先行 → 成功後にのみ trashItem」。DB delete 失敗時はファイルを
//   一切動かしていないため rethrow のみで足りる (rollback 機構は構造的に不要 = 撤去済み)。
// - trashItem の個別失敗 (対象消滅・権限・ゴミ箱を持てないボリューム等) は per-file
//   try/catch で warn + live 残置とし、削除処理全体は継続する (trashItem は失敗時に
//   元位置残置の非破壊であることを実測済み。設計 §4.1/§4.2)。
// - ambiguous legacy (同 slug 2件以上) は対象にせず live 残置 + warning (従来どおり)。
// - tiles / tmbs / tmbs _512 は originals から再生成可能な派生物のため OS ゴミ箱に
//   入れず、従来どおり fs.remove の直接削除を維持する (設計 §5.4)。
// - 誤削除の救済は OS ゴミ箱 (Finder の「戻す」等) へ委譲する。復元位置はアプリから
//   制御できず、DB row は復元されない (画像救済のみ。設計 §5.2)。
export async function deleteMapWithTrash(uidOrMapID: string): Promise<void> {
    const doc = await SqliteDataService.findMapByRef(uidOrMapID);
    const fileKey = doc?.uid || uidOrMapID;
    // 実装レビュー v1 で確定した MapDataService.deleteMap() の意図的 no-op ガードを踏襲する
    // (m13-t2 実装レビュー v1 Minor 1、originals/ の dotfile 誤削除防止)
    if (!fileKey) return;

    return MapMutationQueue.run(fileKey, 'map-delete', async () => {
        const { tileFolder, thumbFolder } = getFolders();
        const slug = doc?.slug || uidOrMapID;

        // 削除対象の解決はファイルを動かさない読み取りのみ (resolveDeletionTargets)。
        // trashItem は常に絶対パスのみを受け取る契約 (設計 §4.1: 相対パスは cwd 基準で
        // 解決されるため禁止。resolveDeletionTargets は絶対パスを返す)
        const trashTargets: string[] = [];
        if (doc) {
            const { canonicalPaths, legacyPath, legacyCandidateCount } = await resolveDeletionTargets(fileKey, slug);
            // ambiguous legacy (2件以上) は対象にせず live に残置する。何が起きたか運用者が
            // 追跡できるよう warning を残す (m13-t4 からの挙動維持、AC18-5)
            if (legacyCandidateCount >= 2) {
                console.warn(`[MapDeleteTrashService] delete: ambiguous legacy originals for uid=${fileKey} slug=${slug} (candidates=${legacyCandidateCount}); leaving all legacy files in place (not moved to the OS trash)`);
            }
            for (const c of canonicalPaths) trashTargets.push(c.path);
            if (legacyPath) trashTargets.push(legacyPath.path);
        }

        // DB delete を先行させる (M12-T18)。失敗時はこの時点で何もファイルを動かして
        // いないため rethrow のみ (利用者には従来どおり DiagnosticFeedback で表示される)
        if (doc) await SqliteDataService.deleteMap(doc.uid);

        // DB 成功後にのみ、対象ファイルごとに OS ゴミ箱へ移す (per-file best-effort)。
        // 失敗した対象は live (originals/) に孤児として残る非破壊側の帰結であり、
        // 自動後始末機構は作らない (設計 §5.1/§5.3)
        for (const target of trashTargets) {
            try {
                await shell.trashItem(target);
            } catch (e) {
                console.warn(`[MapDeleteTrashService] failed moving original to the OS trash; leaving it in place: ${target}`, e);
            }
        }

        // DB success 後: tiles/tmbs/tmbs_512 を best-effort で削除する。失敗しても warning のみ、
        // rollback しない
        const tileDir = path.join(tileFolder, fileKey);
        try { if (await fs.pathExists(tileDir)) await fs.remove(tileDir); }
        catch (e) { console.warn(`[MapDeleteTrashService] failed to remove tile dir: ${tileDir}`, e); }

        const thumbFile = path.join(thumbFolder, `${fileKey}.jpg`);
        try { if (await fs.pathExists(thumbFile)) await fs.remove(thumbFile); }
        catch (e) { console.warn(`[MapDeleteTrashService] failed to remove thumbnail: ${thumbFile}`, e); }

        const thumb512File = path.join(thumbFolder, `${fileKey}_512.jpg`);
        try { if (await fs.pathExists(thumb512File)) await fs.remove(thumb512File); }
        catch (e) { console.warn(`[MapDeleteTrashService] failed to remove 512 thumbnail: ${thumb512File}`, e); }
    });
}
