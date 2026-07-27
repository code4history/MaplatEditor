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
 * M12-T15 R3: ズーム2タイルを stitch して長辺512pxサムネイルを生成
 * 画像ピラミッド方式: ズーム2の全タイルを合成すると画像全体が復元される
 * @param outFolder - タイル出力フォルダ（{z}/{x}/{y}.{ext} 構造）
 * @param to - 出力ファイルパス
 * @param ext - タイル拡張子（jpg/png 等）
 * @param origWidth - 元画像幅
 * @param origHeight - 元画像高さ
 * @param maxZoom - 最大ズームレベル
 */
async function makeThumbnail512(
    outFolder: string,
    to: string,
    ext: string,
    origWidth: number,
    origHeight: number,
    maxZoom: number
): Promise<void> {
    // ズーム2のタイルディレクトリ
    const zoom2Dir = path.resolve(outFolder, '2');
    // §C3: maxZoom < 2 の場合は呼ばれないが、万が一ディレクトリがない場合はスキップ
    if (!await fs.pathExists(zoom2Dir)) return;

    // ズーム2のタイル数を計算
    const pw = Math.round(origWidth / Math.pow(2, maxZoom - 2));
    const ph = Math.round(origHeight / Math.pow(2, maxZoom - 2));
    const tilesX = Math.ceil(pw / 256);
    const tilesY = Math.ceil(ph / 256);

    // キャンバス作成（全タイルを合成）
    const canvas = new Jimp({
        width: tilesX * 256,
        height: tilesY * 256,
        color: 0xffffffff,
    });

    for (let tx = 0; tx < tilesX; tx++) {
        for (let ty = 0; ty < tilesY; ty++) {
            const tilePath = path.resolve(zoom2Dir, `${tx}`, `${ty}.${ext}`);
            if (await fs.pathExists(tilePath)) {
                try {
                    const tileImage = await Jimp.read(tilePath);
                    canvas.composite(tileImage, tx * 256, ty * 256);
                } catch {
                    // タイル読み込み失敗は白背景のまま残す
                }
            }
        }
    }

    // 元画像のアスペクト比で crop（余分な白背景を除去）
    const cropW = Math.min(canvas.width, pw);
    const cropH = Math.min(canvas.height, ph);
    if (cropW < canvas.width || cropH < canvas.height) {
        canvas.crop({ x: 0, y: 0, w: cropW, h: cropH });
    }

    // 長辺512pxへ縮小
    const longSide = Math.max(canvas.width, canvas.height);
    if (longSide > 512) {
        const scale = 512 / longSide;
        canvas.resize({
            w: Math.max(1, Math.round(canvas.width * scale)),
            h: Math.max(1, Math.round(canvas.height * scale)),
        });
    }

    await canvas.write(to as `${string}.${string}`);
}

/**
 * 旧実装 MapUpload.imageCutter() 相当
 * 画像を 256x256 タイルピラミッドに分割し、サムネイルを生成する
 *
 * @param win       - プログレス通知先 BrowserWindow
 * @param srcFile   - アップロード元画像ファイルパス
 * @param outFolder - 下書き staging dir（M12-T20 §6.1: 必ず共通バリデータ
 *                    resolveDraftTileDir で解決済みのパスを handler から受け取る。
 *                    imageCutter 自身はパスを組み立てない — assetUid='..' 等での
 *                    親領域クリア事故の構造的排除）
 * @returns { width, height, url, imageExtension } or { err }
 */
async function imageCutter(
    win: BrowserWindow,
    srcFile: string,
    outFolder: string
): Promise<{ width?: number; height?: number; url?: string; imageExtension?: string; err?: any }> {
    try {
        // 拡張子判定（旧実装と同じロジック）
        const regex = /([^\\/]+)\.([^.]+)$/;
        const match = srcFile.match(regex);
        if (!match) return { err: '画像拡張子エラー' };
        let toExtKey = match[2].toLowerCase();
        if (toExtKey === 'jpeg') toExtKey = 'jpg';

        // M12-T20 (§6.1): 自 dir のみをクリアして書く（旧実装の tmpFolder/tiles 全消しを置換。
        // 単一スロット衝突の解消）。削除プリミティブは fs.remove（symlink 非追従。§6.1 の契約
        // — fs.emptyDir 等リンク先へ降りるプリミティブは使わない）
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

        // M12-T15 R3: ズーム2タイルから長辺512pxサムネイル生成（§C3: maxZoom < 2 はスキップ）
        if (maxZoom >= 2) {
            const thumb512To = path.resolve(outFolder, 'thumbnail_512.jpg');
            await makeThumbnail512(outFolder, thumb512To, toExtKey, width, height, maxZoom);
        }

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
    stagingDir: string,
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

    // M12-T20: stagingDir は IPC handler が resolveDraftTileDir で解決済み（§6.1）
    return await imageCutter(win, ret.filePaths[0], stagingDir);
}
