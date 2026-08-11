/**
 * mapupload.ts
 * 旧実装 backend/src/mapupload.js の IPC ハンドラ部分の TypeScript 移植版
 *
 * 主な変更点:
 * - ipcMain.on + ev.reply → ipcMain.handle (Promise化)
 * - プログレスは webContents.send('mapedit:taskProgress', ...) で送信
 * - M12-T20: staging を揮発 tmp から永続 draft-tiles/{assetUid} へ移行（設計 §5.1）。
 *   staging dir は共通バリデータ（draftTilePaths.resolveDraftTileDir）でのみ解決する
 * - M5-T8: 取り込み前の確認往復（設計 §5.6）。同一チャネルへ `confirmed` を載せて再送する
 *   （`useRevisionedAssetSave` の revision 衝突と同形＝既存デザイン踏襲）
 */
import { ipcMain, BrowserWindow } from 'electron';
import { selectMapImage, imageCutter } from '../services/MapUploadService';
import { draftTileRoot, resolveDraftTileDir } from '../services/draftTilePaths';

/**
 * M5-T8: 確認待ちの選択を保持する（設計 §5.6）。
 *
 * なぜ main 側に持つのか: 確認 OK のあとにファイル選択ダイアログを再表示させないため。
 * **renderer からファイルパスを受け取る形にはしない** — 任意パスの読み取り口を新設しない。
 *
 * なぜ webContents ごとなのか: 本アプリは複数ウィンドウを持つ
 * （`useRevisionedAssetSave` の「他ウィンドウで先に更新されている」分岐が実在の前提）。
 * 単一スロットにすると、ウィンドウ A の確認がウィンドウ B の選択を拾ってしまう。
 */
const pendingSelections = new Map<number, { filePath: string; draftAssetUid: string }>();

export function registerMapUploadHandlers() {
    // 旧実装: ipcMain.on('mapupload_showMapSelectDialog', ...)
    ipcMain.handle(
        'mapupload:showMapSelectDialog',
        async (event, mapImageLabel: string, draftAssetUid: string, confirmed?: boolean) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (!win) throw new Error('BrowserWindow not found');

            // M12-T20 (§5.0): ダイアログ表示・fs 操作の前に staging dir を解決。null なら即時 err
            // （正規 UI からは発生しない — uid はアプリ採番 uuid — ため防御専用。renderer は
            // 既存 err 経路で mapedit.error_image_upload を表示する）
            const stagingDir = resolveDraftTileDir(draftTileRoot, draftAssetUid);
            if (!stagingDir) {
                return { err: 'invalid draftAssetUid' };
            }

            const senderId = event.sender.id;

            // M5-T8: 確認 OK の再送。**ダイアログを出さず**保持済みの選択で続行する。
            if (confirmed) {
                const pending = pendingSelections.get(senderId);
                if (!pending || pending.draftAssetUid !== draftAssetUid) {
                    // **不一致では保持を捨てない。** 捨てると、無関係な（あるいは順序の狂った）
                    // 確認1回で正当な選択が消え、利用者はファイル選択からやり直しになる。
                    // 保持は webContents 単位で、次の選択が来れば上書きされ、ウィンドウ破棄で
                    // 消えるため、残しても増え続けない（AC21）。
                    // また黙って選び直させない — 利用者が確認した対象と実際に処理する対象が
                    // ずれる方が危険なので、失効は失効として renderer へ返す
                    return { err: 'stale confirmation', errorCode: 'stale_confirmation' };
                }
                // 一致したときだけ消費する（同じ確認を二度使えないようにする）
                pendingSelections.delete(senderId);
                return await imageCutter(win, pending.filePath, stagingDir, { confirmed: true });
            }

            const filePath = await selectMapImage(win, mapImageLabel);
            if (filePath === null) {
                return { err: 'Canceled' };
            }
            const result = await imageCutter(win, filePath, stagingDir);
            if ('needsConfirmation' in result) {
                pendingSelections.set(senderId, { filePath, draftAssetUid });
                // ウィンドウが閉じられたら保持を捨てる（破棄済みウィンドウのエントリを残さない）
                if (typeof (event.sender as any).once === 'function') {
                    (event.sender as any).once('destroyed', () => pendingSelections.delete(senderId));
                }
            }
            return result;
        },
    );
}
