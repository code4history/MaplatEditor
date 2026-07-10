// 登録 POI ソース参照 ({poiUid}) の main 側解決層 (Phase 7 Task 1, 43 §2.4/§8)。
// document.pois / map data_json の pois 配列内の { poiUid, cachedTitle? } 要素を
// PoiSourceService.exportForm の export 形 FeatureCollection へ置換する。
// 生要素 (URL 文字列 / FC 埋め込み) は無加工で透過し (座標も丸めない)、
// 見つからない/読めない poiUid は要素を落として 'appedit.warn_missing_poi_source' を1回だけ載せる。
// 呼び込み点は 4 箇所: AppPreviewService の app JSON / map JSON、AppExportService の app JSON / map JSON。
// warnings は静的 i18n キー (AppEdit 側の t(key) 表示と互換、パラメタ補間なし)。
import PoiSourceService from './PoiSourceService';

export interface ResolvedPois {
  pois: unknown[];
  warnings: string[];
}

// {poiUid} 参照要素なら uid を返す。poiUid 以外のキー (cachedTitle 等) は解決時に無視する
function poiUidOf(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const uid = (entry as Record<string, unknown>).poiUid;
  return typeof uid === 'string' && uid.trim() !== '' ? uid : null;
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

// pois 配列内の {poiUid} 要素のみ export 形 FC に置換。生要素は透過。
// missing は要素落ち + 警告キー1回。非配列入力は空配列扱い (呼び出し側で配列時のみ呼ぶこと)
export async function resolvePoisArray(pois: unknown): Promise<ResolvedPois> {
  const warnings: string[] = [];
  if (!Array.isArray(pois)) return { pois: [], warnings };
  const out: unknown[] = [];
  let missing = false;
  for (const entry of pois) {
    const uid = poiUidOf(entry);
    if (!uid) {
      out.push(entry);
      continue;
    }
    const fc = await PoiSourceService.exportForm(uid);
    if (fc) {
      out.push(fc);
    } else {
      missing = true;
    }
  }
  if (missing) warnings.push('appedit.warn_missing_poi_source');
  return { pois: out, warnings };
}

// 警告キーの重複なし合流 (静的キーのため同一キーは1回だけ表示する)
export function mergeWarnings(target: string[], added: string[]): void {
  for (const key of added) {
    if (!target.includes(key)) target.push(key);
  }
}

// 二重参照警告キー (POI-142)。静的キー制約のため slug は含めない ({key,params} 化は UI 統一タスクで)
export const DUPLICATE_POI_REFERENCE_WARNING = 'appedit.warn_duplicate_poi_reference';
