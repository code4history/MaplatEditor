import { ipcMain, BrowserWindow } from 'electron';
import WmtsGeneratorService from '../services/WmtsGeneratorService';
// #100: 長時間 IPC ハンドラを uncaughtException 時の settle 保証で wrap する
import { runGuarded } from '../utils/inflightGuard';

// M12-T22: 本ハンドラ登録自体はmain.ts:138(import)/229(起動時呼び出し)により
// 常時生きている。m6-t8でMapEdit.vueの新規「メルカトルタイル」タブから到達
// 可能になった（M12-T22が転用予定としていたM4-(2)に対応）。ロジックは
// 削除しない。
// 詳細: docs/superpowers/state/nayuta-state.json m12.tasks[t22] / m4.human_direction_2026_07_25
export function registerWmtsHandlers() {
    ipcMain.handle('wmtsGen:generate', async (
        event,
        uid: string,
        mapID: string,
        width: number,
        height: number,
        tinSerial: any,
        extKey: string,
        hash: string,
        targetBaseMapUid: string
    ) => {
        const win = BrowserWindow.fromWebContents(event.sender)!;
        return await runGuarded('wmtsGen:generate', () =>
            WmtsGeneratorService.generate(win, uid, mapID, width, height, tinSerial, extKey, hash, targetBaseMapUid));
    });
}
