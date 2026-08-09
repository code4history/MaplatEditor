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
import SettingsService from './SettingsService';
import { estimateJpegDecodeBudget, type JpegDecodeBudget } from '../utils/jpegDecodeBudget';
import { resolveDecodeSafety } from '../utils/decodeSafety';

/**
 * M5-T6: 画像取り込みの結果契約（設計 §6.1 が唯一の記述）。
 *
 * 失敗時、予測由来の項目は `prediction` にまとめて**全部入りか無しか**にする。
 * 個々を省略可にすると「requiredMemoryMB はあるが recommendedMemoryMB は無い」という
 * 成立しない中間状態を作れてしまうため。renderer の分岐鍵も `prediction` の有無である。
 */
export type MapUploadResult =
    | { width: number; height: number; url: string; imageExtension: string }
    | { err: 'Canceled' }
    /**
     * M5-T8: 取り込み前の確認要求。`err` を持たない点が分岐鍵である
     * （renderer は `needsConfirmation` を最優先で見る。設計 §6.2）。
     * **選択したファイルパスは載せない** — renderer へ渡さず main 側で保持する。
     */
    | { needsConfirmation: 'long_import'; megapixels: number }
    /**
     * M5-T8: この機械では構造的に扱えない（V8 ヒープが尽きて強制終了する）。
     * 確認プロンプトを出さずハードブロックする（人間指示 2026-08-03）。
     */
    | {
          err: string;
          errorCode: 'jpeg_machine_limit';
          machine: { requiredHeapMB: number; availableHeapMB: number; megapixels: number };
      }
    | {
          err: string;
          errorCode: 'jpeg_memory_limit';
          configuredMB: number;
          prediction?: { requiredMemoryMB: number; recommendedMemoryMB: number };
      }
    | {
          err: string;
          errorCode: 'jpeg_resolution_limit';
          configuredMP: number;
          prediction?: { megapixels: number; recommendedResolutionMP: number };
      }
    /** M5-T8: `confirmed: true` で来たが、main 側に対応する選択が保持されていない */
    | { err: string; errorCode: 'stale_confirmation' }
    | { err: string; errorCode: 'unknown' };

/**
 * M5-T8: 確認プロンプトを出す画素数の閾値（十進 MP）。
 *
 * タイル化の実測は m19-t6（タイル生成ループの原寸クローン除去）以後で
 * 48 MP ≒ 29.7 秒 / 110 MP ≒ 57.1 秒（m5-t6 smoke）、`t ∝ MP^0.79` で 100 MP は約 53 秒。
 * ∴ この閾値を支える根拠はタイル化からデコードへ移った。デコード時間は内容依存で、
 * 実写スキャンは約 1.00 s/MP（470 MP で 469 秒。FUTURE_PLAN §6.2）であるため、
 * 100 MP の実写ではデコード約 100 秒 + タイル化約 53 秒 ≒ 2.5 分となり、
 * ここから先は進捗バーだけでは足りない。根拠が移っただけで閾値を動かす材料は無いので、
 * m19-t6 の高速化後も 100 のまま据え置く。
 * これ未満は従来どおり無確認で進む（確認の出しすぎは無視されるだけで害になる）。
 */
export const LONG_IMPORT_THRESHOLD_MP = 100;

/** jpeg-js の例外文言から、どちらのガードに当たったかを判別する（renderer では判別しない） */
function classifyDecodeError(error: unknown): 'jpeg_memory_limit' | 'jpeg_resolution_limit' | 'unknown' {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (message.includes('maxMemoryUsageInMB')) return 'jpeg_memory_limit';
    if (message.includes('maxResolutionInMP')) return 'jpeg_resolution_limit';
    return 'unknown';
}

/**
 * m19-t6: 原寸ビットマップの矩形領域だけを取り出す（原寸全体を複製しない）。
 *
 * 返り値は Jimp v1 の `image.clone().crop({x,y,w,h}).bitmap` と **バイト単位で同一**である。
 * - `crop` は行優先で矩形を写すだけ（@jimp/plugin-crop + @jimp/utils の scan）なので、
 *   行単位の Buffer.copy と結果が一致する
 * - `x===0 && w===source.width` の分岐は `crop` 自身のショートカット（Buffer の view）と同じもの。
 *   行が連続しているためコピーが要らない
 *
 * 返す bitmap は **必ず新しいオブジェクト**である（`source` を返さない）。
 * Jimp の `resize` は bitmap オブジェクトをその場で書き換えるため、`source` をそのまま渡すと
 * 原本が破壊される（プラグインラッパの都合で `crop` も同様にその場で書き換える）。
 * data だけを共有するのは安全である（resize は入力バッファを読むだけで書き込まない）。
 *
 * **等価性の上界**: `crop` / `scan` はインデックス計算に `<< 2`（32bit 演算）を使うのに対し、
 * 本関数は `* 4`（float64・2^53 まで正確）を使う。∴ 厳密なバイト一致が成立するのは
 * `width * height < 2^29 px`（= 536,870,912 px ≒ 536.9 MP）までである。
 * これを超える領域では jimp の `crop` 側が 32bit シフトのオーバーフローで破綻しており
 * （ショートカット分岐は `Buffer.slice(負値)` が末尾からのオフセットと解釈されるため
 * **例外を投げずに誤ったデータを返す**。非ショートカット分岐は `readUInt32BE` で RangeError）、
 * 本関数は `* 4` を使うためこの領域でも正しい結果を返す。∴ 上界の外は回帰ではなく改善である。
 */
export function cropRegionBitmap(
    source: { data: Buffer; width: number; height: number },
    xArg: number,
    yArg: number,
    wArg: number,
    hArg: number
): { data: Buffer; width: number; height: number } {
    // crop が入力を丸めているため、丸めまで含めて同一にする
    // （現在の呼び出し値はすべて整数だが「crop の差し替え」という契約を崩さない）。
    const x = Math.round(xArg);
    const y = Math.round(yArg);
    const w = Math.round(wArg);
    const h = Math.round(hArg);
    if (x === 0 && w === source.width) {
        // 行が連続しているためコピー不要（crop のショートカットと同一の分岐条件）。
        // slice は Buffer では非推奨エイリアスのため subarray を使う。
        const start = (source.width * y + x) * 4;
        return { data: source.data.subarray(start, start + h * w * 4), width: w, height: h };
    }
    // Buffer.alloc（ゼロ埋め）を使う。全バイトを書き込むので機能上は allocUnsafe で足りるが、
    // 万一の書き漏れが未初期化ヒープの画像への混入になるため採らない。
    const data = Buffer.alloc(w * h * 4);
    const rowBytes = w * 4;
    for (let row = 0; row < h; row++) {
        const s = (source.width * (y + row) + x) * 4;
        source.data.copy(data, row * rowBytes, s, s + rowBytes);
    }
    return { data, width: w, height: h };
}

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
export async function imageCutter(
    win: BrowserWindow,
    srcFile: string,
    outFolder: string,
    options: { confirmed?: boolean } = {}
): Promise<MapUploadResult> {
    // M5-T8: 事前判定に使う材料を先に揃える。
    //   caps   = 利用者が明示したキャップ（null = 自動）
    //   safety = この機械が構造的に耐えられる量（V8 heap_size_limit から実行時算出）
    const caps = SettingsService.getJpegDecodeCaps();
    const safety = resolveDecodeSafety();
    let sourceBuffer: Buffer;
    let budget: JpegDecodeBudget | null = null;
    let toExtKey: string;
    // デコードへ実際に渡す値。budget があれば画像ごとの自動値、無ければ機械安全枠。
    let effectiveMemoryMB: number;
    let effectiveResolutionMP: number;
    try {
        // 拡張子判定（旧実装と同じロジック）
        const match = srcFile.match(/([^\\/]+)\.([^.]+)$/);
        if (!match) return { err: '画像拡張子エラー', errorCode: 'unknown' };
        toExtKey = match[2].toLowerCase();
        if (toExtKey === 'jpeg') toExtKey = 'jpg';

        sourceBuffer = await fs.readFile(srcFile);

        // M5-T6 (§5.4) / M5-T8 (§5.0): デコードもタイル化も始める前に判定する。
        // ここで戻る経路は **outFolder のクリアに到達しない**ため、既存の下書きタイルを壊さない
        // （この順序が不変条件。AC12 が番人）。予測できない入力（PNG 等）は null が返る。
        budget = estimateJpegDecodeBudget(sourceBuffer);
        if (budget) {
            // D2: この機械では構造的に扱えない。jpeg-js の会計ガードは通っても V8 ヒープが
            // 尽きてプロセスごと落ちる領域であり、例外として catch できない。∴ 確認を出さず
            // ここで止める（人間指示 2026-08-03）。
            if (budget.decoderHeapMB > safety.maxDecoderHeapMB) {
                return {
                    err: `jpeg decode machine limit: required heap ${budget.decoderHeapMB}MiB > available ${safety.maxDecoderHeapMB}MiB`,
                    errorCode: 'jpeg_machine_limit',
                    machine: {
                        requiredHeapMB: budget.decoderHeapMB,
                        availableHeapMB: safety.maxDecoderHeapMB,
                        megapixels: budget.megapixels,
                    },
                };
            }

            // D3 / D4: 利用者が明示したキャップに当たった場合のみ弾く（自動のときは素通り）。
            // 判定は「デコードへ渡す予定の自動値」に対して行う — キャップで頭打ちにした値を
            // 渡して「デコード途中で落ちる」状態を作らないため。
            if (caps.maxMemoryUsageInMB !== null && budget.recommendedMemoryMB > caps.maxMemoryUsageInMB) {
                return {
                    err: `jpeg decode memory limit: required ${budget.requiredMemoryMB}MB > configured cap ${caps.maxMemoryUsageInMB}MB`,
                    errorCode: 'jpeg_memory_limit',
                    configuredMB: caps.maxMemoryUsageInMB,
                    prediction: {
                        requiredMemoryMB: budget.requiredMemoryMB,
                        recommendedMemoryMB: budget.recommendedMemoryMB,
                    },
                };
            }
            if (caps.maxResolutionInMP !== null && budget.recommendedResolutionMP > caps.maxResolutionInMP) {
                return {
                    err: `jpeg decode resolution limit: ${budget.megapixels}MP > configured cap ${caps.maxResolutionInMP}MP`,
                    errorCode: 'jpeg_resolution_limit',
                    configuredMP: caps.maxResolutionInMP,
                    prediction: {
                        megapixels: budget.megapixels,
                        recommendedResolutionMP: budget.recommendedResolutionMP,
                    },
                };
            }

            // D5: 上限は足りているが非常に時間がかかる。**確認を取るまで進まない**。
            // ここも outFolder より前なので、キャンセルしても後始末は要らない。
            if (!options.confirmed && budget.megapixels > LONG_IMPORT_THRESHOLD_MP) {
                return { needsConfirmation: 'long_import', megapixels: budget.megapixels };
            }

            effectiveMemoryMB = budget.recommendedMemoryMB;
            effectiveResolutionMP = budget.recommendedResolutionMP;
        } else {
            // D1: 予測できない（PNG・SOF 解析不能）。PNG では jpeg オプションが参照されないため
            // 実害は無いが、値の出どころを「機械が耐えられる量」に揃えておく。
            effectiveMemoryMB = safety.maxMemoryMB;
            effectiveResolutionMP = safety.maxResolutionMP;
        }
    } catch (err) {
        return { err: err instanceof Error ? err.message : String(err), errorCode: 'unknown' };
    }

    try {
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
        // M5-T6: ここが原寸デコード地点であり、大容量原本が jpeg-js のガードで落ちていた箇所。
        // Jimp.read はローカルファイルパスと Buffer の経路で第2引数 options を捨て、
        // URL 経路だけが fromBuffer へ渡す（@jimp/core の read 実装）。
        // ∴ Jimp.read(srcFile, options) では設定が届かないため fromBuffer を直接呼ぶ。
        // PNG 入力時は image/jpeg の options が参照されないため無害
        // （@jimp/js-png の DecodePngOptions にメモリ・解像度の上限は無い）。
        // M5-T6: 上限は設定値から取る（既定 8192 / 800）。読み出し口は
        // SettingsService.getJpegDecodeLimits の1つだけ（正規化がそこに閉じている）。
        // M5-T8: 渡す値は §5.3 の表のとおり画像ごとに自動決定した値である（設定の運用値ではない）。
        const imageJimp = await Jimp.fromBuffer(sourceBuffer, {
            'image/jpeg': {
                maxMemoryUsageInMB: effectiveMemoryMB,
                maxResolutionInMP: effectiveResolutionMP,
            },
        });
        // m19-t6: デコード後、圧縮元バッファは以降どこからも読まれない
        // （original.<ext> のコピーは fs.copy が srcFile から直接行う）。
        // タイル化は数分続くため、ここで参照を落として解放できるようにする。
        // 型を `Buffer | null` に変えず空バッファを代入するのは、188 行の宣言と非 null 前提を保ち、
        // `!` の追加や制御フローの変更を持ち込まないためである。
        sourceBuffer = Buffer.alloc(0);
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
            // m19-t6: 旧実装は imageJimp.clone() で原寸 RGBA 全体を毎回複製していた
            // （旧 Electron 版 backend/src/mapupload.js:123 から引き継いだ形）。
            // cropRegionBitmap は clone().crop({x,y,w,h}) と同一の bitmap を、コピー無し／
            // 矩形ぶんのコピーだけで返す。resize 以降は一切変えていない。
            const canvasJimp = new Jimp(
                cropRegionBitmap(imageJimp.bitmap, task[1], task[2], task[3], task[4])
            ).resize({ w: task[5], h: task[6] });
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
        // M5-T6 (§5.4): 事前判定を通り抜けたのにガードへ当たった場合の保険。
        // 予測が立っていれば prediction を丸ごと添え、無ければキーごと省く
        // （個々のフィールドに undefined を入れて部分的な payload を作らない）。
        const message = err instanceof Error ? err.message : String(err);
        const errorCode = classifyDecodeError(err);
        if (errorCode === 'jpeg_memory_limit') {
            return {
                err: message,
                errorCode,
                // M5-T8: 実際にデコーダへ渡した値を返す（キャップではない）。
                // 事前判定を通り抜けてなおガードに当たった、という意味だからである
                configuredMB: effectiveMemoryMB,
                ...(budget
                    ? { prediction: { requiredMemoryMB: budget.requiredMemoryMB, recommendedMemoryMB: budget.recommendedMemoryMB } }
                    : {}),
            };
        }
        if (errorCode === 'jpeg_resolution_limit') {
            return {
                err: message,
                errorCode,
                configuredMP: effectiveResolutionMP,
                ...(budget
                    ? { prediction: { megapixels: budget.megapixels, recommendedResolutionMP: budget.recommendedResolutionMP } }
                    : {}),
            };
        }
        return { err: message, errorCode: 'unknown' };
    }
}

/**
 * 旧実装 MapUpload.showMapSelectDialog() 相当
 * ファイル選択ダイアログを表示し、選択された画像でタイル切断を実行する
 *
 * 旧実装の IPC: ipcMain.on('mapupload_showMapSelectDialog', ...)
 * 新実装の IPC: ipcMain.handle('mapupload:showMapSelectDialog', ...)
 */
export async function selectMapImage(
    win: BrowserWindow,
    mapImageLabel: string
): Promise<string | null> {
    const ret = await dialog.showOpenDialog(win, {
        defaultPath: app.getPath('documents'),
        properties: ['openFile'],
        // 旧実装: filters: [{name: mapImageRepl, extensions: ['jpg', 'png', 'jpeg']}]
        filters: [{ name: mapImageLabel, extensions: ['jpg', 'png', 'jpeg'] }]
    });
    if (ret.canceled) return null;
    return ret.filePaths[0];
}

/**
 * 旧実装 MapUpload.showMapSelectDialog() 相当（選択 → タイル化を一息で行う合成）。
 *
 * M5-T8: 確認往復を挟む本番経路は `electron/ipc/mapupload.ts` が
 * `selectMapImage` と `imageCutter` を個別に呼ぶ（選択の保持が必要なため）。
 * 本関数は**確認を挟まない直接経路**として残す。既存の smoke（m12-t15 / m5-t6）が
 * この窓口を使っており、それらは確認を必要としない。
 * 100 MP を超える画像を確認なしで通したい場合は `options.confirmed` を渡す。
 */
export async function showMapSelectDialog(
    win: BrowserWindow,
    stagingDir: string,
    mapImageLabel: string,
    options: { confirmed?: boolean } = {}
): Promise<MapUploadResult> {
    const filePath = await selectMapImage(win, mapImageLabel);
    if (filePath === null) {
        return { err: 'Canceled' };
    }

    // M12-T20: stagingDir は IPC handler が resolveDraftTileDir で解決済み（§6.1）
    return await imageCutter(win, filePath, stagingDir, options);
}
