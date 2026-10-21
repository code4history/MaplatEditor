// pwa-asset-generator の Apple 端末寸法表（apple-fallback-data.json）を
// リポジトリ内の electron/pwa_apple_splash_devices.json へ機械コピーする生成器。
//
// なぜ自前で持つか（#174 / nov26-rc-editor174 設計書 v2 §6）:
//   pwaAssets.ts は実行時に依存の内部パス（node_modules/.pnpm/... や asar 内）を import しない。
//   ただし寸法表そのものは「今と同じ 46 枚」を作るための正本なので、依存が package.json に
//   残っている間は依存側の JSON とバイト同一に保つ（smoke:nov26-rc-editor174-pwa-assets の AC7 が
//   両者を deepStrictEqual で突き合わせる）。依存を撤去する次サイクルでは、この生成器の出力が正本になる。
//
// 使い方: node scripts/generate-pwa-splash-devices.mjs
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const outputPath = path.join(projectRoot, 'electron/pwa_apple_splash_devices.json');

/** 依存側 JSON の実パスを解決する（pnpm の .pnpm 配下でも pkg 解決に任せる）。 */
export async function resolveSourcePath() {
  // pwa-asset-generator は ESM だが、package.json の location だけを require.resolve で引く
  const pkgPath = require.resolve('pwa-asset-generator/package.json');
  return path.join(path.dirname(pkgPath), 'dist/config/apple-fallback-data.json');
}

async function main() {
  const sourcePath = await resolveSourcePath();
  const sourceBytes = await readFile(sourcePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await copyFile(sourcePath, outputPath);
  const parsed = JSON.parse(sourceBytes.toString('utf8'));
  console.log(`copied ${parsed.length} devices: ${path.relative(projectRoot, sourcePath)} -> ${path.relative(projectRoot, outputPath)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
