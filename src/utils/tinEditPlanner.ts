/**
 * Editor の対応点・必須エッジの変化から、Tin の編集（`TinEdit`）を作る（MaplatTin#100・設計書 §9.2「最初の id の規約」）。
 *
 * Editor の文書（層の `gcps`・`edges`）は、配列で、安定した id を持たない。Tin は、点と必須エッジを id で指す。
 * そこで、worker の網が持っている入力（`TrackedInputs`: 並び + id の並び）を主スレッドも写して持ち、
 * 新しい配列との差から編集を作る。
 *
 * - 作り直した（`rebuild`）直後は、添字がそのまま id（`setPoints`・`setEdges` の規約）。新しく足す点・必須エッジには、
 *   使われたことのない id（`nextPointId`・`nextEdgeId`。点を消しても、他の id は変わらず、id は使い回さない）を振る
 * - 点の対応づけは、座標が全部同じ（そのまま）、紙の面だけ同じ（地理面の移動）、地理面だけ同じ（紙の面の移動）の順。
 *   並びが入れ替わるものは、最長の増加列だけを対応づけ、残りは削除 + 追加にする（並びを再現できる編集にするため）
 * - 必須エッジは、端点の id の組で対応づける（端点の点が動いても、同じ必須エッジ）。折れ点が違えば `replaceEdgeNodes`
 * - 編集の順は、必須エッジの削除 → 点の削除 → 点の移動 → 点の追加 → 折れ点の差し替え → 必須エッジの追加
 *   （Tin は、必須エッジの端点の点を、先にエッジを外してからでないと消せない）
 * - 作った編集を、Tin と同じ規則で入力へ当て直し、新しい配列と一致しなければ、編集を返さない（呼び出し側は全部組み直す）
 *
 * 座標は、Tin へ渡すのと同じ外の座標系（follow のときの必須エッジの折れ点は、`reverseFollowEdgeAxis` を通した後の値）。
 */
import type { TinEdit } from '@maplat/tin';

export type PlannerPosition = number[];
export type PlannerPoint = [PlannerPosition, PlannerPosition];
export type PlannerEdge = [PlannerPosition[], PlannerPosition[], [number, number]];

export interface TrackedInputs {
  points: PlannerPoint[];
  pointIds: number[];
  edges: PlannerEdge[];
  edgeIds: number[];
  nextPointId: number;
  nextEdgeId: number;
}

const copyPosition = (position: PlannerPosition): PlannerPosition => [position[0], position[1]];
const copyPoint = (point: ArrayLike<PlannerPosition>): PlannerPoint => [copyPosition(point[0]), copyPosition(point[1])];
const copyEdge = (edge: PlannerEdge): PlannerEdge => [edge[0].map(copyPosition), edge[1].map(copyPosition), [edge[2][0], edge[2][1]]];
const samePosition = (a: PlannerPosition, b: PlannerPosition) => a[0] === b[0] && a[1] === b[1];
const sameNodes = (a: PlannerPosition[], b: PlannerPosition[]) => a.length === b.length && a.every((p, i) => samePosition(p, b[i]));
const positionKey = (p: PlannerPosition) => `${p[0]},${p[1]}`;

/** 作り直した直後の入力（添字が id）。呼び出し側の配列は、写して持つ（後で書き換えられても、影響を受けない）。 */
export function trackInputs(
  points: ReadonlyArray<ArrayLike<PlannerPosition>>,
  edges: ReadonlyArray<PlannerEdge>,
): TrackedInputs {
  return {
    points: points.map(copyPoint),
    pointIds: points.map((_, index) => index),
    edges: edges.map(copyEdge),
    edgeIds: edges.map((_, index) => index),
    nextPointId: points.length,
    nextEdgeId: edges.length,
  };
}

/** 編集を、Tin の `applyToInputs` と同じ規則で入力へ当てる（もとの入力は変えない）。当てられなければ undefined。 */
export function applyEditsToTracked(prev: TrackedInputs, edits: readonly TinEdit[]): TrackedInputs | undefined {
  const points = prev.points.slice();
  const pointIds = prev.pointIds.slice();
  const edges = prev.edges.map(([forwNodes, bakwNodes, [start, end]]) => ({
    forwNodes, bakwNodes, start: prev.pointIds[start], end: prev.pointIds[end],
  }));
  const edgeIds = prev.edgeIds.slice();
  let nextPointId = prev.nextPointId;
  let nextEdgeId = prev.nextEdgeId;
  for (const edit of edits) {
    switch (edit.type) {
      case 'addPoint': {
        if (pointIds.includes(edit.id)) return undefined;
        const at = edit.position ?? points.length;
        if (at < 0 || at > points.length) return undefined;
        points.splice(at, 0, [edit.forw, edit.bakw]);
        pointIds.splice(at, 0, edit.id);
        nextPointId = Math.max(nextPointId, edit.id + 1);
        break;
      }
      case 'removePoint': {
        const at = pointIds.indexOf(edit.id);
        if (at === -1 || edges.some((edge) => edge.start === edit.id || edge.end === edit.id)) return undefined;
        points.splice(at, 1);
        pointIds.splice(at, 1);
        break;
      }
      case 'movePoint': {
        const at = pointIds.indexOf(edit.id);
        if (at === -1) return undefined;
        points[at] = [edit.forw ?? points[at][0], edit.bakw ?? points[at][1]];
        break;
      }
      case 'addEdge': {
        if (edgeIds.includes(edit.id) || !pointIds.includes(edit.start) || !pointIds.includes(edit.end)) return undefined;
        const at = edit.position ?? edges.length;
        if (at < 0 || at > edges.length) return undefined;
        edges.splice(at, 0, { forwNodes: edit.forwNodes, bakwNodes: edit.bakwNodes, start: edit.start, end: edit.end });
        edgeIds.splice(at, 0, edit.id);
        nextEdgeId = Math.max(nextEdgeId, edit.id + 1);
        break;
      }
      case 'removeEdge': {
        const at = edgeIds.indexOf(edit.id);
        if (at === -1) return undefined;
        edges.splice(at, 1);
        edgeIds.splice(at, 1);
        break;
      }
      case 'replaceEdgeNodes': {
        const at = edgeIds.indexOf(edit.id);
        if (at === -1) return undefined;
        edges[at] = { ...edges[at], forwNodes: edit.forwNodes, bakwNodes: edit.bakwNodes };
        break;
      }
    }
  }
  const indexOf = new Map(pointIds.map((id, index) => [id, index]));
  return {
    points, pointIds, edgeIds, nextPointId, nextEdgeId,
    edges: edges.map((edge): PlannerEdge => [edge.forwNodes, edge.bakwNodes, [indexOf.get(edge.start)!, indexOf.get(edge.end)!]]),
  };
}

/** 添字の組（`[old, new]`、new の昇順）から、old が増加する最長の列を選ぶ。 */
function longestIncreasing(pairs: ReadonlyArray<readonly [number, number]>): Array<readonly [number, number]> {
  const tails: number[] = []; // 長さ k+1 の増加列の、最後の要素の pairs 添字（old が最小のもの）
  const previous: number[] = new Array(pairs.length).fill(-1);
  for (let i = 0; i < pairs.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][0] < pairs[i][0]) lo = mid + 1;
      else hi = mid;
    }
    previous[i] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = i;
  }
  const chosen: Array<readonly [number, number]> = [];
  for (let at = tails.length ? tails[tails.length - 1] : -1; at !== -1; at = previous[at]) chosen.push(pairs[at]);
  return chosen.reverse();
}

export interface PlannedEdits {
  edits: TinEdit[];
  /** 編集を当てた後の入力（id つき）。worker の網が、次の呼び出しの前に持つ入力と同じ */
  next: TrackedInputs;
}

/**
 * 今の入力（`prev`）から、新しい点・必須エッジ（Editor の配列）へ変える編集を作る。
 * 編集を作れない（当て直した結果が新しい配列と一致しない）ときは undefined。
 */
export function planEdits(
  prev: TrackedInputs,
  nextPoints: ReadonlyArray<ArrayLike<PlannerPosition>>,
  nextEdges: ReadonlyArray<PlannerEdge>,
): PlannedEdits | undefined {
  const target = nextPoints.map(copyPoint);

  // ---- 点の対応づけ（old 添字 ⇔ new 添字）----
  const byFull = new Map<string, number[]>();
  const byForw = new Map<string, number[]>();
  const byBakw = new Map<string, number[]>();
  const push = (map: Map<string, number[]>, key: string, index: number) => {
    const list = map.get(key);
    if (list) list.push(index);
    else map.set(key, [index]);
  };
  prev.points.forEach(([forw, bakw], index) => {
    push(byFull, `${positionKey(forw)}|${positionKey(bakw)}`, index);
    push(byForw, positionKey(forw), index);
    push(byBakw, positionKey(bakw), index);
  });
  const usedOld = new Set<number>();
  const take = (map: Map<string, number[]>, key: string): number | undefined => {
    const list = map.get(key);
    if (!list) return undefined;
    while (list.length) {
      const index = list.shift()!;
      if (!usedOld.has(index)) {
        usedOld.add(index);
        return index;
      }
    }
    return undefined;
  };
  const candidate = new Map<number, number>(); // new → old
  target.forEach(([forw, bakw], j) => {
    const old = take(byFull, `${positionKey(forw)}|${positionKey(bakw)}`);
    if (old !== undefined) candidate.set(j, old);
  });
  target.forEach(([forw, bakw], j) => {
    if (candidate.has(j)) return;
    const old = take(byForw, positionKey(forw)) ?? take(byBakw, positionKey(bakw));
    if (old !== undefined) candidate.set(j, old);
  });
  const pairs = [...candidate.entries()].sort((a, b) => a[0] - b[0]).map(([n, o]) => [o, n] as const);
  const kept = longestIncreasing(pairs); // 並びを保てる対応づけだけ
  const oldOf = new Map<number, number>(kept.map(([o, n]) => [n, o])); // new → old
  const matchedOld = new Set(kept.map(([o]) => o));

  const edits: TinEdit[] = [];
  const newPointIds: number[] = new Array(target.length);
  let nextPointId = prev.nextPointId;
  target.forEach((_, j) => {
    const old = oldOf.get(j);
    newPointIds[j] = old !== undefined ? prev.pointIds[old] : -1;
  });

  // ---- 必須エッジの対応づけ（端点の id の組）----
  const newIdOfIndex = (j: number) => newPointIds[j];
  // 新しい点に振る id（追加される点）。必須エッジの端点の id に要る
  target.forEach((_, j) => {
    if (newPointIds[j] === -1) newPointIds[j] = nextPointId++;
  });
  const edgeKey = (start: number, end: number) => `${start}>${end}`;
  const oldEdgeByKey = new Map<string, number[]>();
  prev.edges.forEach(([, , [start, end]], index) => {
    const key = edgeKey(prev.pointIds[start], prev.pointIds[end]);
    const list = oldEdgeByKey.get(key);
    if (list) list.push(index);
    else oldEdgeByKey.set(key, [index]);
  });
  const edgePairs: Array<readonly [number, number]> = [];
  nextEdges.forEach(([, , [start, end]], n) => {
    if (start >= target.length || end >= target.length || start < 0 || end < 0) return;
    const list = oldEdgeByKey.get(edgeKey(newIdOfIndex(start), newIdOfIndex(end)));
    const old = list?.shift();
    if (old !== undefined) edgePairs.push([old, n]);
  });
  const keptEdges = longestIncreasing(edgePairs);
  const oldEdgeOf = new Map<number, number>(keptEdges.map(([o, n]) => [n, o]));
  const matchedOldEdges = new Set(keptEdges.map(([o]) => o));

  // ---- 編集（必須エッジの削除 → 点の削除 → 点の移動 → 点の追加 → 折れ点 → 必須エッジの追加）----
  prev.edges.forEach((_, index) => {
    if (!matchedOldEdges.has(index)) edits.push({ type: 'removeEdge', id: prev.edgeIds[index] });
  });
  prev.points.forEach((_, index) => {
    if (!matchedOld.has(index)) edits.push({ type: 'removePoint', id: prev.pointIds[index] });
  });
  target.forEach(([forw, bakw], j) => {
    const old = oldOf.get(j);
    if (old === undefined) return;
    const [oldForw, oldBakw] = prev.points[old];
    const forwChanged = !samePosition(oldForw, forw);
    const bakwChanged = !samePosition(oldBakw, bakw);
    if (!forwChanged && !bakwChanged) return;
    edits.push({
      type: 'movePoint', id: prev.pointIds[old],
      ...(forwChanged ? { forw: copyPosition(forw) } : {}),
      ...(bakwChanged ? { bakw: copyPosition(bakw) } : {}),
    });
  });
  target.forEach(([forw, bakw], j) => {
    if (oldOf.has(j)) return;
    edits.push({ type: 'addPoint', id: newPointIds[j], forw: copyPosition(forw), bakw: copyPosition(bakw), position: j });
  });
  let nextEdgeId = prev.nextEdgeId;
  nextEdges.forEach(([forwNodes, bakwNodes], n) => {
    const old = oldEdgeOf.get(n);
    if (old === undefined) return;
    const [oldForwNodes, oldBakwNodes] = prev.edges[old];
    if (sameNodes(oldForwNodes, forwNodes) && sameNodes(oldBakwNodes, bakwNodes)) return;
    edits.push({
      type: 'replaceEdgeNodes', id: prev.edgeIds[old],
      forwNodes: forwNodes.map(copyPosition), bakwNodes: bakwNodes.map(copyPosition),
    });
  });
  nextEdges.forEach(([forwNodes, bakwNodes, [start, end]], n) => {
    if (oldEdgeOf.has(n)) return;
    edits.push({
      type: 'addEdge', id: nextEdgeId++,
      start: newPointIds[start], end: newPointIds[end],
      forwNodes: forwNodes.map(copyPosition), bakwNodes: bakwNodes.map(copyPosition),
      position: n,
    });
  });

  // ---- 検算: Tin と同じ規則で当て直して、新しい配列と一致すること ----
  const applied = applyEditsToTracked(prev, edits);
  if (!applied) return undefined;
  if (applied.points.length !== target.length || applied.edges.length !== nextEdges.length) return undefined;
  for (let j = 0; j < target.length; j++) {
    if (!samePosition(applied.points[j][0], target[j][0]) || !samePosition(applied.points[j][1], target[j][1])) return undefined;
  }
  for (let n = 0; n < nextEdges.length; n++) {
    const [forwNodes, bakwNodes, [start, end]] = nextEdges[n];
    const [aForw, aBakw, [aStart, aEnd]] = applied.edges[n];
    if (aStart !== start || aEnd !== end || !sameNodes(aForw, forwNodes) || !sameNodes(aBakw, bakwNodes)) return undefined;
  }
  return { edits, next: applied };
}
