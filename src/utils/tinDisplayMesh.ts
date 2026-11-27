/**
 * 画面が三角網を描くための「表示用の網」（MaplatTin#100・設計書 §9.2「座標だけの変化」・§9.3 の 2）。
 *
 * 頂点は頂点表（`VertexRef` → 座標）で持ち、三角形は頂点の指し方で持つ（三角形ごとに座標を複製しない）。
 * そうしないと、座標だけの変化（地理面だけのドラッグ）を、差分（`TinPatch#movedVertices`）で表せない。
 *
 * 作り方は 2 つ。
 * - 全部の三角形から: `replaceAll(snapshot)`。worker が全部組み直した結果（`TinMeshSnapshot`）を取り込む
 * - 差分から: `applyPatch(patch)`。`TinPatch`（`mode: "local"`）の、消えた三角形・頂点、増えた頂点・三角形、動いた頂点を当てる
 *
 * 差分の当て方が、全部作り直した網と一致することは、smoke（`tin-incremental-worker-smoke.mjs`）で確かめる。
 * 差分が壊れていたとき（知らない頂点・三角形を指す、版が飛ぶ、など）は、網に触らず失敗を返す。
 * 呼び出し側は、全部の取り直し（`rebuild`）へ戻る。
 */
import type { MeshPosition, TinMeshSnapshot, TinPatch, VertexRef } from '../workers/tinWorkerProtocol.ts';

/** 頂点の指し方を、表のキーにする。種類ごとに先頭の 1 文字が違うので、種類をまたいで衝突しない。 */
export function vertexKey(ref: VertexRef): string {
  switch (ref.kind) {
    case 'gcp': return `g${ref.id}`;
    case 'edgeNode': return `n${ref.edge}.${ref.order}`;
    case 'supplement': return `s${ref.key}`;
    case 'boundary': return `b${ref.order}`;
  }
}

export interface DisplayVertex {
  ref: VertexRef;
  forw: MeshPosition;
  bakw: MeshPosition;
}

export interface DisplayTriangle {
  id: number;
  /** 頂点表のキー（`vertexKey`）。向きは、受け取ったまま */
  keys: [string, string, string];
}

export type PatchRejection =
  /** 全部組み直しへ落ちた差分（`mode: "full"`）。差分は無いので、全部を取り直す */
  | 'notLocal'
  /** 前の版の次ではない（差分が抜けた・重なった） */
  | 'revisionGap'
  | 'unknownVertex'
  | 'duplicateVertex'
  | 'unknownTriangle'
  | 'duplicateTriangle'
  /** 消した頂点を、残った三角形がまだ指している */
  | 'danglingVertex';

export type PatchApplyResult =
  | { ok: true; /** 差し替えた範囲の外接矩形（紙の面）。描き直す範囲に使う */ dirtyBounds?: [number, number, number, number] }
  | { ok: false; reason: PatchRejection };

/** 比べるための正規の形（三角形の id と順は問わない。向きは保つ）。 */
export interface CanonicalDisplayMesh {
  vertices: Array<[key: string, forw: MeshPosition, bakw: MeshPosition]>;
  /** 各三角形を、最小のキーから始まるように回した 3 つのキーを `|` でつないだ文字列。昇順 */
  triangles: string[];
  centroid?: TinMeshSnapshot['centroid'];
  verticesParams?: number[][];
  supplementPairs?: TinMeshSnapshot['supplementPairs'];
  badTriangles?: number;
  boundaryStale: boolean;
}

export class TinDisplayMesh {
  private readonly vertexTable = new Map<string, DisplayVertex>();
  private readonly triangleTable = new Map<number, DisplayTriangle>();
  /** 頂点を指している三角形の数（消す頂点が、残った三角形に指されていないかの確かめに使う） */
  private readonly uses = new Map<string, number>();
  private meta: Pick<TinMeshSnapshot, 'centroid' | 'verticesParams' | 'supplementPairs' | 'badTriangles' | 'boundaryStale'> = {
    boundaryStale: false,
  };
  /** 最後に取り込んだ差分の版（全部の取り込みでは、渡した版） */
  revision = 0;

  get vertexCount(): number {
    return this.vertexTable.size;
  }

  get triangleCount(): number {
    return this.triangleTable.size;
  }

  get boundaryStale(): boolean {
    return this.meta.boundaryStale;
  }

  /** ok でない三角形の id（最後に差分か全部の取り込みで入った値） */
  get badTriangles(): readonly number[] {
    return this.meta.badTriangles ?? [];
  }

  vertex(ref: VertexRef): DisplayVertex | undefined {
    return this.vertexTable.get(vertexKey(ref));
  }

  triangle(id: number): DisplayTriangle | undefined {
    return this.triangleTable.get(id);
  }

  clear(): void {
    this.vertexTable.clear();
    this.triangleTable.clear();
    this.uses.clear();
    this.meta = { boundaryStale: false };
    this.revision = 0;
  }

  /** 全部の三角形から作り直す。 */
  replaceAll(snapshot: TinMeshSnapshot, revision = 0): void {
    this.clear();
    for (const { ref, forw, bakw } of snapshot.vertices) {
      this.vertexTable.set(vertexKey(ref), { ref: { ...ref }, forw: [...forw], bakw: [...bakw] });
    }
    for (const { id, vertices } of snapshot.triangles) {
      const keys = vertices.map(vertexKey) as [string, string, string];
      this.triangleTable.set(id, { id, keys });
      for (const key of keys) this.uses.set(key, (this.uses.get(key) ?? 0) + 1);
    }
    this.meta = cloneMeta(snapshot);
    this.revision = revision;
  }

  /** 差分を当てる。失敗したら、網には触らない。 */
  applyPatch(patch: TinPatch): PatchApplyResult {
    if (patch.mode !== 'local') return { ok: false, reason: 'notLocal' };
    if (patch.revision !== this.revision + 1) return { ok: false, reason: 'revisionGap' };

    const undo: Array<() => void> = [];
    const rollback = () => {
      for (let i = undo.length - 1; i >= 0; i--) undo[i]();
    };
    const fail = (reason: PatchRejection): PatchApplyResult => {
      rollback();
      return { ok: false, reason };
    };
    const attach = (triangle: DisplayTriangle) => {
      this.triangleTable.set(triangle.id, triangle);
      for (const key of triangle.keys) this.uses.set(key, (this.uses.get(key) ?? 0) + 1);
    };
    const detach = (triangle: DisplayTriangle) => {
      this.triangleTable.delete(triangle.id);
      for (const key of triangle.keys) {
        const next = (this.uses.get(key) ?? 0) - 1;
        if (next > 0) this.uses.set(key, next);
        else this.uses.delete(key);
      }
    };

    // 1. 消えた三角形
    for (const id of patch.removedTriangles ?? []) {
      const triangle = this.triangleTable.get(id);
      if (!triangle) return fail('unknownTriangle');
      detach(triangle);
      undo.push(() => attach(triangle));
    }
    // 2. 消えた頂点（もう、残った三角形から指されていないこと）
    for (const ref of patch.removedVertices ?? []) {
      const key = vertexKey(ref);
      const vertex = this.vertexTable.get(key);
      if (!vertex) return fail('unknownVertex');
      if (this.uses.has(key)) return fail('danglingVertex');
      this.vertexTable.delete(key);
      undo.push(() => this.vertexTable.set(key, vertex));
    }
    // 3. 増えた頂点
    for (const { ref, forw, bakw } of patch.addedVertices ?? []) {
      const key = vertexKey(ref);
      if (this.vertexTable.has(key)) return fail('duplicateVertex');
      this.vertexTable.set(key, { ref: { ...ref }, forw: [...forw], bakw: [...bakw] });
      undo.push(() => this.vertexTable.delete(key));
    }
    // 4. 動いた頂点（接続が変わらなくても入る）
    for (const { ref, forw, bakw } of patch.movedVertices ?? []) {
      const key = vertexKey(ref);
      const vertex = this.vertexTable.get(key);
      if (!vertex) return fail('unknownVertex');
      const before = { forw: vertex.forw, bakw: vertex.bakw };
      vertex.forw = [...forw];
      vertex.bakw = [...bakw];
      undo.push(() => Object.assign(vertex, before));
    }
    // 5. 増えた三角形（頂点は、ここまでにそろっていること）
    for (const { id, vertices } of patch.addedTriangles ?? []) {
      if (this.triangleTable.has(id)) return fail('duplicateTriangle');
      const keys = vertices.map(vertexKey) as [string, string, string];
      if (keys.some((key) => !this.vertexTable.has(key))) return fail('unknownVertex');
      const triangle: DisplayTriangle = { id, keys };
      attach(triangle);
      undo.push(() => detach(triangle));
    }

    // 全部が当たった。付随の値は、入っているものだけを置き換える（入っていなければ前のまま）
    if (patch.centroid) this.meta.centroid = { forw: [...patch.centroid.forw], bakw: [...patch.centroid.bakw] };
    if (patch.verticesParams) this.meta.verticesParams = patch.verticesParams.map((row) => [...row]);
    if (patch.supplementPairs) this.meta.supplementPairs = structuredClone(patch.supplementPairs);
    if (patch.badTriangles) this.meta.badTriangles = [...patch.badTriangles];
    this.meta.boundaryStale = patch.boundaryStale;
    this.revision = patch.revision;
    return { ok: true, ...(patch.dirtyBounds ? { dirtyBounds: patch.dirtyBounds } : {}) };
  }

  /** 描くための座標（面ごと）。三角形は id の昇順。 */
  triangleCoordinates(side: 'forw' | 'bakw'): Array<[MeshPosition, MeshPosition, MeshPosition]> {
    return [...this.triangleTable.values()]
      .sort((a, b) => a.id - b.id)
      .map(({ keys }) => keys.map((key) => this.vertexTable.get(key)![side]) as [MeshPosition, MeshPosition, MeshPosition]);
  }

  /** 今の全部を、取り込み用の形で返す（頂点はキー順、三角形は id 順）。 */
  toSnapshot(): TinMeshSnapshot {
    return {
      vertices: [...this.vertexTable.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, { ref, forw, bakw }]) => ({ ref: { ...ref }, forw: [...forw], bakw: [...bakw] })),
      triangles: [...this.triangleTable.values()]
        .sort((a, b) => a.id - b.id)
        .map(({ id, keys }) => ({ id, vertices: keys.map((key) => ({ ...this.vertexTable.get(key)!.ref })) as TinMeshSnapshot['triangles'][number]['vertices'] })),
      ...cloneMeta(this.meta),
    };
  }

  /** 三角形の id を問わずに比べるための正規の形。 */
  canonical(): CanonicalDisplayMesh {
    const triangles = [...this.triangleTable.values()].map(({ keys }) => {
      // 向きを保ったまま、最小のキーから始まるように回す
      let start = 0;
      for (let i = 1; i < 3; i++) if (keys[i] < keys[start]) start = i;
      return [keys[start], keys[(start + 1) % 3], keys[(start + 2) % 3]].join('|');
    }).sort();
    return {
      vertices: [...this.vertexTable.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, { forw, bakw }]) => [key, [...forw], [...bakw]]),
      triangles,
      ...(this.meta.centroid ? { centroid: this.meta.centroid } : {}),
      ...(this.meta.verticesParams ? { verticesParams: this.meta.verticesParams } : {}),
      ...(this.meta.supplementPairs ? { supplementPairs: this.meta.supplementPairs } : {}),
      // 不良な三角形は id で持つので、id を問わない比較では件数だけを見る
      badTriangles: this.meta.badTriangles?.length ?? 0,
      boundaryStale: this.meta.boundaryStale,
    };
  }
}

function cloneMeta(
  source: Pick<TinMeshSnapshot, 'centroid' | 'verticesParams' | 'supplementPairs' | 'badTriangles' | 'boundaryStale'>,
): Pick<TinMeshSnapshot, 'centroid' | 'verticesParams' | 'supplementPairs' | 'badTriangles' | 'boundaryStale'> {
  return {
    ...(source.centroid ? { centroid: { forw: [...source.centroid.forw], bakw: [...source.centroid.bakw] } } : {}),
    ...(source.verticesParams ? { verticesParams: source.verticesParams.map((row) => [...row]) } : {}),
    ...(source.supplementPairs ? { supplementPairs: structuredClone(source.supplementPairs) } : {}),
    ...(source.badTriangles ? { badTriangles: [...source.badTriangles] } : {}),
    boundaryStale: source.boundaryStale,
  };
}
