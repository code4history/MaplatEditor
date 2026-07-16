// POI Content Mode の純ロジック（型定義・モード別アクティブフィールド契約・legacy推定・Asset Reference URI収集）。
// renderer(POI editor)と electron main(export/preview) の双方から import するため、
// electron/node 固有 API は使わない。
export type PoiContentMode = 'standard' | 'html' | 'url';

export const CONTENT_MODE_VALUES: readonly PoiContentMode[] = ['standard', 'html', 'url'];

// モード別アクティブフィールド契約。image は標準モードでは表示用メディア、html モードでは参照素材。
const ACTIVE_FIELDS: Record<PoiContentMode, readonly string[]> = {
  standard: ['desc', 'address', 'image'],
  html: ['html', 'image'],
  url: ['url'],
};

const INCOMPATIBLE_FIELDS: Record<PoiContentMode, readonly string[]> = {
  standard: ['html', 'url'],
  html: ['desc', 'address', 'url'],
  url: ['desc', 'address', 'html', 'image'],
};

export function activeFieldsForMode(mode: PoiContentMode): readonly string[] {
  return ACTIVE_FIELDS[mode];
}

export function incompatibleFieldsForMode(mode: PoiContentMode): readonly string[] {
  return INCOMPATIBLE_FIELDS[mode];
}

// LangResource 値（string | {lang: string}）が非空か。
function hasNonEmptyLangValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() !== '';
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.values(value as Record<string, unknown>).some(
      (v) => typeof v === 'string' && v.trim() !== '',
    );
  }
  return false;
}

// legacy Feature の properties から Content Mode を推定。
// html > url > undefined（undefined = standard として扱うが、明示値は書かない）
export function estimateContentMode(props: Record<string, unknown>): PoiContentMode | undefined {
  if (hasNonEmptyLangValue(props.html)) return 'html';
  if (hasNonEmptyLangValue(props.url)) return 'url';
  return undefined;
}

// --- Asset Reference URI 収集（純関数） ---

// maplat-asset:<UID> の正規表現。UUID_PATTERN に一致する UID のみ抽出する。
const ASSET_REF_RE = /maplat-asset:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

// 値そのものが UUID 形状（=アセット UID 直接参照）かの判定（StorageAdapter.UUID_PATTERN と同形）
const UID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// html 文字列（単一言語の string）から maplat-asset:<UID> の UID 集合を抽出。
// HTML 以外の文脈（URL 等）では使わない（RE は大文字小文字非区別のグローバル）。
function collectUidsFromString(html: string): Set<string> {
  const uids = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = ASSET_REF_RE.exec(html)) !== null) {
    uids.add(m[1].toLowerCase());
  }
  return uids;
}

// LangResource（string または lang→string の record）の全言語値を走査し、
// maplat-asset:<UID> の UID 集合を返す純関数。UID 判定には UUID_PATTERN（同上）を使う。
export function collectAssetRefUids(html: unknown): Set<string> {
  const uids = new Set<string>();
  if (typeof html === 'string') {
    const found = collectUidsFromString(html);
    for (const uid of found) uids.add(uid);
  } else if (html && typeof html === 'object' && !Array.isArray(html)) {
    for (const value of Object.values(html as Record<string, unknown>)) {
      if (typeof value === 'string') {
        const found = collectUidsFromString(value);
        for (const uid of found) uids.add(uid);
      }
    }
  }
  return uids;
}

// image フィールド値 (string | Array<string | {src}> | {src}) から
// UUID 形状のアセット参照 UID を収集する。
// 標準モードの画像・htmlモードの参照素材はアセット UID を直接値として持つため、
// maplat-asset: 形式ではなく値そのものが UID かで判定する（人間検証Round1: 画像欄の欠落未検査の解消）。
export function collectImageAssetUids(image: unknown): Set<string> {
  const uids = new Set<string>();
  const addIfUid = (v: unknown): void => {
    if (typeof v === 'string' && UID_RE.test(v.trim())) uids.add(v.trim().toLowerCase());
  };
  if (Array.isArray(image)) {
    for (const entry of image) {
      if (typeof entry === 'string') addIfUid(entry);
      else if (entry && typeof entry === 'object') addIfUid((entry as Record<string, unknown>).src);
    }
  } else if (typeof image === 'string') {
    addIfUid(image);
  } else if (image && typeof image === 'object') {
    addIfUid((image as Record<string, unknown>).src);
  }
  return uids;
}

// FeatureCollection の全 features の properties.html から Asset Reference UID を収集。
// 走査対象は properties.html のみ（設計 §93、desc/address/url は走査しない）。
export function collectAssetRefsInFc(fc: unknown): Set<string> {
  const uids = new Set<string>();
  if (!fc || typeof fc !== 'object' || Array.isArray(fc)) return uids;
  const obj = fc as Record<string, unknown>;
  if (obj.type !== 'FeatureCollection' || !Array.isArray(obj.features)) return uids;
  for (const feature of obj.features as unknown[]) {
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