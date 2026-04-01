/**
 * MapUploadService.ts
 * 旧実装 backend/src/mapupload.js の TypeScript 移植版
 *
 * 主な変更点（モダナイゼーション対応）:
 * - ipcMain.on + ev.reply  → ipcMain.handle + webContents.send (Promise化)
 * - Jimp v1: crop(x,y,w,h) → crop({x,y,w,h}), resize(w,h) → resize({w,h})
 * - bitmap.width/height → width/height プロパティ直接参照
 */
import path from 'path';
import fs from 'fs-extra';
import { app, BrowserWindow, dialog } from 'electron';
import fileUrl from 'file-url';
// @ts-ignore
import { Jimp } from 'jimp';
import { ProgressReporter } from '../utils/ProgressReporter';

let outFolder: string;

/**
 * 旧実装 thumbExtractor.make_thumbnail() 相当
 * 旧実装: 52px 以内に縮小した JPEG を生成
 */
async function makeThumbnail(from: string, to: string): Promise<void> {
    const imageJimp = await Jimp.read(from);
    const width: number = imageJimp.width;
    const height: number = imageJimp.height;
    // 旧実装と同じ縮小ロジック
    const w = width > height ? 52 : Math.ceil(52 * width / height);
    const h = width > height ? Math.ceil(52 * height / width) : 52;
    await imageJimp.resize({ w, h }).write(to as `${string}.${string}`);
}

/**
 * 旧実装 MapUpload.imageCutter() 相当
 * 画像を 256x256 タイルピラミッドに分割し、サムネイルを生成する
 *
 * @param win       - プログレス通知先 BrowserWindow
 * @param srcFile   - アップロード元画像ファイルパス
 * @param tmpFolder - 一時保存ルート（settings.tmpFolder）
 * @returns { width, height, url, imageExtension } or { err }
 */
async function imageCutter(
    win: BrowserWindow,
    srcFile: string,
    tmpFolder: string
): Promise<{ width?: number; height?: number; url?: string; imageExtension?: string; err?: any }> {
    try {
        // 拡張子判定（旧実装と同じロジック）
        const regex = /([^\\/]+)\.([^.]+)$/;
        const match = srcFile.match(regex);
        if (!match) return { err: '画像拡張子エラー' };
        let toExtKey = match[2].toLowerCase();
        if (toExtKey === 'jpeg') toExtKey = 'jpg';

        // 旧実装: outFolder = ${tmpFolder}/tiles を毎回クリア
        outFolder = path.resolve(tmpFolder, 'tiles');
        try {
            await fs.stat(outFolder);
            await fs.remove(outFolder);
        } catch {
            // 存在しない場合は何もしない
        }
        await fs.ensureDir(outFolder);

        // 旧実装: Jimp で画像読み込み、幅・高さ・最大ズーム計算
        const imageJimp = await Jimp.read(srcFile);
        const width: number = imageJimp.width;   // 旧: imageJimp.bitmap.width
        const height: number = imageJimp.height; // 旧: imageJimp.bitmap.height
        const maxZoom = Math.ceil(Math.log(Math.max(width, height) / 256) / Math.log(2));

        // タスクリスト構築（旧実装と同じアルゴリズム）
        const tasks: [string, number, number, number, number, number, number][] = [];
        for (let z = maxZoom; z >= 0; z--) {
            const pw = Math.round(width / Math.pow(2, maxZoom - z));
            const ph = Math.round(height / Math.pow(2, maxZoom - z));
            for (let tx = 0; tx * 256 < pw; tx++) {
                const tw = (tx + 1) * 256 > pw ? pw - tx * 256 : 256;
                const sx = tx * 256 * Math.pow(2, maxZoom - z);
                const sw = (tx + 1) * 256 * Math.pow(2, maxZoom - z) > width
                    ? width - sx
                    : 256 * Math.pow(2, maxZoom - z);
                const tileDir = path.resolve(outFolder, `${z}`, `${tx}`);
                await fs.ensureDir(tileDir);
                for (let ty = 0; ty * 256 < ph; ty++) {
                    const th = (ty + 1) * 256 > ph ? ph - ty * 256 : 256;
                    const sy = ty * 256 * Math.pow(2, maxZoom - z);
                    const sh = (ty + 1) * 256 * Math.pow(2, maxZoom - z) > height
                        ? height - sy
                        : 256 * Math.pow(2, maxZoom - z);
                    const tileFile = path.resolve(tileDir, `${ty}.${toExtKey}`);
                    tasks.push([tileFile, sx, sy, sw, sh, tw, th]);
                }
            }
        }

        // 旧実装: ProgressReporter("mapedit", tasks.length, 'mapupload.dividing_tile', 'mapupload.next_thumbnail')
        const progress = new ProgressReporter(
            'mapedit:taskProgress',
            tasks.length,
            'mapupload.dividing_tile',
            'mapupload.next_thumbnail'
        );
        progress.setWindow(win);
        progress.update(0);

        // タイル生成ループ
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            // 旧実装: imageJimp.clone().crop(sx, sy, sw, sh).resize(tw, th)
            // Jimp v1: crop({x,y,w,h}), resize({w,h})
            const canvasJimp = imageJimp.clone()
                .crop({ x: task[1], y: task[2], w: task[3], h: task[4] })
                .resize({ w: task[5], h: task[6] });
            await canvasJimp.write(task[0] as `${string}.${string}`);

            progress.update(i + 1);
            // 旧実装: await new Promise(s => setTimeout(s, 1))
            await new Promise<void>((s) => setTimeout(s, 1));
        }

        // オリジナル画像コピー
        await fs.copy(srcFile, path.resolve(outFolder, `original.${toExtKey}`));

        // サムネイル生成（旧実装: thumbExtractor.make_thumbnail）
        const thumbFrom = path.resolve(outFolder, '0', '0', `0.${toExtKey}`);
        const thumbTo = path.resolve(outFolder, 'thumbnail.jpg');
        await makeThumbnail(thumbFrom, thumbTo);

        // 旧実装: url = `${fileUrl(outFolder)}/{z}/{x}/{y}.${toExtKey}`
        const url = `${fileUrl(outFolder)}/{z}/{x}/{y}.${toExtKey}`;
        return { width, height, url, imageExtension: toExtKey };

    } catch (err) {
        return { err };
    }
}

/**
 * 旧実装 MapUpload.showMapSelectDialog() 相当
 * ファイル選択ダイアログを表示し、選択された画像でタイル切断を実行する
 *
 * 旧実装の IPC: ipcMain.on('mapupload_showMapSelectDialog', ...)
 * 新実装の IPC: ipcMain.handle('mapupload:showMapSelectDialog', ...)
 */
export async function showMapSelectDialog(
    win: BrowserWindow,
    tmpFolder: string,
    mapImageLabel: string
): Promise<{ width?: number; height?: number; url?: string; imageExtension?: string; err?: string }> {
    const ret = await dialog.showOpenDialog(win, {
        defaultPath: app.getPath('documents'),
        properties: ['openFile'],
        // 旧実装: filters: [{name: mapImageRepl, extensions: ['jpg', 'png', 'jpeg']}]
        filters: [{ name: mapImageLabel, extensions: ['jpg', 'png', 'jpeg'] }]
    });

    if (ret.canceled) {
        return { err: 'Canceled' };
    }

    return await imageCutter(win, ret.filePaths[0], tmpFolder);
}
