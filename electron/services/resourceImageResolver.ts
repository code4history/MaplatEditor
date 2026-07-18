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
  const tileFolder = path.join(saveFolder, 'tiles');
  const uiThumbnailFolder = path.join(saveFolder, 'tmbs');
  // 旧実装（MapDataService.requestMaps）と同一順序: uid || (_id || mapID)
  const fileKey = doc.uid || doc._id || doc.mapID || doc.slug;
  if (!fileKey) return null;
  const uiThumbnail = path.join(uiThumbnailFolder, `${fileKey}.jpg`);
  if (await fs.pathExists(uiThumbnail)) {
    return `file://${uiThumbnail.split(path.sep).join('/')}`;
  }
  const thumbFolder = path.join(tileFolder, fileKey, '0', '0');
  try {
    const files = await fs.readdir(thumbFolder);
    const tileFile = files.find((f) => /^0\.(jpg|jpeg|png)$/.test(f));
    if (tileFile) {
      const tilePath = path.join(thumbFolder, tileFile);
      return `file://${tilePath.split(path.sep).join('/')}`;
    }
  } catch (e: any) {
    if (e?.code !== 'ENOENT') {
      console.error(`[resourceImageResolver] ${fileKey} のサムネイル読み込みエラー`, e);
    }
  }
  return null;
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
    return await resolveMapTileByRef(startSource.mapUid);
  }
  return null;
}

// startFrom 地図の 0/0/0 タイル解決（AppDataService.getMapTile と同一ロジック）
async function resolveMapTileByRef(mapRef: string): Promise<string | null> {
  const mapDoc = await SqliteDataService.findMapByRef(mapRef);
  if (!mapDoc?.uid) return null;
  const saveFolder = SettingsService.get('saveFolder');
  const thumbFolder = path.join(saveFolder, 'tiles', mapDoc.uid, '0', '0');
  if (!fs.existsSync(thumbFolder)) return null;
  try {
    const files = await fs.readdir(thumbFolder);
    const tileFile = files.find((f) => /^0\.(jpg|jpeg|png)$/.test(f));
    return tileFile ? `file://${path.join(thumbFolder, tileFile).split(path.sep).join('/')}` : null;
  } catch {
    return null;
  }
}
