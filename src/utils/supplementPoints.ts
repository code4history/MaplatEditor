/**
 * 補完点（supplementPairs）と三角網の表示部品（外挿四辺形・補助頂点・内分点）の表示用の読み取りと、
 * 対応点への格上げ（MaplatEditor#321）。
 *
 * 補完点は Tin が作るもの（MaplatTin#89）で、人間の対応点（gcps）には入れない。画面は 2 つの
 * 出し方から読む。
 * - 局所更新（設定 incrementalEdits）が入っているとき: 表示用の網（`TinDisplayMesh`）が持つ
 *   補完点の対（`VertexRef` で指す。点の追加・削除で添字がずれない）
 * - 局所更新が切のとき: compiled の `supplementPairs`（座標は `edgeNodes[node]`）
 *
 * 読み取りは純粋で、文書（gcps・edges・mapData）を一切変えない。文書へ書き込むのは格上げ
 * （`supplementPointToGcp`）だけで、位置や数が変わっても未保存の変更には数えない。
 */
import { compiledPointToExternalCrs } from './compiledGeo.ts';
import type { YaxisMode } from '@maplat/transform';
import type { TinDisplayMesh } from './tinDisplayMesh.ts';
import type { TinMeshSupplementPair, VertexRef } from '../workers/tinWorkerProtocol.ts';

/** compiled の `supplementPairs` の 1 件（MaplatTin#89 §4.1。Transform の型には無いので写す）。 */
export interface CompiledSupplementPairRecord {
  /** `edgeNodes` の中の位置。座標は `edgeNodes[node]` に 1 か所だけ持つ */
  node: number;
  /** 補完点を足した理由。今は `"hullEdge"` だけ */
  kind: string;
  /** 足した凸包の辺の両端（対応点は数、中継点・補完点は `"e12"`） */
  edge: [number | string, number | string];
  /** いちばん凹んだ所の点の添字（無ければ省く） */
  anchor?: number | string;
}

/** compiled の補完点が入る形（`CompiledTransformData` への追加項目）。 */
export type CompiledWithSupplementPairs = {
  edgeNodes?: [number[], number[]][];
  vertices_points?: [number[], number[]][];
  supplementPairs?: CompiledSupplementPairRecord[];
};

/** 辺・anchor を指す頂点。GCP は添字（0 起点）、それ以外は技術的な id の文字列。 */
export type SupplementVertexLabel =
  | { gcpIndex: number }
  | { text: string };

/** 画面に渡す補完点 1 件。座標は内部の座標（compiled と同じ）。 */
export interface SupplementPointView {
  /** 一覧・印の識別子（表示用の網の `vertexKey`、compiled は `s{node}`） */
  key: string;
  /** 紙の面の座標 */
  forw: number[];
  /** 地理の面の座標 */
  bakw: number[];
  /** 種類（`"hullEdge"` など） */
  kind: string;
  /** 足した凸包の辺の両端 */
  edge: [SupplementVertexLabel, SupplementVertexLabel];
  /** いちばん凹んだ所の点（無ければ undefined） */
  anchor?: SupplementVertexLabel;
}

function labelOfVertexRef(ref: VertexRef): SupplementVertexLabel {
  switch (ref.kind) {
    case 'gcp': return { gcpIndex: ref.id };
    case 'edgeNode': return { text: `e${ref.edge}.${ref.order}` };
    case 'boundary': return { text: `b${ref.order}` };
    case 'supplement': return { text: ref.key };
  }
}

function labelOfCompiledId(id: number | string): SupplementVertexLabel {
  return typeof id === 'number' ? { gcpIndex: id } : { text: id };
}

/** 頂点のラベル文字列（GCP はマーカーと同じ 1 起きの番号、それ以外は技術的な id）。 */
export function supplementVertexText(label: SupplementVertexLabel): string {
  return 'gcpIndex' in label ? String(label.gcpIndex + 1) : label.text;
}

/** 表示用の網から補完点を読む（局所更新が入っているとき）。 */
export function supplementPointsFromDisplayMesh(mesh: TinDisplayMesh): SupplementPointView[] {
  const views: SupplementPointView[] = [];
  for (const pair of mesh.supplementPairs as TinMeshSupplementPair[]) {
    const vertex = mesh.vertex(pair.node);
    if (!vertex) continue;
    views.push({
      key: `s${pair.node.kind === 'supplement' ? pair.node.key : JSON.stringify(pair.node)}`,
      forw: [...vertex.forw],
      bakw: [...vertex.bakw],
      kind: pair.kind,
      edge: [labelOfVertexRef(pair.edge[0]), labelOfVertexRef(pair.edge[1])],
      ...(pair.anchor ? { anchor: labelOfVertexRef(pair.anchor) } : {}),
    });
  }
  return views;
}

/** compiled から補完点を読む（局所更新が切のとき）。 */
export function supplementPointsFromCompiled(compiled: unknown): SupplementPointView[] {
  const data = compiled as CompiledWithSupplementPairs | null | undefined;
  if (!data || typeof data !== 'object') return [];
  const records = data.supplementPairs;
  const edgeNodes = data.edgeNodes;
  if (!Array.isArray(records) || !Array.isArray(edgeNodes)) return [];
  const views: SupplementPointView[] = [];
  for (const record of records) {
    const node = edgeNodes[record.node];
    if (!node || !Array.isArray(node[0]) || !Array.isArray(node[1])) continue;
    views.push({
      key: `s${record.node}`,
      forw: [...node[0]],
      bakw: [...node[1]],
      kind: record.kind,
      edge: [labelOfCompiledId(record.edge[0]), labelOfCompiledId(record.edge[1])],
      ...(record.anchor !== undefined ? { anchor: labelOfCompiledId(record.anchor) } : {}),
    });
  }
  return views;
}

/** GCP と同じ形で格上げする 1 件分の対応点 `[紙, 地理, 層]` を作る。 */
export function supplementPointToGcp(
  view: SupplementPointView,
  layerIndex: number,
  yaxisMode?: YaxisMode,
): [number[], number[], number] {
  // 丸めない（MaplatEditor#321 レビュー指摘）。Tin が置いた座標をそのまま入れないと、短い凸包の辺で
  // 丸め差の分だけ内側へ戻り、格上げした辺に補完点がもう一度付く。紙の面も地理面もそのまま使う。
  const paper = [view.forw[0], view.forw[1]];
  const geo = compiledPointToExternalCrs(view.bakw, yaxisMode).slice(0, 2);
  return [paper, geo, layerIndex];
}

// ---- 三角網の表示部品（外挿四辺形・補助頂点・内分点。MaplatEditor#321） ----
// 凡例と同じ #3454d1 で描くもの。補完点と同じく Tin の派生データで、文書には入れない。

/** 面ごとの座標 1 つ（内部の座標。compiled と同じ）。 */
export interface TinMeshDecorPoint {
  forw: number[];
  bakw: number[];
}

/** 地図に描く三角網の表示部品。 */
export interface TinMeshDecor {
  /** 外挿四辺形の輪（閉じた線。先頭の点を末尾に重ねる）。無いときは null */
  quadrilateral: { forw: number[][]; bakw: number[][] } | null;
  /** 補助頂点（四角の印。輪の順） */
  auxiliaryVertices: TinMeshDecorPoint[];
  /** 内分点（対応線の edgeNodes。白抜きの丸） */
  proportionalPoints: TinMeshDecorPoint[];
}

export const EMPTY_TIN_MESH_DECOR: TinMeshDecor = { quadrilateral: null, auxiliaryVertices: [], proportionalPoints: [] };

/** compiled の `vertices_points`（外挿四辺形の上の補助頂点の輪）と `edgeNodes` から表示部品を作る。 */
export function tinDecorFromCompiled(compiled: unknown): TinMeshDecor {
  const data = compiled as CompiledWithSupplementPairs | null | undefined;
  if (!data || typeof data !== 'object') return EMPTY_TIN_MESH_DECOR;
  const ring = Array.isArray(data.vertices_points) ? data.vertices_points : [];
  const auxiliaryVertices: TinMeshDecorPoint[] = ring
    .filter((entry) => Array.isArray(entry) && Array.isArray(entry[0]) && Array.isArray(entry[1]))
    .map(([forw, bakw]) => ({ forw: [...forw], bakw: [...bakw] }));
  const quadrilateral = auxiliaryVertices.length >= 3
    ? {
        forw: [...auxiliaryVertices.map((point) => point.forw), auxiliaryVertices[0].forw],
        bakw: [...auxiliaryVertices.map((point) => point.bakw), auxiliaryVertices[0].bakw],
      }
    : null;
  // 内分点は edgeNodes のうち補完点（supplementPairs が指す node）を除いたもの
  const supplementNodes = new Set((data.supplementPairs ?? []).map((record) => record.node));
  const edgeNodes = Array.isArray(data.edgeNodes) ? data.edgeNodes : [];
  const proportionalPoints: TinMeshDecorPoint[] = edgeNodes
    .map((entry, index) => (supplementNodes.has(index) ? undefined : entry))
    .filter((entry): entry is [number[], number[]] => Array.isArray(entry) && Array.isArray(entry[0]) && Array.isArray(entry[1]))
    .map(([forw, bakw]) => ({ forw: [...forw], bakw: [...bakw] }));
  return { quadrilateral, auxiliaryVertices, proportionalPoints };
}

/** 表示用の網から表示部品を作る（局所更新が入っているとき）。 */
export function tinDecorFromDisplayMesh(mesh: TinDisplayMesh): TinMeshDecor {
  const boundary: TinMeshDecorPoint[] = [];
  const proportionalPoints: TinMeshDecorPoint[] = [];
  for (const { ref, forw, bakw } of mesh.toSnapshot().vertices) {
    if (ref.kind === 'boundary') boundary[ref.order] = { forw: [...forw], bakw: [...bakw] };
    else if (ref.kind === 'edgeNode') proportionalPoints.push({ forw: [...forw], bakw: [...bakw] });
  }
  const auxiliaryVertices = boundary.filter((point): point is TinMeshDecorPoint => !!point);
  const quadrilateral = auxiliaryVertices.length >= 3
    ? {
        forw: [...auxiliaryVertices.map((point) => point.forw), auxiliaryVertices[0].forw],
        bakw: [...auxiliaryVertices.map((point) => point.bakw), auxiliaryVertices[0].bakw],
      }
    : null;
  return { quadrilateral, auxiliaryVertices, proportionalPoints };
}

/** 画面に渡す三角網の表示データ（補完点＋表示部品）。 */
export interface SupplementDisplay {
  points: SupplementPointView[];
  decor: TinMeshDecor;
}

export const EMPTY_SUPPLEMENT_DISPLAY: SupplementDisplay = { points: [], decor: EMPTY_TIN_MESH_DECOR };

/**
 * 補完点と表示部品を読む（MaplatEditor#321）。
 *
 * - `tinLike` が三角網のオブジェクトでなければ空（Plan A（ワールドファイルだけ）・エラーの層では描かない）
 * - 局所更新が入っているとき（`mesh` に三角形があるとき）は表示用の網から、切のときは compiled から
 */
export function supplementDisplayOf(tinLike: unknown, mesh?: TinDisplayMesh | null): SupplementDisplay {
  if (!tinLike || typeof tinLike !== 'object' || typeof (tinLike as { getCompiled?: unknown }).getCompiled !== 'function') {
    return EMPTY_SUPPLEMENT_DISPLAY;
  }
  const compiled = (tinLike as { getCompiled(): unknown }).getCompiled();
  if (mesh && mesh.triangleCount > 0) {
    return { points: supplementPointsFromDisplayMesh(mesh), decor: tinDecorFromDisplayMesh(mesh) };
  }
  return { points: supplementPointsFromCompiled(compiled), decor: tinDecorFromCompiled(compiled) };
}
