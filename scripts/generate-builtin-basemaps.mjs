// KTGISカタログを正本としてbuiltin Base Map定義を決定的に生成する。
// --data-only はJSONだけを書き換え、既存アイコンを一切削除・変更しない。
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// m19-t5: 512px アイコンは webp で同梱する（配布物 116.05 MiB -> 37.98 MiB / -67.3%）。
// 52px（basemap_icons/）は据え置き（凍結契約 §4.3.2-4 の拡張子非対称）。
// カタログ（リポジトリ外・未追跡）から再生成するときに webp になることを保証するのが本ファイルの責務であり、
// 変換結果そのものは公開資産としてコミットされている。
const THUMB_512_ASSET_EXT = "webp";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const defaultCatalogPath = path.resolve(projectRoot, "../Playground/KTGIS/ktgis-maplat-catalog.json");
const legacyTmsListPath = path.join(projectRoot, "electron/tms_list.json");
const outputPath = path.join(projectRoot, "electron/builtin_base_maps.json");
const iconOutputDir = path.join(projectRoot, "public/basemap_icons");
const icon512OutputDir = path.join(projectRoot, "public/basemap_icons_512");
const assetImgDir = path.join(projectRoot, "src/assets/img");

const VIEWER_BUILTIN_IDS = new Set(["osm", "gsi", "gsi_ortho"]);
export const OSM_LANGS = ["ja", "en", "de", "fr", "es", "ko", "zh", "zh-TW", "vi", "th", "id"];

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

export const BASE_MAP_LOCALIZED_LABELS = {
  osm: Object.fromEntries(OSM_LANGS.map((lang) => [lang, "OSM"])),
  gsi: { ja: "地理院", en: "GSI" },
  gsi_ortho: { ja: "地理院オルソ", en: "GSI Ortho" },
  gsi_ort_USA10: { ja: "空撮 1945-50", en: "Aero 1945-50" },
  gsi_ort_old10: { ja: "空撮 1961-64", en: "Aero 1961-64" },
  gsi_gazo1: { ja: "空撮 1974-78", en: "Aero 1974-78" },
  gsi_gazo2: { ja: "空撮 1979-83", en: "Aero 1979-83" },
  gsi_gazo3: { ja: "空撮 1984-86", en: "Aero 1984-86" },
  gsi_gazo4: { ja: "空撮 1988-90", en: "Aero 1988-90" },
  affrc_rapid16: { ja: "迅速測図", en: "Rapid Survey" },
  affrc_tokyo5k: { ja: "東京 1:5000", en: "Tokyo 1:5000" },
};

const REGION_LABELS = {
  "首都圏": { ja: "東京", en: "Tokyo" },
  "中京圏": { ja: "名古屋", en: "Nagoya" },
  "京阪神圏": { ja: "大阪", en: "Osaka" },
  "東北地方太平洋岸": { ja: "東北", en: "Tohoku" },
  "関東": { ja: "関東", en: "Kanto" },
  "札幌": { ja: "札幌", en: "Sapporo" },
  "旭川": { ja: "旭川", en: "Asahikawa" },
  "釧路": { ja: "釧路", en: "Kushiro" },
  "帯広": { ja: "帯広", en: "Obihiro" },
  "苫小牧": { ja: "苫小牧", en: "Tomakomai" },
  "室蘭": { ja: "室蘭", en: "Muroran" },
  "函館": { ja: "函館", en: "Hakodate" },
  "青森": { ja: "青森", en: "Aomori" },
  "弘前": { ja: "弘前", en: "Hirosaki" },
  "盛岡": { ja: "盛岡", en: "Morioka" },
  "岩手県南": { ja: "北上", en: "Kitakami" },
  "仙台": { ja: "仙台", en: "Sendai" },
  "秋田": { ja: "秋田", en: "Akita" },
  "山形": { ja: "山形", en: "Yamagata" },
  "米沢": { ja: "米沢", en: "Yonezawa" },
  "庄内": { ja: "庄内", en: "Shonai" },
  "福島": { ja: "福島", en: "Fukushima" },
  "会津": { ja: "会津", en: "Aizu" },
  "新潟": { ja: "新潟", en: "Niigata" },
  "金沢・富山": { ja: "金沢", en: "Kanazawa" },
  "福井": { ja: "福井", en: "Fukui" },
  "長野": { ja: "長野", en: "Nagano" },
  "松本": { ja: "松本", en: "Matsumoto" },
  "伊那": { ja: "伊那", en: "Ina" },
  "浜松・豊橋": { ja: "浜松", en: "Hamamatsu" },
  "津": { ja: "津", en: "Tsu" },
  "伊賀": { ja: "伊賀", en: "Iga" },
  "近江": { ja: "近江", en: "Omi" },
  "姫路": { ja: "姫路", en: "Himeji" },
  "和歌山": { ja: "和歌山", en: "Wakayama" },
  "鳥取": { ja: "鳥取", en: "Tottori" },
  "松江・米子": { ja: "松江", en: "Matsue" },
  "岡山・福山": { ja: "岡山", en: "Okayama" },
  "広島": { ja: "広島", en: "Hiroshima" },
  "周南": { ja: "周南", en: "Shunan" },
  "山口": { ja: "山口", en: "Yamaguchi" },
  "徳島": { ja: "徳島", en: "Tokushima" },
  "高松": { ja: "高松", en: "Takamatsu" },
  "松山": { ja: "松山", en: "Matsuyama" },
  "東予": { ja: "今治", en: "Imabari" },
  "高知": { ja: "高知", en: "Kochi" },
  "福岡・北九州": { ja: "福岡", en: "Fukuoka" },
  "佐賀・久留米": { ja: "佐賀", en: "Saga" },
  "長崎": { ja: "長崎", en: "Nagasaki" },
  "佐世保": { ja: "佐世保", en: "Sasebo" },
  "大牟田・島原": { ja: "大牟田", en: "Omuta" },
  "熊本": { ja: "熊本", en: "Kumamoto" },
  "八代": { ja: "八代", en: "Yatsushiro" },
  "大分": { ja: "大分", en: "Oita" },
  "延岡": { ja: "延岡", en: "Nobeoka" },
  "宮崎": { ja: "宮崎", en: "Miyazaki" },
  "都城": { ja: "都城", en: "Miyakonojo" },
  "鹿児島": { ja: "鹿児島", en: "Kagoshima" },
  "沖縄本島南部": { ja: "那覇", en: "Naha" },
};

export function compactEra(value) {
  const era = value.replace(/年$/, "");
  const match = era.match(/^(\d{4})-(\d{4})$/);
  return match ? `${match[1]}-${match[2].slice(-2)}` : era;
}

function konjakuLabel(row, mapID) {
  const region = REGION_LABELS[row.region];
  if (!region) throw new Error(`compact Base Map label missing: ${row.region}`);
  const era = compactEra(row.era);
  if (mapID === "kagoshima5man") return { ja: `${region.ja} ${era} 5万`, en: `${region.en} ${era} 50k` };
  if (mapID === "kagoshima2man") return { ja: `${region.ja} ${era} 2万`, en: `${region.en} ${era} 20k` };
  return { ja: `${region.ja} ${era}`, en: `${region.en} ${era}` };
}

const GSI_PROVIDER = {
  attr: { ja: "国土地理院", en: "The Geospatial Information Authority of Japan" },
  license: "Custom",
  dataLicense: "Custom",
  licenseNote: { ja: "公共データ利用規約 第1.0版（PDL1.0）／出典：国土地理院ウェブサイト", en: "Public Data License 1.0 / Source: GSI website" },
  dataLicenseNote: { ja: "公共データ利用規約 第1.0版（PDL1.0）", en: "Public Data License 1.0" },
};

const NARO_PROVIDER = {
  attr: { ja: "農研機構農業環境研究部門", en: "NARO Institute for Agro-Environmental Sciences" },
  license: "CC BY",
  dataLicense: "CC BY",
  licenseNote: { ja: "CC BY 2.1 日本", en: "CC BY 2.1 Japan" },
  dataLicenseNote: { ja: "CC BY 2.1 日本", en: "CC BY 2.1 Japan" },
};

const PROVIDER_ATTRS = {
  gsi_ort_USA10: GSI_PROVIDER,
  gsi_ort_old10: GSI_PROVIDER,
  gsi_gazo1: GSI_PROVIDER,
  gsi_gazo2: GSI_PROVIDER,
  gsi_gazo3: GSI_PROVIDER,
  gsi_gazo4: GSI_PROVIDER,
  affrc_rapid16: NARO_PROVIDER,
  affrc_tokyo5k: NARO_PROVIDER,
};

const KONJAKU_PROVIDER = {
  attr: { ja: "今昔マップ on the web（埼玉大学教育学部 谷 謙二）", en: "Konjaku Map on the Web" },
  license: "Custom",
  dataLicense: "Custom",
  licenseNote: { ja: "国土地理院長の使用/複製承認 R4JHf18 ほか", en: "Permission from GSI Director-General (R4JHf18, etc.)" },
  dataLicenseNote: { ja: "国土地理院長の使用/複製承認 R4JHf18 ほか", en: "Permission from GSI Director-General (R4JHf18, etc.)" },
};

const VIEWER_BUILTIN_LICENSES = {
  osm: {
    attr: { ja: "©\uFE0E OpenStreetMap contributors", en: "©\uFE0E OpenStreetMap contributors" },
    dataAttr: { ja: "©\uFE0E OpenStreetMap contributors", en: "©\uFE0E OpenStreetMap contributors" },
    license: "Custom",
    dataLicense: "ODbL",
    licenseNote: {
      ja: "©\uFE0E OpenStreetMap contributors（OpenStreetMap Copyright: https://www.openstreetmap.org/copyright）",
      en: "©\uFE0E OpenStreetMap contributors (OpenStreetMap Copyright: https://www.openstreetmap.org/copyright)",
    },
    // dataLicenseNote は未設定（ODbL アイコンが表意するため）
  },
  gsi: GSI_PROVIDER,
  gsi_ortho: GSI_PROVIDER,
};

function bboxToEnvelope([west, south, east, north]) {
  return [[west, south], [east, south], [east, north], [west, north]];
}

function applyProviderFields(entry, provider) {
  if (!provider) return;
  if (provider.attr) entry.attr = provider.attr;
  if (provider.dataAttr) entry.dataAttr = provider.dataAttr;
  if (provider.license) entry.license = provider.license;
  if (provider.dataLicense) entry.dataLicense = provider.dataLicense;
  if (provider.licenseNote) entry.licenseNote = provider.licenseNote;
  if (provider.dataLicenseNote) entry.dataLicenseNote = provider.dataLicenseNote;
  // dataAttr は provider.dataAttr が定義されている場合のみ出力する（現状 osm のみ。決定 (a) の射程）
}

export function buildBuiltinBaseMaps(catalog, legacyList) {
  if (new Set(legacyList.map((tms) => tms.mapID)).size !== legacyList.length) {
    throw new Error("legacy Base Map mapID must be unique");
  }
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
    const label = BASE_MAP_LOCALIZED_LABELS[mapID];
    if (!label) throw new Error(`localized Base Map label missing: ${mapID}`);
    const entry = { mapID, lang: "en", title: { ...title }, label: { ...label } };
    if (VIEWER_BUILTIN_IDS.has(mapID)) entry.always = true;
    if (row.tileUrl) entry.url = row.tileUrl;
    if (row.minZoom != null) entry.minZoom = row.minZoom;
    if (row.maxZoom != null) entry.maxZoom = row.maxZoom;
    applyProviderFields(entry, PROVIDER_ATTRS[mapID] || VIEWER_BUILTIN_LICENSES[mapID]);
    if (row.bboxWest != null) entry.coverageLngLats = bboxToEnvelope([row.bboxWest, row.bboxSouth, row.bboxEast, row.bboxNorth]);
    if (row.icon52NoYear) entry.thumbnail = `basemap_icons/${mapID}.png`;
    if (row.icon512NoYear) entry.thumbnail512 = `basemap_icons_512/${mapID}.${THUMB_512_ASSET_EXT}`;
    output.push(entry);
  }
  for (const row of catalog.rows) {
    if (typeof row.regionEn !== "string" || !row.regionEn.trim()) throw new Error(`regionEn missing: ${row.region}`);
    const mapID = row.maplatEditorId || row.id.replace(/\//g, "");
    if (seenIDs.has(mapID)) throw new Error(`catalog Base Map mapID must be unique: ${mapID}`);
    seenIDs.add(mapID);
    const legacy = legacyByID.get(mapID);
    if (legacy?.url && legacy.url !== row.tileUrl) throw new Error(`legacy Base Map URL mismatch: ${mapID}`);
    const title = {
      ja: `今昔マップ ${row.region} ${row.era}`,
      en: `Konjaku Map: ${row.regionEn} ${row.era}`,
    };
    const label = konjakuLabel(row, mapID);
    output.push({
      mapID, lang: "en", title, label,
      attr: KONJAKU_PROVIDER.attr,
      license: KONJAKU_PROVIDER.license,
      dataLicense: KONJAKU_PROVIDER.dataLicense,
      licenseNote: KONJAKU_PROVIDER.licenseNote,
      dataLicenseNote: KONJAKU_PROVIDER.dataLicenseNote,
      url: row.tileUrl, minZoom: row.minZoom, maxZoom: row.maxZoom,
      coverageLngLats: bboxToEnvelope([row.bboxWest, row.bboxSouth, row.bboxEast, row.bboxNorth]),
      thumbnail: `basemap_icons/${mapID}.png`,
      ...(row.icon512NoYear ? { thumbnail512: `basemap_icons_512/${mapID}.${THUMB_512_ASSET_EXT}` } : {}),
    });
  }
  if (new Set(output.map((entry) => entry.mapID)).size !== output.length) throw new Error("generated Base Map mapID must be unique");
  for (const lang of ["ja", "en"]) {
    if (new Set(output.map((entry) => entry.label[lang])).size !== output.length) {
      throw new Error(`generated Base Map ${lang} labels must be unique`);
    }
  }
  return output;
}

// m19-t5: 512px アイコンを webp へ符号化して書く。
// 品質は electron/utils/thumbnail512Codec.ts の THUMB_512_WEBP_QUALITY と同じ q85 を用いる
// （本スクリプトはオフライン生成器であり main プロセスの TS を import できないため値を持つが、
//  食い違いは smoke の Part B（合計サイズ閾値）が検出する）。
async function encodeIcon512(srcPath, destPath) {
  const { Jimp } = await import("jimp");
  const { default: encode, init: initEnc } = await import("@jsquash/webp/encode.js");
  if (!encodeIcon512.ready) {
    const require_ = createRequire(import.meta.url);
    const fs = await import("node:fs/promises");
    // SIMD 版を先に試し、SIMD 非対応環境では compile が失敗するので非 SIMD 版へ落とす
    for (const specifier of [
      "@jsquash/webp/codec/enc/webp_enc_simd.wasm",
      "@jsquash/webp/codec/enc/webp_enc.wasm",
    ]) {
      try {
        await initEnc(await WebAssembly.compile(await fs.readFile(require_.resolve(specifier))));
        encodeIcon512.ready = true;
        break;
      } catch { /* 次の候補へ */ }
    }
    if (!encodeIcon512.ready) throw new Error("webp encoder init failed");
  }
  const image = await Jimp.read(srcPath);
  const data = new Uint8ClampedArray(
    image.bitmap.data.buffer,
    image.bitmap.data.byteOffset,
    image.bitmap.data.byteLength,
  );
  const encoded = await encode({ data, width: image.bitmap.width, height: image.bitmap.height }, { quality: 85 });
  const { writeFile: write } = await import("node:fs/promises");
  await write(destPath, Buffer.from(encoded));
}

async function syncKnownIconFiles(catalog, catalogDir) {
  await mkdir(iconOutputDir, { recursive: true });
  await mkdir(icon512OutputDir, { recursive: true });
  await mkdir(assetImgDir, { recursive: true });
  for (const row of [...catalog.baseMapRows, ...catalog.rows]) {
    if (!row.icon52NoYear) continue;
    const mapID = row.maplatEditorId || row.id.replace(/\//g, "");
    await copyFile(path.join(catalogDir, row.icon52NoYear), path.join(iconOutputDir, `${mapID}.png`));
    if (VIEWER_BUILTIN_IDS.has(mapID)) {
      await copyFile(path.join(catalogDir, row.icon52NoYear), path.join(assetImgDir, `${mapID}.png`));
    }
    // R1/R2: 512px アイコンの取込（icon512NoYear があれば basemap_icons_512 へ）。
    // m19-t5: 単純コピーではなく webp へ符号化して書く（配布物削減。品質は thumbnail512Codec と同じ q85）。
    if (row.icon512NoYear) {
      await encodeIcon512(
        path.join(catalogDir, row.icon512NoYear),
        path.join(icon512OutputDir, `${mapID}.${THUMB_512_ASSET_EXT}`),
      );
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
