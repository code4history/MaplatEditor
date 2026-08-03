export const POI_PACKAGE_MAX_ENTRIES = 512;
export const POI_PACKAGE_MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
export const POI_PACKAGE_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export interface PoiPackageEntryInfo {
  name: string;
  size: number;
  isSymlink?: boolean;
}

// M5-T4: 旧 assertSafePoiPackageEntries は**性質の異なる2種類の検査**を1つのループに
// 混ぜていた。地図 ZIP はタイルを再帰的・無制限に同梱する既存形式のため（mapDownloadZip.ts）、
// 後者（容量・件数上限）を地図 ZIP 全体へ適用すると**正当な地図が import できなくなる**。
// ∴ 2つに割り、既存関数は両者の合成として残す（挙動・メッセージとも無変更）。
//
//   (a) assertSafeArchiveEntries  — ZIP 種別に依らず全 entry へ適用する安全検証
//   (b) assertPoiPayloadLimits    — POI payload の容量・件数上限
//
// **(b) は「渡された entry 集合」に対して働き、絞り込みは行わない。**
// 絞り込みを (b) の内側に置くと、POI 単体パッケージ経路で payload 外 entry
// （巨大な README 等）が勘定から外れ、zip-bomb 検知が弱体化する。一方 (b) を
// 地図 ZIP 全体へ掛けると正当な地図を拒否する。∴ **どの集合へ掛けるかは呼び出し側の
// 関心事**とし、判定述語だけを isPoiPayloadEntry として共有する
// （findPoiDocumentEntry / listPoiDocumentEntries と同じ切り分け方である:
//  共通化するのは列挙・判定であって、個数や範囲の要求ではない）。
//
//   POI 単体パッケージ: (b) を全 entry へ（= assertSafePoiPackageEntries）
//   地図 ZIP:           (a) を全 entry へ、(b) を isPoiPayloadEntry で絞った集合へ

/** (a) 安全検証。ZIP 種別に依らず全 entry へ適用する。 */
export function assertSafeArchiveEntries(
  entries: readonly PoiPackageEntryInfo[],
  kindLabel = 'POI package',
): void {
  const names = new Set<string>();
  for (const entry of entries) {
    const name = String(entry.name);
    if (
      !name ||
      name.includes('\\') ||
      name.startsWith('/') ||
      /^[A-Za-z]:/.test(name) ||
      name.split('/').some((segment) => segment === '..') ||
      entry.isSymlink
    ) {
      throw new Error(`Unsafe ${kindLabel} entry: ${name}`);
    }
    if (names.has(name)) throw new Error(`Duplicate ${kindLabel} entry: ${name}`);
    names.add(name);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`Invalid ${kindLabel} entry size: ${name}`);
    }
  }
}

/** POI payload（ZIP 同梱の POI 実体）に当たる entry か。地図 ZIP 側の絞り込みに使う。 */
export function isPoiPayloadEntry(name: string): boolean {
  return /^(?:pois|imgs)\//i.test(String(name));
}

/**
 * (b) POI payload の容量・件数上限。**渡された集合に対して適用する**（絞り込みはしない）。
 * メッセージは kindLabel を取らない — 守っている対象が ZIP 種別に依らず POI payload であり、
 * 地図 ZIP で超過した場合も「POI package is too large」が事実として正しいためである。
 */
export function assertPoiPayloadLimits(entries: readonly PoiPackageEntryInfo[]): void {
  if (entries.length > POI_PACKAGE_MAX_ENTRIES) {
    throw new Error('POI package contains too many entries');
  }
  let total = 0;
  for (const entry of entries) {
    const name = String(entry.name);
    // size の妥当性検査は (a) 側が持つ。ここで再度弾くのは **単独呼び出しへの自衛**である:
    // NaN が1件でも混ざると total が NaN になり、以降の `total > MAX` が恒偽になって
    // 上限判定そのものが無効化する（サイズ上限を黙って素通りさせる最悪の壊れ方）。
    // 合成経路では (a) が先に throw するため、この行に到達するのは単独呼び出しのときだけである。
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`Invalid POI package entry size: ${name}`);
    }
    total += entry.size;
    if (/^imgs\/.+[^/]$/i.test(name) && entry.size > POI_PACKAGE_MAX_IMAGE_BYTES) {
      throw new Error(`Packaged image is too large: ${name}`);
    }
    if (total > POI_PACKAGE_MAX_EXPANDED_BYTES) {
      throw new Error('POI package is too large');
    }
  }
}

/**
 * 既存契約の維持。POI 単体パッケージは**全 entry が payload** であるため、
 * (b) を絞り込まずに全 entry へ掛ける。
 *
 * 分割前との差は「多重違反時にどちらのメッセージが返るか」だけである
 * （旧実装は entry ごとに (a)(b) を交互に評価していた）。単一違反の入力に対しては
 * メッセージまで完全に一致する。
 */
export function assertSafePoiPackageEntries(entries: readonly PoiPackageEntryInfo[]): void {
  assertSafeArchiveEntries(entries);
  assertPoiPayloadLimits(entries);
}

/** POI 文書 entry の列挙（共通 primitive）。個数の要求は呼び出し側の関心事とする。 */
export function listPoiDocumentEntries(names: readonly string[]): string[] {
  return names.filter((name) => /^pois\/[^/]+\.geojson$/i.test(name));
}

/** POI 単体パッケージ専用。ちょうど1件という**入力検証**を持つ（地図 ZIP の都合で緩めない）。 */
export function findPoiDocumentEntry(names: readonly string[]): string {
  const matches = listPoiDocumentEntries(names);
  if (matches.length !== 1) {
    throw new Error(`POI package must contain exactly one pois/*.geojson file (found ${matches.length})`);
  }
  return matches[0];
}

type MediaResolver = (value: string) => string | Promise<string>;

/**
 * M5-T4B: `properties.html` に埋め込まれた `imgs/<slug>.<ext>` を asset の正本記法へ戻す解決器。
 *
 * `MediaResolver` と分けているのは **正本の記法が違う**ためである。
 * `icon` / `selectedIcon` / `image` の正本は**裸の asset UID**だが、
 * html 本文中の正本は `maplat-asset:<UID>` である（`poiReferenceResolver.ASSET_REF_RE`）。
 * 同じ resolver を使い回すと html に裸 UID が書かれ、viewer からも editor からも
 * 画像として解決できない文字列になる。
 *
 * 戻り値 null は「asset として解決しない（原文を維持する）」を意味する。
 */
export type HtmlAssetRefResolver = (imgsPath: string) => Promise<string | null>;

// html 本文中の imgs 参照。`imgs/icons/<set>/<id>.<ext>`（icon set の実体）は
// スラッシュを許さないこの形にマッチしない ∴ 自然に対象外になる
// （icon set は asset ではないため maplat-asset: 記法を持たない）。
const HTML_IMGS_REF_RE = /imgs\/[A-Za-z0-9._-]+\.[A-Za-z0-9]+/g;

// html は string か LangResource（{ja: "...", en: "..."}）のどちらかである。
// 搬出側 replaceAssetRefsInLangValue と同じ2形を受ける（copy-on-write）。
async function rewriteHtmlAssetRefs(
  value: unknown,
  resolve: HtmlAssetRefResolver,
): Promise<{ value: unknown; changed: boolean }> {
  if (typeof value === 'string') {
    const found = [...new Set(value.match(HTML_IMGS_REF_RE) ?? [])];
    if (found.length === 0) return { value, changed: false };
    let out = value;
    let changed = false;
    for (const ref of found) {
      const uid = await resolve(ref);
      if (!uid) continue;
      out = out.split(ref).join(`maplat-asset:${uid}`);
      changed = true;
    }
    return { value: out, changed };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [lang, text] of Object.entries(object)) {
      const rewritten = await rewriteHtmlAssetRefs(text, resolve);
      next[lang] = rewritten.value;
      if (rewritten.changed) changed = true;
    }
    return { value: changed ? next : object, changed };
  }
  return { value, changed: false };
}

async function rewriteImage(value: unknown, resolve: MediaResolver): Promise<unknown> {
  if (typeof value === 'string') return resolve(value);
  if (Array.isArray(value)) return Promise.all(value.map((entry) => rewriteImage(entry, resolve)));
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (typeof object.src !== 'string') return value;
    return { ...object, src: await resolve(object.src) };
  }
  return value;
}

async function rewriteProperties(
  properties: Record<string, unknown>,
  resolve: MediaResolver,
  resolveHtmlAssetRef?: HtmlAssetRefResolver,
): Promise<Record<string, unknown>> {
  let changed: Record<string, unknown> | null = null;
  for (const key of ['icon', 'selectedIcon'] as const) {
    if (typeof properties[key] !== 'string') continue;
    const next = await resolve(properties[key] as string);
    if (next !== properties[key]) {
      if (!changed) changed = { ...properties };
      changed[key] = next;
    }
  }
  if ('image' in properties) {
    const next = await rewriteImage(properties.image, resolve);
    if (JSON.stringify(next) !== JSON.stringify(properties.image)) {
      if (!changed) changed = { ...properties };
      changed.image = next;
    }
  }
  // M5-T4B: html 本文の imgs 参照を maplat-asset: へ戻す（搬出 resolveAssetRefsForExport の逆）。
  // resolveHtmlAssetRef 未指定の呼び出し側は従来どおり html を触らない
  if (resolveHtmlAssetRef && 'html' in properties) {
    const rewritten = await rewriteHtmlAssetRefs(properties.html, resolveHtmlAssetRef);
    if (rewritten.changed) {
      if (!changed) changed = { ...properties };
      changed.html = rewritten.value;
    }
  }
  return changed ?? properties;
}

export async function rewritePoiMediaReferences<T>(
  document: T,
  resolve: MediaResolver,
  resolveHtmlAssetRef?: HtmlAssetRefResolver,
): Promise<T> {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return document;
  const fc = document as Record<string, unknown>;
  let output = await rewriteProperties(fc, resolve, resolveHtmlAssetRef);

  // m18-t5: FC.properties（layer metadata の正本位置）の icon 参照書き換え
  const fcProps = fc.properties;
  if (fcProps && typeof fcProps === 'object' && !Array.isArray(fcProps)) {
    const changedProps = await rewriteProperties(fcProps as Record<string, unknown>, resolve, resolveHtmlAssetRef);
    if (changedProps !== fcProps) {
      output = output === fc ? { ...fc } : output;
      output.properties = changedProps;
    }
  }

  if (Array.isArray(fc.features)) {
    const originalFeatures = fc.features;
    const features = await Promise.all(originalFeatures.map(async (feature) => {
      if (!feature || typeof feature !== 'object' || Array.isArray(feature)) return feature;
      const row = feature as Record<string, unknown>;
      if (!row.properties || typeof row.properties !== 'object' || Array.isArray(row.properties)) return feature;
      const properties = await rewriteProperties(
        row.properties as Record<string, unknown>, resolve, resolveHtmlAssetRef);
      return properties === row.properties ? feature : { ...row, properties };
    }));
    if (features.some((feature, index) => feature !== originalFeatures[index])) {
      output = output === fc ? { ...fc } : output;
      output.features = features;
    }
  }
  return output as T;
}
