import { BrowserWindow } from 'electron';
import fs from 'fs-extra';
import path from 'path';
import AdmZip from 'adm-zip';
// @ts-ignore
import recursiveFs from 'recursive-fs';
import SettingsService from '../services/SettingsService';
import * as storeHandler from './store_handler';
import { compactMapLangFields } from '../../src/utils/langResource';
import { ProgressReporter } from './ProgressReporter';
import { resolvePoisArray, type IconFile } from '../services/poiReferenceResolver';

// download 用の交換形 map JSON を組み立てる (M2)。histMap2Store + 言語畳み込みの後、
// pois 内の {poiUid} 参照を resolvePoisArray で export 形 FC へ解決する
// (AppExportService/AppPreviewService と同じ viewer 互換の扱いに統一)。
// icon 参照文法も同時に imgs/... へ解決され (POI-117, M1)、実体コピー要求 files を返す
// (呼び出し側が ZIP の imgs/... へ同梱する)。
// mapedit:download / mapedit:download-saved の戻り値は 'Success'|'Canceled'|'Error' の文字列契約を保つため、
// warnings はここでは返すのみに留め、呼び出し側で console.warn するか判断させる
// (M13-T1: mapedit.ts:65-82 からそのまま移設。ロジック変更なし)
export async function composeDownloadMapJson(
  mapObject: any, tins: any[]
): Promise<{ compiled: any; warnings: string[]; files: IconFile[] }> {
  const compiled = compactMapLangFields(await storeHandler.histMap2Store(mapObject, tins));
  // 交換形にはv2の内部メタデータ(uid/slug/revision)を含めない (ADR-0007)
  delete (compiled as any).uid;
  delete (compiled as any).slug;
  delete (compiled as any).revision;
  let warnings: string[] = [];
  let files: IconFile[] = [];
  if (Array.isArray((compiled as any).pois)) {
    const resolved = await resolvePoisArray((compiled as any).pois);
    warnings = resolved.warnings;
    files = resolved.files;
    (compiled as any).pois = resolved.pois;
  }
  return { compiled, warnings, files };
}

// mapedit.ts:171-227 (旧 mapedit:download ハンドラ本体) から compose 呼び出し以降を統合。
// compose を内部で呼ぶため mapObject/tins を受け取る (M13-T1: §2.6)。
// tmpFolder/saveFolder/tileFolder/thumbFolder の解決は SettingsService を使用する (既存と同一)
export async function buildAndWriteMapZip(
  win: BrowserWindow,
  mapObject: any,
  tins: any[],
  slug: string,
  fileKey: string,
  targetFilePath: string,
): Promise<void> {
  const tmpFolder = SettingsService.get('tmpFolder') as string;
  const saveFolder = SettingsService.get('saveFolder') as string;
  const tileFolder = path.join(saveFolder, 'tiles');
  const thumbFolder = path.join(saveFolder, 'tmbs');

  // histMap2Store で store 形式に変換してから JSON 保存。
  // エクスポート(交換形)ではデフォルト言語のみの言語別フィールドを
  // プレーン文字列に畳み込む (ADR-0005)。pois 内の {poiUid} 参照は export 形 FC へ
  // 解決する (viewer 互換, M2)。renderer には warnings を表示する経路が未配線のため
  // console.warn で可視化するに留める (判断根拠は Phase 7 品質レビュー M2 参照)
  const { compiled, warnings, files } = await composeDownloadMapJson(mapObject, tins);
  if (warnings.length > 0) {
    console.warn('[mapDownloadZip] POI reference warnings:', warnings);
  }
  const tmpFile = path.join(tmpFolder, `${slug}.json`);
  await fs.ensureDir(tmpFolder);
  await fs.writeFile(tmpFile, JSON.stringify(compiled));

  // ZIP に追加するファイルリスト: [localPath, zipDir, zipName]
  const targets: [string, string, string][] = [
    [tmpFile, 'maps', `${slug}.json`],
    [path.join(thumbFolder, `${fileKey}.jpg`), 'tmbs', `${slug}.jpg`],
  ];

  // 解決済み POI icon の実体 (POI-117): zip ルート相対 imgs/... へ同梱
  // (viewer は icon をページ URL 基準で解決するため、index.html と同階層に置かれる想定の配置)
  for (const file of files) {
    const destSegments = file.dest.split('/');
    const zipName = destSegments.pop()!;
    targets.push([file.src, destSegments.join('/'), zipName]);
  }

  // タイルファイルを再帰的に収集(読み込みはtiles/{uid}、zip内はtiles/{slug})
  const tileRoot = path.join(tileFolder, fileKey);
  try {
    const { files: tileFiles } = await recursiveFs.read(tileRoot);
    for (const file of tileFiles) {
      const localPath = path.resolve(file);
      const zipName = path.basename(localPath);
      const relDir = path.relative(tileRoot, path.dirname(localPath));
      const zipPath = ['tiles', slug, ...relDir.split(path.sep).filter(Boolean)].join('/');
      targets.push([localPath, zipPath, zipName]);
    }
  } catch (_e) { /* タイルなし */ }

  const reporter = new ProgressReporter(
    'mapedit:taskProgress',
    targets.length,
    'mapdownload.adding_zip',
    'mapdownload.creating_zip'
  );
  reporter.setWindow(win);
  reporter.update(0);

  const zipFilePath = path.join(tmpFolder, `${slug}.zip`);
  const zip = new AdmZip();
  for (let i = 0; i < targets.length; i++) {
    const [localPath, zipDir, zipName] = targets[i];
    if (fs.existsSync(localPath)) {
      zip.addLocalFile(localPath, zipDir, zipName);
    }
    reporter.update(i + 1);
  }
  zip.writeZip(zipFilePath);

  await fs.remove(tmpFile);
  await fs.move(zipFilePath, targetFilePath, { overwrite: true });
}
