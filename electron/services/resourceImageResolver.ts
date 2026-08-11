// M12-T1-HOTFIX-1: 一覧/selector 用の image URL 解決の共有層。
// MapDataService（maplist.request）と AppDataService（applist.request）が持っていた
// 画像解決ロジックを search layer 経路（search:maps/search:apps）へ共通化する。
// file:// URL を返し、解決不可は null（呼び出し側は no_image fallback へ）。
import fs from 'fs-extra';
import path from 'node:path';
import SettingsService from './SettingsService';
import AppAssetService from './AppAssetService';
import SqliteDataService from './SqliteDataService';
import { normalizeAppSource } from '../../src/utils/appSourceModel';
import { resourceAssetFileUrl, isUnderFolder } from '../utils/resourceAssets';
// m19-t5: 512px の所在は派生規約の単一モジュールから導く（拡張子は THUMB_512_EXT が決める）
import { thumb512PathFor, thumb52PathFor } from '../../src/utils/thumbnailPaths';

// m1-t7 (Minor-3): tiles/{fileKey}/0/0/0.{jpg,jpeg,png} を saveFolder 配下に封じ込めたうえで
// file:// URL として解決する共通ヘルパ。
//
// この処理はもともと resolveMapListImage の tiles fallback と resolveMapTileByRef に
// 同じものが2つ写しで存在し、前者にだけ追加された M12-T13 の封じ込めが後者へ伝播せず、
// Cycle 1 包括セキュリティレビュー Minor-3 として顕在化した。挙動を似せて2箇所を直すのではなく
// 単一実装へ畳んで、写しが再発しない形にしている。
//
// 封じ込めはディレクトリ（FS 読み取り前）と最終ファイルパスの二段で行う。前者は saveFolder 外の
// ディレクトリを読みに行かないため、後者は将来 tileFile 名の生成規則が変わっても契約を守るため。
export async function resolveTileZeroFileUrl(
  saveFolder: string,
  fileKey: string,
): Promise<string | null> {
  if (!fileKey) return null;
  const thumbFolder = path.join(saveFolder, 'tiles', fileKey, '0', '0');
  // fileKey が slug 由来で '..' を含む場合、path.join は正規化されて saveFolder 外を指しうる
  if (!isUnderFolder(thumbFolder, saveFolder)) return null;
  try {
    const files = await fs.readdir(thumbFolder);
    const tileFile = files.find((f) => /^0\.(jpg|jpeg|png)$/.test(f));
    if (!tileFile) return null;
    const tilePath = path.join(thumbFolder, tileFile);
    if (!isUnderFolder(tilePath, saveFolder)) return null;
    return `file://${tilePath.split(path.sep).join('/')}`;
  } catch (e: any) {
    if (e?.code !== 'ENOENT') {
      console.error(`[resourceImageResolver] ${fileKey} のサムネイル読み込みエラー`, e);
    }
    return null;
  }
}

// 地図一覧の画像: 正式サムネイル tmbs/{fileKey}.jpg → 無ければ tiles/{fileKey}/0/0/0.* fallback。
// fileKey は uid 優先（ADR-0007。uid 欠落時は旧 slug パスへフォールバック）。
// MapDataService.requestMaps の :58-79 と同一ロジックを共有化したもの（挙動不変）。
export async function resolveMapListImage(doc: {
  uid?: string;
  mapID?: string;
  slug?: string;
  _id?: string;
}): Promise<string | null> {
  const saveFolder = SettingsService.get('saveFolder');
  const uiThumbnailFolder = path.join(saveFolder, 'tmbs');
  // 旧実装（MapDataService.requestMaps）と同一順序: uid || (_id || mapID)
  const fileKey = doc.uid || doc._id || doc.mapID || doc.slug;
  if (!fileKey) return null;
  const uiThumbnail = path.join(uiThumbnailFolder, `${fileKey}.jpg`);
  if (await fs.pathExists(uiThumbnail)) {
    // sec-1 (M12-T13): fileKey が slug 由来で '..' を含む場合、path.join は正規化されて
    // saveFolder 外を指しうる。返却前に saveFolder 配下であることを確認し、外なら null へ落とす。
    if (!isUnderFolder(uiThumbnail, saveFolder)) return null;
    return `file://${uiThumbnail.split(path.sep).join('/')}`;
  }
  // sec-1 (M12-T13) の tiles fallback 封じ込めは m1-t7 で共通ヘルパへ移した
  return resolveTileZeroFileUrl(saveFolder, fileKey);
}

// アプリ一覧の画像: アイコン → スプラッシュ → startFrom が Maplat 地図なら 0/0/0 タイル → null。
// AppDataService.resolveAppImage の :58-78 と同一ロジックを共有化したもの（挙動不変）。
export async function resolveAppListImage(doc: any): Promise<string | null> {
  const iconSource = doc.manifestSettings?.iconSource || doc.httpSettings?.iconSource;
  if (typeof iconSource === 'string' && iconSource.trim()) {
    const url = AppAssetService.fileUrlFor(iconSource);
    if (url) return url;
  }
  const splash = doc.appSettings?.splash || doc.splash;
  if (typeof splash === 'string' && splash.trim()) {
    const url = AppAssetService.fileUrlFor(`img/${splash}`);
    if (url) return url;
  }
  const sources = (Array.isArray(doc.sources) ? doc.sources : [])
    .map((raw: any) => normalizeAppSource(raw, doc.lang || 'ja'));
  // startFromは新形=uid、旧保存形=slugのどちらもあり得る (ADR-0007)
  const startFromID = doc.startFrom || doc.start_from || sources.find((source: any) => source.startFrom)?.mapUid;
  const startSource = sources.find((source: any) => source.mapUid === startFromID || source.mapSlug === startFromID);
  if (startSource?.sourceType === 'maplat') {
    // M12-T15 (R7): favicon 未設定のアプリは、startFrom の地図の 512px サムネイルを優先解決する
    // （地図タイル fallback の前に 512px サムネイルを試す）
    const mapDoc = await SqliteDataService.findMapByRef(startSource.mapUid);
    if (mapDoc) {
      const thumb512 = await resolveMapListImage512(mapDoc);
      if (thumb512) return thumb512;
    }
    return await resolveMapTileByRef(startSource.mapUid);
  }
  return null;
}

// startFrom 地図の 0/0/0 タイル解決。
// m1-t7 (Minor-3): 旧実装はここで tiles パスを自前に組み立てており、M12-T13 が
// resolveMapListImage 側へ入れた saveFolder 封じ込めが適用されていなかった。
// 同一操作である resolveTileZeroFileUrl へ委譲して封じ込めを一元化する。
// あわせて、抽出元として AppDataService 側の同等関数を指していた旧コメントを外した
// （当該関数は既に存在せず、grep が空振りする stale 参照になっていた）
async function resolveMapTileByRef(mapRef: string): Promise<string | null> {
  const mapDoc = await SqliteDataService.findMapByRef(mapRef);
  if (!mapDoc?.uid) return null;
  return resolveTileZeroFileUrl(SettingsService.get('saveFolder'), mapDoc.uid);
}

// M12-T15 (R6): 地図一覧の高精細サムネイル解決。
// 512px（thumb512PathFor が導く唯一のパス。あれば）→ resolveMapListImage（52px → tile fallback）の順で解決する。
// 512px は MapList grid card（200px 表示）の高精細化に使う。
// m19-t5: 旧形式（jpg/png）を探し直す fallback は持たない。既存データは起動時 migration が
// 正規形へ移す（sp-0006: 読み込み側に二重分岐を作らない）。
export async function resolveMapListImage512(doc: {
  uid?: string;
  mapID?: string;
  slug?: string;
  _id?: string;
}): Promise<string | null> {
  const saveFolder = SettingsService.get('saveFolder');
  const fileKey = doc.uid || doc._id || doc.mapID || doc.slug;
  const rel512 = fileKey ? thumb512PathFor(thumb52PathFor(fileKey, 'jpg')) : null;
  if (rel512) {
    const thumb512 = path.join(saveFolder, rel512);
    if (await fs.pathExists(thumb512)) {
      // M12-T13 と同型: fileKey が slug 由来で '..' を含む場合の saveFolder 配下封じ込め
      if (!isUnderFolder(thumb512, saveFolder)) return null;
      return `file://${thumb512.split(path.sep).join('/')}`;
    }
  }
  return resolveMapListImage(doc);
}

// ベースマップ一覧の icon 解決: マスタの thumbnail を UI 表示用 URL へ解決する。
// basemap_icons/（同梱リソース）は resourceAssetFileUrl、その他の相対パスは saveFolder 基準、
// thumbnail 未設定の旧ユーザーベースマップは tmbs/{mapID}_menu.jpg の存在で補完する。
// electron/ipc/settings.ts basemaps:list（:46-66）と同一ロジックを共有化したもの（挙動不変）。
export function resolveBaseMapListImage(item: { mapID?: string; slug?: string; data?: any }): string | null {
  const saveFolder = SettingsService.get('saveFolder');
  let thumbnailUrl: string | null = null;
  const thumbnail = typeof item.data?.thumbnail === 'string' ? item.data.thumbnail : '';
  if (thumbnail.startsWith('basemap_icons/')) {
    thumbnailUrl = resourceAssetFileUrl(thumbnail);
  } else if (thumbnail) {
    const thumbPath = path.resolve(path.join(saveFolder, thumbnail));
    // sec-2 (M12-T13): 旧実装は startsWith(path.resolve(saveFolder)) だったが末尾 path.sep が無く、
    // 兄弟ディレクトリ（{saveFolder}-x）が prefix 一致で通過していた。isUnderFolder で厳密化。
    if (isUnderFolder(thumbPath, saveFolder) && fs.existsSync(thumbPath)) {
      thumbnailUrl = `file://${thumbPath.split(path.sep).join('/')}`;
    }
  }
  if (!thumbnailUrl) {
    const mapID = item.mapID || item.slug;
    const legacyPath = path.join(saveFolder, 'tmbs', `${mapID}_menu.jpg`);
    // sec-2 (M12-T13): legacyPath も mapID に '..' が含まれれば脱出しうるため、同じく isUnderFolder で封じ込め（多層化）。
    if (isUnderFolder(legacyPath, saveFolder) && fs.existsSync(legacyPath)) {
      thumbnailUrl = `file://${legacyPath.split(path.sep).join('/')}`;
    }
  }
  return thumbnailUrl;
}
