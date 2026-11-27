// 種別軸（kind）導入 smoke
// case 1: 新規=kind:null / 読込=未知→"tms"
// case 2: validateBaseMapDocument の kind 分岐（tms は現行一致 / provider=provider-incomplete / merc=url 非必須）
// case 5: normalize→compose 本番連鎖で kind 未設定・tms・merc の出力が現行と完全一致（JSON 安定化）
// case 6: kind が viewer 出力に出ない
// case 11: toBaseMapSavePayload が tms.kind を永続化（null→"tms" 正規化）
// case 13: normalize→compose でも provider 分岐が生きる（kind/maptype 保持）
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { makeSmokeScratch } from './smoke-scratch.mjs';

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, ".tmp-smoke");
await mkdir(scratchRoot, { recursive: true });
const workDir = await makeSmokeScratch("basemap-kind-axis-");
const entryPath = path.join(workDir, "entry.ts");
const outDir = path.join(workDir, "dist");
const modulePath = (relativePath) => JSON.stringify(path.join(projectRoot, relativePath));

const knownKinds = ["tms", "google", "mapbox", "maplibre", "merc"];
// google は maptype-required へ移行したため、provider-incomplete 対象は mapbox/maplibre のみ
const providerKinds = ["mapbox", "maplibre"];

const kindOf = (doc) => doc.kind;

try {
  await writeFile(
    entryPath,
    [
      `export * from ${modulePath("src/utils/baseMapEditorDocument.ts")};`,
      `export * from ${modulePath("src/utils/appSourceModel.ts")};`,
    ].join("\n"),
    "utf8",
  );

  await build({
    root: projectRoot,
    logLevel: "error",
    configFile: false,
    build: {
      outDir,
      emptyOutDir: true,
      lib: { entry: entryPath, formats: ["es"], fileName: () => "contracts.mjs" },
    },
  });

  const {
    fromBaseMapCatalogItem,
    newBaseMapDocument,
    validateBaseMapDocument,
    toBaseMapSavePayload,
    normalizeAppSource,
    composeViewerSource,
    composeBaseMapSettingFile,
    createBaseMapMasterLookup,
    createAppSourceFromBaseMap,
  } = await import(pathToFileURL(path.join(outDir, "contracts.mjs")).href);

  const uid = "11111111-1111-4111-8111-111111111111";

  // ---- case 1: 新規 / 読込の kind 正規化 ----
  const fresh = newBaseMapDocument(uid, "ja");
  assert.equal(fresh.kind, null, "case 1: newBaseMapDocument は kind: null");
  for (const dataKind of [undefined, "unknown", 123, null]) {
    const loaded = fromBaseMapCatalogItem({ uid, mapID: "x", scope: "user", revision: 1, data: { lang: "ja", kind: dataKind } });
    assert.equal(loaded.kind, "tms", `case 1: data.kind=${String(dataKind)} は "tms" へ正規化`);
  }
  for (const k of knownKinds) {
    const loaded = fromBaseMapCatalogItem({ uid, mapID: "x", scope: "user", revision: 1, data: { lang: "ja", kind: k } });
    assert.equal(loaded.kind, k, `case 1: data.kind=${k} は保持`);
  }

  // ---- case 2: 検証の kind 分岐 ----
  const tmsDoc = {
    ...newBaseMapDocument(uid, "ja"),
    kind: "tms",
    slug: "valid-slug",
    title: { ja: "T" },
    // attr が必須になったためテストデータにも設定（両方残すのマージ対応）
    attr: { ja: "© Ex" },
    url: "https://x/{z}/{x}/{y}.png",
  };
  assert.equal(validateBaseMapDocument(tmsDoc).valid, true, "case 2: tms で url 必須・有効");
  assert.equal(
    validateBaseMapDocument({ ...tmsDoc, url: "" }).errors.includes("url-required"),
    true,
    "case 2: tms は url 必須（現行一致）",
  );
  // tms の検証結果が kind 導入前と同値（url/slug/title/zoom のみ依存）であることを、
  // url なし + 有効 slug/title のとき errors に kind-required / provider-incomplete が無いことで担保
  const tmsMissingUrl = validateBaseMapDocument({ ...tmsDoc, url: "" });
  assert.equal(tmsMissingUrl.errors.includes("kind-required"), false, "case 2: tms は kind-required を出さない");
  assert.equal(tmsMissingUrl.errors.includes("provider-incomplete"), false, "case 2: tms は provider-incomplete を出さない");

  // mapbox/maplibre → style-required（style 空）。google は maptype-required へ移行済み
  for (const pk of ["mapbox", "maplibre"]) {
    const doc = { ...tmsDoc, kind: pk, url: "", style: null };
    const v = validateBaseMapDocument(doc);
    assert.equal(v.errors.includes("style-required"), true, `case 2: ${pk} は style-required`);
    assert.equal(v.errors.includes("provider-incomplete"), false, `case 2: ${pk} は provider-incomplete を出さない`);
    assert.equal(v.valid, false, `case 2: ${pk} は style 空で保存不可`);
  }
  {
    const doc = { ...tmsDoc, kind: "maplibre", url: "", style: "mapbox://styles/mapbox/streets-v11" };
    const v = validateBaseMapDocument(doc);
    assert.equal(v.errors.includes("style-mapbox-scheme-forbidden"), true, "case 2: maplibre+mapbox:// は forbidden");
  }
  {
    const doc = { ...tmsDoc, kind: "maplibre", url: "", style: "https://example.com/style.json" };
    const v = validateBaseMapDocument(doc);
    assert.equal(v.errors.includes("style-required"), false, "case 2: maplibre+https は style-required 無し");
    assert.equal(v.valid, true, "case 2: maplibre+https style は他項目OKなら valid");
  }
  {
    const doc = { ...tmsDoc, kind: "google", url: "", style: null };
    const v = validateBaseMapDocument(doc);
    assert.equal(v.errors.includes("maptype-required"), true, "case 2: google は maptype-required");
    assert.equal(v.errors.includes("provider-incomplete"), false, "case 2: google は provider-incomplete を出さない");
  }
  // null（未選択）→ kind-required
  const nullDoc = newBaseMapDocument(uid, "ja");
  assert.equal(validateBaseMapDocument(nullDoc).errors.includes("kind-required"), true, "case 2: null は kind-required");
  // merc → url 非必須
  const mercDoc = { ...tmsDoc, kind: "merc", url: "" };
  const mercV = validateBaseMapDocument(mercDoc);
  assert.equal(mercV.errors.includes("url-required"), false, "case 2: merc は url 非必須");
  assert.equal(mercV.errors.includes("provider-incomplete"), false, "case 2: merc は provider-incomplete を出さない");

  // ---- case 11: toBaseMapSavePayload が tms.kind を永続化 ----
  const saved = toBaseMapSavePayload(tmsDoc, 3);
  assert.equal(saved.tms.kind, "tms", "case 11: tms 保存で tms.kind は \"tms\"");
  const savedNull = toBaseMapSavePayload({ ...newBaseMapDocument(uid, "ja"), slug: "s", title: { ja: "T" } }, null);
  assert.equal(savedNull.tms.kind, "tms", "case 11: kind null は保存時 \"tms\" へ正規化");

  // ---- case 5 / case 6: kind が viewer へ漏れないこと（アプリのソースの差分モデルで境界が移動）----
  // maptype はアプリ JSON ではなく設定ファイル側が持つようになった。
  // kind はどちらにも出てはならない、という case 6 の趣旨は不変なので、両方の出力で検査する。
  const kindCases = [
    { label: "kind無し", kind: undefined, expectedMaptype: "base" },
    { label: "tms", kind: "tms", expectedMaptype: "base" },
    { label: "merc", kind: "merc", expectedMaptype: "base" },
  ];
  const canonical = (v) => JSON.stringify(v ?? null);
  for (const { label, kind, expectedMaptype } of kindCases) {
    const master = {
      uid: `uid-${label}`,
      mapID: "t1",
      data: { mapID: "t1", lang: "ja", url: "https://x/{z}/{x}/{y}.png", maxZoom: 18, ...(kind ? { kind } : {}) },
    };
    const lookup = createBaseMapMasterLookup([master]);
    const normalized = normalizeAppSource({ sourceType: "base-map", mapID: "t1", role: "base", data: { ...master.data } });
    const out = composeViewerSource(normalized, { lookup });
    assert.equal(canonical(out.mapID), canonical("t1"), `case 5(${label}): mapID=t1`);
    assert.equal(out.settingFile, "maps/t1.json", `case 5(${label}): 設定ファイル参照を出す`);
    assert.equal("maptype" in out, false, `case 5(${label}): アプリ JSON に maptype は出さない`);
    assert.equal("kind" in out, false, `case 6(${label}): kind はアプリ JSON に出ない`);

    const settingFile = composeBaseMapSettingFile(master, normalized.role);
    assert.equal(canonical(settingFile.maptype), canonical(expectedMaptype), `case 5(${label}): 設定ファイル側 maptype=${expectedMaptype}`);
    assert.equal("kind" in settingFile, false, `case 6(${label}): kind は設定ファイルにも出ない`);
  }

  // ---- case 13: provider の maptype が連鎖の末端（設定ファイル）まで生きる ----
  const providerCases = [
    { kind: "google", maptype: "google_roadmap", expected: "google_roadmap" },
    { kind: "mapbox", maptype: "mapbox", expected: "mapbox" },
    { kind: "maplibre", maptype: "maplibre", expected: "maplibre" },
  ];
  for (const pc of providerCases) {
    const master = {
      uid: `uid-${pc.kind}`,
      mapID: "prov",
      data: { mapID: "prov", lang: "ja", url: "", kind: pc.kind, maptype: pc.maptype },
    };
    const lookup = createBaseMapMasterLookup([master]);
    const normalized = normalizeAppSource({ sourceType: "base-map", mapID: "prov", role: "base", data: { ...master.data } });
    const out = composeViewerSource(normalized, { lookup });
    assert.equal("maptype" in out, false, `case 13(${pc.kind}): アプリ JSON に maptype は出さない`);
    assert.equal("kind" in out, false, `case 13(${pc.kind}): kind は出力に出ない`);
    const settingFile = composeBaseMapSettingFile(master, normalized.role);
    assert.equal(canonical(settingFile.maptype), canonical(pc.expected), `case 13(${pc.kind}): 設定ファイル側 maptype=${pc.expected}（role 導出 base より provider が優先）`);
    assert.equal("kind" in settingFile, false, `case 13(${pc.kind}): kind は設定ファイルに出ない`);
    assert.equal("url" in settingFile, false, `case 13(${pc.kind}): provider は url を出さない`);
  }

  // ---- case 13 補強: createAppSourceFromBaseMap → compose の一貫経路 ----
  const masterGoogle = {
    uid: "uid-google-master",
    mapID: "google-master",
    data: { mapID: "google-master", lang: "ja", title: { ja: "Google" }, kind: "google", maptype: "google_roadmap" },
  };
  const googleLookup = createBaseMapMasterLookup([masterGoogle]);
  const appSource = createAppSourceFromBaseMap(masterGoogle, "ja");
  assert.equal(appSource.baseMapUid, "uid-google-master", "case 13: 参照（baseMapUid）を持つ");
  assert.deepEqual(appSource.overrides ?? {}, {}, "case 13: 差分モデルでは全コピーせず上書きは空");
  const composedAppSource = composeViewerSource(appSource, { lookup: googleLookup });
  assert.equal("kind" in composedAppSource, false, "case 13: kind は出力に出ない");
  assert.equal(
    composeBaseMapSettingFile(masterGoogle, appSource.role).maptype,
    "google_roadmap",
    "case 13: create→設定ファイルで provider maptype が生きる",
  );

  console.log("basemap-kind-axis smoke: PASS");
} finally {
  await rm(workDir, { recursive: true, force: true });
}
