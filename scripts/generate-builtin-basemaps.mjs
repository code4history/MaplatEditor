// ビルトインベースマップ定義の生成スクリプト。
// ../Playground/KTGIS/ktgis-maplat-catalog.json を正本として electron/builtin_base_maps.json を生成する。
// - KTGIS(今昔マップ): rows から生成
// - 非KTGIS基盤レイヤー(osm/gsi/gsi_ortho/地理院年代別/AFFRC): baseMapRows から生成
// - アイコンは52px文字なし(no-year)を public/basemap_icons/{mapID}.png へコピーする
//   (osm/gsi/gsi_ortho は AppEdit の静的サムネイル用に src/assets/img/ へもコピー)
// 手編集禁止: 変更はカタログまたは本スクリプトに対して行うこと(ADR-0002)。
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const catalogPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(projectRoot, '../Playground/KTGIS/ktgis-maplat-catalog.json');
const catalogDir = path.dirname(catalogPath);
const legacyTmsListPath = path.join(projectRoot, 'electron/tms_list.json');
const outputPath = path.join(projectRoot, 'electron/builtin_base_maps.json');
const iconOutputDir = path.join(projectRoot, 'public/basemap_icons');
const assetImgDir = path.join(projectRoot, 'src/assets/img');

// Viewerビルトイン(アプリJSONへは素の文字列で出力される3種)
const VIEWER_BUILTIN_IDS = new Set(['osm', 'gsi', 'gsi_ortho']);

// 帰属表示: カタログにはattrがないため、ここで管理する
const BASE_MAP_ATTRS = {
  gsi_ort_USA10: 'The Geospatial Information Authority of Japan',
  gsi_ort_old10: 'The Geospatial Information Authority of Japan',
  gsi_gazo1: 'The Geospatial Information Authority of Japan',
  gsi_gazo2: 'The Geospatial Information Authority of Japan',
  gsi_gazo3: 'The Geospatial Information Authority of Japan',
  gsi_gazo4: 'The Geospatial Information Authority of Japan',
  // 旧aginfo配信終了に伴いCC-BYミラーへ移行(カタログnote参照)。権利者は農研機構
  affrc_rapid16: '農研機構農業環境研究部門',
  affrc_tokyo5k: '農研機構農業環境研究部門',
};

function bboxToEnvelope([west, south, east, north]) {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ];
}

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const legacyList = JSON.parse(await readFile(legacyTmsListPath, 'utf8'));
const legacyByID = new Map(legacyList.map((tms) => [tms.mapID, tms]));

// 生成物ディレクトリは毎回作り直す(旧アイコンの残骸を残さない)
await rm(iconOutputDir, { recursive: true, force: true });
await mkdir(iconOutputDir, { recursive: true });

const output = [];
const iconCopies = [];
const seenIDs = new Set();

// 1) 非KTGIS基盤レイヤー: カタログ baseMapRows を正本に生成
for (const row of catalog.baseMapRows) {
  const mapID = row.id;
  seenIDs.add(mapID);
  const entry = { mapID, title: row.title };
  if (VIEWER_BUILTIN_IDS.has(mapID)) {
    // Viewer内蔵レイヤー: アプリ出力は素の文字列のままにするため always を維持。
    // url/zoomはViewer内蔵定義と同値の参考情報(MapEditはmapIDで特別扱いしurlを見ない)
    entry.always = true;
  }
  if (row.tileUrl) entry.url = row.tileUrl;
  if (row.minZoom != null) entry.minZoom = row.minZoom;
  if (row.maxZoom != null) entry.maxZoom = row.maxZoom;
  const attr = BASE_MAP_ATTRS[mapID] || legacyByID.get(mapID)?.attr;
  if (attr) entry.attr = attr;
  if (row.bboxWest != null) {
    entry.envelopeLngLats = bboxToEnvelope([row.bboxWest, row.bboxSouth, row.bboxEast, row.bboxNorth]);
  }
  if (row.icon52NoYear) {
    entry.thumbnail = `basemap_icons/${mapID}.png`;
    iconCopies.push({ from: path.join(catalogDir, row.icon52NoYear), to: path.join(iconOutputDir, `${mapID}.png`) });
    if (VIEWER_BUILTIN_IDS.has(mapID)) {
      iconCopies.push({ from: path.join(catalogDir, row.icon52NoYear), to: path.join(assetImgDir, `${mapID}.png`) });
    }
  }
  output.push(entry);
}

// 2) KTGIS(今昔マップ): カタログ rows を正本に生成(アイコンは52px文字なし)
for (const row of catalog.rows) {
  const mapID = row.maplatEditorId || row.id.replace(/\//g, '');
  if (seenIDs.has(mapID)) {
    console.warn(`skip duplicated mapID: ${mapID} (${row.id})`);
    continue;
  }
  seenIDs.add(mapID);
  const legacy = legacyByID.get(mapID);
  const entry = {
    mapID,
    title: legacy?.title || `今昔マップ ${row.region} ${row.era}`,
    attr: legacy?.attr || '今昔マップ on the web',
    url: row.tileUrl,
    minZoom: row.minZoom,
    maxZoom: row.maxZoom,
    envelopeLngLats: bboxToEnvelope([row.bboxWest, row.bboxSouth, row.bboxEast, row.bboxNorth]),
    thumbnail: `basemap_icons/${mapID}.png`,
  };
  output.push(entry);
  iconCopies.push({ from: path.join(catalogDir, row.icon52NoYear), to: path.join(iconOutputDir, `${mapID}.png`) });
}

for (const { from, to } of iconCopies) {
  await copyFile(from, to);
}
await writeFile(outputPath, JSON.stringify(output, null, 1) + '\n');
console.log(`generated ${output.length} builtin base maps -> ${path.relative(projectRoot, outputPath)}`);
console.log(`copied ${iconCopies.length} icons -> ${path.relative(projectRoot, iconOutputDir)} (+ viewer builtins to src/assets/img)`);
console.log(`icon files now in basemap_icons: ${(await readdir(iconOutputDir)).length}`);
