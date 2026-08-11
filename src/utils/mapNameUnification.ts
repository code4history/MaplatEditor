// m19-t1: 地図の名称属性を 1.0.0 の語彙へ移す写像と、その取込境界での受容。
// タスク設計 `docs/superpowers/specs/2026-08-09-m19-t1-map-name-unification-design.md` v1.2 §4.1
// 上位契約: マイルストーン設計 v1.6 §4.2（1.0.0 データスキーマ凍結契約）
//
//   旧 title (地図名称(表示用)・必須) -> label (表示ラベル・任意)
//   旧 officialTitle (地図名称(正確)・任意) -> title (タイトル・必須)
//     ※ 正確名を持たない言語キーは旧 title で必須制約を満たす（移行時の一時措置であり、
//        実行時の代替表示ではない。表示側にフォールバックは実装しない）
//
// ★不変条件（絶対・m19-t7 で更新）: (A) unifyMapNameFields は「移行の写像」であって
//   「正規化」ではない。呼んでよいのは **下記 adoptDeprecatedMapNames の 1 箇所だけ** である。
//   そして adoptDeprecatedMapNames を呼んでよいのは、書き込み側の唯一の正規化点
//   SqliteDataService.normalizeMapDocument の 1 箇所だけである。
//   読み込み側（mapRowToDocument）から呼んではならない。
//
//   m19-t7 以前は呼び出し可能点が 2 つあった（marker 保護下の one-shot migration
//   applyMapNameUnificationMigration と、本ファイルの取込境界ゲート）。
//   0.7.0 → 1.0.0 を一気通貫化した際に前者を撤去したので、写像の呼び出し点は 1 つになった。
//   併せて「レガシー取込は写像を持たず行を作るだけ」という旧規律も撤去した。その規律は
//   「取込行は同一 migrate() 実行内の後段が写像する」という前提の上に立っており、
//   後段が消えた以上は維持不能である。レガシー取込は他のすべての書き込みと同じく
//   normalizeMapDocument を通る（写像を二重実装するのではなく、唯一の点を素通りしない）。
//
// ★冪等性について（二重の守りと、その限界）:
//   素朴形（label <- title と title <- officialTitle の無条件同時入れ替え）は冪等ではない。
//   2 回適用すると label が（すでに正確名になった）title で潰される。
//   本実装は「label は言語キーが無いときだけ埋める / 廃止属性は在るときだけ移して削除する」形に
//   することで 2 回目に値を潰さないが、**no-op ではない**。
//   正しい不変条件は「2 回目は既存の言語キーの値を 1 つも変えない。label の欠損言語キーの
//   補充だけは起こりうる」である（旧 officialTitle にのみ存在した言語キーは 1 回目で title に
//   入り、素の (A) を 2 回当てれば label へ補充されうる）。
//   m19-t7 以降、唯一の入口 (B) は**キーの在否でゲートするため完全に冪等**であり
//   （1 回目でキーが消えるので 2 回目は no-op）、marker による保護は不要になった。
//   ∴ marker 喪失で二重適用される経路そのものが存在しない。
//   実データでの補充発生は 0 件（実ユーザ DB 264 件・0.7.0 公開 map.json 14 件のいずれにも
//   「廃止属性にのみ存在する言語キー」を持つ地図は無い）。
//
// ★写像は文書単位ではなく **言語キー単位** で取る（ADR-0005 の per-language 前提）。
//   ベースマップ側の参照実装（SqliteDataService.normalizeLegacyBaseMapDocument。m19-t7 で
//   起動時 migration から取込側へ移設したもの）の whole-object 判定
//   （Object.keys(label).length > 0 ? label : {...title}）は参照実装であって規範ではない。
//   文書単位だと title={ja,en} / 正確名={ja} の地図で英語のタイトルが消える。
import { normalizeLangResource } from './langResource';

// 0.7.0 の正規属性（1.0.0 で廃止）。属性名を 1 箇所に閉じ込める
const DEPRECATED_EXACT_NAME_KEY = 'officialTitle';

/** 2 つの言語キー集合の和集合（挿入順は base → extra） */
function langKeyUnion(base: Record<string, string>, extra: Record<string, string>): string[] {
  const keys = Object.keys(base);
  for (const key of Object.keys(extra)) {
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

/**
 * (A) 地図の名称属性を 1.0.0 の語彙へ移す（marker 保護下の migration 専用）。
 * 非破壊。副作用なし・DB 非依存の純関数。
 */
export function unifyMapNameFields<T extends Record<string, any>>(document: T): T {
  const lang = typeof document.lang === 'string' && document.lang ? document.lang : 'ja';
  // 入力の名称属性は undefined / null / プレーン文字列 / オブジェクトのいずれもあり得る。
  // MAP_LANG_ATTRS から廃止属性を外した結果、レガシー取込で保持される値は
  // プレーン文字列のまま行に入りうるため、必ず normalizeLangResource を通してから読む。
  const oldTitle = normalizeLangResource(document.title, lang);
  const oldLabel = normalizeLangResource(document.label, lang);
  const oldExactName = normalizeLangResource((document as any)[DEPRECATED_EXACT_NAME_KEY], lang);

  // (1) 表示用名称を label へ移す。label にその言語キーが無いときだけ埋める
  const newLabel: Record<string, string> = {};
  for (const lg of langKeyUnion(oldLabel, oldTitle)) {
    const value = oldLabel[lg] ?? oldTitle[lg];
    if (value !== undefined) newLabel[lg] = value;
  }

  // (2) 正確名を title へ移す。正確名を持たない言語キーは旧 title で必須制約を満たす
  const newTitle: Record<string, string> = {};
  for (const lg of langKeyUnion(oldExactName, oldTitle)) {
    const value = oldExactName[lg] ?? oldTitle[lg];
    if (value !== undefined) newTitle[lg] = value;
  }

  const out: Record<string, any> = { ...document, title: newTitle, label: newLabel };
  // 廃止属性を落とす（= 2 回目以降の (2) を構造的に無効化する）
  delete out[DEPRECATED_EXACT_NAME_KEY];
  return out as T;
}

/**
 * (B) 取込境界での受容（sp-0006 の「過去の正規形式の受容」の許容側）。
 *
 * 廃止属性のキーが在るとき **だけ** (A) を適用し、無ければ何もしない（非破壊で返す）。
 * 0.7.0 が公開した交換形を 1.0.0 の語彙へ写すためのもので、1.0.0 のエディタが書き出す
 * 文書にはキーが存在しないため常設経路では一切発火しない。
 *
 * ★(A) と違い **完全に冪等** である: 1 回目でキーが消えるため 2 回目は no-op。
 *   ∴ 書き込み側の唯一の正規化点（normalizeMapDocument）に置いてよい。
 *
 * ★ゲートは「キーの在否」で取り、「値の非空」では取らない。
 *   0.7.0 のデータには空文字の廃止属性を持つ地図が現に存在し、値で取ると同じ 0.7.0 文書でも
 *   空文字のものだけ label が埋まらず、結果が入力の些細な違いで割れる。
 *
 * ★キーそのものを持たない文書は写像の対象外である（label を title から補充しない）。
 *   移すものが無いのだから移さない、というだけの規則である。m19-t7 以前は marker 保護下の
 *   one-shot migration が全行へ無条件に (A) を当てていたため、キー無し文書でも label が
 *   title から生えていた。この差は 0.7.0 の実 corpus では発生しない
 *   （0.7.0 の MapEdit は廃止属性を必ず空文字で初期化するため。人間の実データ 244/244 が
 *   キーを保持することを実測済み）。title は必ず残るのでデータ喪失でもない。
 *   この仕様は scripts/m19-t7-migration-passthrough-smoke.mjs の
 *   INTENTIONAL_DIVERGENCE が fixture で機械固定している。
 */
export function adoptDeprecatedMapNames<T extends Record<string, any>>(document: T): T {
  if (!document || typeof document !== 'object') return document;
  if (!(DEPRECATED_EXACT_NAME_KEY in document)) return document;
  return unifyMapNameFields(document);
}
