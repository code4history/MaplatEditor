// M12-T1: 対応線上への対応点作成（addMarkerOnEdge）の edge 分割計算部。
// 旧版 frontend/src/mapedit.js:405-489 の計算ロジックを OL・Vue 非依存の純粋関数へ移植した。
// 旧版の式（垂直距離・nearestLength・比率補間・slice 規則）を逐語維持する（quirks も含む、parity 方針）。
//
// 座標系: 操作側（this）・反対側（that）ともに各面の内部座標（illst は画像 xy、mercator は EPSG:3857）。
// 変換（illstSource.sysCoord2Xy / xy2SysCoord）と丸めは呼び出し側（MapEdit.vue）の責務。

export interface EdgeSplitInput {
  /** 操作側の中間 node 列（端点を含まない。edge[0] or edge[1]） */
  thisNodes: number[][];
  /** 反対側の中間 node 列（端点を含まない） */
  thatNodes: number[][];
  /** 操作側の端点1（edge[2][0] に対応する GCP の操作側座標） */
  thisEnd1: number[];
  /** 操作側の端点2（edge[2][1] に対応する GCP の操作側座標） */
  thisEnd2: number[];
  /** 反対側の端点1 */
  thatEnd1: number[];
  /** 反対側の端点2 */
  thatEnd2: number[];
  /** 操作側の丸め済みクリック座標 */
  xy: number[];
}

export interface EdgeSplitSuccess {
  ok: true;
  /** 反対側の補間座標（新 GCP の反対側） */
  thatXy: number[];
  /** 分割 edge 前半の中間 node 列（操作側） */
  thisPrevNodes: number[][];
  /** 分割 edge 後半の中間 node 列（操作側） */
  thisLastNodes: number[][];
  /** 分割 edge 前半の中間 node 列（反対側） */
  thatPrevNodes: number[][];
  /** 分割 edge 後半の中間 node 列（反対側） */
  thatLastNodes: number[][];
}

export type EdgeSplitErrorCode = "EDGE_ZERO_LENGTH" | "INVALID_COORDINATE_ARRAY";

export interface EdgeSplitFailure {
  ok: false;
  code: EdgeSplitErrorCode;
}

export type EdgeSplitResult = EdgeSplitSuccess | EdgeSplitFailure;

function isPoint(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

export function edgeSplit(input: EdgeSplitInput): EdgeSplitResult {
  const { thisNodes, thatNodes, thisEnd1, thisEnd2, thatEnd1, thatEnd2, xy } = input;
  // 構造検証（INVALID_COORDINATE_ARRAY）: 配列・端点・xy・全 node が [x, y] 数値ペアであること
  if (
    !Array.isArray(thisNodes) ||
    !Array.isArray(thatNodes) ||
    !isPoint(thisEnd1) ||
    !isPoint(thisEnd2) ||
    !isPoint(thatEnd1) ||
    !isPoint(thatEnd2) ||
    !isPoint(xy) ||
    thisNodes.some((node) => !isPoint(node)) ||
    thatNodes.some((node) => !isPoint(node))
  ) {
    return { ok: false, code: "INVALID_COORDINATE_ARRAY" };
  }

  // 旧版: 端点を先頭・末尾へ足した全 node 列を作る（Object.assign による浅い複製と同じ）
  const thisAll: number[][] = [thisEnd1.slice(), ...thisNodes.map((n) => n.slice()), thisEnd2.slice()];
  const thatAll: number[][] = [thatEnd1.slice(), ...thatNodes.map((n) => n.slice()), thatEnd2.slice()];

  // 旧版 thisResults reduce の逐語移植:
  // 各セグメントの [length, 累積長, xy との垂直距離] を走査し、
  // 最寄セグメント（nearestIndex）と edge 沿いの投影位置（nearestLength）を求める
  let nearest = 0;
  let nearestIndex = 0;
  let nearestLength = 0;
  const thisResults: number[][] = [];
  for (let index = 0; index < thisAll.length; index++) {
    if (index === 0) {
      thisResults.push([0, 0]);
      continue;
    }
    const curr = thisAll[index];
    const prevCoord = thisAll[index - 1];
    const length = Math.sqrt(Math.pow(curr[1] - prevCoord[1], 2) + Math.pow(curr[0] - prevCoord[0], 2));
    const distance =
      Math.abs(
        (curr[1] - prevCoord[1]) * xy[0] -
          (curr[0] - prevCoord[0]) * xy[1] +
          curr[0] * prevCoord[1] -
          curr[1] * prevCoord[0],
      ) / length;
    const sum = thisResults[index - 1][1] + length;
    thisResults.push([length, sum, distance]);
    if (!nearestIndex || nearest > distance) {
      nearestIndex = index;
      nearest = distance;
      nearestLength =
        thisResults[index - 1][1] +
        Math.sqrt(Math.pow(xy[1] - prevCoord[1], 2) + Math.pow(xy[0] - prevCoord[0], 2));
    }
  }

  const thisTotalLength = thisResults[thisResults.length - 1][1];
  if (thisTotalLength === 0) {
    return { ok: false, code: "EDGE_ZERO_LENGTH" };
  }
  const nearestRatio = nearestLength / thisTotalLength;

  // 旧版 thatResults reduce の逐語移植: 反対側ポリラインの累積長
  const thatResults: number[][] = [];
  for (let index = 0; index < thatAll.length; index++) {
    if (index === 0) {
      thatResults.push([0, 0]);
      continue;
    }
    const curr = thatAll[index];
    const prevCoord = thatAll[index - 1];
    const length = Math.sqrt(Math.pow(curr[1] - prevCoord[1], 2) + Math.pow(curr[0] - prevCoord[0], 2));
    const sum = thatResults[index - 1][1] + length;
    thatResults.push([length, sum]);
  }
  const thatTotalLength = thatResults[thatResults.length - 1][1];
  if (thatTotalLength === 0) {
    return { ok: false, code: "EDGE_ZERO_LENGTH" };
  }

  // 旧版の比率補間: nearestRatio 分の長さの地点を反対側ポリライン上で線形補間する
  let thatXy: number[] = [];
  let thatIndex = 0;
  const thatLengthToXy = nearestRatio * thatTotalLength;
  for (let index = 1; index < thatAll.length; index++) {
    const result = thatResults[index];
    if (thatLengthToXy < result[1] && !thatIndex) {
      thatIndex = index;
      const localRatio = (thatLengthToXy - thatResults[index - 1][1]) / result[0];
      const prevNode = thatAll[index - 1];
      const nextNode = thatAll[index];
      thatXy = [
        (nextNode[0] - prevNode[0]) * localRatio + prevNode[0],
        (nextNode[1] - prevNode[1]) * localRatio + prevNode[1],
      ];
    }
  }
  // クリックがポリライン終端を超える場合（ratio 計算上あり得る）、旧版は thatXy=[] のまま
  // 末尾 node を使う（旧版は [] を push して壊れていた。mutation を成立させるため終端へクランプする。
  // ただし ratio <= 1 の通常経路では発生しない）
  if (thatXy.length === 0) {
    thatXy = thatAll[thatAll.length - 1].slice();
    thatIndex = thatAll.length - 1;
  }

  // 旧版の slice 規則（端点を足した列から中間 node 部分を前後で分配）
  return {
    ok: true,
    thatXy,
    thisPrevNodes: thisAll.slice(1, nearestIndex),
    thisLastNodes: thisAll.slice(nearestIndex, thisAll.length - 1),
    thatPrevNodes: thatAll.slice(1, thatIndex),
    thatLastNodes: thatAll.slice(thatIndex, thatAll.length - 1),
  };
}
