/**
 * m6-t6 smoke: API キー3段解決の純粋ロジック（providerKeyResolution.ts / requiresProviderKey）
 * m6-t5 と同様に vite で contracts をバンドルして検証する。
 *
 * AC13: requiresProviderKey / PROVIDER_KEY_REQUIRED_KINDS が isProviderKind（3種）・
 *       providerGlCdn の sourceKind（2種・CDN用）と混同されない
 * §3.1/§3.2: resolvePreviewKey（3段）/ resolvePublishKey（2段）
 * §3.1/§3.2 v1.3 (M5): resolveStartFromViewerMapID の3段照合（除外ソース救済なし・旧形 slug 救済あり）
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, ".tmp-smoke");
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, "m6-t6-"));
const entryPath = path.join(workDir, "entry.ts");
const outDir = path.join(workDir, "dist");

const modulePath = (relativePath) =>
  JSON.stringify(path.join(projectRoot, relativePath));

await import("node:fs/promises").then(({ writeFile }) =>
  writeFile(
    entryPath,
    `
export {
  requiresProviderKey,
  PROVIDER_KEY_REQUIRED_KINDS,
  isProviderKind,
} from ${modulePath("src/utils/baseMapEditorDocument.ts")};
export {
  resolvePreviewKey,
  resolvePublishKey,
  resolveStartFromViewerMapID,
  PROVIDER_KEY_MISSING_WARNING,
} from ${modulePath("electron/services/providerKeyResolution.ts")};
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
  requiresProviderKey,
  PROVIDER_KEY_REQUIRED_KINDS,
  isProviderKind,
  resolvePreviewKey,
  resolvePublishKey,
  resolveStartFromViewerMapID,
  PROVIDER_KEY_MISSING_WARNING,
} = await import(pathToFileURL(path.join(outDir, "contracts.mjs")).href);

// ---- AC13: requiresProviderKey は google/mapbox の2種のみ。isProviderKind（3種）とは別述語 ----
assert.deepEqual([...PROVIDER_KEY_REQUIRED_KINDS], ["google", "mapbox"]);
assert.equal(requiresProviderKey("google"), true, "google はキーが要る");
assert.equal(requiresProviderKey("mapbox"), true, "mapbox はキーが要る");
assert.equal(requiresProviderKey("maplibre"), false, "maplibre はキー不要（GL のみ）");
assert.equal(requiresProviderKey("tms"), false);
assert.equal(requiresProviderKey("merc"), false);
assert.equal(requiresProviderKey(null), false);
assert.equal(requiresProviderKey(undefined), false);
// isProviderKind（3種）は maplibre も true のままであること = 混同していないこと
assert.equal(isProviderKind("maplibre"), true, "isProviderKind は maplibre も provider 扱い（別述語の証明）");

// ---- resolvePublishKey: アプリ単位 → 設定ページ既定公開用 → undefined ----
{
  const settingsEmpty = { get: () => undefined };
  const settingsWithDefault = {
    get: (key) =>
      key === "defaultPublishGoogleApiKey" ? "default-google-key" : undefined,
  };

  assert.equal(
    resolvePublishKey("google", { googleApiKey: "app-google-key" }, settingsWithDefault),
    "app-google-key",
    "1段目: アプリ単位キーが優先される",
  );
  assert.equal(
    resolvePublishKey("google", { googleApiKey: "" }, settingsWithDefault),
    "default-google-key",
    "2段目: アプリ単位キーが空なら既定公開用キーへ",
  );
  assert.equal(
    resolvePublishKey("google", undefined, settingsEmpty),
    undefined,
    "3段目: 両方空なら undefined",
  );
  assert.equal(
    resolvePublishKey("mapbox", { mapboxToken: "app-mapbox" }, settingsEmpty),
    "app-mapbox",
  );
}

// ---- resolvePreviewKey: エディタ用キー → (アプリ単位 → 既定公開用) → undefined ----
{
  const settingsEditorOnly = {
    get: (key) => (key === "editorGoogleApiKey" ? "editor-google-key" : undefined),
  };
  const settingsEmpty = { get: () => undefined };
  const settingsDefaultPublish = {
    get: (key) =>
      key === "defaultPublishMapboxToken" ? "default-mapbox-key" : undefined,
  };

  assert.equal(
    resolvePreviewKey("google", { googleApiKey: "app-key" }, settingsEditorOnly),
    "editor-google-key",
    "1段目: エディタ用キーが優先される（アプリ単位キーがあっても）",
  );
  assert.equal(
    resolvePreviewKey("mapbox", { mapboxToken: "app-mapbox" }, settingsEmpty),
    "app-mapbox",
    "2段目: エディタ用キー無しならアプリ単位キーへフォールバック",
  );
  assert.equal(
    resolvePreviewKey("mapbox", {}, settingsDefaultPublish),
    "default-mapbox-key",
    "2段目のさらに内側: アプリ単位キーも無ければ既定公開用キーへ",
  );
  assert.equal(
    resolvePreviewKey("google", undefined, settingsEmpty),
    undefined,
    "3段とも空なら undefined",
  );
}

// ---- PROVIDER_KEY_MISSING_WARNING: 補間なしの固定キー2本 ----
assert.equal(PROVIDER_KEY_MISSING_WARNING.google, "appedit.warn_provider_google_key_missing");
assert.equal(PROVIDER_KEY_MISSING_WARNING.mapbox, "appedit.warn_provider_mapbox_key_missing");
assert.equal(/[:{]/.test(PROVIDER_KEY_MISSING_WARNING.google), false, "補間パラメータを含まない素のキー文字列");

// ---- resolveStartFromViewerMapID: 3段照合 ----
{
  // 1段目: startFrom フラグ付きソースを最優先
  const flagged = [
    { startFrom: false, mapUid: "u1", mapSlug: undefined, viewerMapID: "u1" },
    { startFrom: true, mapUid: "u2", mapSlug: undefined, viewerMapID: "u2" },
  ];
  assert.equal(resolveStartFromViewerMapID(flagged, "u1"), "u2", "1段目のフラグが2段目のuid一致より優先");

  // 2段目: mapUid/mapSlug 一致
  const byId = [
    { startFrom: false, mapUid: "u1", mapSlug: "slug1", viewerMapID: "u1" },
    { startFrom: false, mapUid: "u2", mapSlug: undefined, viewerMapID: "u2" },
  ];
  assert.equal(resolveStartFromViewerMapID(byId, "u2"), "u2", "2段目: mapUid 一致");
  assert.equal(resolveStartFromViewerMapID(byId, "slug1"), "u1", "2段目: mapSlug 一致（新形が旧形 mapSlug を保持するケース）");

  // 3段目: 旧形 slug 救済（mapUid/mapSlug のどちらとも字面が異なるが viewerMapID とは一致）
  const legacy = [
    { startFrom: false, mapUid: "22222222-2222-4222-8222-222222222222", mapSlug: undefined, viewerMapID: "legacy-slug" },
  ];
  assert.equal(
    resolveStartFromViewerMapID(legacy, "legacy-slug"),
    "legacy-slug",
    "3段目: mapUid/mapSlug 不一致でも viewerMapID 一致で旧形 slug ドキュメントを救済（M5 回帰防止・R22）",
  );

  // 除外ソースは candidates に含まれないため、除外ソースを指す startFrom は3段とも外れて undefined になる
  const withoutExcluded = [
    { startFrom: false, mapUid: "u1", mapSlug: undefined, viewerMapID: "u1" },
  ];
  assert.equal(
    resolveStartFromViewerMapID(withoutExcluded, "excluded-google-source-uid"),
    undefined,
    "除外されたソースの uid は candidates に無いため3段とも外れ undefined（素通ししない）",
  );

  // 何も一致しない・空配列
  assert.equal(resolveStartFromViewerMapID([], "anything"), undefined);
  // 既存実装からの忠実な移植: document.startFrom が undefined で候補の mapSlug も undefined だと
  // 2段目の `mapSlug === documentStartFrom` が undefined===undefined で意図せず一致する。
  // これは m6-t6 以前から AppExportService.ts / AppPreviewService.ts に存在する挙動であり、
  // 本タスクは既存ロジックを共通化するだけでこの挙動自体は変更しない（スコープ外）
  assert.equal(
    resolveStartFromViewerMapID(withoutExcluded, undefined),
    "u1",
    "startFrom未指定時、mapSlug未設定の候補が2段目でundefined同士一致してしまう既存の挙動を維持",
  );
}

console.log("m6-t6-api-key-tiers-smoke: OK");
