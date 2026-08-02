// app document の pois 形式判定（M12-T30、sp-0006 準拠）。
// 撤去済みの旧 heal ユーティリティ（bounded reparse ループによる多重 stringify 破損の復元）は、
// 旧 Editor が d234ce8 (2026-07-02) で発明した JSON 文字列の内部表現へのフォールバック復元も
// 持っていたが、いずれも normalize のたびに JSON.stringify し直していた実装ミスの後始末であり、
// viewer 正本 (MaplatCore/src/normalize_pois.ts) が実際に受容する過去の正規形式の翻訳ではなかった。
// 書き込み側は既に修正済み（AppEdit.vue の保存経路は pois 配列をそのまま永続化する）ため、
// 読み込み側での復元は不要かつ sp-0006 に抵触する。
//
// ここでは「復元」ではなく「形式判定」のみを行う（文字列の再パースは一切行わない）。
// editor 正準形は pois が配列であることのみ。それ以外（文字列・object）は unsupported として
// 扱い、生値を温存 (黙って消えない原則, m3-t6 §5.8 H-5(d)) した上で read-only 表示に倒す。
// 温存を含む「受け入れ」は下の acceptDocumentPois が担い、AppEdit / MapEdit の両画面が
// この1本を通る (M4-T1)。
//
// レイヤ名キー object 形 ({main: layer, id1: layer}) は normalizeLayers (MaplatCore) の
// 出力＝ビューア内部形式であり、設定ファイル形式ではない (実データ0件・m4 マイルストーン設計 §1.2
// で確認)。恒久的に unsupported として扱う。M12-T30 当時のコメントは「正規取り込み化は別タスク
// (m12-t28) の責務」としていたが、m4 の再定義でその前提は失われた。
//
// 旧 Editor 発明の内部表現は人間が導入したフィールドではなく viewer 正本にも一切登場しないため、
// M12-T30 v1.2（sp-0007・恒久指示）により「存在しないものとして扱う」。本関数はそのフィールドを
// 一切参照しない（パラメータからも削除済み）。
import {
  isPoiLayerRef,
  isPoiLayerRefAsWhole,
  poisEntryShape,
} from "./poisLayerStructure";

export function readAppDocumentPois(value: { pois?: unknown }): {
  pois: unknown[];
  unsupported: boolean;
} {
  if (Array.isArray(value.pois)) {
    return { pois: value.pois, unsupported: false };
  }
  if (value.pois == null) {
    return { pois: [], unsupported: false };
  }
  // M4-T4: 単独形（レイヤ1つを配列に包まず直接置く形）を受け入れる。
  // データモデル上 pois は「レイヤ単独 or [レイヤ配列]」であり（人間・2026-08-02）、
  // 単独形の URL文字列 / 上書きレイヤ / FeatureCollection はいずれも viewer 正本が受容する
  // （nodesLoader :5-19 / isPoiLayerRefAsWhole :49-51 / 単一 FC :142-145）。
  //
  // 【sp-0006】ここで返す配列は **表示のための写像**であり、文書の pois を配列へ書き換えるもの
  // ではない。単独形と1要素配列は現行 viewer で等価ではない（"url" は fetch されて1レイヤに
  // なるが ["url"] は壊れる）ため、読み込み時に配列化すると壊れるデータを作ってしまう。
  // 保存形の維持は書き込み側の関所 writeDocumentPois が担う。
  if (isSingleLayerForm(value.pois)) {
    return { pois: [value.pois], unsupported: false };
  }
  return { pois: [], unsupported: true };
}

// 単独形として受け入れる値か。viewer 正本の非配列分岐に1対1で対応する。
// 素ラッパー（上書きキーを持たないラッパー）は viewer の else 分岐へ落ちて壊れるため
// **受け入れない**（= 従来どおり unsupported で生値温存）。Editor はこの形を保存もしない
// （writeDocumentPois が退化させる）。
function isSingleLayerForm(pois: unknown): boolean {
  if (typeof pois === "string") return isPoiUrlString(pois);
  if (poisEntryShape(pois) === "fc") return true;
  return isPoiLayerRefAsWhole(pois);
}

// URLレイヤとして受け入れる文字列か。空文字は除外し、**JSON 文字列化された値も除外**する。
// 後者は旧 Editor の多重 stringify バグ由来の破損であり（M12-T30 で unsupported と確定）、
// URL ではない。ここで supported にすると、破損を「URLレイヤ」として編集可能に見せてしまい、
// 利用者が破損の上に編集を積むことになる。sp-0006 / 恒久指示「正規化 vs バグ後始末」に従い、
// **復元も追認もせず unsupported のまま生値温存へ倒す**（read-only + 警告）。
// viewer の nodesLoader も この文字列をそのまま fetch して失敗するだけで、意味は与えない。
//
// 除外する先頭文字は JSON の構造開始記号 `[` `{` `"` の3つ。深さ2以上の stringify は
// `"` で始まる（`"[{…}]"` を更に stringify すると `"\"[{…}]\""`）ため、`[` `{` だけでは
// 素通ししてしまう（M12-T30 の「深さ2 stringify」ケースで実測）。URL がこの3文字で
// 始まることは無いので、判定は URL 側を狭めない。
const JSON_OPENERS = ['[', '{', '"'];

function isPoiUrlString(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  return !JSON_OPENERS.includes(trimmed[0]);
}

/**
 * pois 書き込みの唯一の関所（M4-T4）。AppEdit / MapEdit の onPoisChange は両方これを通す
 * （読み込み側の acceptDocumentPois と対称）。
 *
 * - 0 件            → pois キーを削除する（t1 で両画面統一した永続形）
 * - 元が単独形で1件 → **単独形のまま保存する**（配列化しない。§5.3 の sp-0006 判定）
 * - 元が単独形で2件以上 → 配列化する（**利用者の操作による形式変更**であり読み込み側の正規化ではない）
 * - 元が配列       → 配列のまま（1件でも単独形へ畳まない）
 *
 * 単独形へ書き戻す値が**素ラッパー**（上書きキーを持たない `{layer:…}`）の場合は、`layer` の
 * 中身へ退化させる。viewer の isPoiLayerRefAsWhole が非配列位置では上書きキーの存在を追加要求
 * するため、素ラッパーの単独形は壊れるからである。**配列要素位置では退化させない** — そちらでは
 * 裸 URL が誤判定される側なので、ラッパーのほうが安全（安全性が位置で逆転する）。
 */
export function writeDocumentPois<T extends { pois?: unknown }>(
  target: T,
  next: readonly unknown[],
  previous: unknown,
): T {
  if (next.length === 0) {
    delete (target as { pois?: unknown }).pois;
    return target;
  }
  const wasSingleForm = previous !== undefined && previous !== null && !Array.isArray(previous);
  if (wasSingleForm && next.length === 1) {
    (target as { pois?: unknown }).pois = degradeBareWrapperForWholePosition(next[0]);
    return target;
  }
  (target as { pois?: unknown }).pois = [...next];
  return target;
}

// 非配列位置に置く値の安全化。素ラッパーは layer の中身へ退化させる。
function degradeBareWrapperForWholePosition(value: unknown): unknown {
  if (isPoiLayerRef(value) && !isPoiLayerRefAsWhole(value)) {
    return (value as Record<string, unknown>).layer;
  }
  return value;
}

/**
 * pois 受け入れの唯一の関所（M4-T1）。外部（DB / ファイル / 複製元）から来た文書を
 * 編集状態へ取り込むとき、AppEdit / MapEdit の両画面ともこの関数を通す。
 *
 * - 未設定（null / undefined） → target に pois キーを作らない（元に無いキーを生やさない）
 * - それ以外（配列・単独形・未対応形式のすべて） → **生値をそのまま温存する**（黙って消えない原則）
 *
 * M4-T4 で「配列は read.pois を代入」という分岐を畳んだ。配列の場合 read.pois は incoming.pois と
 * 同一参照だったので挙動は変わらないが、**単独形が supported になった以上、read.pois（表示用の
 * 配列写像）を代入すると文書の単独形が配列へ書き換わってしまう** — これは読み込み側の正規化であり
 * sp-0006 に抵触する。∴ この関所は「生値を置く」ことに徹し、配列化は書き込み側の
 * writeDocumentPois が利用者操作の結果としてのみ行う。
 *
 * target と incoming が同一オブジェクトでも安全（冪等）。
 */
export function acceptDocumentPois<T extends { pois?: unknown }>(
  target: T,
  incoming: { pois?: unknown },
): T {
  if (incoming.pois == null) {
    delete (target as { pois?: unknown }).pois;
  } else {
    (target as { pois?: unknown }).pois = incoming.pois;
  }
  return target;
}
