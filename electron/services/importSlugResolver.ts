// M5-T5: import の slug 衝突解決。**全 import 経路の唯一の正本**。
//
// 【この層が持つのは「import 方針」であって候補生成規則ではない】
// 候補生成 (base, base-2 … base-<maxIndex>) は src/utils/slugSequence.ts が正本であり、
// 複製 "-copy" / inline POI 変換 "-poi" と共有している。ここが決めるのは import 固有の3点:
//
//   1. 空入力を素通しする — 呼び出し側の invalid-request 検査へそのまま委ねる
//      (ここで 'untitled' 等へ正規化すると、利用者の入力ミスが黙って通ってしまう)
//   2. 予約をしない — 直後の作成処理が isSlugAvailable を再検査する。検査後の先取り
//      (レース) は作成側で 'Exist' へ写像される (地図側の写像は DataUploadService)
//   3. 候補枯渇は null — 呼び出し側が 'Exist' を返す
//
// 【なぜ main 側に置くか】
// slugSequence は renderer/main 共用の純関数だが、本 API は SqliteDataService へ
// 問い合わせる。src/utils/ へ置くと renderer が DB 依存を引き込む。
//
// 【使う経路 (全数)】
//   1. POI .zip import                    PoiSourceService.importFile
//   2. POI .geojson import                PoiSourceService.importFile
//   3. 地図 ZIP 同梱 managed POI 復元      PoiSourceService.createPoiSourceFromManagedDocument
//   4. 地図 ZIP import                    DataUploadService.extractZip
//   5. 画像 asset import                  PoiPackageService (POI ZIP 同梱画像の登録)
//
// ADR-0007 により slug は asset 種別を跨いで一意 ∴ 種別ごとに規則を分けてはならない。
import { findAvailableSlug } from '../../src/utils/slugSequence';
import SqliteDataService from './SqliteDataService';

export interface ResolveImportSlugOptions {
  /** 上書き保存経路で、自分自身の slug を衝突扱いにしないための除外 uid */
  excludeUid?: string;
}

/**
 * import の slug 衝突を自動解決する。
 *
 * @returns 空きが見つかった slug / 空入力はそのまま (空文字) / 全候補枯渇は `null`
 */
export async function resolveImportSlug(
  slug: unknown,
  options: ResolveImportSlugOptions = {},
): Promise<string | null> {
  const base = String(slug ?? '').trim();
  if (!base) return base; // 空 slug は呼び出し側の invalid-request 検査へそのまま委ねる
  return findAvailableSlug(base, (candidate) =>
    SqliteDataService.isSlugAvailable(candidate, options.excludeUid));
}
