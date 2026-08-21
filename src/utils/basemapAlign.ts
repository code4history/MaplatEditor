// m1-t2「ベースマップ位置合わせモード」の純関数モジュール。
// 設計: docs/superpowers/specs/2026-08-21-m1-t2-basemap-align-mode-task-design.md §5.1 / §5.3 / §7
// 座標系・単位・符号の契約はマイルストーン設計 C-2:
//   MercatorShiftX/Y は EPSG:3857 メートル。正の X は画像を東へ、正の Y は北へ動かす。
//   確定式 shift = P_groundTruth − P_reference。合成規則は「上書き」であり既存値へ加算しない。
// 保持値は編集環境ストア（SQLite テーブル map_base_map_shift）へ Save 不要で即時永続化される
// （m1-t4・HR-6・C-3 v1.2。HR-4.3 の「非永続」は人間により明示的に逆転された）。
// 地図文書にもベースマップ master にもアプリソースにも書かない（ADR-0018 とは整合のまま）。

export type MercatorShift = { x: number; y: number };

export type AlignPhase = 'P0' | 'P1' | 'P2';

export const ZERO_SHIFT: MercatorShift = { x: 0, y: 0 };

/**
 * 基準点と Ground Truth の EPSG:3857 座標差からシフト量を求める（C-2 の確定式）。
 * 基準点はシフト解除状態の対象ベースマップ上で打たれる（HR-4.6(e)）ため、
 * 得られる差分は絶対量であって増分ではない。
 */
export function computeMercatorShift(reference: number[], groundTruth: number[]): MercatorShift {
    return { x: groundTruth[0] - reference[0], y: groundTruth[1] - reference[1] };
}

/**
 * 保持値レコードへ 1 件のシフトを「上書き」で適用する（C-2: `=` であり `+=` ではない）。
 * 入力レコードは破壊せず、新しいレコードを返す（Vue の ref 差し替えに使う）。
 */
export function applyShiftOverwrite(
    shifts: Record<string, MercatorShift>,
    mapID: string,
    shift: MercatorShift,
): Record<string, MercatorShift> {
    return { ...shifts, [mapID]: { x: shift.x, y: shift.y } };
}

/**
 * ソースへ載せる「実効値」を相に応じて求める（§5.1・§5.3）。
 * P1 / P2 では対象ベースマップの実効値だけを 0 にする。保持値は変えない。
 */
/**
 * シフトが 0,0（＝補正なし）かどうか（m1-t4 §5.2: リセットボタンの disabled 判定。HR-5.2）。
 * ストア側は 0,0 を行 DELETE で表現する（m1-t4 §5.1）ため、
 * メモリの明示的な {x:0, y:0} と未登録（行なし）は同義である。
 */
export function isZeroShift(shift: MercatorShift): boolean {
    return shift.x === 0 && shift.y === 0;
}

export function effectiveShiftOf(
    shifts: Record<string, MercatorShift>,
    mapID: string,
    phase: AlignPhase,
    targetMapID: string | null,
): MercatorShift {
    if (phase !== 'P0' && mapID === targetMapID) return { x: 0, y: 0 };
    const held = shifts[mapID];
    return held ? { x: held.x, y: held.y } : { x: 0, y: 0 };
}
