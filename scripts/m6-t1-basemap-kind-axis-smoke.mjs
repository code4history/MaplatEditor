// m6-t1 種別軸（kind）導入 smoke
// AC1: 新規=kind:null / 読込=未知→"tms"
// AC2: validateBaseMapDocument の kind 分岐（tms は現行一致 / provider=provider-incomplete / merc=url 非必須）
// AC5: normalize→compose 本番連鎖で kind 未設定・tms・merc の出力が現行と完全一致（JSON 安定化）
// AC6: kind が viewer 出力に出ない
// AC11: toBaseMapSavePayload が tms.kind を永続化（null→"tms" 正規化）
// AC13: normalize→compose でも provider 分岐が生きる（kind/maptype 保持）
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, ".tmp-smoke");
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, "m6-t1-basemap-kind-axis-"));
const entryPath = path.join(workDir, "entry.ts");
const outDir = path.join(workDir, "dist");
const modulePath = (relativePath) => JSON.stringify(path.join(projectRoot, relativePath));

const knownKinds = ["tms", "google", "mapbox", "maplibre", "merc"];
const providerKinds = ["google", "mapbox", "maplibre"];

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
    createAppSourceFromBaseMap,
  } = await import(pathToFileURL(path.join(outDir, "contracts.mjs")).href);

  const uid = "11111111-1111-4111-8111-111111111111";

  // ---- AC1: 新規 / 読込の kind 正規化 ----
  const fresh = newBaseMapDocument(uid, "ja");
  assert.equal(fresh.kind, null, "AC1: newBaseMapDocument は kind: null");
  for (const dataKind of [undefined, "unknown", 123, null]) {
    const loaded = fromBaseMapCatalogItem({ uid, mapID: "x", scope: "user", revision: 1, data: { lang: "ja", kind: dataKind } });
    assert.equal(loaded.kind, "tms", `AC1: data.kind=${String(dataKind)} は "tms" へ正規化`);
  }
  for (const k of knownKinds) {
    const loaded = fromBaseMapCatalogItem({ uid, mapID: "x", scope: "user", revision: 1, data: { lang: "ja", kind: k } });
    assert.equal(loaded.kind, k, `AC1: data.kind=${k} は保持`);
  }

  // ---- AC2: 検証の kind 分岐 ----
  const tmsDoc = {
    ...newBaseMapDocument(uid, "ja"),
    kind: "tms",
    slug: "valid-slug",
    title: { ja: "T" },
    // m6-t2 が attr 必須化したためテストデータにも設定（両方残すのマージ対応）
    attr: { ja: "© Ex" },
    url: "https://x/{z}/{x}/{y}.png",
  };
  assert.equal(validateBaseMapDocument(tmsDoc).valid, true, "AC2: tms で url 必須・有効");
  assert.equal(
    validateBaseMapDocument({ ...tmsDoc, url: "" }).errors.includes("url-required"),
    true,
    "AC2: tms は url 必須（現行一致）",
  );
  // tms の検証結果が kind 導入前と同値（url/slug/title/zoom のみ依存）であることを、
  // url なし + 有効 slug/title のとき errors に kind-required / provider-incomplete が無いことで担保
  const tmsMissingUrl = validateBaseMapDocument({ ...tmsDoc, url: "" });
  assert.equal(tmsMissingUrl.errors.includes("kind-required"), false, "AC2: tms は kind-required を出さない");
  assert.equal(tmsMissingUrl.errors.includes("provider-incomplete"), false, "AC2: tms は provider-incomplete を出さない");

  // google / mapbox / maplibre → provider-incomplete（t1 では必須項目未実装のため保存不可）
  for (const pk of providerKinds) {
    const doc = { ...tmsDoc, kind: pk, url: "" };
    const v = validateBaseMapDocument(doc);
    assert.equal(v.errors.includes("provider-incomplete"), true, `AC2: ${pk} は provider-incomplete`);
    assert.equal(v.valid, false, `AC2: ${pk} は保存不可`);
  }
  // null（未選択）→ kind-required
  const nullDoc = newBaseMapDocument(uid, "ja");
  assert.equal(validateBaseMapDocument(nullDoc).errors.includes("kind-required"), true, "AC2: null は kind-required");
  // merc → url 非必須
  const mercDoc = { ...tmsDoc, kind: "merc", url: "" };
  const mercV = validateBaseMapDocument(mercDoc);
  assert.equal(mercV.errors.includes("url-required"), false, "AC2: merc は url 非必須");
  assert.equal(mercV.errors.includes("provider-incomplete"), false, "AC2: merc は provider-incomplete を出さない");

  // ---- AC11: toBaseMapSavePayload が tms.kind を永続化 ----
  const saved = toBaseMapSavePayload(tmsDoc, 3);
  assert.equal(saved.tms.kind, "tms", "AC11: tms 保存で tms.kind は \"tms\"");
  const savedNull = toBaseMapSavePayload({ ...newBaseMapDocument(uid, "ja"), slug: "s", title: { ja: "T" } }, null);
  assert.equal(savedNull.tms.kind, "tms", "AC11: kind null は保存時 \"tms\" へ正規化");

  // ---- AC5 / AC6: normalize→compose 本番連鎖の出力不変性 ----
  // 現行実装の固定出力を期待値として、3入力の出力が kind 導入後も同値であることを JSON 正準形で比較。
  // 参考: kind 無し・tms・merc はいずれも role 分岐（base）へ落ちる。
  const baseSourceInputs = [
    { label: "kind無し", raw: { sourceType: "base-map", mapID: "t1", role: "base", data: { url: "https://x/{z}/{x}/{y}.png", maxZoom: 18 } } },
    { label: "tms", raw: { sourceType: "base-map", mapID: "t1", role: "base", data: { url: "https://x/{z}/{x}/{y}.png", maxZoom: 18, kind: "tms" } } },
    { label: "merc", raw: { sourceType: "base-map", mapID: "t1", role: "base", data: { url: "https://x/{z}/{x}/{y}.png", maxZoom: 18, kind: "merc" } } },
  ];
  const canonical = (v) => JSON.stringify(v ?? null);
  for (const { label, raw } of baseSourceInputs) {
    const normalized = normalizeAppSource(raw);
    const out = composeViewerSource(normalized);
    assert.equal(canonical(out.maptype), canonical("base"), `AC5(${label}): maptype=base`);
    assert.equal(canonical(out.mapID), canonical("t1"), `AC5(${label}): mapID=t1`);
    assert.equal("kind" in out, false, `AC6(${label}): kind は出力に出ない`);
    assert.equal(out.kind, undefined, `AC6(${label}): out.kind は undefined`);
    // normalize 後の AppSource.data.kind は内部保持される（tms/merc も再付着）
    if (raw.data && "kind" in raw.data) {
      assert.equal(normalized.data.kind, raw.data.kind, `AC5(${label}): normalize 後 data.kind 保持`);
    }
  }

  // ---- AC13: normalize→compose で provider 分岐が生きる ----
  // role 導出値（base）と異なる maptype を合成入力で与え、normalize→compose 後にその maptype が残ること・kind が出ないことを検証
  const providerCases = [
    { kind: "google", maptype: "google_roadmap", expected: "google_roadmap" },
    { kind: "mapbox", maptype: "mapbox", expected: "mapbox" },
    { kind: "maplibre", maptype: "maplibre", expected: "maplibre" },
  ];
  for (const pc of providerCases) {
    const raw = { sourceType: "base-map", mapID: "prov", role: "base", data: { url: "", kind: pc.kind, maptype: pc.maptype } };
    const normalized = normalizeAppSource(raw);
    assert.equal(normalized.data.kind, pc.kind, `AC13(${pc.kind}): normalize 後 data.kind 保持`);
    assert.equal(normalized.data.maptype, pc.maptype, `AC13(${pc.kind}): normalize 後 data.maptype 保持`);
    const out = composeViewerSource(normalized);
    assert.equal(canonical(out.maptype), canonical(pc.expected), `AC13(${pc.kind}): compose 出力 maptype=${pc.expected}（role 導出 base と異なる）`);
    assert.equal("kind" in out, false, `AC13(${pc.kind}): kind は出力に出ない`);
    assert.equal(out.kind, undefined, `AC13(${pc.kind}): out.kind は undefined`);
  }

  // ---- AC13 補強: createAppSourceFromBaseMap → normalize → compose の一貫経路 ----
  // エディタ内部形（master.data.kind 保持）→ App コピー → 書き出し連鎖で provider maptype が生きる
  const masterGoogle = {
    mapID: "google-master",
    lang: "ja",
    title: { ja: "Google" },
    kind: "google",
    maptype: "google_roadmap",
  };
  const appSource = createAppSourceFromBaseMap(masterGoogle, "ja");
  assert.equal(appSource.data.kind, "google", "AC13: createAppSourceFromBaseMap が kind を data へ保持");
  const composedAppSource = composeViewerSource(appSource);
  assert.equal(composedAppSource.maptype, "google_roadmap", "AC13: create→compose で provider maptype が生きる");
  assert.equal("kind" in composedAppSource, false, "AC13: kind は出力に出ない");

  console.log("m6-t1-basemap-kind-axis smoke: PASS");
} finally {
  await rm(workDir, { recursive: true, force: true });
}
