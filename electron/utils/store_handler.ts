"use strict";

import {
  Transform,
  Compiled,
  PointSet,
  EdgeSet,
  StrictMode,
  VertexMode,
  YaxisMode
} from "@maplat/transform";
import type { Position } from "geojson";
type LangResource = string | Record<string, string>;
type TinLike = string | Transform | Compiled;

export interface HistMapStore {
  title: LangResource;
  attr: LangResource;
  officialTitle: LangResource;
  dataAttr: LangResource;
  strictMode?: StrictMode;
  vertexMode?: VertexMode;
  yaxisMode?: YaxisMode;
  author: LangResource;
  createdAt: LangResource;
  era: LangResource;
  license: string;
  dataLicense: string;
  contributor: LangResource;
  mapper: LangResource;
  reference: string;
  description: LangResource;
  url: LangResource;
  lang: string;
  imageExtension: string;
  width?: number;
  height?: number;
  gcps?: PointSet[];
  edges?: EdgeSet[];
  compiled?: Compiled;
  sub_maps: SubMap[];
  homePosition: Position;
  mercZoom: number;
}

interface SubMap {
  gcps?: PointSet[];
  edges?: EdgeSet[];
  compiled?: Compiled;
  priority: number;
  importance: number;
  bounds?: number[][];
}

const keys: (keyof HistMapStore)[] = [
  "title",
  "attr",
  "officialTitle",
  "dataAttr",
  "author",
  "createdAt",
  "era",
  "license",
  "dataLicense",
  "contributor",
  "mapper",
  "reference",
  "description",
  "url",
  "lang",
  "imageExtension",
  "homePosition",
  "mercZoom"
];

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
  store: HistMapStore,
  byCompiled: boolean,
  coreLogic: boolean
): Promise<[HistMapStore, TinLike[]]> {
  const ret: any = coreLogic ? store : {};
  const tins: TinLike[] = [];
  keys.forEach(key => {
    ret[key] = store[key];
  });
  if ((store as any)["imageExtention"] || (store as any)["imageExtension"])
    ret["imageExtension"] = (store as any)["imageExtension"] || (store as any)["imageExtention"];
  if (store.compiled) {
    let tin: TinLike = new Transform();
    (tin as Transform).setCompiled(store.compiled);
    (tin as Transform).addIndexedTin();
    if (byCompiled) {
      tin = store.compiled;
    }
    const transform = tin as Transform;
    ret.strictMode = transform.strictMode;
    ret.vertexMode = transform.vertexMode;
    ret.yaxisMode = transform.yaxisMode;
    ret.width = transform.wh?.[0];
    ret.height = transform.wh?.[1];
    ret.gcps = transform.points;
    ret.edges = transform.edges;
    tins.push(tin);
  } else {
    ret.strictMode = store.strictMode;
    ret.vertexMode = store.vertexMode;
    ret.yaxisMode = store.yaxisMode;
    ret.width = store.width;
    ret.height = store.height;
    ret.gcps = store.gcps;
    ret.edges = store.edges;
    let tin = await createTinFromGcpsAsync(
      store.strictMode!,
      store.vertexMode!,
      store.yaxisMode,
      store.gcps,
      store.edges,
      [store.width!, store.height!]
    );
    if (byCompiled && typeof tin !== "string") tin = store.compiled!;
    tins.push(tin);
  }

  if (store.sub_maps) {
    const sub_maps = [] as SubMap[];
    for (let i = 0; i < store.sub_maps.length; i++) {
      const sub_map = store.sub_maps[i];
      const sub: any = {};
      sub.importance = sub_map.importance;
      sub.priority = sub_map.priority;
      if (sub_map.compiled) {
        let tin: TinLike = new Transform();
        (tin as Transform).setCompiled(sub_map.compiled);
        (tin as Transform).addIndexedTin();
        if (byCompiled) {
          tin = sub_map.compiled;
        }
        sub.bounds = tin.bounds;
        sub.gcps = tin.points;
        sub.edges = tin.edges;
        tins.push(tin);
      } else {
        sub.bounds = sub_map.bounds;
        sub.gcps = sub_map.gcps;
        sub.edges = sub_map.edges;
        let tin = await createTinFromGcpsAsync(
          store.strictMode!,
          store.vertexMode!,
          store.yaxisMode,
          sub_map.gcps,
          sub_map.edges,
          undefined,
          sub_map.bounds
        );
        if (byCompiled && typeof tin !== "string")
          tin = sub_map.compiled!;
        tins.push(tin);
      }
      sub_maps.push(sub as SubMap);
    }
    ret.sub_maps = sub_maps;
  }
  return [ret as HistMapStore, tins];
}

export async function histMap2Store(
  histmap: HistMapStore,
  tins: TinLike[]
): Promise<HistMapStore> {
  const ret: any = {};
  keys.forEach(key => {
    ret[key] = histmap[key];
  });
  if ((histmap as any)["imageExtention"] || (histmap as any)["imageExtension"])
    ret["imageExtension"] = (histmap as any)["imageExtension"] || (histmap as any)["imageExtention"];
  const tin = tins.shift();
  if (typeof tin === "string") {
    ret.width = histmap.width;
    ret.height = histmap.height;
    ret.gcps = histmap.gcps;
    ret.edges = histmap.edges;
    ret.strictMode = histmap.strictMode;
    ret.vertexMode = histmap.vertexMode;
    ret.yaxisMode = histmap.yaxisMode;
  } else {
    ret.compiled = tin as Compiled;
  }

  ret.sub_maps =
    tins.length > 0
      ? tins.map((tin, index) => {
          const sub_map = histmap.sub_maps[index];
          const sub: any = {
            priority: sub_map.priority,
            importance: sub_map.importance
          };
          if (typeof tin === "string") {
            sub.gcps = sub_map.gcps;
            sub.edges = sub_map.edges;
            sub.bounds = sub_map.bounds;
          } else {
            sub.compiled = tin as Compiled;
          }
          return sub as SubMap;
        })
      : [];

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
