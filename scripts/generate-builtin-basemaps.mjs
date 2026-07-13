// KTGISカタログを正本としてbuiltin Base Map定義を決定的に生成する。
// --data-only はJSONだけを書き換え、既存アイコンを一切削除・変更しない。
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const defaultCatalogPath = path.resolve(projectRoot, "../Playground/KTGIS/ktgis-maplat-catalog.json");
const legacyTmsListPath = path.join(projectRoot, "electron/tms_list.json");
const outputPath = path.join(projectRoot, "electron/builtin_base_maps.json");
const iconOutputDir = path.join(projectRoot, "public/basemap_icons");
const assetImgDir = path.join(projectRoot, "src/assets/img");

const VIEWER_BUILTIN_IDS = new Set(["osm", "gsi", "gsi_ortho"]);
const OSM_LANGS = ["ja", "en", "de", "fr", "es", "ko", "zh", "zh-TW", "vi", "th", "id"];

export const BASE_MAP_LOCALIZED_NAMES = {
  osm: { ja: "OpenStreetMap", en: "OpenStreetMap", de: "OpenStreetMap", fr: "OpenStreetMap", es: "OpenStreetMap", ko: "OpenStreetMap", zh: "OpenStreetMap", "zh-TW": "OpenStreetMap", vi: "OpenStreetMap", th: "OpenStreetMap", id: "OpenStreetMap" },
  gsi: { ja: "地理院地図", en: "GSI Maps" },
  gsi_ortho: { ja: "地理院航空写真", en: "GSI Aerial Photographs" },
  gsi_ort_USA10: { ja: "地理院航空写真1945-50", en: "GSI Aerial Photographs 1945–1950" },
  gsi_ort_old10: { ja: "地理院航空写真1961-64", en: "GSI Aerial Photographs 1961–1964" },
  gsi_gazo1: { ja: "地理院航空写真1974-78", en: "GSI Aerial Photographs 1974–1978" },
  gsi_gazo2: { ja: "地理院航空写真1979-83", en: "GSI Aerial Photographs 1979–1983" },
  gsi_gazo3: { ja: "地理院航空写真1984-86", en: "GSI Aerial Photographs 1984–1986" },
  gsi_gazo4: { ja: "地理院航空写真1988-90", en: "GSI Aerial Photographs 1988–1990" },
  affrc_rapid16: { ja: "1/2万 迅速測図原図", en: "Rapid Survey Maps, 1:20,000" },
  affrc_tokyo5k: { ja: "1/5千 東京測量図原図", en: "Tokyo Survey Maps, 1:5,000" },
};

const BASE_MAP_ATTRS = {
  gsi_ort_USA10: "The Geospatial Information Authority of Japan",
  gsi_ort_old10: "The Geospatial Information Authority of Japan",
  gsi_gazo1: "The Geospatial Information Authority of Japan",
  gsi_gazo2: "The Geospatial Information Authority of Japan",
  gsi_gazo3: "The Geospatial Information Authority of Japan",
  gsi_gazo4: "The Geospatial Information Authority of Japan",
  affrc_rapid16: "農研機構農業環境研究部門",
  affrc_tokyo5k: "農研機構農業環境研究部門",
};

function bboxToEnvelope([west, south, east, north]) {
  return [[west, south], [east, south], [east, north], [west, north]];
}

function resourceAttr(value) {
  if (!value) return undefined;
  return value.includes("農研機構") ? { ja: value, en: "NARO Institute for Agro-Environmental Sciences" } : { en: value };
}

export function buildBuiltinBaseMaps(catalog, legacyList) {
  const legacyByID = new Map(legacyList.map((tms) => [tms.mapID, tms]));
  const output = [];
  const seenIDs = new Set();
  for (const row of catalog.baseMapRows) {
    const mapID = row.id;
    const title = BASE_MAP_LOCALIZED_NAMES[mapID];
    if (!title) throw new Error(`localized Base Map name missing: ${mapID}`);
    if (mapID === "osm" && Object.keys(title).length !== OSM_LANGS.length) {
      throw new Error("OSM must provide all supported languages");
    }
    seenIDs.add(mapID);
    const entry = { mapID, lang: "en", title: { ...title }, label: { ...title } };
    if (VIEWER_BUILTIN_IDS.has(mapID)) entry.always = true;
    if (row.tileUrl) entry.url = row.tileUrl;
    if (row.minZoom != null) entry.minZoom = row.minZoom;
    if (row.maxZoom != null) entry.maxZoom = row.maxZoom;
    const attr = resourceAttr(BASE_MAP_ATTRS[mapID] || legacyByID.get(mapID)?.attr);
    if (attr) entry.attr = attr;
    if (row.bboxWest != null) entry.coverageLngLats = bboxToEnvelope([row.bboxWest, row.bboxSouth, row.bboxEast, row.bboxNorth]);
    if (row.icon52NoYear) entry.thumbnail = `basemap_icons/${mapID}.png`;
    output.push(entry);
  }
  for (const row of catalog.rows) {
    if (typeof row.regionEn !== "string" || !row.regionEn.trim()) throw new Error(`regionEn missing: ${row.region}`);
    const mapID = row.maplatEditorId || row.id.replace(/\//g, "");
    if (seenIDs.has(mapID)) continue;
    seenIDs.add(mapID);
    const legacy = legacyByID.get(mapID);
    const title = {
      ja: legacy?.title || `今昔マップ ${row.region} ${row.era}`,
      en: `Konjaku Map: ${row.regionEn} ${row.era}`,
    };
    output.push({
      mapID, lang: "en", title, label: { ...title },
      attr: resourceAttr(legacy?.attr || "Konjaku Map on the Web"),
      url: row.tileUrl, minZoom: row.minZoom, maxZoom: row.maxZoom,
      coverageLngLats: bboxToEnvelope([row.bboxWest, row.bboxSouth, row.bboxEast, row.bboxNorth]),
      thumbnail: `basemap_icons/${mapID}.png`,
    });
  }
  return output;
}

async function syncKnownIconFiles(catalog, catalogDir) {
  await mkdir(iconOutputDir, { recursive: true });
  await mkdir(assetImgDir, { recursive: true });
  for (const row of [...catalog.baseMapRows, ...catalog.rows]) {
    if (!row.icon52NoYear) continue;
    const mapID = row.maplatEditorId || row.id.replace(/\//g, "");
    await copyFile(path.join(catalogDir, row.icon52NoYear), path.join(iconOutputDir, `${mapID}.png`));
    if (VIEWER_BUILTIN_IDS.has(mapID)) {
      await copyFile(path.join(catalogDir, row.icon52NoYear), path.join(assetImgDir, `${mapID}.png`));
    }
  }
}

async function main() {
  const catalogArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  const catalogPath = catalogArg ? path.resolve(catalogArg) : defaultCatalogPath;
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const legacyList = JSON.parse(await readFile(legacyTmsListPath, "utf8"));
  const output = buildBuiltinBaseMaps(catalog, legacyList);
  await writeFile(outputPath, `${JSON.stringify(output, null, 1)}\n`, "utf8");
  if (!process.argv.includes("--data-only")) await syncKnownIconFiles(catalog, path.dirname(catalogPath));
  console.log(`generated ${output.length} builtin base maps -> ${path.relative(projectRoot, outputPath)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
