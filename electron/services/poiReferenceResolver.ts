// 登録 POI ソース参照 ({poiUid}) と icon 参照文法の main 側解決層 (Phase 7, 43 §2.4/§7/§8)。
// document.pois / map data_json の pois 配列内の { poiUid, cachedTitle?, icon?, selectedIcon?, title? } 要素を
// PoiSourceService.exportForm の export 形 FeatureCollection へ置換する。
// 生要素 (URL 文字列 / FC 埋め込み) は無加工で透過し (座標も丸めない)、
// 見つからない/読めない poiUid は要素を落として 'appedit.warn_missing_poi_source' を1回だけ載せる。
// 呼び込み点は 5 箇所: AppPreviewService の app JSON / map JSON、AppExportService の app JSON / map JSON、
// mapDownloadZip.ts の composeDownloadMapJson (M13-T1: mapedit.ts から移設。旧 mapedit:download の
// composeDownloadMapJson を指していた記述を実体へ追随)。
// warnings は静的 i18n キー (AppEdit 側の t(key) 表示と互換、パラメタ補間なし)。
//
// icon 参照文法の解決 (POI-117): pois 配列内の FC (解決済み・生 FC の双方) の layer metadata
// (トップレベル icon/selectedIcon) と全 feature properties の icon/selectedIcon を走査し、
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

// props (layer metadata または feature properties) の icon/selectedIcon を解決。
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

  let out: Record<string, unknown> | null = await resolveIconProps(fc, sink);
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

// 参照要素の icon/selectedIcon 上書き (Phase 8, POI-112 最小形) を解決後 FC のトップレベル
// (layer metadata) へ適用する。string かつ非空の値のみ有効で、ソース側 FC に元々 icon が
// あっても参照側の上書きが勝つ。ここでは参照文法のまま載せ、後段の resolveIconRefsInFc が
// 通常の icon 解決 (imgs/ 書き換え + 実体コピー要求 + unresolved 警告) を等しく適用する。
// title 上書き (GUI 検証 D1): 参照要素の title (LangResource) が非空なら、toExportForm が
// FC.name に書くのと同じ交換形 (compactLangResource collapse、defaultLang=DEFAULT_LANG) で
// 解決後 FC の name をソース側より優先で上書きする。空 (空文字/空 object/未定義) は上書きなし
function applyReferenceIconOverrides(
  fc: Record<string, unknown>,
  entry: Record<string, unknown>,
): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  for (const key of ['icon', 'selectedIcon']) {
    const value = entry[key];
    if (typeof value !== 'string' || value === '') continue;
    if (!out) out = { ...fc };
    out[key] = value;
  }
  const title = compactLangResource(entry.title as LangResource | null | undefined, DEFAULT_LANG);
  if (title !== undefined) {
    if (!out) out = { ...fc };
    out.name = title;
  }
  return out ?? fc;
}

// pois 配列内の {poiUid} 要素のみ export 形 FC に置換。生要素は透過 (icon 参照解決を除き無加工)。
// missing は要素落ち + 警告キー1回。非配列入力は空配列扱い (呼び出し側で配列時のみ呼ぶこと)。
// 参照要素の icon/selectedIcon 上書きは解決後 FC のトップレベルへ適用 (Phase 8, POI-112 最小形)。
// 置換後の FC (解決済み・生 FC の双方) の icon 参照文法を imgs/... へ解決し、
// 実体コピー要求を files として返す (POI-117)。同一参照の重複コピーは dest キーで畳む
export async function resolvePoisArray(pois: unknown): Promise<ResolvedPois> {
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
    const fc = await PoiSourceService.exportForm(uid);
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
  return { pois: out, files: [...sink.files.values()], warnings };
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
