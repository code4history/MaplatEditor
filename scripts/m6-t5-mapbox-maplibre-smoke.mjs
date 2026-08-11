/**
 * m6-t5 smoke: style 契約 / CDN 共通モジュール / peerDeps / wiring
 * m11-t4 と同様に vite で contracts をバンドルして検証する。
 * m6-t4a AC1/AC3: AC13 ブロックへ単色プレースホルダ検出・寸法検証を追加
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
// m19-t5: 512px は webp。webp/非 webp を同じ規則で読む共通リーダーを使う
import { readImageRGBA } from "./lib/webpAssets.mjs";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, ".tmp-smoke");
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, "m6-t5-"));
const entryPath = path.join(workDir, "entry.ts");
const outDir = path.join(workDir, "dist");

const modulePath = (relativePath) =>
  JSON.stringify(path.join(projectRoot, relativePath));

// m6-t4a 設計 §4.3: 単色プレースホルダでないことの検証（6x6 グリッドサンプルで distinct 色数を数える）
async function assertNotSolidColor(filePath, label) {
  // m19-t5: 512px は webp。Jimp は webp を decode できないため共通リーダーへ委譲する
  const img = await readImageRGBA(filePath);
  const { width, height } = img;
  const seen = new Set();
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const x = Math.min(width - 1, Math.floor((width / steps) * i));
      const y = Math.min(height - 1, Math.floor((height / steps) * j));
      seen.add(img.getPixelColor(x, y));
    }
  }
  assert.ok(seen.size >= 4, `${label}: 単色プレースホルダの疑い（distinct=${seen.size}）`);
}

// m6-t4a 設計 §4.3: 寸法検証（assertNotSolidColor とは独立に読み直す）
async function assertDimensions(filePath, expected, label) {
  const img = await readImageRGBA(filePath);
  const { width, height } = img;
  assert.equal(width, expected, `${label}: 幅が ${expected}px でない（実測 ${width}px）`);
  assert.equal(height, expected, `${label}: 高さが ${expected}px でない（実測 ${height}px）`);
}

await import("node:fs/promises").then(({ writeFile }) =>
  writeFile(
    entryPath,
    `
export {
  validateBaseMapDocument,
  newBaseMapDocument,
  toBaseMapSavePayload,
  isMapboxScheme,
  isAllowedStyleUrl,
  isProviderKind,
  isProviderBaseMapData,
} from ${modulePath("src/utils/baseMapEditorDocument.ts")};
export {
  detectRequiredProviderGl,
  renderProviderGlCdnTags,
  PROVIDER_GL_CDN,
} from ${modulePath("electron/services/providerGlCdn.ts")};
export {
  composeViewerSource,
  composeBaseMapSettingFile,
  createBaseMapMasterLookup,
  normalizeAppSource,
} from ${modulePath("src/utils/appSourceModel.ts")};
`,
  ),
);

await build({
  configFile: false,
  logLevel: "error",
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: entryPath,
      formats: ["es"],
      fileName: () => "contracts.mjs",
    },
  },
});

const {
  validateBaseMapDocument,
  newBaseMapDocument,
  toBaseMapSavePayload,
  isMapboxScheme,
  isAllowedStyleUrl,
  isProviderKind,
  isProviderBaseMapData,
  detectRequiredProviderGl,
  renderProviderGlCdnTags,
  PROVIDER_GL_CDN,
  composeViewerSource,
  composeBaseMapSettingFile,
  createBaseMapMasterLookup,
  normalizeAppSource,
} = await import(pathToFileURL(path.join(outDir, "contracts.mjs")).href);

assert.equal(isMapboxScheme("mapbox://styles/x"), true);
assert.equal(isAllowedStyleUrl("https://a/b.json", "maplibre"), true);
assert.equal(isAllowedStyleUrl("mapbox://styles/x", "maplibre"), false);
assert.equal(isAllowedStyleUrl("mapbox://styles/x", "mapbox"), true);

const base = {
  ...newBaseMapDocument("u1", "ja"),
  slug: "s1",
  title: { ja: "T" },
  attr: { ja: "A" },
};

// AC1
{
  const doc = {
    ...base,
    kind: "mapbox",
    style: "mapbox://styles/mapbox/streets-v12",
  };
  assert.equal(validateBaseMapDocument(doc).valid, true, "AC1 valid");
  const payload = toBaseMapSavePayload(doc, null);
  assert.equal(payload.tms.maptype, "mapbox");
  assert.equal(payload.tms.style, "mapbox://styles/mapbox/streets-v12");
}

// AC2
{
  const doc = {
    ...base,
    kind: "maplibre",
    style: "https://example.com/style.json",
  };
  assert.equal(validateBaseMapDocument(doc).valid, true);
  const payload = toBaseMapSavePayload(doc, null);
  assert.equal(payload.tms.maptype, "maplibre");
  assert.equal(payload.tms.style, "https://example.com/style.json");
}

// AC3
{
  const doc = { ...base, kind: "maplibre", style: "mapbox://styles/x" };
  assert.equal(
    validateBaseMapDocument(doc).errors.includes("style-mapbox-scheme-forbidden"),
    true,
  );
}

// AC4
{
  const doc = { ...base, kind: "mapbox", style: null };
  const e = validateBaseMapDocument(doc).errors;
  assert.equal(e.includes("style-required"), true);
  assert.equal(e.includes("provider-incomplete"), false);
}

// AC5: composeViewerSource が style と maptype を viewer オブジェクトへ載せる
{
  const raw = {
    sourceType: "base-map",
    mapID: "ml1",
    role: "base",
    data: {
      kind: "maplibre",
      maptype: "maplibre",
      style: "https://tile.openstreetmap.jp/styles/osm-bright/style.json",
      attr: "A",
    },
  };
  // m6-t10 (ADR-0017): maptype / style の運び先はアプリ JSON から設定ファイルへ移った。
  const master = { uid: "uid-ml1", mapID: "ml1", data: { mapID: "ml1", lang: "ja", ...raw.data } };
  const lookup = createBaseMapMasterLookup([master]);
  const out = composeBaseMapSettingFile(master, "base");
  const appElement = composeViewerSource(normalizeAppSource(raw), { lookup });
  assert.equal("maptype" in appElement, false, "AC5: アプリ JSON に maptype は出さない");
  assert.equal(appElement.settingFile, "maps/ml1.json", "AC5: 設定ファイル参照を出す");
  assert.equal(out.maptype, "maplibre", "AC5: maptype=maplibre");
  assert.equal(
    out.style,
    "https://tile.openstreetmap.jp/styles/osm-bright/style.json",
    "AC5: style が設定ファイル出力に載る",
  );
  assert.equal("kind" in out, false, "AC5: kind は出力に出ない（EDITOR_ONLY）");
}

// AC6
{
  const s = detectRequiredProviderGl([
    { maptype: "maplibre" },
    { kind: "mapbox" },
    { maptype: "base" },
  ]);
  assert.equal(s.has("maplibre"), true);
  assert.equal(s.has("mapbox"), true);
  assert.equal(detectRequiredProviderGl([{ maptype: "base" }]).size, 0);
}

// AC7/AC8/AC9
{
  const html = renderProviderGlCdnTags(new Set(["maplibre"]));
  assert.match(html, /maplibre-gl@5\.6\.2/);
  assert.match(html, /integrity="sha384-/);
  assert.match(html, /crossorigin="anonymous"/);
  assert.doesNotMatch(html, /mapbox-gl-js/);
  const both = renderProviderGlCdnTags(new Set(["mapbox", "maplibre"]));
  assert.match(both, /mapbox-gl-js\/v3\.27\.0/);
  assert.equal(PROVIDER_GL_CDN.maplibre.jsIntegrity.startsWith("sha384-"), true);
  assert.equal(PROVIDER_GL_CDN.mapbox.jsIntegrity.startsWith("sha384-"), true);
}

// AC11 peerDeps
{
  const corePkg = JSON.parse(
    await readFile(path.join(projectRoot, "../MaplatCore/package.json"), "utf8"),
  );
  const uiPkg = JSON.parse(
    await readFile(path.join(projectRoot, "../Maplat/package.json"), "utf8"),
  );
  assert.equal(corePkg.peerDependencies["maplibre-gl"], "^5.0.0 || ^6.0.0");
  assert.equal(corePkg.peerDependencies["mapbox-gl"], "^2.0.0 || ^3.0.0");
  assert.equal(uiPkg.peerDependencies["maplibre-gl"], "^5.0.0 || ^6.0.0");
  assert.equal(uiPkg.peerDependencies["mapbox-gl"], "^2.0.0 || ^3.0.0");
  assert.equal(corePkg.devDependencies?.["maplibre-gl"], "5.6.2");
}

// Export/Preview same module
{
  const exp = await readFile(
    path.join(projectRoot, "electron/services/AppExportService.ts"),
    "utf8",
  );
  const prev = await readFile(
    path.join(projectRoot, "electron/services/AppPreviewService.ts"),
    "utf8",
  );
  assert.match(exp, /from ['"]\.\/providerGlCdn['"]/);
  assert.match(prev, /from ['"]\.\/providerGlCdn['"]/);
  assert.match(exp, /renderProviderGlCdnTags/);
  assert.match(prev, /renderProviderGlCdnTags/);
  // Preview の GL 判定は session.maps（maplat ソースのみ）を見てはならない。
  // maps ベースだと maplibre basemap を検出できない（m6-t5 実装中に検出した欠陥）。
  //
  // m6-t10 で判定元がもう一度動いた: 差分保持モデル（ADR-0017/0018）では viewer 要素が
  // maptype も kind も持たなくなり、compose 済み要素からも検出できなくなった。
  // ∴ マスタの解決結果から判定する detectRequiredProviderGlFromAppSources へ移し、
  // 結果を session.requiredProviderGl として持ち回る。旧2形（maps ベース・
  // compose 済み要素ベース）のどちらへも戻らないことを固定する。
  assert.match(prev, /detectRequiredProviderGlFromAppSources\(previewableSources/);
  assert.match(prev, /renderProviderGlCdnTags\(new Set\(session\.requiredProviderGl/);
  assert.doesNotMatch(prev, /detectRequiredProviderGl\(Object\.values\(session\.maps/);
  assert.doesNotMatch(prev, /detectRequiredProviderGl\(session\.viewerSources/);
  assert.match(exp, /detectRequiredProviderGlFromAppSources\(sources/);
}

// AC12（v1.3）: provider 3種別は loadBaseMapVisibility の単一投入点で除外。
// 機能 assert（述語）+ 適用点 assert + v1.1 実装の撤去 assert
{
  // 述語の機能: kind 優先・maptype フォールバック
  assert.equal(isProviderKind("google"), true);
  assert.equal(isProviderKind("mapbox"), true);
  assert.equal(isProviderKind("maplibre"), true);
  assert.equal(isProviderKind("tms"), false);
  assert.equal(isProviderKind("merc"), false);
  assert.equal(isProviderKind(undefined), false);
  assert.equal(isProviderBaseMapData({ kind: "maplibre" }), true);
  assert.equal(isProviderBaseMapData({ maptype: "mapbox" }), true);
  assert.equal(isProviderBaseMapData({ kind: "tms", maptype: "base" }), false);
  assert.equal(isProviderBaseMapData(null), false);

  const mapedit = await readFile(
    path.join(projectRoot, "src/views/MapEdit.vue"),
    "utf8",
  );
  // 適用点: loadBaseMapVisibility 内で isProviderBaseMapData filter
  assert.match(mapedit, /isProviderBaseMapData\(item\?\.data\)/);
  // 撤去（needle は vm.disabledReason。裸の disabledReason は :3957 disabledReasonKey と部分一致するため禁止）
  assert.doesNotMatch(mapedit, /isMapboxBaseMapItem/);
  assert.doesNotMatch(mapedit, /vm\.disabledReason/);
  assert.doesNotMatch(mapedit, /basemap_mapbox_not_in_editor/);
  // adapter には filter を置かない（単一投入点の原則）
  const adapter = await readFile(
    path.join(projectRoot, "src/views/resource-adapters/baseMapVisibilityListAdapter.ts"),
    "utf8",
  );
  assert.doesNotMatch(adapter, /isProviderBaseMapData/);
  // locales 11言語からキー削除
  const { readdir } = await import("node:fs/promises");
  const langs = (await readdir(path.join(projectRoot, "public/locales"))).filter((d) => !d.includes("."));
  assert.equal(langs.length, 11, "locales は11言語");
  for (const lang of langs) {
    const tr = await readFile(path.join(projectRoot, "public/locales", lang, "translation.json"), "utf8");
    assert.ok(!tr.includes("basemap_mapbox_not_in_editor"), `AC12: ${lang} に撤去済みキー残存`);
  }
}

// AC13: 既定サムネ（kind 選択で basemap_icons/{mapbox,maplibre}.png。実ファイル存在）
{
  const vue = await readFile(
    path.join(projectRoot, "src/components/basemap/BaseMapEdit.vue"),
    "utf8",
  );
  assert.match(vue, /basemap_icons\/mapbox\.png/);
  assert.match(vue, /basemap_icons\/maplibre\.png/);
  for (const name of ["mapbox.png", "maplibre.png"]) {
    const st = await import("node:fs/promises").then(({ stat }) =>
      stat(path.join(projectRoot, "public/basemap_icons", name)),
    );
    assert.equal(st.isFile(), true, `AC13: basemap_icons/${name} 存在`);
  }

  // ---- m6-t4a AC1: 単色プレースホルダでないこと・52px寸法（basemap_icons/） ----
  for (const name of ["mapbox.png", "maplibre.png"]) {
    const icon = path.join(projectRoot, "public/basemap_icons", name);
    await assertNotSolidColor(icon, `${name} (52px)`);
    await assertDimensions(icon, 52, `${name} (52px)`);
  }

  // ---- m6-t4a AC2/AC9: 単色プレースホルダでないこと・512px寸法（basemap_icons_512/） ----
  for (const name of ["mapbox.webp", "maplibre.webp"]) {
    const icon512 = path.join(projectRoot, "public/basemap_icons_512", name);
    const st512 = await import("node:fs/promises").then(({ stat }) => stat(icon512));
    assert.equal(st512.isFile(), true, `${name} (512px) 存在`);
    await assertNotSolidColor(icon512, `${name} (512px)`);
    await assertDimensions(icon512, 512, `${name} (512px)`);
  }
}

// Core index wiring
{
  const idx = await readFile(
    path.join(projectRoot, "../MaplatCore/src/index.ts"),
    "utf8",
  );
  assert.match(idx, /bindProviderGlToSource/);
  assert.doesNotMatch(idx, /throw ["']To use Mapbox based maps/);
}

await rm(workDir, { recursive: true, force: true });
console.log("m6-t5 smoke: PASS");
