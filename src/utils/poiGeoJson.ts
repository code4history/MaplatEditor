// POI GeoJSON の純ロジック (検証・旧POI正規化・表示ID採番・_maplatUid 注入/剥離・export形変換)。
// renderer(POI editor)と electron main(保存/import/export)の双方から import する
// (langResource.ts と同じ配置規約)。electron/node 固有 API は使わず web-safe API のみ:
// UID 採番は globalThis.crypto.randomUUID() (Electron renderer / Node 19+ 双方で利用可)。
// LangResource の型・normalize/compact は langResource.ts の既存実装を再利用し重複実装しない。
import type { Feature, FeatureCollection, Point, Position } from "geojson";
import {
  type LangResource,
  compactLangResource,
  normalizeLangResource,
} from "./langResource";
import {
  resolveEditorLanguage,
  type LangCode,
} from "./editorLanguages";
import { estimateContentMode } from "./poiContentMode";

// POI editor の default 言語 (ADR-0005 既定)。title / feature の LangResource フィールドを
// 交換形へ collapse する際にこの言語のみなら string 化する。各公開関数は optional な
// defaultLang 引数でこの既定を上書きできる。raw ペイン (PoiRawPane) の Apply 側正規化も
// 同じ既定を共有するため export する。
export const DEFAULT_LANG = "ja";

export function resolvePoiSourceLanguage(
  candidate: unknown,
  fallback: string = DEFAULT_LANG,
): LangCode {
  const fallbackLang = resolveEditorLanguage(fallback);
  if (typeof candidate !== "string" || candidate.trim() === "") {
    return fallbackLang;
  }
  return resolveEditorLanguage(candidate);
}

// ADR-0005 の LangResource を適用する feature property (POI-135)。viewer が translate() を
// 通すフィールド。image / icon は LangResource ではないので対象外。
const LANG_FIELDS = ["name", "desc", "html", "address", "url"] as const;

// 旧POIオブジェクト形式 (normalizeLegacyPoi の旧オブジェクト分岐) で properties から除外するキー。
// 座標系5キーは geometry.coordinates へ、id は Feature.id へ移すため除外する (M3-T5)。
const LEGACY_EXCLUDED_KEYS = new Set<string>([
  "lnglat",
  "lng",
  "lat",
  "longitude",
  "latitude",
  "id",
]);

// 表示 ID (Feature.id) の文字種: slug と同じ (POI-140)。viewer の namespaceID が {mapID}#{id}
// 結合のため # 等を許すと壊れる。属性フォームの入力検証 (PoiAttributeForm) からも参照するため export。
export const DISPLAY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// 規模 warning (POI-121) / raw ペイン read-only ガード (POI-141) の閾値。
// raw ペイン (PoiRawPane) が同じ閾値で read-only 判定するため export する (再定義禁止)。
export const SCALE_FEATURE_COUNT = 1000;
export const SCALE_BYTE_SIZE = 5 * 1024 * 1024;

// export 座標の丸め桁 (POI-143, ≈1cm / RFC 7946 精度指針)。
const COORD_DECIMALS = 7;

export interface PoiValidationIssue {
  level: "error" | "warning";
  code: string;
  featureId?: string;
  message?: string;
}

// editor 内部形の Feature。id = 表示 ID (export される)、properties._maplatUid = 内部不変 UUID。
export interface PoiEditorFeature extends Feature<Point> {
  id: string;
  properties: Record<string, unknown>;
}

// editor 内部形の FeatureCollection。features は内部形 (_maplatUid 入り)。
// layer metadata 等の editor 内部メタはトップレベル property として round-trip 保持しうるが、
// 本モジュールの純関数が必要とするのは features のみなので最小に留める。
export interface PoiEditorFC extends FeatureCollection {
  features: PoiEditorFeature[];
  lang?: LangCode;
}

export function normalizePoiSourceCollection(
  input: unknown,
  fallbackLang: string = DEFAULT_LANG,
): PoiEditorFC & { lang: LangCode } {
  const source = isRecord(input) ? input : {};
  const lang = resolvePoiSourceLanguage(source.lang, fallbackLang);
  const features = ensureFeatureUids(
    ensureDisplayIds(normalizeLegacyPoiList(input, lang)).features,
  );
  // _maplatContentMode が無い feature に legacy 推定値を設定。
  // 既に値がある feature は上書きしない（ユーザー設定を尊重）。
  const featuresWithMode = features.map((f) => {
    if (f.properties._maplatContentMode === undefined) {
      const estimated = estimateContentMode(f.properties);
      if (estimated !== undefined) {
        return { ...f, properties: { ...f.properties, _maplatContentMode: estimated } };
      }
    }
    return f;
  });
  const layerMeta: Record<string, unknown> = {};
  if (source.type === "FeatureCollection") {
    // 1. FC トップレベル（過去形式・手書きデータ受容）を先に読む
    for (const [key, value] of Object.entries(source)) {
      if (key === "type" || key === "features" || key === "id" || key === "name" || key === "lang" || key === "properties") continue;
      layerMeta[key] = value;
    }
    // 2. FC.properties（新しい正本）を優先で重ねる（同名キーは properties 側が勝つ）
    const props = (source as Record<string, unknown>).properties;
    if (isRecord(props)) {
      for (const [key, value] of Object.entries(props)) {
        layerMeta[key] = value;
      }
    }
  }
  return { ...layerMeta, type: "FeatureCollection", lang, features: featuresWithMode };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mintUid(): string {
  return globalThis.crypto.randomUUID();
}

// _maplat* プレフィックスの内部 property かどうか。
function isInternalProp(key: string): boolean {
  return key.startsWith("_maplat");
}

// 表示 ID (Feature.id) の型正規化。GeoJSON は数値 id を許容し参照実装 (MaplatCore
// normalize_pois) も型を問わずコピーするため、有限数値は String 化して尊重する (Important #3)。
// 文字列・有限数値以外は欠落 ("") 扱い。
function coerceDisplayId(id: unknown): string {
  if (typeof id === "string") return id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return "";
}

// LangResource フィールドを内部形 {lang: text} へ (POI-135)。数値は String 化してから正規化する
// (name:5 が「欠落」でなく "5" になる)。normalizeLangResource は空エントリを除去する。
function toInternalLang(
  value: unknown,
  defaultLang: string,
): Record<string, string> {
  const coerced =
    typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  return normalizeLangResource(
    coerced as LangResource | null | undefined,
    defaultLang,
  );
}

// props 内の LangResource フィールド (存在するもの) を内部形へ正規化する (in-place)。
function internalizeLangFields(
  props: Record<string, unknown>,
  defaultLang: string,
): void {
  for (const key of LANG_FIELDS) {
    if (props[key] !== undefined) {
      props[key] = toInternalLang(props[key], defaultLang);
    }
  }
}

// props 内の LangResource フィールドを交換形へ collapse する (in-place)。
// default 言語のみ→string / 複数言語→object / 空→フィールド削除 (ADR-0005)。
function externalizeLangFields(
  props: Record<string, unknown>,
  defaultLang: string,
): void {
  for (const key of LANG_FIELDS) {
    if (props[key] !== undefined) {
      const compacted = compactLangResource(
        props[key] as LangResource,
        defaultLang,
      );
      if (compacted === undefined) delete props[key];
      else props[key] = compacted;
    }
  }
}

// LangResource 値が非空の string または非空の言語値を持つか。
function hasNonEmptyStringOrLangValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== "";
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.values(value as Record<string, unknown>).some(
      (v) => typeof v === "string" && v.trim() !== "",
    );
  }
  return false;
}

// LangResource 値（全言語）の中に、url mode で許可されないプロトコル
// （http/https 以外かつ先頭が protocol:// 形式）が 1 件でもあるか。
// 許可: http: / https: で始まる、またはプロトコル文字列を持たない（相対パス・空）。
// 拒否: javascript: / data: / vbscript: / ftp: / file: 等、何らかのプロトコル識別子を持つものすべて。
function hasDangerousUrlProtocol(value: unknown): boolean {
  if (typeof value === "string") {
    return isDangerousUrlString(value);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.values(value as Record<string, unknown>).some(
      (v) => typeof v === "string" && isDangerousUrlString(v),
    );
  }
  return false;
}

function isDangerousUrlString(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed === "") return false;
  // プロトコル識別子がなければ相対パスとみなし許可
  if (!/^[a-z][a-z0-9+\-.]*:/i.test(trimmed)) return false;
  // http: または https: は許可
  if (/^https?:\/\//i.test(trimmed)) return false;
  // その他のプロトコル（javascript:/data:/vbscript:/ftp:等）は拒否
  return true;
}

// feature が「コンテンツ」(desc/html/address/url/image のいずれか非空) を持つか (POI-108)。
function hasContent(props: Record<string, unknown>): boolean {
  for (const key of ["desc", "html", "address", "url", "image"]) {
    const v = props[key];
    if (v === undefined || v === null) continue;
    if (typeof v === "string") {
      if (v.trim() !== "") return true;
    } else if (Array.isArray(v)) {
      if (v.length > 0) return true;
    } else if (typeof v === "object") {
      if (Object.keys(v as object).length > 0) return true;
    } else {
      return true;
    }
  }
  return false;
}

// name property が非空か (POI-107)。LangResource(内部形 object / 交換形 string) 双方を許容。
function hasName(props: Record<string, unknown>): boolean {
  const name = props.name;
  if (typeof name === "string") return name.trim() !== "";
  if (isRecord(name)) {
    return Object.values(name).some(
      (t) => typeof t === "string" && t.trim() !== "",
    );
  }
  return false;
}

// 表示 ID を検証・重複・文字種・name・geometry・座標範囲を検査し issue 配列を返す。
// 空配列 = クリーン。not-feature-collection 単独 issue = 構造不正。
export function validateFeatureCollection(fc: unknown): PoiValidationIssue[] {
  if (
    !isRecord(fc) ||
    fc.type !== "FeatureCollection" ||
    !Array.isArray(fc.features)
  ) {
    return [{ level: "error", code: "not-feature-collection" }];
  }

  const issues: PoiValidationIssue[] = [];
  const features = fc.features as unknown[];

  const seenIds = new Set<string>();
  const dupReported = new Set<string>();
  const charsetReported = new Set<string>();
  let anyContent = false;

  for (const raw of features) {
    if (!isRecord(raw)) {
      issues.push({ level: "error", code: "geometry-not-point" });
      continue;
    }
    const id = coerceDisplayId(raw.id);
    const props = isRecord(raw.properties) ? raw.properties : {};

    // geometry: Point のみ (POI-104)
    const geometry = raw.geometry;
    if (!isRecord(geometry) || geometry.type !== "Point") {
      issues.push({ level: "error", code: "geometry-not-point", featureId: id });
    } else {
      // 座標範囲: lon ±180 / lat ±90
      const coords = geometry.coordinates;
      if (Array.isArray(coords) && coords.length >= 2) {
        const [lon, lat] = coords as number[];
        // Number.isFinite は非 number / NaN / ±Infinity を全て false にする。NaN は全比較が
        // false になり範囲チェックを素通りするため、有限性ガードで捕捉する (Important #1)。
        if (
          !Number.isFinite(lon) ||
          !Number.isFinite(lat) ||
          lon < -180 ||
          lon > 180 ||
          lat < -90 ||
          lat > 90
        ) {
          issues.push({ level: "error", code: "coord-range", featureId: id });
        }
      } else {
        issues.push({ level: "error", code: "coord-range", featureId: id });
      }
    }

    // name 必須 (POI-107)
    if (!hasName(props)) {
      issues.push({ level: "error", code: "name-required", featureId: id });
    }

    // 表示 ID 一意 (ソース内) + 文字種 (POI-140)
    if (id !== "") {
      if (seenIds.has(id)) {
        if (!dupReported.has(id)) {
          issues.push({
            level: "error",
            code: "display-id-duplicate",
            featureId: id,
          });
          dupReported.add(id);
        }
      } else {
        seenIds.add(id);
      }
      if (!DISPLAY_ID_PATTERN.test(id) && !charsetReported.has(id)) {
        issues.push({
          level: "error",
          code: "display-id-charset",
          featureId: id,
        });
        charsetReported.add(id);
      }
    }

    if (hasContent(props)) anyContent = true;

    // --- Content Mode 検証 (M11-T9) ---
    const mode = props._maplatContentMode;
    if (mode === 'html') {
      // html mode で html が空 → warning
      if (!hasNonEmptyStringOrLangValue(props.html)) {
        issues.push({
          level: "warning",
          code: "content-mode-html-missing-content",
          featureId: id,
        });
      }
    }
    if (mode === 'url') {
    // url mode で url が http:/https: 以外のプロトコル → error（全言語走査）
    if (hasDangerousUrlProtocol(props.url)) {
      issues.push({
        level: "error",
        code: "content-mode-url-format",
        featureId: id,
      });
    }
  }
  }

  // 無コンテンツ warning (POI-108): ソース全体が無コンテンツ (かつ 1 件以上) の時に単一 warning
  if (features.length > 0 && !anyContent) {
    issues.push({ level: "warning", code: "no-content" });
  }

  // 規模 warning (POI-121)
  if (features.length > SCALE_FEATURE_COUNT) {
    issues.push({ level: "warning", code: "scale-feature-count" });
  }
  let byteSize = 0;
  try {
    byteSize = JSON.stringify(fc).length;
  } catch {
    byteSize = 0;
  }
  if (byteSize > SCALE_BYTE_SIZE) {
    issues.push({ level: "warning", code: "scale-byte-size" });
  }

  return issues;
}

// 旧POIオブジェクト形式 (glossary) → 内部形 Feature へ正規化。
// coordinates: lnglat があればそのまま、無ければ [lng||longitude, lat||latitude]。
// 座標キー(lnglat/lng/lat/longitude/latitude)と id 以外の全キーを properties へ透過する
// (M3-T5: 旧 whitelist を撤廃し FC 経路と同形化。parity 正本 = MaplatCore normalizePoi)。
// _maplat* プレフィックスは fromExportForm と同じ規律で剥がし、再採番に委ねる (identity spoofing 防止)。
// display id / _maplatUid は採番しない (ensureDisplayIds/ensureFeatureUids の担当)。
// ただし既に id を持つ旧オブジェクトはその id を維持する。
export function normalizeLegacyPoi(
  obj: Record<string, unknown>,
  defaultLang: string = DEFAULT_LANG,
): PoiEditorFeature {
  // 既に GeoJSON Feature ならほぼ pass-through (properties 保持)
  if (obj.type === "Feature" && isRecord(obj.geometry)) {
    const props = isRecord(obj.properties) ? { ...obj.properties } : {};
    internalizeLangFields(props, defaultLang);
    const id = coerceDisplayId(obj.id);
    return {
      type: "Feature",
      id,
      geometry: obj.geometry as unknown as Point,
      properties: props,
    };
  }

  let coordinates: Position;
  if (Array.isArray(obj.lnglat) && obj.lnglat.length >= 2) {
    coordinates = [Number(obj.lnglat[0]), Number(obj.lnglat[1])];
  } else {
    const lng = obj.lng ?? obj.longitude;
    const lat = obj.lat ?? obj.latitude;
    coordinates = [Number(lng), Number(lat)];
  }

  const props: Record<string, unknown> = { ...obj };
  for (const key of Object.keys(props)) {
    if (LEGACY_EXCLUDED_KEYS.has(key) || isInternalProp(key)) delete props[key];
  }
  internalizeLangFields(props, defaultLang);

  const id = coerceDisplayId(obj.id);

  return {
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates },
    properties: props,
  };
}

// 配列 / FeatureCollection / 単体 (旧オブジェクト or Feature) を受容し内部形 Feature[] を返す。
// FC の非 Point feature は drop せず geometry を保持したまま返す (caller が validate で拒否する)。
export function normalizeLegacyPoiList(
  input: unknown,
  defaultLang: string = DEFAULT_LANG,
): PoiEditorFeature[] {
  if (input === null || input === undefined) return [];

  // FeatureCollection
  if (
    isRecord(input) &&
    input.type === "FeatureCollection" &&
    Array.isArray(input.features)
  ) {
    return input.features.map((f) => {
      if (isRecord(f)) {
        const props = isRecord(f.properties) ? { ...f.properties } : {};
        internalizeLangFields(props, defaultLang);
        const id = coerceDisplayId(f.id);
        return {
          type: "Feature",
          id,
          geometry: (f.geometry as unknown as Point) ?? {
            type: "Point",
            coordinates: [NaN, NaN],
          },
          properties: props,
        } as PoiEditorFeature;
      }
      return {
        type: "Feature",
        id: "",
        geometry: { type: "Point", coordinates: [NaN, NaN] },
        properties: {},
      } as PoiEditorFeature;
    });
  }

  // 配列
  if (Array.isArray(input)) {
    return input.map((item) =>
      isRecord(item)
        ? normalizeLegacyPoi(item, defaultLang)
        : ({
            type: "Feature",
            id: "",
            geometry: { type: "Point", coordinates: [NaN, NaN] },
            properties: {},
          } as PoiEditorFeature),
    );
  }

  // 単体
  if (isRecord(input)) {
    return [normalizeLegacyPoi(input, defaultLang)];
  }

  return [];
}

// 表示 ID 採番。既存の有効/無効を問わず非空 id は「使用済み」として尊重・衝突回避に数える
// (文字種違反は自動修正せず validate 側で報告)。欠落 (空) 分に p1,p2,... の未使用連番を採番。
export function ensureDisplayIds(features: PoiEditorFeature[]): {
  features: PoiEditorFeature[];
  assigned: string[];
} {
  const taken = new Set<string>();
  for (const f of features) {
    const id = coerceDisplayId(f.id);
    if (id !== "") taken.add(id);
  }

  const assigned: string[] = [];
  let counter = 1;
  const nextId = (): string => {
    let candidate = `p${counter}`;
    while (taken.has(candidate)) {
      counter += 1;
      candidate = `p${counter}`;
    }
    taken.add(candidate);
    counter += 1;
    return candidate;
  };

  const out = features.map((f) => {
    // 有限数値 id は String 化して尊重 (Important #3)。
    const existing = coerceDisplayId(f.id);
    if (existing !== "") {
      return existing === f.id ? f : { ...f, id: existing };
    }
    const id = nextId();
    assigned.push(id);
    return { ...f, id };
  });

  return { features: out, assigned };
}

// properties._maplatUid が無い feature に UUID を採番。既存は維持 (POI-134)。
export function ensureFeatureUids(
  features: PoiEditorFeature[],
): PoiEditorFeature[] {
  // 同一 uid が 2 回以上現れた場合、最初の 1 件のみ維持し以降は再採番する (Minor: 衝突 dedup)。
  const seen = new Set<string>();
  return features.map((f) => {
    const existing = f.properties?._maplatUid;
    if (
      typeof existing === "string" &&
      existing !== "" &&
      !seen.has(existing)
    ) {
      seen.add(existing);
      return f;
    }
    const uid = mintUid();
    seen.add(uid);
    return {
      ...f,
      properties: { ...f.properties, _maplatUid: uid },
    };
  });
}

// 1 座標成分を指定桁で丸める。
function roundCoord(n: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return n;
  const factor = 10 ** COORD_DECIMALS;
  return Math.round(n * factor) / factor;
}

// editor 内部形 → export/raw 表示形。_maplat* property を剥離し、FC.id=slug / FC.name=title 交換形
// (ADR-0005 collapse)。roundCoordinates:true の時のみ座標を 7 桁丸め (POI-143, package export 経路限定)。
// raw ペイン表示は roundCoordinates:false で呼ぶこと (丸めた表示を Apply で書き戻すと Write Store
// 内の座標が静かに劣化するため)。
export function toExportForm(
  fc: PoiEditorFC,
  slug: string,
  titleInternal: LangResource,
  options?: { roundCoordinates?: boolean; defaultLang?: string },
): FeatureCollection {
  const roundCoordinates = options?.roundCoordinates ?? false;
  const defaultLang = options?.defaultLang ?? DEFAULT_LANG;

  const features: Feature[] = fc.features.map((f) => {
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(f.properties ?? {})) {
      if (!isInternalProp(key)) props[key] = value;
    }
    // feature 単位 LangResource (name/desc/html/address/url) を交換形へ collapse (POI-135)。
    externalizeLangFields(props, defaultLang);

    let geometry: Point = f.geometry;
    if (roundCoordinates && geometry && Array.isArray(geometry.coordinates)) {
      geometry = {
        ...geometry,
        coordinates: geometry.coordinates.map((c) => roundCoord(c)) as Position,
      };
    }

    return {
      type: "Feature",
      id: f.id,
      geometry,
      properties: props,
    };
  });

  // layer metadata（icon/selectedIcon/hide/poiTemplate 等、§2.3）は FC.properties
  // の直下へ書く（m18-t5 正本位置。viewer は FC.properties を cluster へ展開する）。
  // FC.id（slug）/ FC.name（title）/ FC.lang は例外でトップレベルのまま（§5.4）。
  const out: Record<string, unknown> = {
    type: "FeatureCollection",
    id: slug,
  };
  const name = compactLangResource(titleInternal, defaultLang);
  if (name !== undefined) {
    out.name = name;
  }
  if (fc.lang !== undefined) {
    out.lang = fc.lang;
  }
  const layerMetaKeys = Object.keys(fc).filter(
    (k) => k !== "type" && k !== "features" && k !== "id" && k !== "name" && k !== "lang"
  );
  const properties: Record<string, unknown> = {};
  for (const key of layerMetaKeys) {
    properties[key] = (fc as unknown as Record<string, unknown>)[key];
  }
  if (Object.keys(properties).length > 0) {
    out.properties = properties;
  }
  out.features = features;

  return out as unknown as FeatureCollection;
}

// raw Apply 用: export 形 FeatureCollection (object) → 内部形。Feature.id で previous と照合し
// _maplatUid を引継ぎ、無ければ新規採番 (POI-136)。同時に validate で issue を収集する。
// 構造不正 (FeatureCollection でない) 場合は not-feature-collection error を返す。
// UID 照合の後に ensureDisplayIds を適用し、id 欠落 feature を素通りさせず importFile/save 側の
// prepare() (PoiSourceService.prepare) と同じ規律で採番する (Phase 5 品質レビュー MAJOR)。
// 1 件以上採番した場合は warning issue (display-id-assigned, message=採番数) を追加する。
export function fromExportForm(
  parsed: unknown,
  previous: PoiEditorFeature[],
  defaultLang: string = DEFAULT_LANG,
): { features: PoiEditorFeature[]; issues: PoiValidationIssue[] } {
  const issues = validateFeatureCollection(parsed);
  if (
    !isRecord(parsed) ||
    parsed.type !== "FeatureCollection" ||
    !Array.isArray(parsed.features)
  ) {
    return {
      features: [],
      issues: issues.length
        ? issues
        : [{ level: "error", code: "not-feature-collection" }],
    };
  }

  // previous を display id で索引化 (_maplatUid 引継ぎ用)
  const prevByDisplayId = new Map<string, PoiEditorFeature>();
  for (const p of previous) {
    const pid = coerceDisplayId(p.id);
    if (pid !== "") prevByDisplayId.set(pid, p);
  }

  const features: PoiEditorFeature[] = parsed.features.map((raw) => {
    const rec = isRecord(raw) ? raw : {};
    const id = coerceDisplayId(rec.id);
    const props: Record<string, unknown> = isRecord(rec.properties)
      ? { ...rec.properties }
      : {};

    // _maplat* は export 形には現れない想定だが、混入していれば剥がして再採番に委ねる
    for (const key of Object.keys(props)) {
      if (isInternalProp(key)) delete props[key];
    }

    // 交換形 (string) / 内部形 (object) 双方を受容し内部形へ正規化 (ADR-0005, POI-135)。
    internalizeLangFields(props, defaultLang);

    const prev = id !== "" ? prevByDisplayId.get(id) : undefined;
    const prevUid = prev?.properties?._maplatUid;
    props._maplatUid =
      typeof prevUid === "string" && prevUid !== "" ? prevUid : mintUid();

    // export 形から戻した feature に _maplatContentMode を再推定
    // （_maplat* は上で剥がされるので、legacy データの html/url から推定する）
    const estimated = estimateContentMode(props);
    if (estimated !== undefined) {
      props._maplatContentMode = estimated;
    }

    const geometry = isRecord(rec.geometry)
      ? (rec.geometry as unknown as Point)
      : ({ type: "Point", coordinates: [NaN, NaN] } as Point);

    return {
      type: "Feature",
      id,
      geometry,
      properties: props,
    };
  });

  // UID 照合の後に採番規律を適用する (importFile/save 側 prepare と同じ ensureDisplayIds)。
  // これにより id 欠落 feature が採番されずに Apply されて slug 相当の識別子を欠く不変条件
  // 違反を防ぐ (Phase 5 品質レビュー MAJOR)。
  const { features: withIds, assigned } = ensureDisplayIds(features);
  if (assigned.length > 0) {
    issues.push({
      level: "warning",
      code: "display-id-assigned",
      message: String(assigned.length),
    });
  }

  return { features: withIds, issues };
}
