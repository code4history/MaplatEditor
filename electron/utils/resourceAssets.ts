// アプリ同梱リソース(ビルトインベースマップの52pxアイコン等)の実体パス解決。
// dev時は public/、ビルド後は dist/ 配下に配置される。
import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = process.env.APP_ROOT || path.resolve(__dirname, '..', '..');

const resourceRoots = [
  path.resolve(appRoot, 'public'),
  path.resolve(appRoot, 'dist'),
  path.resolve(__dirname, '..', 'public'),
  path.resolve(__dirname, '..', 'dist'),
];

// リソース相対パス(例: basemap_icons/tokyo502man.png) → 実体絶対パス。無ければnull。
export function resolveResourceAsset(relPath: string): string | null {
  if (typeof relPath !== 'string' || !relPath.trim() || relPath.includes('..')) return null;
  for (const root of resourceRoots) {
    const candidate = path.join(root, relPath);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export function resourceAssetFileUrl(relPath: string): string | null {
  const resolved = resolveResourceAsset(relPath);
  return resolved ? `file://${resolved.split(path.sep).join('/')}` : null;
}
