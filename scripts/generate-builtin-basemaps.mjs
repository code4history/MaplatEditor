// ビルトインベースマップ定義の生成スクリプト。
// KTGIS系は ../Playground/KTGIS/ktgis-maplat-catalog.json を正本として
// electron/builtin_base_maps.json を生成し、52pxアイコン(文字入り)を
// public/basemap_icons/{mapID}.png へコピーする。
// 非KTGIS(OSM/GSI系/AFFRC)は electron/tms_list.json から引き継ぐ。
// 手編集禁止: 変更はカタログまたは本スクリプトに対して行うこと(ADR-0002)。
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const catalogPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(projectRoot, '../Playground/KTGIS/ktgis-maplat-catalog.json');
const catalogDir = path.dirname(catalogPath);
const legacyTmsListPath = path.join(projectRoot, 'electron/tms_list.json');
const outputPath = path.join(projectRoot, 'electron/builtin_base_maps.json');
const iconOutputDir = path.join(projectRoot, 'public/basemap_icons');
const corePartsDir = path.resolve(projectRoot, '../MaplatCore/parts');

// 地理院タイルのおおよその提供範囲(日本域)。厳密値ではなく編集UIの目安。
const GSI_JAPAN_BBOX = [122.78, 20.3, 154.78, 45.71];

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
await mkdir(iconOutputDir, { recursive: true });

const legacyByID = new Map(legacyList.map((tms) => [tms.mapID, tms]));
const output = [];
const iconCopies = [];

// 1) Viewerビルトイン3種(osm/gsi/gsi_ortho): アイコンはMaplatCoreの52px定義を使用
const viewerBuiltins = [
  { mapID: 'osm', envelope: null },
  { mapID: 'gsi', envelope: bboxToEnvelope(GSI_JAPAN_BBOX) },
  { mapID: 'gsi_ortho', envelope: bboxToEnvelope(GSI_JAPAN_BBOX) },
];
for (const { mapID, envelope } of viewerBuiltins) {
  const legacy = legacyByID.get(mapID);
  if (!legacy) throw new Error(`legacy tms_list is missing viewer builtin: ${mapID}`);
  const entry = { ...legacy, thumbnail: `basemap_icons/${mapID}.jpg` };
  if (envelope) entry.envelopeLngLats = envelope;
  output.push(entry);
  iconCopies.push({ from: path.join(corePartsDir, `${mapID}.jpg`), to: path.join(iconOutputDir, `${mapID}.jpg`) });
}

// 2) 非KTGISのTMS(GSI歴史空中写真/AFFRC): 従来定義をそのまま引き継ぐ(アイコン/範囲は未定義)
for (const tms of legacyList) {
  if (viewerBuiltins.some((b) => b.mapID === tms.mapID)) continue;
  if (String(tms.url || '').includes('ktgis.net')) continue;
  output.push({ ...tms });
}

// 3) KTGIS(今昔マップ): カタログを正本に生成
const seenIDs = new Set(output.map((tms) => tms.mapID));
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
  iconCopies.push({ from: path.join(catalogDir, row.icon52Year), to: path.join(iconOutputDir, `${mapID}.png`) });
}

for (const { from, to } of iconCopies) {
  await copyFile(from, to);
}
await writeFile(outputPath, JSON.stringify(output, null, 1) + '\n');
console.log(`generated ${output.length} builtin base maps -> ${path.relative(projectRoot, outputPath)}`);
console.log(`copied ${iconCopies.length} icons -> ${path.relative(projectRoot, iconOutputDir)}`);
