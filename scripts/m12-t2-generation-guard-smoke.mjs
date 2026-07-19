// M12-T2 smoke: initGenerationGuard（generation guard 完結）。
// m11-t11-geo-estimate 型の vite lib build で initGenerationGuard.ts を import し、
// 制御 Promise + 注入 fake ops で競合を物理的に重ねて検証する（失敗事例ルール準拠）。
// シナリオ:
//   guardedReleaseThenFallback
//     (a) AC1: release の await 中に stale 化 → onFallback は呼ばれない（stale 上書きなし）
//     (b) AC1b: 開始時点で stale → release も onFallback も呼ばれない
//     (c) AC2: current のまま → onFallback が呼ばれる（非退行）
//   runGuardedPoiImport
//     (d) AC3a: 開始時点で stale → pickImportFile は呼ばれず outcome='stale'
//     (e) AC3b: picker 待ちの間に stale 化 → importFile は呼ばれず outcome='stale'
//     (f) AC3c: importFile 成功後に stale 化 → removeDraft(importUid) は呼ばれるが
//         loadSaved/replaceRoute は呼ばれず outcome='stale'（Min2 残留物ポリシー）
//     (g) AC3d: current のまま importFile が failure → outcome='failed' + failure 保持
//     (h) AC4: current 全通過 → pick→detect→import→removeDraft→loadSaved→replaceRoute の順で
//         呼ばれ outcome='current-saved'
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, ".tmp-smoke");
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, "m12-t2-guard-"));
const outDir = path.join(workDir, "dist");

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve: (v) => resolve(v) };
}

try {
  await build({
    root: projectRoot,
    logLevel: "error",
    configFile: false,
    build: {
      outDir,
      emptyOutDir: true,
      lib: {
        entry: path.join(projectRoot, "src/utils/initGenerationGuard.ts"),
        formats: ["es"],
        fileName: () => "initGenerationGuard.mjs",
      },
      rollupOptions: { external: [] },
    },
  });

  const bundleUrl = pathToFileURL(path.join(outDir, "initGenerationGuard.mjs")).href;
  const { guardedReleaseThenFallback, runGuardedPoiImport } = await import(bundleUrl);
  assert.equal(typeof guardedReleaseThenFallback, "function");
  assert.equal(typeof runGuardedPoiImport, "function");

  // (a) AC1: release の await 中に stale 化 → onFallback 非呼出
  {
    let current = true;
    const releaseDef = deferred();
    let fallbackCalls = 0;
    const run = guardedReleaseThenFallback({
      isCurrent: () => current,
      release: () => releaseDef.promise,
      onFallback: () => { fallbackCalls += 1; },
    });
    current = false; // release の await 中に世代切替（物理的に重ねる）
    releaseDef.resolve();
    await run;
    assert.equal(fallbackCalls, 0, "release await 中の stale では onFallback が呼ばれないはず");
    console.log("ok: (a) stale during release await skips onFallback");
  }

  // (b) AC1b: 開始時点で stale → release も onFallback も非呼出
  {
    let releaseCalls = 0;
    let fallbackCalls = 0;
    await guardedReleaseThenFallback({
      isCurrent: () => false,
      release: () => { releaseCalls += 1; return Promise.resolve(); },
      onFallback: () => { fallbackCalls += 1; },
    });
    assert.equal(releaseCalls, 0, "開始時点で stale なら release 自体も呼ばれないはず");
    assert.equal(fallbackCalls, 0);
    console.log("ok: (b) stale from start calls neither release nor onFallback");
  }

  // (c) AC2: current のまま → onFallback 呼出
  {
    let fallbackCalls = 0;
    await guardedReleaseThenFallback({
      isCurrent: () => true,
      release: () => Promise.resolve(),
      onFallback: () => { fallbackCalls += 1; },
    });
    assert.equal(fallbackCalls, 1, "current なら onFallback が呼ばれるはず");
    console.log("ok: (c) current applies onFallback");
  }

  // (d) AC3a: 開始時点で stale → pickImportFile 非呼出、outcome='stale'
  {
    let pickCalls = 0;
    const outcome = await runGuardedPoiImport({
      isCurrent: () => false,
      newUid: () => "uid-a",
      pickImportFile: () => { pickCalls += 1; return Promise.resolve({ filePath: "/tmp/a.geojson", fileName: "a.geojson" }); },
      detectImportLanguage: () => Promise.resolve("ja"),
      importFile: () => Promise.resolve({ result: "Success", uid: "uid-a", slug: "a", revision: 1 }),
      removeDraft: () => Promise.resolve(),
      loadSaved: () => Promise.resolve(),
      replaceRoute: () => Promise.resolve(),
    });
    assert.equal(pickCalls, 0, "開始時点で stale なら picker を呼ばないはず");
    assert.deepEqual(outcome, { outcome: "stale" });
    console.log("ok: (d) stale at start never calls the picker");
  }

  // (e) AC3b: picker 待ちの間に stale 化 → importFile 非呼出、outcome='stale'
  {
    let current = true;
    const pickDef = deferred();
    let importCalls = 0;
    const run = runGuardedPoiImport({
      isCurrent: () => current,
      newUid: () => "uid-b",
      pickImportFile: () => pickDef.promise,
      detectImportLanguage: () => Promise.resolve("ja"),
      importFile: () => { importCalls += 1; return Promise.resolve({ result: "Success", uid: "uid-b", slug: "b", revision: 1 }); },
      removeDraft: () => Promise.resolve(),
      loadSaved: () => Promise.resolve(),
      replaceRoute: () => Promise.resolve(),
    });
    current = false; // picker 待ちの間に世代切替
    pickDef.resolve({ filePath: "/tmp/b.geojson", fileName: "b.geojson" });
    const outcome = await run;
    assert.equal(importCalls, 0, "picker 待ちの間に stale なら importFile を呼ばないはず");
    assert.deepEqual(outcome, { outcome: "stale" });
    console.log("ok: (e) stale during picker await skips importFile");
  }

  // (f) AC3c: importFile 成功直後に stale 化 → removeDraft(importUid) のみ実行、loadSaved/replaceRoute 非呼出
  {
    let current = true;
    const removedDrafts = [];
    let loadCalls = 0;
    let replaceCalls = 0;
    const outcome = await runGuardedPoiImport({
      isCurrent: () => current,
      newUid: () => "uid-c",
      pickImportFile: () => Promise.resolve({ filePath: "/tmp/c.geojson", fileName: "c.geojson" }),
      detectImportLanguage: () => Promise.resolve("ja"),
      importFile: () => {
        // importFile 完了直後の世代切替を物理的に再現（成功は成立したが、その後 stale へ）
        current = false;
        return Promise.resolve({ result: "Success", uid: "uid-c", slug: "c", revision: 1 });
      },
      removeDraft: (uid) => { removedDrafts.push(uid); return Promise.resolve(); },
      loadSaved: () => { loadCalls += 1; return Promise.resolve(); },
      replaceRoute: () => { replaceCalls += 1; return Promise.resolve(); },
    });
    assert.deepEqual(removedDrafts, ["uid-c"], "自世代 uid の draft cleanup は stale でも実行されるはず");
    assert.equal(loadCalls, 0, "stale では loadSaved を呼ばないはず");
    assert.equal(replaceCalls, 0, "stale では replaceRoute を呼ばないはず");
    assert.deepEqual(outcome, { outcome: "stale" });
    console.log("ok: (f) stale after successful import cleans up own draft but skips load/replace");
  }

  // (g) AC3d: current のまま importFile が failure → outcome='failed' + failure 保持
  {
    const failure = { result: "Exist" };
    const outcome = await runGuardedPoiImport({
      isCurrent: () => true,
      newUid: () => "uid-d",
      pickImportFile: () => Promise.resolve({ filePath: "/tmp/d.geojson", fileName: "d.geojson" }),
      detectImportLanguage: () => Promise.resolve("ja"),
      importFile: () => Promise.resolve(failure),
      removeDraft: () => Promise.resolve(),
      loadSaved: () => Promise.resolve(),
      replaceRoute: () => Promise.resolve(),
    });
    assert.deepEqual(outcome, { outcome: "failed", failure });
    console.log("ok: (g) current failure returns failed outcome with the failure payload");
  }

  // (h) AC4: current 全通過 → 全ステップが順序どおり呼ばれ outcome='current-saved'
  {
    const calls = [];
    const outcome = await runGuardedPoiImport({
      isCurrent: () => true,
      newUid: () => "uid-e",
      pickImportFile: () => { calls.push("pick"); return Promise.resolve({ filePath: "/tmp/e.geojson", fileName: "e.geojson" }); },
      detectImportLanguage: () => { calls.push("detect"); return Promise.resolve("ja"); },
      importFile: () => { calls.push("import"); return Promise.resolve({ result: "Success", uid: "uid-e", slug: "e", revision: 1 }); },
      removeDraft: (uid) => { calls.push(`remove:${uid}`); return Promise.resolve(); },
      loadSaved: (uid) => { calls.push(`load:${uid}`); return Promise.resolve(); },
      replaceRoute: (uid) => { calls.push(`replace:${uid}`); return Promise.resolve(); },
    });
    assert.deepEqual(calls, ["pick", "detect", "import", "remove:uid-e", "load:uid-e", "replace:uid-e"],
      "current なら全ステップが順序どおり呼ばれるはず");
    assert.deepEqual(outcome, { outcome: "current-saved" });
    console.log("ok: (h) current runs the full import flow in order");
  }

  // (h2) load() が世代を進める（import 捕捉世代が陳腐化する）実運用でも、
  // importFile 成功後は loadSaved → replaceRoute まで完了する
  // （loadSaved は自身の世代 guard を持つため、import 捕捉世代との post-load 比較はしない契約）
  {
    let current = true;
    const calls = [];
    const outcome = await runGuardedPoiImport({
      isCurrent: () => current,
      newUid: () => "uid-f",
      pickImportFile: () => { calls.push("pick"); return Promise.resolve({ filePath: "/tmp/f.geojson", fileName: "f.geojson" }); },
      detectImportLanguage: () => Promise.resolve("ja"),
      importFile: () => { calls.push("import"); return Promise.resolve({ result: "Success", uid: "uid-f", slug: "f", revision: 1 }); },
      removeDraft: () => Promise.resolve(),
      loadSaved: () => { calls.push("load"); current = false; return Promise.resolve(); }, // load() による世代前進を再現
      replaceRoute: (uid) => { calls.push(`replace:${uid}`); return Promise.resolve(); },
    });
    assert.deepEqual(calls, ["pick", "import", "load", "replace:uid-f"],
      "load() が世代を進めても loadSaved → replaceRoute は完了するはず");
    assert.deepEqual(outcome, { outcome: "current-saved" });
    console.log("ok: (h2) load-time generation advance still completes replaceRoute");
  }

  // 静的検査: PoiEdit.vue の配線（importAutoRun の generation 化・guardedReleaseThenFallback・importUid 固定）
  const { readFile } = await import("node:fs/promises");
  const poiEditSrc = await readFile(path.join(projectRoot, "src/views/PoiEdit.vue"), "utf8");
  assert.ok(poiEditSrc.includes("guardedReleaseThenFallback"), "PoiEdit が guardedReleaseThenFallback を使うこと");
  assert.ok(poiEditSrc.includes("importAutoRun(generation"), "PoiEdit の importAutoRun が generation 引数化されていること");
  assert.ok(poiEditSrc.includes("const importUid = newPoiUid.value"), "PoiEdit が flow 開始時に importUid を固定していること");
  assert.ok(poiEditSrc.includes("importAutoRun(generation)") || poiEditSrc.includes("void importAutoRun(generation)"), "スケジュール側が generation を渡すこと");
  console.log("ok: static PoiEdit wiring checks");

  console.log("m12-t2 generation-guard smoke: ALL PASS");
} finally {
  await rm(workDir, { recursive: true, force: true });
}
