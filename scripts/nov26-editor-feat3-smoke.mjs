/**
 * nov26-editor-feat3 smoke: 地図の編集用ベースマップに Google を条件付きで加える。
 *
 * AC1  : isGoogleEditorBasemap の表駆動単体（google だけ true・キー無しで false・
 *        旧保存形＝kind 無しで maptype が google_* も受ける）
 * AC6  : 単一投入点（loadBaseMapVisibility）の字面が保たれ、除外が「従来述語 OR google 述語」になっている
 * AC9  : MapEdit.vue の google 源分岐のソーステキスト契約（url / thumbnail を渡さない・key と maptype を渡す）
 * AC10 : 11 言語すべてに 2 キーが存在する
 * MINOR(b): applyBaseMapShifts が google 源を対象外にする
 * MINOR(c): googleTileLocaleOf が既定値ではなく今の表示言語（currentLang）から language/region を導く
 *
 * 使い方: node scripts/nov26-editor-feat3-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, ".tmp-smoke");
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, "feat3-"));
const entryPath = path.join(workDir, "entry.ts");
const outDir = path.join(workDir, "dist");

const modulePath = (relativePath) =>
  JSON.stringify(path.join(projectRoot, relativePath));

await import("node:fs/promises").then(({ writeFile }) =>
  writeFile(
    entryPath,
    `
export {
  isGoogleEditorBasemap,
  baseMapProviderKindOf,
  googleTileLocaleOf,
  isProviderBaseMapData,
} from ${modulePath("src/utils/baseMapEditorDocument.ts")};
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
  isGoogleEditorBasemap,
  baseMapProviderKindOf,
  googleTileLocaleOf,
  isProviderBaseMapData,
} = await import(pathToFileURL(path.join(outDir, "contracts.mjs")).href);

// ---- AC1: 表駆動（google のときだけ true・キーが無ければ false） ----
{
  const table = [
    // [data, keyAvailable, expected, label]
    [{ kind: "google", maptype: "google_roadmap" }, true, true, "google kind + roadmap"],
    [{ kind: "google", maptype: "google_satellite" }, true, true, "google kind + satellite"],
    [{ kind: "google", maptype: "google_hybrid" }, true, true, "google kind + hybrid"],
    [{ kind: "google", maptype: "google_terrain" }, true, true, "google kind + terrain"],
    [{ maptype: "google_roadmap" }, true, true, "旧保存形: kind 無し + google_*"],
    [{ maptype: "google_satellite" }, true, true, "旧保存形: kind 無し + google_*"],
    [{ kind: "google", maptype: "google_roadmap" }, false, false, "google でもキー無し"],
    [{ maptype: "google_roadmap" }, false, false, "旧保存形でもキー無し"],
    [{ kind: "mapbox", maptype: "mapbox" }, true, false, "mapbox は対象外"],
    [{ kind: "maplibre", maptype: "maplibre" }, true, false, "maplibre は対象外"],
    [{ maptype: "mapbox" }, true, false, "旧保存形 mapbox は対象外（maptype フォールバックでも除外）"],
    [{ kind: "tms", maptype: "base" }, true, false, "tms は対象外"],
    [{ kind: "merc" }, true, false, "merc は対象外"],
    [{ kind: "google" }, true, false, "maptype を持たない google は源を作れないため対象外"],
    [{ kind: "google", maptype: "base" }, true, false, "kind google + maptype base は対象外"],
    [{}, true, false, "空"],
    [null, true, false, "null"],
    [undefined, true, false, "undefined"],
  ];
  for (const [data, keyAvailable, expected, label] of table) {
    assert.equal(
      isGoogleEditorBasemap(data, keyAvailable),
      expected,
      `AC1: ${label} が ${expected} でない`,
    );
  }

  // provider 種別の切り出し（google/mapbox/maplibre 以外は null）
  assert.equal(baseMapProviderKindOf({ kind: "google" }), "google");
  assert.equal(baseMapProviderKindOf({ maptype: "google_roadmap" }), "google");
  assert.equal(baseMapProviderKindOf({ kind: "mapbox" }), "mapbox");
  assert.equal(baseMapProviderKindOf({ kind: "maplibre" }), "maplibre");
  assert.equal(baseMapProviderKindOf({ kind: "tms", maptype: "base" }), null);
  assert.equal(baseMapProviderKindOf(null), null);
  assert.equal(baseMapProviderKindOf(undefined), null);

  // 従来述語の意味は変えない（m6-t5 の AC6 と同一の期待値）。
  // なお既存述語は maptype を種別名として見るため旧保存形の `google_roadmap` は拾わない。
  // 既存述語は変更しないので、この穴は新しい述語側で塞ぐ（MINOR a）
  assert.equal(isProviderBaseMapData({ kind: "google" }), true);
  assert.equal(isProviderBaseMapData({ maptype: "google_roadmap" }), false);
  assert.equal(isProviderBaseMapData({ kind: "mapbox" }), true);
  assert.equal(isProviderBaseMapData({ kind: "tms", maptype: "base" }), false);
  assert.equal(isProviderBaseMapData(null), false);
}

// ---- MINOR(c): 既定の en-US / US ではなく今の表示言語から language/region を導く ----
{
  const cases = [
    ["ja", "ja", "JP"],
    ["en", "en", "US"],
    ["de", "de", "DE"],
    ["fr", "fr", "FR"],
    ["es", "es", "ES"],
    ["ko", "ko", "KR"],
    ["zh", "zh", "CN"],
    ["zh-TW", "zh-TW", "TW"],
    ["vi", "vi", "VN"],
    ["th", "th", "TH"],
    ["id", "id", "ID"],
  ];
  for (const [lang, language, region] of cases) {
    const resolved = googleTileLocaleOf(lang);
    assert.equal(resolved.language, language, `MINOR(c): language(${lang})`);
    assert.equal(resolved.region, region, `MINOR(c): region(${lang})`);
  }
  // 空・未知は en / 地域不明（既定値 US を書き込まない）
  assert.equal(googleTileLocaleOf("").language, "en");
  assert.equal(googleTileLocaleOf(undefined).language, "en");
  assert.equal(googleTileLocaleOf("zz").region, "", "未知の言語に地域を捏造しない");
}

// ---- AC10: 11 言語すべてに 2 キーが存在する ----
{
  const localesDir = path.join(projectRoot, "public/locales");
  const langs = (await readdir(localesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.equal(langs.length, 11, "locales は 11 言語");
  for (const lang of langs) {
    const tr = JSON.parse(await readFile(path.join(localesDir, lang, "translation.json"), "utf8"));
    for (const key of ["base_map_google_key_missing", "base_map_google_failed"]) {
      const value = tr?.mapedit?.[key];
      assert.equal(typeof value, "string", `AC10: ${lang} に mapedit.${key} が無い`);
      assert.ok(value.trim() !== "", `AC10: ${lang} の mapedit.${key} が空`);
    }
  }
}

const mapedit = await readFile(path.join(projectRoot, "src/views/MapEdit.vue"), "utf8");

// ---- AC6: 単一投入点の字面と、google を条件付きで通す OR ----
{
  // m6-t5 の smoke が断言する字面（isProviderBaseMapData(item?.data)）を保つ
  assert.match(mapedit, /isProviderBaseMapData\(item\?\.data\)/);
  // 従来述語を消さず、google 述語を OR で足す
  assert.match(
    mapedit,
    // NOV26-IR-EDITOR-FEAT3-0459 MINOR-1: 旧い保存形の google を従来述語の側で通さない（キーの条件だけで通す）
    /\(!isProviderBaseMapData\(item\?\.data\)\s*&&\s*baseMapProviderKindOf\(item\?\.data\)\s*!==\s*'google'\)\s*\|\|\s*isGoogleEditorBasemap\(item\?\.data,/,
    "AC6: フィルタが「（従来述語 かつ google でない）OR google 述語」になっていない",
  );
  // キーの有無は述語の第2引数で渡す（キー未解決なら出さない）
  assert.match(mapedit, /isGoogleEditorBasemap\(item\?\.data,\s*!!editorGoogleKey\.value\)/);
}

// ---- AC9: google 源の分岐（ソーステキスト契約） ----
{
  const start = mapedit.indexOf("isGoogleEditorBasemap(tms");
  assert.ok(start > 0, "AC9: setupBaseMaps に google 分岐が無い");
  const endMarker = mapedit.indexOf("watchGoogleSourceState", start);
  const block = mapedit.slice(start, endMarker > 0 ? endMarker : start + 2400);
  assert.match(block, /maptype:\s*tms\.maptype/, "AC9: maptype を tms から渡していない");
  assert.match(block, /\bkey:\s*editorGoogleKey\.value/, "AC9: key を渡していない");
  // provider に url を渡すと ol/source/Google の baseUrl が汚染される（source_ex.ts:110-116）
  assert.doesNotMatch(block, /\burl:\s/, "AC9: google 分岐で url を渡している");
  // 相対 thumbnail 仮置き fetch を避けるため thumbnail も渡さない
  assert.doesNotMatch(block, /\bthumbnail:\s/, "AC9: google 分岐で thumbnail を渡している");
  // MINOR(c): 表示言語を渡す
  assert.match(block, /googleTileLocaleOf\(currentLang\.value\)/, "MINOR(c): 表示言語を渡していない");
  // 失敗検知: 源の change を購読して error 状態を見る
  assert.match(mapedit, /getState[^/]*?(===|!==)\s*['"]error['"]/, "失敗検知: getState()==='error' を見ていない");
  assert.match(mapedit, /getError/, "失敗検知: getError() を見ていない");
}

// ---- MINOR(b): applyBaseMapShifts は google 源に mercatorXShift を書かない ----
{
  const start = mapedit.indexOf("const applyBaseMapShifts");
  assert.ok(start > 0, "applyBaseMapShifts が無い");
  const end = mapedit.indexOf("const loadBaseMapShifts", start);
  const block = mapedit.slice(start, end > 0 ? end : start + 1600);
  assert.match(block, /baseMapProviderKindOf\(baseMapTms\)/, "MINOR(b): google 判定が無い");
  assert.match(block, /===\s*["']google["']/, "MINOR(b): google の比較が無い");
}

// ---- 失敗検知: 未処理 reject を作らない（fetchSessionToken の差し替え） ----
{
  assert.match(mapedit, /fetchSessionToken\s*:/, "未処理 reject 対策の fetchSessionToken 差し替えが無い");
  assert.match(mapedit, /catch/, "fetchSessionToken 側の catch が無い");
}


console.log("nov26-editor-feat3 smoke: OK");
