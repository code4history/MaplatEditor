"use strict";

import {
  MapTransform,
  Transform,
  WorldFileSurface,
  validateWorldFile,
  type CompiledTransformData,
  type CrsObject,
  type LayeredMapData,
  type WorldFile,
  PointSet,
  EdgeSet,
  StrictMode,
  VertexMode,
  YaxisMode
} from "@maplat/transform";
import type { Position } from "geojson";
import { projectionEngineForCrs } from "../../src/utils/compiledGeo";
import { isAllowedDeliveryUrl } from "../../src/utils/ipClassify";
type LangResource = string | Record<string, string>;
type TinLike = string | Transform | CompiledTransformData;
const compiledByTransform = new WeakMap<Transform, CompiledTransformData>();

interface StoredLayer {
  crs?: CrsObject;
  worldFile?: WorldFile;
  tinEnabled?: boolean;
  width?: number;
  height?: number;
  gcps?: PointSet[];
  edges?: EdgeSet[];
  compiled?: CompiledTransformData;
  bounds?: number[][];
}

/** IIIF Image API の画像を配るための情報。 */
export interface IiifDelivery {
  type: "iiifImage";
  url: string;
}

/** IIIF から取り込んだときの結び付きの記録。 */
export interface IiifSection {
  manifest?: string;
  canvas?: string;
  image?: string;
  bindings?: Record<string, unknown>;
  copiedValues?: Record<string, unknown>;
  copiedMetadata?: unknown[];
  copiedAt?: string;
  [key: string]: unknown;
}

export interface HistMapStore extends StoredLayer {
  title: LangResource;
  // 表示ラベル。多言語 (LangResource)。keys へも必ず追加する
  // (無いと MapEditService.save の histMap2Store で保存時に消える。ライセンスの欄の追加の licenseNote /
  //  地図の POI 保存の pois と同じ穴。ただし前 2 件と違い label は「保存されていた値が落ちるように
  //  なった」のではなく「器そのものが最初から無く一度も保存されたことがない」)
  label: LangResource;
  attr: LangResource;
  dataAttr: LangResource;
  strictMode?: StrictMode;
  vertexMode?: VertexMode;
  yaxisMode?: YaxisMode;
  author: LangResource;
  createdAt: LangResource;
  era: LangResource;
  license: string;
  dataLicense: string;
  // ライセンスの自由記述欄。多言語 (LangResource)。keys へも必ず追加する
  // (無いと MapEditService.save の histMap2Store で保存時に消える。地図の POI 保存の pois と同じ穴)
  licenseNote: LangResource;
  dataLicenseNote: LangResource;
  contributor: LangResource;
  mapper: LangResource;
  reference: string;
  description: LangResource;
  // url は利用者が指定する交換形のタイルURLテンプレート（単一文字列）であり、
  // 多言語リソースではない。LangResource だったのは MaplatCore 側の i18n 分離時に
  // メタデータの型を一括拡張した際の巻き添えで、それがこの写しにも及んでいた
  url: string;
  lang: string;
  imageExtension: string;
  sub_maps: SubMap[];
  homePosition: Position;
  mercZoom: number;
  // POI 配列: {poiUid, cachedTitle} 参照要素と生要素 (URL/FC) の混在。
  // シリアライズ両方向 (histMap2Store / store2HistMap) で素通し保持する
  pois?: unknown[];
  // IIIF から取り込んだ地図の配信情報と結び付きの記録。keys へも必ず追加する
  // (無いと histMap2Store の保存で消える。licenseNote / pois と同じ穴)
  delivery?: IiifDelivery;
  iiif?: IiifSection;
}

interface SubMap extends StoredLayer {
  priority: number;
  importance: number;
}

const keys: (keyof HistMapStore)[] = [
  "title",
  "label",
  "attr",
  "dataAttr",
  "author",
  "createdAt",
  "era",
  "license",
  "dataLicense",
  "licenseNote",
  "dataLicenseNote",
  "contributor",
  "mapper",
  "reference",
  "description",
  "url",
  "lang",
  "imageExtension",
  "homePosition",
  "mercZoom",
  "crs",
  "worldFile",
  "tinEnabled",
  "pois",
  "delivery",
  "iiif"
];

export function hasLayerTransformDeclaration(layer: StoredLayer): boolean {
  return layer.tinEnabled === false || layer.crs !== undefined ||
    (layer.compiled != null && typeof layer.compiled === "object" && "outerTransform" in layer.compiled);
}

export function imageCorners(layer: StoredLayer): number[][] | undefined {
  const { width, height } = layer;
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0 ||
      typeof height !== "number" || !Number.isFinite(height) || height <= 0) return undefined;
  return [[0, 0], [width, 0], [width, height], [0, height]];
}

export function readWorldFileSurface(layer: StoredLayer, isSubMap: boolean): WorldFileSurface {
  if (Object.hasOwn(layer, "compiled")) {
    throw new Error("tinEnabled:false の層は compiled を持てません");
  }
  const { crs, worldFile, bounds, width, height } = layer;
  if (!crs) throw new Error("ワールドファイルの層には crs が必要です");
  if (!worldFile) throw new Error("tinEnabled:false の層には worldFile が必要です");

  const options = { crs, worldFile, projectionEngine: projectionEngineForCrs(crs) };
  if (isSubMap) {
    if (!Array.isArray(bounds) || bounds.length < 3) {
      throw new Error("ワールドファイルの副層には 3 頂点以上の bounds が必要です");
    }
    const surface = new WorldFileSurface({ ...options, bounds: bounds as [number[], number[], number[], ...number[][]] });
    validateSubMapBounds(bounds, surface);
    return surface;
  }
  if (!imageCorners(layer)) {
    throw new Error("ワールドファイルの主図には正の有限な width と height が必要です");
  }
  return new WorldFileSurface({ ...options, wh: [width!, height!] });
}

function cleanCompiled(compiled: CompiledTransformData | undefined) {
  if (!compiled || typeof compiled !== "object" || !("worldFile" in compiled) ||
      ("outerTransform" in compiled && compiled.outerTransform === "worldFile")) return compiled;
  const cleaned = { ...compiled };
  Reflect.deleteProperty(cleaned, "worldFile");
  return cleaned;
}

function cleanStoredLayer<T extends StoredLayer>(layer: T): T {
  if (!layer || typeof layer !== "object" || Array.isArray(layer)) {
    throw new Error("地図の層はオブジェクトで指定してください");
  }
  const cleaned = { ...layer };
  Reflect.deleteProperty(cleaned, "outerTransform");
  if (layer.tinEnabled !== false) {
    delete cleaned.tinEnabled;
    delete cleaned.worldFile;
    if (layer.compiled) cleaned.compiled = cleanCompiled(layer.compiled);
  }
  return cleaned;
}

export function normalizeStoredTransformKeys<T extends HistMapStore>(store: T): T {
  const cleaned = cleanStoredLayer(store);
  if (store.sub_maps !== undefined) {
    if (!Array.isArray(store.sub_maps)) throw new Error("sub_maps は配列で指定してください");
    cleaned.sub_maps = store.sub_maps.map(cleanStoredLayer);
  }
  return cleaned;
}

function validateSubMapBounds(bounds: number[][] | undefined, surface: Transform | WorldFileSurface) {
  if (!Array.isArray(bounds) || bounds.length < 3) {
    throw new Error("副層には 3 頂点以上の bounds または compiled.bounds が必要です");
  }
  if (bounds.some(xy => !Array.isArray(xy) || xy.length < 2 ||
      !Number.isFinite(xy[0]) || !Number.isFinite(xy[1]) || surface.transform(xy, false) === false)) {
    throw new Error("副層の bounds を変換できません");
  }
}

function validateStoredCrs(crs: CrsObject) {
  // 三角網が無い場合も Core と同じ CRS の定義検査を通す。
  new WorldFileSurface({
    crs,
    worldFile: { xScale: 1, xSkew: 0, xOrigin: 0, ySkew: 0, yScale: -1, yOrigin: 0 },
    wh: [1, 1],
    projectionEngine: projectionEngineForCrs(crs),
  });
}

/** 範囲検索に必要な定義を、三角網全体を復元せずに検査する。 */
export function validateCompiledGeo(layer: StoredLayer) {
  if (layer.crs !== undefined) validateStoredCrs(layer.crs);
  const { compiled } = layer;
  if (compiled && "outerTransform" in compiled && compiled.outerTransform === "worldFile") {
    if (!compiled.worldFile) throw new Error("compiled.worldFile が必要です");
    validateWorldFile(compiled.worldFile);
  }
}

function readStoredTin(layer: StoredLayer, isSubMap = false): Transform | undefined {
  const { crs, compiled, bounds } = layer;
  if (!compiled) {
    if (crs !== undefined) validateStoredCrs(crs);
    return undefined;
  }

  let transform: Transform;
  if (crs !== undefined) {
    const data: LayeredMapData = {
      main: { kind: "tin", crs, compiled, bounds, projectionEngine: projectionEngineForCrs(crs) },
    };
    const map = new MapTransform();
    map.setLayeredMapData(data);
    transform = map.getSurfaceTransform(0) as Transform;
  } else {
    transform = new Transform();
    transform.setCompiled(compiled);
  }
  if (isSubMap && hasLayerTransformDeclaration(layer)) {
    validateSubMapBounds(bounds ?? transform.bounds, transform);
  }
  compiledByTransform.set(transform, compiled);
  return transform;
}

export function validateStoredTransformLayers(store: HistMapStore): void {
  [store, ...(store.sub_maps ?? [])].forEach((layer, index) => {
    if (layer.tinEnabled === false) readWorldFileSurface(layer, index > 0);
    else if (hasLayerTransformDeclaration(layer)) readStoredTin(layer, index > 0);
  });
}

const layerKeys = ["width", "height", "bounds", "gcps", "edges", "compiled"];
const importMapKeys = new Set<string>([
  ...keys, ...layerKeys, "strictMode", "vertexMode", "yaxisMode", "sub_maps", "imageExtention", "maptype",
]);
const importSubMapKeys = new Set([
  ...layerKeys, "crs", "worldFile", "tinEnabled", "priority", "importance",
]);

/** ZIP の形式を検査し、変換の宣言を持つ地図を交換形式の許可リストに揃える。 */
export function prepareImportedMap(store: HistMapStore): HistMapStore {
  const cleaned = normalizeStoredTransformKeys(store);
  validateStoredTransformLayers(cleaned);
  if (!hasLayerTransformDeclaration(cleaned) && !cleaned.sub_maps?.some(hasLayerTransformDeclaration)) {
    return cleaned;
  }
  const pick = <T extends object>(layer: T, allowed: Set<string>): T =>
    Object.fromEntries(Object.entries(layer).filter(([key]) => allowed.has(key))) as T;
  const imported = pick(cleaned, importMapKeys);
  if (cleaned.sub_maps) imported.sub_maps = cleaned.sub_maps.map(layer => pick(layer, importSubMapKeys));
  return imported;
}

export async function store2HistMap(
  store: HistMapStore,
  byCompiled = false
): Promise<[HistMapStore, TinLike[]]> {
  return store2HistMap_internal(store, byCompiled, false);
}

export async function store2HistMap4Core(
  store: HistMapStore
): Promise<[HistMapStore, TinLike[]]> {
  return store2HistMap_internal(store, false, true);
}

async function store2HistMap_internal(
  input: HistMapStore,
  byCompiled: boolean,
  coreLogic: boolean
): Promise<[HistMapStore, TinLike[]]> {
  const store = normalizeStoredTransformKeys(input);
  const ret: any = coreLogic ? store : {};
  const tins: TinLike[] = [];
  keys.forEach(key => {
    if (store[key] !== undefined) ret[key] = store[key];
  });
  if ((store as any)["imageExtention"] || store.imageExtension)
    ret.imageExtension = store.imageExtension || (store as any)["imageExtention"];

  ret.strictMode = store.strictMode;
  ret.vertexMode = store.vertexMode;
  ret.yaxisMode = store.yaxisMode;
  ret.width = store.width;
  ret.height = store.height;
  ret.gcps = store.gcps;
  ret.edges = store.edges;
  if (store.tinEnabled === false) {
    readWorldFileSurface(store, false);
    Object.assign(ret, worldFileStoreFields(store));
    tins.push("worldFile");
  } else {
    const transform = readStoredTin(store);
    if (transform) {
      // 従来の byCompiled では平文の値を優先する。地図の寸法は wh から復元する。
      const source = byCompiled ? store.compiled! : transform;
      ret.strictMode = source.strictMode;
      ret.vertexMode = source.vertexMode;
      ret.yaxisMode = source.yaxisMode;
      ret.width = source.wh?.[0];
      ret.height = source.wh?.[1];
      ret.gcps = source.points;
      ret.edges = source.edges;
      if (store.compiled && "outerTransform" in store.compiled) ret.compiled = store.compiled;
      tins.push(byCompiled ? store.compiled! : transform);
    } else {
      tins.push(await createTinFromGcpsAsync(
        store.strictMode!, store.vertexMode!, store.yaxisMode, store.gcps, store.edges,
        [store.width!, store.height!]
      ));
    }
  }

  if (store.sub_maps) {
    ret.sub_maps = [];
    for (const layer of store.sub_maps) {
      const sub: SubMap = { importance: layer.importance, priority: layer.priority };
      if (layer.crs !== undefined) sub.crs = layer.crs;
      if (layer.tinEnabled === false) {
        readWorldFileSurface(layer, true);
        Object.assign(sub, worldFileStoreFields(layer));
        tins.push("worldFile");
      } else {
        const transform = readStoredTin(layer, true);
        const source = byCompiled ? layer.compiled : transform;
        if (transform && source) {
          sub.bounds = hasLayerTransformDeclaration(layer) ? layer.bounds ?? source.bounds : source.bounds;
          sub.gcps = source.points;
          sub.edges = source.edges;
          if (layer.compiled && "outerTransform" in layer.compiled) sub.compiled = layer.compiled;
          tins.push(source);
        } else {
          sub.bounds = layer.bounds;
          sub.gcps = layer.gcps;
          sub.edges = layer.edges;
          tins.push(await createTinFromGcpsAsync(
            store.strictMode!, store.vertexMode!, store.yaxisMode,
            layer.gcps, layer.edges, undefined, layer.bounds
          ));
        }
      }
      ret.sub_maps.push(sub);
    }
  }
  return [ret, tins];
}

function worldFileStoreFields(layer: StoredLayer): StoredLayer {
  const { crs, worldFile, width, height, gcps, edges, bounds } = layer;
  return { crs, worldFile, tinEnabled: false, width, height, gcps, edges, bounds };
}

function compiledForStore(tin: Transform | CompiledTransformData | undefined) {
  return cleanCompiled(tin instanceof Transform ? compiledByTransform.get(tin) : tin);
}

export async function histMap2Store(
  histmap: HistMapStore,
  tins: TinLike[]
): Promise<HistMapStore> {
  const ret: any = {};
  // 保存の前に、配信先の URL の文字列を検査する。通らない delivery は落として警告を 1 行出す
  // （配れない地図を配れる地図として保存しないため）。
  const delivery = (histmap as any).delivery;
  const deliveryAllowed =
    !delivery ||
    (typeof delivery.url === "string" && isAllowedDeliveryUrl(delivery.url));
  if (delivery && !deliveryAllowed) {
    console.warn(
      "[store_handler] delivery dropped: the url is not an allowed https address"
    );
  }
  keys.forEach(key => {
    if (key === "worldFile" || key === "tinEnabled" || (key === "delivery" && !deliveryAllowed)) return;
    if (histmap[key] !== undefined) ret[key] = histmap[key];
  });
  if ((histmap as any)["imageExtention"] || (histmap as any)["imageExtension"])
    ret["imageExtension"] = (histmap as any)["imageExtension"] || (histmap as any)["imageExtention"];
  const [tin, ...subTins] = tins;
  if (tin === "worldFile" || histmap.tinEnabled === false) {
    Object.assign(ret, worldFileStoreFields(histmap));
  } else if (typeof tin === "string") {
    ret.width = histmap.width;
    ret.height = histmap.height;
    ret.gcps = histmap.gcps;
    ret.edges = histmap.edges;
    ret.strictMode = histmap.strictMode;
    ret.vertexMode = histmap.vertexMode;
    ret.yaxisMode = histmap.yaxisMode;
  } else {
    ret.compiled = compiledForStore(tin);
  }

  ret.sub_maps = [];
  const subMaps = histmap.sub_maps ?? [];
  // 印が未設定でも、層の宣言があればワールドファイルを保存する。
  const layerCount = subMaps.reduce((count, layer, index) =>
    layer.tinEnabled === false ? Math.max(count, index + 1) : count, subTins.length);
  for (const [index, layer] of subMaps.slice(0, layerCount).entries()) {
    const tin = subTins[index];
    const sub: SubMap = { priority: layer.priority, importance: layer.importance };
    if (layer.crs !== undefined) sub.crs = layer.crs;
    if (tin === "worldFile" || layer.tinEnabled === false) {
      Object.assign(sub, worldFileStoreFields(layer));
    } else if (typeof tin === "string" || index >= subTins.length) {
      sub.gcps = layer.gcps;
      sub.edges = layer.edges;
      sub.bounds = layer.bounds;
    } else {
      sub.compiled = compiledForStore(tin);
      // Core は副層の直下の bounds を優先する。compiled と異なる明示値は引き継ぐ。
      if (hasLayerTransformDeclaration(sub) && layer.bounds &&
          JSON.stringify(layer.bounds) !== JSON.stringify(sub.compiled?.bounds)) sub.bounds = layer.bounds;
    }
    ret.sub_maps.push(sub);
  }

  return ret as HistMapStore;
}

async function createTinFromGcpsAsync(
  _strict: StrictMode,
  _vertex: VertexMode,
  _yaxis?: YaxisMode,
  gcps: PointSet[] = [],
  _edges: EdgeSet[] = [],
  _wh?: number[],
  _bounds?: number[][]
): Promise<TinLike> {
  if (gcps.length < 3) return "tooLessGcps";
  
  console.error('@maplat/transform requires pre-compiled data. Cannot create from GCPs.');
  console.error('Please use @maplat/editor or a separate tool to generate compiled data.');
  return "compiledRequired";
}
