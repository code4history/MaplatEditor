// 登録 POI ソース参照 ({poiUid}) と icon 参照文法の main 側解決層 (Phase 7, 43 §2.4/§7/§8)。
// document.pois / map data_json の pois 配列内の { poiUid, cachedTitle?, icon?, selectedIcon?, title?, hide? } 要素を
// PoiSourceService.exportForm の export 形 FeatureCollection へ置換する。
// 生要素 (URL 文字列 / FC 埋め込み) は無加工で透過し (座標も丸めない)、
// 見つからない/読めない poiUid は要素を落として 'appedit.warn_missing_poi_source' を1回だけ載せる。
// 呼び込み点は 5 箇所: AppPreviewService の app JSON / map JSON、AppExportService の app JSON / map JSON、
// mapDownloadZip.ts の composeDownloadMapJson (M13-T1: mapedit.ts から移設。旧 mapedit:download の
// composeDownloadMapJson を指していた記述を実体へ追随)。
// warnings は静的 i18n キー (AppEdit 側の t(key) 表示と互換、パラメタ補間なし)。
//
// icon 参照文法の解決 (POI-117): pois 配列内の FC (解決済み・生 FC の双方) の layer metadata
// (FC.properties 配下の icon/selectedIcon — 過去形式として FC トップレベルも維持) と
// 全 feature properties の icon/selectedIcon を走査し、
//   - icon set 参照 ({setId}:{iconId}, 登録済み) → 'imgs/icons/{setId}/{iconId}.{ext}' + 実体コピー要求
//   - asset UUID (assets テーブルに存在 + 実体あり) → 'imgs/{slug}.{ext}' + 実体コピー要求
//   - URL / 相対パス → 無変更
//   - 未登録 setId・未知 iconId・存在しない asset → 原文維持 + 'appedit.warn_unresolved_icon' 1回
// viewer は icon 文字列を OpenLayers Icon の src としてページ URL 基準で解決するため、
// 出力形はページ相対 'imgs/...' で足りる (export は index.html と同階層、preview は
// /preview/{token}/ 配下に imgs/ ルートを配信、download ZIP は zip ルートに imgs/ を同梱)。
// Write Store 内は参照文法のまま保持し、この層は出力時のみ書き換える (raw ペインとは非干渉)。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';
import PoiSourceService from './PoiSourceService';
import SqliteDataService from './SqliteDataService';
import SettingsService from './SettingsService';
import { UUID_PATTERN } from '../adapters/StorageAdapter';
import { parseIconRef, listIconSets } from '../../src/utils/iconRefs';
import { compactLangResource, type LangResource } from '../../src/utils/langResource';
import { DEFAULT_LANG } from '../../src/utils/poiGeoJson';
import { poisEntryShape, hasMixedPoisShapes, poisLayerKeyOf } from '../../src/utils/poisLayerStructure';
import { sanitizePoiFileBase, reservePoiFileBase } from '../../src/utils/poiExportFileName';
import {
  collectAssetRefUids,
} from '../../src/utils/poiContentMode';

// icon 実体のコピー要求。dest は出力ルート相対 (posix 区切り) — export はディレクトリコピー先、
// preview は配信ルート、download は zip 内パスとして解釈する
export interface IconFile {
  src: string;
  dest: string;
}

export interface ResolvedPois {
  pois: unknown[];
  files: IconFile[];
  warnings: string[];
}

export const UNRESOLVED_ICON_WARNING = 'appedit.warn_unresolved_icon';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = process.env.APP_ROOT || path.resolve(__dirname, '..', '..');
// builtin 等 icon set 実体 (public/icons/{setId}/*.{png,svg}) の候補ルート。
// dev は APP_ROOT/public、prod は dist / パッケージ相対 (AppPreviewService の候補配列方式を踏襲)
const ICON_ASSET_ROOTS = [
  path.resolve(appRoot, 'public'),
  path.resolve(appRoot, 'dist'),
  path.resolve(__dirname, '..', 'public'),
  path.resolve(__dirname, '..', 'dist'),
];

// icon set の相対パス ('icons/{setId}/{iconId}.{ext}') を実体の絶対パスへ解決する。
// 候補ルート外への path traversal は拒否。見つからなければ null (呼び出し側で unresolved 扱い)。
// AppPreviewService の imgs/icons/... 配信ルートもこれを使う
export function iconSetFilePath(relPath: string): string | null {
  if (relPath.includes('://')) return null;
  for (const root of ICON_ASSET_ROOTS) {
    const resolved = path.resolve(root, relPath);
    if (!resolved.startsWith(root + path.sep)) continue;
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
    } catch {
      // noop — 次の候補へ
    }
  }
  return null;
}

type IconValueResolution =
  | { kind: 'resolved'; dest: string; file: IconFile }
  | { kind: 'unresolved' }
  | null; // 無変更 (URL/相対パス/非文字列)

// icon/selectedIcon 1 値の解決。判別は parseIconRef (src/utils/iconRefs が正) に委ねる
async function resolveIconValue(value: unknown): Promise<IconValueResolution> {
  if (typeof value !== 'string' || value === '') return null;
  const ref = parseIconRef(value);
  if (ref.kind === 'url') return null;
  if (ref.kind === 'iconset') {
    const set = listIconSets().find((entry) => entry.setId === ref.setId);
    // 未登録 setId / 未知 iconId は URL とみなさず unresolved (仕様 §7)
    if (!set || !set.iconIds.includes(ref.iconId)) return { kind: 'unresolved' };
    const relPath = set.previewUrl(ref.iconId);
    const src = iconSetFilePath(relPath);
    if (!src) return { kind: 'unresolved' };
    const dest = `imgs/icons/${ref.setId}/${ref.iconId}${path.extname(src)}`;
    return { kind: 'resolved', dest, file: { src, dest } };
  }
  // asset UUID: メタデータ (slug/ext) は DB、実体は {saveFolder}/assets/{uid}.{ext}
  const record = await SqliteDataService.findAsset(ref.uid);
  if (!record) return { kind: 'unresolved' };
  const saveFolder = SettingsService.get('saveFolder') as string;
  const src = path.join(saveFolder, 'assets', `${record.uid}.${record.ext}`);
  if (!(await fs.pathExists(src))) return { kind: 'unresolved' };
  const dest = `imgs/${record.slug}.${record.ext}`;
  return { kind: 'resolved', dest, file: { src, dest } };
}

interface IconResolutionSink {
  files: Map<string, IconFile>; // dest キーで重複コピー要求を畳む
  warnings: string[];
}

async function resolveImageValue(
  value: unknown,
  sink: IconResolutionSink,
): Promise<{ value: unknown; changed: boolean }> {
  if (typeof value === 'string') {
    const resolution = await resolveIconValue(value);
    if (!resolution) return { value, changed: false };
    if (resolution.kind === 'unresolved') {
      mergeWarnings(sink.warnings, [UNRESOLVED_ICON_WARNING]);
      return { value, changed: false };
    }
    sink.files.set(resolution.file.dest, resolution.file);
    return { value: resolution.dest, changed: true };
  }
  if (Array.isArray(value)) {
    const resolved = await Promise.all(value.map((entry) => resolveImageValue(entry, sink)));
    return resolved.some((entry) => entry.changed)
      ? { value: resolved.map((entry) => entry.value), changed: true }
      : { value, changed: false };
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (typeof object.src !== 'string') return { value, changed: false };
    const resolved = await resolveImageValue(object.src, sink);
    return resolved.changed
      ? { value: { ...object, src: resolved.value }, changed: true }
      : { value, changed: false };
  }
  return { value, changed: false };
}

// props（FC.properties layer metadata または feature properties）の icon/selectedIcon を解決。
// 変更があった場合のみ shallow copy を返す (無変更なら null — 生 FC の無加工透過を保つ)
async function resolveIconProps(
  props: Record<string, unknown>,
  sink: IconResolutionSink,
): Promise<Record<string, unknown> | null> {
  let changed: Record<string, unknown> | null = null;
  for (const key of ['icon', 'selectedIcon']) {
    const resolution = await resolveIconValue(props[key]);
    if (!resolution) continue;
    if (resolution.kind === 'unresolved') {
      mergeWarnings(sink.warnings, [UNRESOLVED_ICON_WARNING]);
      continue;
    }
    sink.files.set(resolution.file.dest, resolution.file);
    if (!changed) changed = { ...props };
    changed[key] = resolution.dest;
  }
  if ('image' in props) {
    const image = await resolveImageValue(props.image, sink);
    if (image.changed) {
      if (!changed) changed = { ...props };
      changed.image = image.value;
    }
  }
  return changed;
}

// FC 1 件の icon 参照解決 (copy-on-write)。FC 以外の値 (URL 文字列等) は素通し
async function resolveIconRefsInFc(entry: unknown, sink: IconResolutionSink): Promise<unknown> {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const fc = entry as Record<string, unknown>;
  if (fc.type !== 'FeatureCollection') return entry;

  let out: Record<string, unknown> | null = await resolveIconProps(fc, sink); // FC トップレベル（過去形式・維持）

  // m18-t5: FC.properties（layer metadata の正本位置）の icon 参照解決
  const existingProps = fc.properties;
  if (existingProps && typeof existingProps === 'object' && !Array.isArray(existingProps)) {
    const changedProps = await resolveIconProps(existingProps as Record<string, unknown>, sink);
    if (changedProps) {
      if (!out) out = { ...fc };
      out.properties = changedProps;
    }
  }

  const features = fc.features;
  if (Array.isArray(features)) {
    let newFeatures: unknown[] | null = null;
    for (let i = 0; i < features.length; i++) {
      const feature = features[i];
      if (!feature || typeof feature !== 'object' || Array.isArray(feature)) continue;
      const props = (feature as Record<string, unknown>).properties;
      if (!props || typeof props !== 'object' || Array.isArray(props)) continue;
      const changedProps = await resolveIconProps(props as Record<string, unknown>, sink);
      if (changedProps) {
        if (!newFeatures) newFeatures = [...features];
        newFeatures[i] = { ...(feature as Record<string, unknown>), properties: changedProps };
      }
    }
    if (newFeatures) {
      if (!out) out = { ...fc };
      out.features = newFeatures;
    }
  }
  return out ?? entry;
}

export async function resolvePoiFeatureCollection(entry: unknown): Promise<{
  fc: unknown;
  files: IconFile[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const sink: IconResolutionSink = { files: new Map(), warnings };
  const fc = await resolveIconRefsInFc(entry, sink);
  return { fc, files: [...sink.files.values()], warnings };
}

// {poiUid} 参照要素なら uid を返す。poiUid 以外のキー (cachedTitle 等) は解決時に無視する。
// uid は UUID 形状 (StorageAdapter.UUID_PATTERN と同形、大小文字非区別) のみ参照として扱う
// (M4)。UUID 形でない poiUid は将来拡張の手書き形かもしれないため生要素として透過し、
// missing 警告の対象にもしない (安全側)。この判定は SqliteDataService.findPoiSourceReferences
// の走査対象 (UUID のみ) と対称 — 非 UUID 値はそもそも逆参照検索にも引っかからないため。
function poiUidOf(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const uid = (entry as Record<string, unknown>).poiUid;
  return typeof uid === 'string' && UUID_PATTERN.test(uid) ? uid : null;
}

// 二重参照検出 (POI-142) 用: pois 配列内の参照 uid 集合。非配列入力は空集合
export function collectPoiUids(pois: unknown): Set<string> {
  const uids = new Set<string>();
  if (!Array.isArray(pois)) return uids;
  for (const entry of pois) {
    const uid = poiUidOf(entry);
    if (uid) uids.add(uid);
  }
  return uids;
}

// 2 つの参照 uid 集合が交差するか (app pois × map pois の二重参照判定)
export function hasSharedPoiUid(a: Set<string>, b: Set<string>): boolean {
  for (const uid of a) {
    if (b.has(uid)) return true;
  }
  return false;
}

// 参照要素の icon/selectedIcon/hide 上書き (Phase 8, POI-112 最小形 + m18-t5 hide) を解決後 FC の
// FC.properties 配下 (layer metadata) へ適用する。string かつ非空の値のみ有効で、ソース側 FC に元々 icon が
// あっても参照側の上書きが勝つ。hide は true のみ有効（§5.3 セマンティクス）。
// ここでは参照文法のまま載せ、後段の resolveIconRefsInFc が
// 通常の icon 解決 (imgs/ 書き換え + 実体コピー要求 + unresolved 警告) を等しく適用する。
// title 上書き (GUI 検証 D1): 参照要素の title (LangResource) が非空なら、toExportForm が
// FC.name に書くのと同じ交換形 (compactLangResource collapse、defaultLang=DEFAULT_LANG) で
// 解決後 FC の name をソース側より優先で上書きする。空 (空文字/空 object/未定義) は上書きなし
function applyReferenceIconOverrides(
  fc: Record<string, unknown>,
  entry: Record<string, unknown>,
): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  let props: Record<string, unknown> | null = null;
  // 既存の properties を取得（copy-on-write）
  const existingProps = (fc.properties && typeof fc.properties === 'object' && !Array.isArray(fc.properties)) ? fc.properties as Record<string, unknown> : {};

  for (const key of ['icon', 'selectedIcon']) {
    const value = entry[key];
    if (typeof value !== 'string' || value === '') continue;
    if (!props) props = { ...existingProps };
    props[key] = value;
  }
  // m18-t5: hide === true のみ有効（§5.3 セマンティクス）
  if (entry.hide === true) {
    if (!props) props = { ...existingProps };
    props.hide = true;
  }
  const title = compactLangResource(entry.title as LangResource | null | undefined, DEFAULT_LANG);
  if (title !== undefined) {
    // title は FC.name へ（viewer が読む場所・現行どおり）
    if (!out) out = { ...fc };
    out.name = title;
  }
  if (props) {
    if (!out) out = { ...fc };
    out.properties = props;
  }
  return out ?? fc;
}

// pois 配列内の {poiUid} 要素のみ export 形 FC に置換。生要素は透過 (icon 参照解決を除き無加工)。
// missing は要素落ち + 警告キー1回。非配列入力は空配列扱い (呼び出し側で配列時のみ呼ぶこと)。
// 参照要素の icon/selectedIcon/hide 上書きは解決後 FC の FC.properties 配下へ適用 (Phase 8, POI-112 最小形 + m18-t5)。
// 置換後の FC (解決済み・生 FC の双方) の icon 参照文法を imgs/... へ解決し、
// 実体コピー要求を files として返す (POI-117)。同一参照の重複コピーは dest キーで畳む
export async function resolvePoisArray(
  pois: unknown,
  options: { exportForm?: (uid: string) => Promise<unknown | null> } = {},
): Promise<ResolvedPois> {
  const warnings: string[] = [];
  const sink: IconResolutionSink = { files: new Map(), warnings };
  if (!Array.isArray(pois)) return { pois: [], files: [], warnings };
  const out: unknown[] = [];
  let missing = false;
  for (const entry of pois) {
    const uid = poiUidOf(entry);
    if (!uid) {
      out.push(await resolveIconRefsInFc(entry, sink));
      continue;
    }
    const fc = await (options.exportForm ?? ((poiUid: string) => PoiSourceService.exportForm(poiUid)))(uid);
    if (fc) {
      const overridden = applyReferenceIconOverrides(
        fc as unknown as Record<string, unknown>,
        entry as Record<string, unknown>,
      );
      out.push(await resolveIconRefsInFc(overridden, sink));
    } else {
      missing = true;
    }
  }
  if (missing) mergeWarnings(warnings, ['appedit.warn_missing_poi_source']);
  // M3-T6 §5.7 (AC6-7): 解決後配列が FC と非 FC object の混在なら警告 (viewer P2a/P2b の解釈分裂 =
  // 確実に壊れる形)。判定は「解決後」に対して行う (参照要素は FC に置換済みのため、旧オブジェクト +
  // 参照の混在が確実に検出される)。文字列要素は数えない — URL が FC を返す正当構成 (P2a) への
  // 恒常偽陽性を避ける (§8.1 の出口側判定)。自動変換は行わない。
  // v1.2 §5.10: 判定を共有述語 (poisLayerStructure) へ載せ替え — UI のレイヤ判別と同一実装
  // (旧ローカル実装と論理同値: fc = isPlainObject && type==='FeatureCollection' /
  //  object = isPlainObject && type!=='FeatureCollection' / 配列・文字列・数値は非カウント)。挙動不変
  if (hasMixedPoisShapes(out.map(poisEntryShape))) mergeWarnings(warnings, ['appedit.warn_mixed_pois']);
  return { pois: out, files: [...sink.files.values()], warnings };
}

// ============================================================================
// POI の外部ファイル化 (M4-T2)
// ============================================================================
// 本来の仕様は「POI はすべて外部ファイルに置き、設定は URL で参照する」であり、上書き仕様
// ({layer, hide, title, icon, selectedIcon}) は外部ファイルを書き換えずに属性だけ差し替える
// ために存在する (人間・2026-08-02)。resolvePoisArray は解決した FC をそのまま配列へ戻す
// = インライン展開であり、上書きも FC へ焼き込んでしまう (applyReferenceIconOverrides)。
//
// resolvePoisArray は変更しない。資源診断 (ResourceDiagnosticsService.diagnosePois) が
// 「解決後の FC そのもの」を走査して icon/asset の欠損を検出しており、参照形を返すと
// 何も検査できなくなるため (設計 §2.4)。∴ 外部化は本関数群として独立に足す。

/** 外部ファイルとして書き出す POI 実体。dest は出力ルート相対 posix パス */
export interface PoiDocument {
  dest: string;
  json: unknown;
}

/**
 * 外部化の作業状態。**export 1 回分で共有する** — app JSON と map JSON が同じ POI ソースを
 * 参照した場合に、外部ファイルを1つへ畳むため。
 */
export interface PoiExternalizationContext {
  /** poiUid → dest。同一ソースの再参照を同じファイルへ向ける */
  byUid: Map<string, string>;
  /** 使用済みファイル基底名。衝突時の連番採番に使う */
  taken: Set<string>;
  /** dest → 実体。重複書き出しを抑止する */
  documents: Map<string, PoiDocument>;
}

export function createPoiExternalizationContext(): PoiExternalizationContext {
  return { byUid: new Map(), taken: new Set(), documents: new Map() };
}

export interface ExternalizedPois {
  pois: unknown[];
  files: IconFile[];
  /** ctx に溜まった全件を返す (この呼び出しで増えた分だけではない) */
  documents: PoiDocument[];
  warnings: string[];
}

// 上書きレイヤ (ラッパー) の許可キーは hide / title / icon / selectedIcon の4つ
// (viewer 正本 MaplatCore/src/normalize_pois.ts:23 の OVERRIDE_KEYS)。キーごとに有効値の
// 判定が異なるため、列挙ではなく buildPoiLayerRef 内で個別に扱う。
// ラッパー判別で「座標を持つ = POI オブジェクト」を弾くためのキー。viewer :25-31 と同一
const COORD_KEYS = ['lnglat', 'lng', 'lat', 'longitude', 'latitude'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFeatureCollection(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && value.type === 'FeatureCollection';
}

// 配列要素文脈のラッパー判別。viewer 正本 isPoiLayerRef (normalize_pois.ts:36-46) と同一規則:
// layer が string または FeatureCollection で、座標キーを持たない plain object
function isPoiLayerRef(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  if (value.type === 'FeatureCollection') return false;
  const layer = value.layer;
  if (typeof layer !== 'string' && !isFeatureCollection(layer)) return false;
  if (COORD_KEYS.some((key) => value[key] !== undefined)) return false;
  return true;
}

// FC を外部ファイルとして ctx へ登録し、参照 URL (dest) を返す。
// 名前は viewer のレイヤ key と同じ位置 (FC.id || FC.properties.id) を基底とし、sanitize +
// 連番一意化する。連番が枯渇したら null (呼び出し側がインライン透過へフォールバックする)。
// 実体側では従来どおり icon 参照文法と asset ref を解決する — 外部ファイルになっても
// viewer から見た imgs/... の位置は変わらない (どちらも index.html と同階層基準)。
async function emitPoiDocument(
  fc: unknown,
  baseHint: unknown,
  ctx: PoiExternalizationContext,
  sink: IconResolutionSink,
): Promise<string | null> {
  const reserved = reservePoiFileBase(sanitizePoiFileBase(baseHint), ctx.taken);
  if (reserved === null) return null;
  const dest = `pois/${reserved}.geojson`;
  const withIcons = await resolveIconRefsInFc(fc, sink);
  const assetResolved = await resolveAssetRefsForExport(withIcons, sink.files);
  mergeWarnings(sink.warnings, assetResolved.warnings);
  ctx.documents.set(dest, { dest, json: assetResolved.entry });
  return dest;
}

// 参照側オブジェクト (ラッパー) を組み立てる。上書きは **FC へ焼き込まず** ここへ載せる
// (これが上書き仕様の存在意義。M4-T2 G2)。
// 有効値の判定は applyReferenceIconOverrides と同一 — hide は true のみ、title は
// compactLangResource が undefined を返さない場合のみ、icon/selectedIcon は非空 string のみ。
//
// 【落とし穴】従来は上書きを FC.properties へ載せてから後段の resolveIconRefsInFc が
// icon 参照文法 (icon set 参照 / asset UUID) を imgs/... へ解決していた。ラッパーへ移す以上、
// 同じ解決をここで通さないと上書きアイコンだけ生 UUID のまま出力され viewer で表示されない。
async function buildPoiLayerRef(
  dest: string,
  entry: Record<string, unknown>,
  sink: IconResolutionSink,
): Promise<Record<string, unknown>> {
  const wrapper: Record<string, unknown> = { layer: dest };
  if (entry.hide === true) wrapper.hide = true;
  const title = compactLangResource(entry.title as LangResource | null | undefined, DEFAULT_LANG);
  if (title !== undefined) wrapper.title = title;
  for (const key of ['icon', 'selectedIcon'] as const) {
    const value = entry[key];
    if (typeof value !== 'string' || value === '') continue;
    const resolution = await resolveIconValue(value);
    if (!resolution) {
      wrapper[key] = value; // URL / 相対パス — 無変更 (resolveIconProps と同じ扱い)
      continue;
    }
    if (resolution.kind === 'unresolved') {
      mergeWarnings(sink.warnings, [UNRESOLVED_ICON_WARNING]);
      wrapper[key] = value; // 原文維持
      continue;
    }
    sink.files.set(resolution.file.dest, resolution.file);
    wrapper[key] = resolution.dest;
  }
  return wrapper;
}

/**
 * pois 配列を「外部ファイル + URL 参照 (+ 上書き属性)」の形へ変換する (M4-T2 §5.2 の正本表)。
 *
 * | 入力要素                       | 出力要素                                | 外部ファイル |
 * |--------------------------------|-----------------------------------------|--------------|
 * | E1 {poiUid, …上書き}           | {layer:"pois/<name>.geojson", …上書き}  | exportForm の FC |
 * | E2 生 FC                       | {layer:"pois/<name>.geojson"}           | その FC |
 * | E3 裸 URL 文字列               | {layer:"<原文>"}                        | なし |
 * | E4 {layer:"<文字列>", …}       | そのまま透過                             | なし |
 * | E5 {layer:<FC>, …}             | {layer:"pois/<name>.geojson", …上書き}  | その FC |
 * | E6 それ以外 (レガシー POI 等)  | そのまま透過                             | なし |
 * | E7 解決できない poiUid         | 要素を落とす + missing 警告 1 回        | なし |
 *
 * E3 の理由: 裸 URL 文字列は配列要素位置で現行 viewer が誤判定する (normalizeLayers は全要素を
 * fetch で中身へ置換してから先頭要素でモード判定するため)。{layer:URL} へ包めば fetch 前に
 * 判別されるので出力側だけで回避できる。viewer 側の堅牢化 (m4-t5) はこれとは独立に残る。
 */
export async function externalizePoisArray(
  pois: unknown,
  ctx: PoiExternalizationContext,
  options: { exportForm?: (uid: string) => Promise<unknown | null> } = {},
): Promise<ExternalizedPois> {
  const warnings: string[] = [];
  const sink: IconResolutionSink = { files: new Map(), warnings };
  if (!Array.isArray(pois)) {
    return { pois: [], files: [], documents: [...ctx.documents.values()], warnings };
  }
  const out: unknown[] = [];
  // 混在警告 (M3-T6 §5.7) の判定は resolvePoisArray と同じ「解決後」基準を維持する。
  // 入力配列で判定すると {poiUid} が 'object' に数えられ、参照 + 生 FC という正常構成が
  // 恒常的に偽陽性になる。∴ 各要素が resolvePoisArray でどの shape になったかを記録する。
  const resolvedShapes: ReturnType<typeof poisEntryShape>[] = [];
  let missing = false;
  for (const entry of pois) {
    const uid = poiUidOf(entry);
    if (uid) {
      let dest = ctx.byUid.get(uid);
      if (dest === undefined) {
        const fc = await (options.exportForm ?? ((poiUid: string) => PoiSourceService.exportForm(poiUid)))(uid);
        if (!fc) {
          missing = true; // E7
          continue;
        }
        const emitted = await emitPoiDocument(fc, poisLayerKeyOf(fc) ?? uid, ctx, sink);
        if (emitted === null) {
          // 連番枯渇 (同一基底名 100 件超)。黙って落とさずインライン透過へ倒す。
          // 利用者向け警告キーは新設しない (§5.5) — main プロセスのログで可視化する
          console.warn('[poiReferenceResolver] POI file name candidates exhausted; kept inline:', uid);
          out.push(await resolveIconRefsInFc(fc, sink));
          resolvedShapes.push(poisEntryShape(fc));
          continue;
        }
        dest = emitted;
        ctx.byUid.set(uid, dest);
      }
      out.push(await buildPoiLayerRef(dest, entry as Record<string, unknown>, sink)); // E1
      resolvedShapes.push('fc'); // resolvePoisArray なら FC に置換されていた
      continue;
    }
    if (isPoiLayerRef(entry)) {
      const layer = entry.layer;
      if (typeof layer === 'string') {
        out.push(entry); // E4
        resolvedShapes.push(poisEntryShape(entry));
        continue;
      }
      const emitted = await emitPoiDocument(layer, poisLayerKeyOf(layer), ctx, sink);
      if (emitted === null) {
        console.warn('[poiReferenceResolver] POI file name candidates exhausted; kept inline wrapper');
        out.push(entry);
      } else {
        out.push(await buildPoiLayerRef(emitted, entry, sink)); // E5
      }
      resolvedShapes.push(poisEntryShape(entry));
      continue;
    }
    if (isFeatureCollection(entry)) {
      const emitted = await emitPoiDocument(entry, poisLayerKeyOf(entry), ctx, sink);
      if (emitted === null) {
        console.warn('[poiReferenceResolver] POI file name candidates exhausted; kept inline FC');
        out.push(await resolveIconRefsInFc(entry, sink));
      } else {
        out.push({ layer: emitted }); // E2
      }
      resolvedShapes.push('fc');
      continue;
    }
    if (typeof entry === 'string') {
      out.push({ layer: entry }); // E3
      resolvedShapes.push('string'); // resolvePoisArray でも文字列は混在判定に数えない
      continue;
    }
    out.push(entry); // E6
    resolvedShapes.push(poisEntryShape(entry));
  }
  if (missing) mergeWarnings(warnings, ['appedit.warn_missing_poi_source']);
  if (hasMixedPoisShapes(resolvedShapes)) mergeWarnings(warnings, ['appedit.warn_mixed_pois']);
  return {
    pois: out,
    files: [...sink.files.values()],
    documents: [...ctx.documents.values()],
    warnings,
  };
}

// icon 実体コピー要求の重複なし合流 (dest キーで畳む — 複数 pois 配列/複数 map をまたぐ集約用)
export function mergeIconFiles(target: Map<string, IconFile>, added: IconFile[]): void {
  for (const file of added) {
    target.set(file.dest, file);
  }
}

// 警告キーの重複なし合流 (静的キーのため同一キーは1回だけ表示する)
export function mergeWarnings(target: string[], added: string[]): void {
  for (const key of added) {
    if (!target.includes(key)) target.push(key);
  }
}

// 二重参照警告キー (POI-142)。静的キー制約のため slug は含めない ({key,params} 化は UI 統一タスクで)
export const DUPLICATE_POI_REFERENCE_WARNING = 'appedit.warn_duplicate_poi_reference';

// Asset Reference 欠落警告キー (M11-T9)。
export const MISSING_ASSET_REF_WARNING = 'appedit.warn_missing_asset_ref';

// --- Asset Reference URI (maplat-asset:<UID>) 解決 (M11-T9) ---

const ASSET_REF_RE = /maplat-asset:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

// LangResource の全言語値から maplat-asset:<UID> を抽出し replaceFn で置換する。
// FEATURE_COPY: 変更がない場合は original をそのまま返す（copy-on-write）。
function replaceAssetRefsInLangValue(
  value: unknown,
  replaceFn: (uid: string) => string,
): { result: unknown; changed: boolean } {
  if (typeof value === 'string') {
    let changed = false;
    const result = value.replace(ASSET_REF_RE, (_match, uid: string) => {
      changed = true;
      return replaceFn(uid.toLowerCase());
    });
    return { result, changed };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    let changed = false;
    const newObj: Record<string, unknown> = {};
    for (const [lang, text] of Object.entries(obj)) {
      if (typeof text === 'string') {
        const newText = text.replace(ASSET_REF_RE, (_match, uid: string) => {
          changed = true;
          return replaceFn(uid.toLowerCase());
        });
        newObj[lang] = newText;
      } else {
        newObj[lang] = text;
      }
    }
    return { result: changed ? newObj : obj, changed };
  }
  return { result: value, changed: false };
}

// FC 内の全 features の properties.html（LangResource 全言語値）から maplat-asset:<UID> を
// replaceFn で置換する (copy-on-write)。走査対象は html のみ（設計 §93）。
function resolveAssetRefsInFc(
  entry: unknown,
  replaceFn: (uid: string) => string,
): unknown {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const fc = entry as Record<string, unknown>;
  if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return entry;

  const features = fc.features as unknown[];
  let changedFeatures: unknown[] | null = null;
  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    if (!feature || typeof feature !== 'object') continue;
    const props = (feature as Record<string, unknown>).properties;
    if (!props || typeof props !== 'object') continue;
    const html = (props as Record<string, unknown>).html;
    if (html === undefined) continue;

    const { result, changed } = replaceAssetRefsInLangValue(html, replaceFn);
    if (changed) {
      if (!changedFeatures) changedFeatures = [...features];
      changedFeatures[i] = {
        ...(feature as Record<string, unknown>),
        properties: { ...(props as Record<string, unknown>), html: result },
      };
    }
  }
  if (changedFeatures) {
    return { ...fc, features: changedFeatures };
  }
  return entry;
}

// プレビュー用: FC 内の maplat-asset:<UID> を /preview/{token}/imgs/assets/{uid}.{ext} に置換。
// getAssetPath(uid) は ImageAssetService.getFilePath(uid) の結果（ext 抽出に使う）。
// 2パス方式: 先に全 UID を収集し ext を解決してから同期的に置換する。
export async function resolveAssetRefsInFcForPreview(
  entry: unknown,
  token: string,
  getAssetPath: (uid: string) => Promise<string | null>,
): Promise<unknown> {
  const uidExtCache = new Map<string, string>();
  const allUids = collectAssetRefUidsFromFcProps(entry);

  for (const uid of allUids) {
    const filePath = await getAssetPath(uid);
    if (filePath) {
      const ext = path.extname(filePath).replace(/^\./, '') || 'png';
      uidExtCache.set(uid, ext);
    }
  }

  return resolveAssetRefsInFc(entry, (uid) => {
    const ext = uidExtCache.get(uid);
    if (ext) {
      return `/preview/${token}/imgs/assets/${uid}.${ext}`;
    }
    // 解決できない UID は元の参照を維持（欠落診断は呼び出し側の責務）
    return `maplat-asset:${uid}`;
  });
}

// FC 内の全 features の properties.html から Asset Reference UID を収集
function collectAssetRefUidsFromFcProps(entry: unknown): Set<string> {
  const uids = new Set<string>();
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return uids;
  const fc = entry as Record<string, unknown>;
  if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return uids;
  for (const feature of fc.features as unknown[]) {
    if (!feature || typeof feature !== 'object') continue;
    const props = (feature as Record<string, unknown>).properties;
    if (!props || typeof props !== 'object') continue;
    const html = (props as Record<string, unknown>).html;
    if (html !== undefined) {
      const found = collectAssetRefUids(html);
      for (const uid of found) uids.add(uid);
    }
  }
  return uids;
}

// エクスポート用: FC 内の maplat-asset:<UID> を imgs/{slug}.{ext} に置換し、
// 実体コピー要求を icons Map に追加。
// 戻り値の warnings は欠落 Asset の警告キー（複数欠落でも1回だけ）。
export async function resolveAssetRefsForExport(
  entry: unknown,
  icons: Map<string, IconFile>,
): Promise<{ entry: unknown; warnings: string[] }> {
  const warnings: string[] = [];
  const allUids = collectAssetRefUidsFromFcProps(entry);
  const uidToDest = new Map<string, string>();

  for (const uid of allUids) {
    const record = await SqliteDataService.findAsset(uid);
    if (!record) {
      mergeWarnings(warnings, [MISSING_ASSET_REF_WARNING]);
      continue;
    }
    const saveFolder = SettingsService.get('saveFolder') as string;
    const src = path.join(saveFolder, 'assets', `${record.uid}.${record.ext}`);
    if (!(await fs.pathExists(src))) {
      mergeWarnings(warnings, [MISSING_ASSET_REF_WARNING]);
      continue;
    }
    const dest = `imgs/${record.slug}.${record.ext}`;
    uidToDest.set(uid, dest);
    icons.set(dest, { src, dest });
  }

  const result = resolveAssetRefsInFc(entry, (uid) => {
    return uidToDest.get(uid) ?? `maplat-asset:${uid}`;
  });

  return { entry: result, warnings };
}
