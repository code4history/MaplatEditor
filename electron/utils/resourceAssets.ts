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

// saveFolder / folder 配下への封じ込め判定。`startsWith(path.resolve(folder) + path.sep)` で、
// 兄弟ディレクトリ（`{folder}-x`）を prefix 一致から除外する（poiReferenceResolver.iconSetFilePath
// と同じ形式）。resourceImageResolver / AppAssetService.fileUrlFor が共有して使う。
// ※ base ちょうど（folder 自身）は除外されるが、対象は常に配下ファイルのため実害なし（設計 Info1）。
export function isUnderFolder(resolvedPath: string, folder: string): boolean {
  const base = path.resolve(folder);
  const resolved = path.resolve(resolvedPath);
  return resolved.startsWith(base + path.sep);
}
