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
import {
  createPoiExternalizationContext,
  externalizeMapDocumentPois,
  writePoiDocuments,
  type IconFile,
  type PoiDocument,
} from '../services/poiReferenceResolver';

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
): Promise<{ compiled: any; warnings: string[]; files: IconFile[]; documents: PoiDocument[] }> {
  const compiled = compactMapLangFields(await storeHandler.histMap2Store(mapObject, tins));
  // 交換形にはv2の内部メタデータ(uid/slug/revision)を含めない (ADR-0007)
  delete (compiled as any).uid;
  delete (compiled as any).slug;
  delete (compiled as any).revision;
  let warnings: string[] = [];
  let files: IconFile[] = [];
  let documents: PoiDocument[] = [];

  // M5-T4B: POI の読み出しを **app 搬出と同じ readAppDocumentPois へ寄せる**。
  //
  // 従来はここが `Array.isArray((compiled as any).pois)` の生判定だった。∴ 単独形
  // (レイヤ1つを配列に包まず直接置く形) の地図では if 節に入らず、pois が
  // **未処理のまま素通り**していた。「pois が undefined になる」のではなく
  // 「解決されないまま配布 ZIP へ出る」のが正確な壊れ方である:
  //   (1) 登録参照 {poiUid} が editor 内部形のまま残り viewer に解決できない
  //       ∴ 利用者から見て POI が失われる
  //   (2) icon / maplat-asset: の実体が manifest へ集まらず ZIP に同梱されない
  //
  // m4-t4 は同じ欠陥を **app 側でだけ** 是正した (AppExportService の該当コメントが
  // 「map 側だけ生判定だったため単独形の地図で POI が丸ごと落ちていた・実データ3件が該当」
  // と記録している)。その是正が地図 ZIP 側に及んでいなかったのを本タスクで揃える
  // (恒久指示「同一扱い処理は共通実装へ徹底」)。
  // M5-T4B: 解決を resolvePoisArray (インライン FC 化) から共通 API へ移す。
  // externalizeMapDocumentPois は **アプリ搬出と共有する唯一の実装**であり、
  // 読み出し (readAppDocumentPois) と外部化 (externalizePoisArray) を1本に束ねる。
  // ctx の寿命は **搬出1回＝地図1枚**である (app 搬出は app + 全 map で1つを共有する。
  // 出力プロファイルの差であって契約の差ではない)。
  const ctx = createPoiExternalizationContext();
  const { result } = await externalizeMapDocumentPois(compiled as { pois?: unknown }, ctx);
  if (result) {
    warnings = result.warnings;
    files = result.files;
    documents = result.documents;
  }
  return { compiled, warnings, files, documents };
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
  const { compiled, warnings, files, documents } = await composeDownloadMapJson(mapObject, tins);
  if (warnings.length > 0) {
    console.warn('[mapDownloadZip] POI reference warnings:', warnings);
  }
  const tmpFile = path.join(tmpFolder, `${slug}.json`);
  await fs.ensureDir(tmpFolder);
  await fs.writeFile(tmpFile, JSON.stringify(compiled));

  // M5-T4B: 外部化した POI 実体 (pois/<name>.geojson) を一時領域へ書き出す。
  // map JSON の pois が指す dest と 1:1 で対応する ∴ ここを書かないと
  // **参照だけがあって実体が無い ZIP** になる。
  //
  // 書き出しは **アプリ搬出と共有する writePoiDocuments** が担う。
  // 従来ここで JSON.stringify (minify) していたためアプリ ZIP の pretty と食い違い、
  // 同じ dest の同じ実体が経路によって別物になっていた (2026-08-03 人間指摘)。
  // 境界検査 (dest が pois/ の外へ出ていないか) も共有側にしか無かった。
  // 一時ディレクトリを出力ルートに見立てて渡し、その下の pois/ へ書かせる
  const poiStageDir = path.join(tmpFolder, `${slug}-poi-stage`);
  await fs.remove(poiStageDir).catch(() => undefined);
  const poiTmpFiles = await writePoiDocuments(poiStageDir, documents);

  // ZIP に追加するファイルリスト: [localPath, zipDir, zipName]
  const targets: [string, string, string][] = [
    [tmpFile, 'maps', `${slug}.json`],
    [path.join(thumbFolder, `${fileKey}.jpg`), 'tmbs', `${slug}.jpg`],
  ];

  // M5-T4B: 512px サムネイル (M12-T15 (G) で app 搬出には入っていたが地図 ZIP には無かった)。
  // 読み込みは uid キー、ZIP 内は slug 名 (ADR-0007)。
  // **旧 ZIP 互換のため実体が無い場合は黙って省略する** — targets は下の addLocalFile が
  // fs.existsSync で存在確認するため、ここへ積むだけで不在時は自動的にスキップされる
  // (通常サムネイル・タイルと同じ扱い)。
  targets.push([path.join(thumbFolder, `${fileKey}_512.jpg`), 'tmbs', `${slug}_512.jpg`]);

  // M5-T4B: 外部化した POI 実体を pois/<name>.geojson として同梱する
  for (let i = 0; i < documents.length; i++) {
    targets.push([poiTmpFiles[i], 'pois', path.posix.basename(documents[i].dest)]);
  }

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
  // M5-T4B: 外部化 POI の一時領域も後始末する
  await fs.remove(poiStageDir).catch(() => undefined);
  await fs.move(zipFilePath, targetFilePath, { overwrite: true });
}
