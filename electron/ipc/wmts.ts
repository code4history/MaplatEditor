import { BrowserWindow } from 'electron';
import { ipc } from './registry';
import WmtsGeneratorService from '../services/WmtsGeneratorService';
// #100: 長時間 IPC ハンドラを uncaughtException 時の settle 保証で wrap する
import { runGuarded } from '../utils/inflightGuard';

// 本ハンドラ登録自体はmain.ts:138(import)/229(起動時呼び出し)により
// 常時生きている。MapEdit.vueの新規「メルカトルタイル」タブから到達
// 可能になった（以前から転用を予定していた地図からのタイル生成に対応）。ロジックは
// 削除しない。
export function registerWmtsHandlers() {
    ipc.handle('wmtsGen:generate', async (
        event,
        uid: string,
        mapID: string,
        width: number,
        height: number,
        tinSerial: any,
        extKey: string,
        hash: string,
        targetBaseMapUid: string,
        crs?: any
    ) => {
        const win = BrowserWindow.fromWebContents(event.sender)!;
        return await runGuarded('wmtsGen:generate', () =>
            WmtsGeneratorService.generate(win, uid, mapID, width, height, tinSerial, extKey, hash, targetBaseMapUid, crs));
    });
}
