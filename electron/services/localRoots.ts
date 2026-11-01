// ローカルのファイルを読んでよい場所の定義。app:// の配信とタイルの読み出しが同じ集合を使う。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppSchemeRoots } from '../utils/appScheme';
import SettingsService from './SettingsService';
import { draftTileRoot } from './draftTilePaths';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveAppSchemeRoots(): AppSchemeRoots {
  const appRoot = process.env.APP_ROOT || path.resolve(__dirname, '..');
  const saveFolder = SettingsService.get('saveFolder');
  const fallbackRoot = path.join(appRoot, 'dist');
  return {
    bundleRoots: [fallbackRoot, path.join(appRoot, 'public')],
    // localFileUrl() が URL 化する置き場所（saveFolder / draftTileRoot / tmpFolder 配下の tiles）を
    // 許可する。一時領域は tiles だけを許可する（zip の展開先などは配信しない）。
    localRoots: [
      typeof saveFolder === 'string' && saveFolder ? saveFolder : fallbackRoot,
      draftTileRoot,
      path.join(SettingsService.get('tmpFolder') as string, 'tiles'),
    ],
  };
}
