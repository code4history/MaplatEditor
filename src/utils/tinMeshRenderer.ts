/**
 * 表示用の網（`TinDisplayMesh`）を、地図の上の三角形として描く（MaplatTin#100・設計書 §9.3 の 2）。
 *
 * 地図の部品（OpenLayers）には触らず、入口と出口（`TinMeshRenderIO`）を受け取る。画面の側は、座標の変換と、
 * 図形の作成・出し入れだけを渡す。
 *
 * - `renderAll`: 全部の三角形を描き直す
 * - `applyChange`: 差分（`PatchChange`）で、消えた三角形を外し、増えた三角形を足し、頂点が動いた三角形の形を作り直す。
 *   当たっていない三角形には触らない
 *
 * 描いた時点の網の番号（`TinDisplayMesh#version`）を覚え、画面の側が「今描いてあるのは今の網か」を `isCurrentFor` で確かめる。
 */
import type { PatchChange, TinDisplayMesh } from './tinDisplayMesh.ts';

export type TinMeshSide = 'forw' | 'bakw';

export interface TinMeshRenderIO<F> {
  /** 紙の面の座標（頂点の `forw`）を、地図の座標へ。変換できなければ false */
  forwToMap(position: number[]): number[] | false;
  /** 地理面の座標（頂点の `bakw`。網の内部の座標系）を、地図の座標へ。変換できなければ false */
  bakwToMap(position: number[]): number[] | false;
  /** 三角形の図形（閉じた輪）を作る */
  createPolygon(side: TinMeshSide, ring: number[][]): F;
  add(side: TinMeshSide, features: F[]): void;
  remove(side: TinMeshSide, features: F[]): void;
}

interface DrawnTriangle<F> {
  forw?: F;
  bakw?: F;
}

export class TinMeshRenderer<F> {
  private readonly io: TinMeshRenderIO<F>;
  private drawn = new Map<number, DrawnTriangle<F>>();
  private owned = new Set<F>();
  private mesh: TinDisplayMesh | undefined;
  private version = -1;

  constructor(io: TinMeshRenderIO<F>) {
    this.io = io;
  }

  get triangleCount(): number {
    return this.drawn.size;
  }

  /** 図形（`createPolygon` が作ったもの）か。三角形以外の図形（交差の点など）と区別するのに使う。 */
  owns(feature: F): boolean {
    return this.owned.has(feature);
  }

  /** いま描いてあるのが、この網の今の状態か。 */
  isCurrentFor(mesh: TinDisplayMesh): boolean {
    return this.mesh === mesh && this.version === mesh.version;
  }

  /** 差分 1 つぶんだけ進めれば、今の網になるか（差分の描き直しが使える状態か）。 */
  isOneBehind(mesh: TinDisplayMesh): boolean {
    return this.mesh === mesh && this.version + 1 === mesh.version;
  }

  /** 描いてあるものを、出し入れせずに忘れる（画面の側が、図形の入れ物ごと空にしたとき）。 */
  forget(): void {
    this.drawn = new Map();
    this.owned = new Set();
    this.mesh = undefined;
    this.version = -1;
  }

  private triangleRing(mesh: TinDisplayMesh, id: number, side: TinMeshSide): number[][] | undefined {
    const triangle = mesh.triangle(id);
    if (!triangle) return undefined;
    const convert = side === 'forw' ? this.io.forwToMap : this.io.bakwToMap;
    const ring: number[][] = [];
    for (const key of triangle.keys) {
      const vertex = mesh.vertexByKey(key);
      if (!vertex) return undefined;
      const point = convert.call(this.io, vertex[side]);
      if (point === false) return undefined;
      ring.push(point);
    }
    ring.push(ring[0]);
    return ring;
  }

  private create(mesh: TinDisplayMesh, id: number): DrawnTriangle<F> {
    const drawn: DrawnTriangle<F> = {};
    for (const side of ['forw', 'bakw'] as const) {
      const ring = this.triangleRing(mesh, id, side);
      if (ring) {
        drawn[side] = this.io.createPolygon(side, ring);
        this.owned.add(drawn[side]!);
      }
    }
    return drawn;
  }

  private drop(drawn: DrawnTriangle<F>): void {
    for (const side of ['forw', 'bakw'] as const) {
      const feature = drawn[side];
      if (feature !== undefined) this.owned.delete(feature);
    }
  }

  /** 全部の三角形を描き直す（前に描いたものは外す）。 */
  renderAll(mesh: TinDisplayMesh): void {
    for (const side of ['forw', 'bakw'] as const) {
      const old = [...this.drawn.values()].flatMap((entry) => (entry[side] === undefined ? [] : [entry[side] as F]));
      if (old.length) this.io.remove(side, old);
    }
    this.forget();
    const forw: F[] = [];
    const bakw: F[] = [];
    for (const { id } of mesh.toSnapshot().triangles) {
      const entry = this.create(mesh, id);
      this.drawn.set(id, entry);
      if (entry.forw !== undefined) forw.push(entry.forw);
      if (entry.bakw !== undefined) bakw.push(entry.bakw);
    }
    if (forw.length) this.io.add('forw', forw);
    if (bakw.length) this.io.add('bakw', bakw);
    this.mesh = mesh;
    this.version = mesh.version;
  }

  /** 差分で描き直す。`mesh` は、差分を当てた後の網。 */
  applyChange(mesh: TinDisplayMesh, change: PatchChange): void {
    const removed: DrawnTriangle<F>[] = [];
    const added = new Map<number, DrawnTriangle<F>>();
    for (const id of change.removedTriangles) {
      const entry = this.drawn.get(id);
      if (entry) {
        removed.push(entry);
        this.drawn.delete(id);
      }
    }
    // 頂点が動いた三角形は、形を作り直す（外して、作って、足す）
    for (const id of change.movedTriangles) {
      const entry = this.drawn.get(id);
      if (entry) removed.push(entry);
      added.set(id, this.create(mesh, id));
    }
    for (const id of change.addedTriangles) added.set(id, this.create(mesh, id));
    for (const side of ['forw', 'bakw'] as const) {
      const out = removed.flatMap((entry) => (entry[side] === undefined ? [] : [entry[side] as F]));
      if (out.length) this.io.remove(side, out);
      const into = [...added.values()].flatMap((entry) => (entry[side] === undefined ? [] : [entry[side] as F]));
      if (into.length) this.io.add(side, into);
    }
    for (const entry of removed) this.drop(entry);
    for (const [id, entry] of added) this.drawn.set(id, entry);
    this.mesh = mesh;
    this.version = mesh.version;
  }
}
