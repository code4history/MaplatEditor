// export 出力の POI 外部ファイル名（`pois/<base>.geojson` の base）を決める純関数（M4-T2 §5.2）。
//
// なぜ出力側で sanitize が要るか: ファイル名の基底は POI ソースの slug だけでなく、
// **生 FC / ラッパー内 FC の `id` / `properties.id`** からも来る（M4-T2 設計 §5.2 の E2 / E5）。
// POI ソースの slug は SqliteDataService.registerAsset:1691 が isValidSlug（= SLUG_PATTERN,
// electron/services/assetIdentity.ts:13）で弾くので安全だが、**FC の id は利用者が raw JSON
// ペインで自由に書ける値で、この検査を一切通らない**。
// ∴ `{"type":"FeatureCollection","id":"../../etc/passwd"}` を pois に置けば出力ディレクトリの
// 外へ書き出され得る。ファイル名を組み立てる直前に必ず通すこと。
//
// suggestSlug（poiSourceSlug.ts）は流用しない。あちらは import 時の slug 提案であり
// NFKD 正規化・拡張子除去・小文字化を含む。ここで必要なのは既存 slug を壊さない防御であって、
// `Kyoto_1` を `kyoto-1` へ変えてはならない（文字種の畳み込みは下の名前予約が担う）。
//
// 【大小の扱い】作る名前は slug の大小を保ち、比べるときだけ畳む。
// 大小を保つのは、取り込み側が ZIP の名前の slug で既存の asset を探して使い回すためである
// （PoiPackageService.sameStoredBytes）。小文字に揃えると元の `Kyoto` が見つからず、
// 同じ画像が2つの asset になってしまう。だから名前が変わるのは大小だけ違う名前が
// ぶつかったときだけで、`Foo` は `imgs/Foo.png`、`foo` は `imgs/foo-2.png`。
// ぶつかりの判定（taken の鍵）は取り込み側の重複検査と同じ entryNameKey で畳む
// （poiPackage.assertSafeArchiveEntries）。畳まないと `imgs/Foo.png` と `imgs/foo.png` が
// 同じ ZIP に並び「Duplicate … entry」として拒否される。slug そのものの表示は変わらない。
//
// 【重要】ここで決まるのはファイル名だけで、viewer のレイヤ key ではない。viewer は key を
// 外部ファイルの中身（`FC.id || FC.properties.id`, MaplatCore/src/normalize_pois.ts:124）から
// 決めるため、sanitize で名前が変わっても cluster の key・namespaceID は変わらない。
import { SLUG_MAX, SEQUENCE_MAX_INDEX, slugCandidate } from "./slugSequence";
import { entryNameKey } from "./poiPackage";

/** sanitize の結果が空になったときの基底名 */
export const POI_FILE_BASE_FALLBACK = "poi";

/**
 * 任意の値を `SLUG_PATTERN` を満たすファイル名基底へ落とす。
 * 非文字列・空・全除去された場合は {@link POI_FILE_BASE_FALLBACK}。
 */
export function sanitizePoiFileBase(raw: unknown): string {
  if (typeof raw !== "string") return POI_FILE_BASE_FALLBACK;
  const cleaned = raw
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, SLUG_MAX)
    // 切り詰めで末尾に残ったハイフンも落とす（`pois/xxx-.geojson` を作らない）
    .replace(/-$/, "");
  return cleaned || POI_FILE_BASE_FALLBACK;
}

/**
 * `taken` に対して未使用の基底名を確保する（`base`, `base-2`, … `base-100`）。
 * 候補生成は slugCandidate（slugSequence）と同一規則。確保した名前は `taken` へ追加する。
 * 全候補が埋まっている場合は null（呼び出し側が非外部化のフォールバックへ倒す）。
 *
 * 返す名前は `base` の大小を保つ（取り込み側が slug で asset を探し直すため）。
 * 比べるときだけ畳む: `taken` の鍵は entryNameKey（取り込み側の重複検査と同じ畳み）で、
 * 大小だけ違う基底名は連番で分かれる（`Foo` → `Foo`、`foo` → `foo-2`）。
 */
export function reservePoiFileBase(base: string, taken: Set<string>): string | null {
  for (let n = 1; n <= SEQUENCE_MAX_INDEX; n++) {
    const candidate = slugCandidate(base, n);
    const key = entryNameKey(candidate);
    if (taken.has(key)) continue;
    taken.add(key);
    return candidate;
  }
  return null;
}

/** 書き出し1回分で共有する imgs/<slug>.<ext> の名前予約（同じ uid は同じ名前になる） */
export interface PackageImageNames {
  /** uid → 確定した entry 名 */
  byUid: Map<string, string>;
  /** 予約済みの基底名（entryNameKey で畳んだ鍵） */
  taken: Set<string>;
}

export function createPackageImageNames(): PackageImageNames {
  return { byUid: new Map(), taken: new Set() };
}

/**
 * 画像 asset の entry 名（`imgs/<base>.<ext>`）を確保する。
 *
 * 大小だけ違う slug（例: `Foo` と `foo`）は同じ基底名として reservePoiFileBase の連番で
 * 分ける（`imgs/Foo.png` と `imgs/foo-2.png`）。名前は slug の大小を保ち、拡張子は小文字。
 * 同じ uid には常に同じ名前を返す（同じ asset の再参照で名前が増えない）。
 * 連番が枯渇した場合は uid の先頭で名前を分ける（まず到達しない保険）。
 */
export function reservePackageImageName(
  names: PackageImageNames,
  uid: string,
  slug: string,
  ext: string,
): string {
  const prior = names.byUid.get(uid);
  if (prior) return prior;
  const suffix = String(ext ?? '').toLowerCase().replace(/^\.+/, '');
  const base = reservePoiFileBase(slug, names.taken)
    ?? `${String(slug).slice(0, SLUG_MAX - 9)}-${uid.slice(0, 8)}`;
  const entryName = `imgs/${base}${suffix ? `.${suffix}` : ''}`;
  names.byUid.set(uid, entryName);
  return entryName;
}
