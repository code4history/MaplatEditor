import { ipcMain, BrowserWindow } from 'electron';
import WmtsGeneratorService from '../services/WmtsGeneratorService';

// M12-T22: 本ハンドラ登録自体はmain.ts:138(import)/229(起動時呼び出し)により
// 常時生きているが、これを発火させるレンダラー側invoke経路（休眠パネル専用の
// wmtsGenerate()、MapEdit.vue §3.1 #11）はM11-T3でUI導線が撤去済み。ロジックは
// 削除禁止 — M4-(2)（既存Maplat定義→WMTS出力→ベースマップ登録）へ転用予定。
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
        hash: string
    ) => {
        const win = BrowserWindow.fromWebContents(event.sender)!;
        return WmtsGeneratorService.generate(win, uid, mapID, width, height, tinSerial, extKey, hash);
    });
}
