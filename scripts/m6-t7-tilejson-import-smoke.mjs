// m6-t7 TileJSON 取り込み smoke
// AC3: tiles[] が複数ある場合は先頭のみ採用
// AC4: attribution/name/bounds 欠落時はフィールドを省略（クロバーしない）
// AC5: bounds が不正（非有限数・順序不正）な場合 coverageLngLats は省略
// AC6: vector_layers を持つ TileJSON は拒否
// AC7: http/https 以外の scheme・ネットワークエラー・50MiB 超過・不正 JSON・HTTP エラー応答
// AC8: tileJsonSourceUrl は EDITOR_ONLY_KEYS 経由で viewer 出力から除去される
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, ".tmp-smoke");
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, "m6-t7-tilejson-import-"));
const entryPath = path.join(workDir, "entry.ts");
const outDir = path.join(workDir, "dist");
const modulePath = (relativePath) => JSON.stringify(path.join(projectRoot, relativePath));

const servers = [];
function startServer(handler) {
  const server = createServer(handler);
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: (p) => `http://127.0.0.1:${port}${p}` });
    });
  });
}

try {
  await writeFile(
    entryPath,
    [
      `export * from ${modulePath("src/utils/baseMapEditorDocument.ts")};`,
      `export * from ${modulePath("src/utils/appSourceModel.ts")};`,
      `export * from ${modulePath("electron/services/remoteFetchGuard.ts")};`,
      `export * from ${modulePath("electron/services/TileJsonImportService.ts")};`,
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
    guardedFetch,
    importTileJson,
    normalizeAppSource,
    composeViewerSource,
    composeBaseMapSettingFile,
    createBaseMapMasterLookup,
    createAppSourceFromBaseMap,
  } = await import(pathToFileURL(path.join(outDir, "contracts.mjs")).href);

  // ---- Part A: guardedFetch ----

  // A1: unsupported scheme（ネットワークアクセス無し）
  {
    const result = await guardedFetch("ftp://example.com/tiles.json");
    assert.equal(result.ok, false, "A1: ftp scheme は失敗");
    assert.equal(result.code, "unsupported-scheme", "A1: code=unsupported-scheme");
  }
  {
    const result = await guardedFetch("not a url");
    assert.equal(result.ok, false, "A1b: 不正な URL 文字列は失敗");
    assert.equal(result.code, "unsupported-scheme", "A1b: code=unsupported-scheme");
  }

  // A2: network error（接続拒否ポート）
  {
    const result = await guardedFetch("http://127.0.0.1:1", { timeoutMs: 2000 });
    assert.equal(result.ok, false, "A2: 接続拒否は失敗");
    assert.equal(result.code, "network", "A2: code=network");
    assert.equal(typeof result.message, "string", "A2: message は string");
  }

  // A3: http-status
  {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(500, "Internal Server Error");
      res.end("boom");
    });
    const result = await guardedFetch(url("/"));
    assert.equal(result.ok, false, "A3: 500応答は失敗");
    assert.equal(result.code, "http-status", "A3: code=http-status");
    assert.match(result.message, /500/, "A3: message に status code");
    server.close();
  }

  // A4: too-large via content-length fast path
  {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Length": "1000", "Content-Type": "application/json" });
      res.end("x".repeat(1000));
    });
    const result = await guardedFetch(url("/"), { maxBytes: 100 });
    assert.equal(result.ok, false, "A4: content-length超過は失敗");
    assert.equal(result.code, "too-large", "A4: code=too-large");
    server.close();
  }

  // A5: too-large via streaming (no content-length)
  {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json", "Transfer-Encoding": "chunked" });
      res.write("x".repeat(60));
      res.write("x".repeat(60));
      res.end();
    });
    const result = await guardedFetch(url("/"), { maxBytes: 100 });
    assert.equal(result.ok, false, "A5: streaming超過は失敗");
    assert.equal(result.code, "too-large", "A5: code=too-large");
    server.close();
  }

  // A6: success
  {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
    const result = await guardedFetch(url("/"));
    assert.equal(result.ok, true, "A6: 成功時は ok:true");
    assert.equal(result.text, '{"ok":true}', "A6: text がそのまま返る");
    server.close();
  }

  console.log("  [Part A] guardedFetch: PASS");

  // ---- Part B: importTileJson ----

  // B1: フル TileJSON（全フィールド有り）
  {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          tiles: ["https://example.test/{z}/{x}/{y}.png"],
          minzoom: 2,
          maxzoom: 18,
          attribution: "Example Attribution",
          name: "Example Tiles",
          bounds: [130, 30, 140, 40],
        }),
      );
    });
    const tileJsonUrl = url("/tiles.json");
    const result = await importTileJson(tileJsonUrl);
    assert.equal(result.ok, true, "B1: 成功する");
    assert.equal(result.fields.url, "https://example.test/{z}/{x}/{y}.png", "B1: url");
    assert.equal(result.fields.minZoom, 2, "B1: minZoom");
    assert.equal(result.fields.maxZoom, 18, "B1: maxZoom");
    assert.equal(result.fields.attr, "Example Attribution", "B1: attr");
    assert.equal(result.fields.title, "Example Tiles", "B1: title");
    assert.deepEqual(result.fields.coverageLngLats, [[130, 30], [140, 30], [140, 40], [130, 40]], "B1: coverageLngLats = bboxToEnvelope(bounds)");
    assert.equal(result.sourceUrl, tileJsonUrl, "B1: sourceUrl は取り込み元 URL そのもの");
    server.close();
  }

  // B2 (AC3): tiles[] が複数 → 先頭のみ採用
  {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ tiles: ["https://a.test/{z}/{x}/{y}.png", "https://b.test/{z}/{x}/{y}.png"] }));
    });
    const result = await importTileJson(url("/"));
    assert.equal(result.ok, true, "B2: 成功する");
    assert.equal(result.fields.url, "https://a.test/{z}/{x}/{y}.png", "AC3: tiles[0] のみ採用");
    server.close();
  }

  // B3 (AC4): attribution/name/bounds 欠落 → フィールド省略、minZoom/maxZoom は仕様既定
  {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ tiles: ["https://c.test/{z}/{x}/{y}.png"] }));
    });
    const result = await importTileJson(url("/"));
    assert.equal(result.ok, true, "B3: 成功する");
    assert.equal(result.fields.minZoom, 0, "AC4: minzoom 欠落は仕様既定 0");
    assert.equal(result.fields.maxZoom, 22, "AC4: maxzoom 欠落は仕様既定 22");
    assert.equal("attr" in result.fields, false, "AC4: attribution 欠落時 attr は省略される（キー自体が無い）");
    assert.equal("title" in result.fields, false, "AC4: name 欠落時 title は省略される");
    assert.equal("coverageLngLats" in result.fields, false, "AC4: bounds 欠落時 coverageLngLats は省略される");
    server.close();
  }

  // B4 (AC5): bounds が不正 → coverageLngLats は省略（他フィールドは正常に反映）
  const invalidBoundsCases = [
    { label: "非有限数を含む", bounds: [130, 30, "NaN", 40] },
    { label: "west >= east", bounds: [140, 30, 130, 40] },
    { label: "south >= north", bounds: [130, 40, 140, 30] },
    { label: "要素数が4でない", bounds: [130, 30, 140] },
  ];
  for (const { label, bounds } of invalidBoundsCases) {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ tiles: ["https://d.test/{z}/{x}/{y}.png"], bounds }));
    });
    const result = await importTileJson(url("/"));
    assert.equal(result.ok, true, `AC5(${label}): 他フィールドは成功`);
    assert.equal("coverageLngLats" in result.fields, false, `AC5(${label}): coverageLngLats は省略される`);
    server.close();
  }

  // B5 (AC6): vector_layers を持つ → vector-tileset で拒否（tiles/bounds が有効でも）
  {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          tiles: ["https://e.test/{z}/{x}/{y}.pbf"],
          bounds: [130, 30, 140, 40],
          vector_layers: [{ id: "layer1" }],
        }),
      );
    });
    const result = await importTileJson(url("/"));
    assert.equal(result.ok, false, "AC6: vector tileset は拒否される");
    assert.equal(result.code, "vector-tileset", "AC6: code=vector-tileset");
    server.close();
  }

  // B6 (AC7 missing-tiles バリエーション)
  const missingTilesCases = [
    { label: "tiles キー自体が無い", body: {} },
    { label: "tiles が空配列", body: { tiles: [] } },
    { label: "tiles[0] が文字列でない", body: { tiles: [123] } },
  ];
  for (const { label, body } of missingTilesCases) {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
    const result = await importTileJson(url("/"));
    assert.equal(result.ok, false, `AC7(${label}): 失敗する`);
    assert.equal(result.code, "missing-tiles", `AC7(${label}): code=missing-tiles`);
    server.close();
  }

  // B7 (AC7): 不正 JSON
  {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{not valid json");
    });
    const result = await importTileJson(url("/"));
    assert.equal(result.ok, false, "AC7(invalid-json): 失敗する");
    assert.equal(result.code, "invalid-json", "AC7(invalid-json): code=invalid-json");
    server.close();
  }

  // B8 (AC7): unsupported scheme はサーバ不要で即座に失敗（guardedFetch と同じ code をそのまま透過）
  {
    const result = await importTileJson("file:///etc/passwd");
    assert.equal(result.ok, false, "AC7(unsupported-scheme): 失敗する");
    assert.equal(result.code, "unsupported-scheme", "AC7(unsupported-scheme): code=unsupported-scheme");
  }

  // B9 (AC7): ネットワークエラー
  {
    const result = await importTileJson("http://127.0.0.1:1");
    assert.equal(result.ok, false, "AC7(network): 失敗する");
    assert.equal(result.code, "network", "AC7(network): code=network");
  }

  // B10 (AC7): HTTP エラー応答
  {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(404, "Not Found");
      res.end();
    });
    const result = await importTileJson(url("/"));
    assert.equal(result.ok, false, "AC7(http-status): 失敗する");
    assert.equal(result.code, "http-status", "AC7(http-status): code=http-status");
    server.close();
  }

  console.log("  [Part B] importTileJson: PASS");

  // ---- Part C (AC8): EDITOR_ONLY_KEYS 経由の viewer 出力ストリップ ----
  {
    const master = {
      mapID: "tilejson-master",
      lang: "ja",
      title: { ja: "TileJSON基点" },
      kind: "tms",
      url: "https://f.test/{z}/{x}/{y}.png",
      tileJsonSourceUrl: "https://f.test/tiles.json",
    };
    // m6-t10: tileJsonSourceUrl はエディタ専用メタデータであり、アプリ JSON にも
    // 設定ファイルにも出てはならない（SETTING_FILE_EXCLUDED_KEYS）。AC8 の趣旨は不変。
    const masterItem = { uid: "uid-tj", mapID: "tj1", data: { mapID: "tj1", ...master } };
    const lookup = createBaseMapMasterLookup([masterItem]);
    const appSource = createAppSourceFromBaseMap(masterItem, "ja");
    const composed = composeViewerSource(appSource, { lookup });
    assert.equal("tileJsonSourceUrl" in composed, false, "AC8: アプリ JSON に tileJsonSourceUrl が含まれない");
    const settingFile = composeBaseMapSettingFile(masterItem, appSource.role);
    assert.equal("tileJsonSourceUrl" in settingFile, false, "AC8: 設定ファイルにも tileJsonSourceUrl が含まれない");
    assert.equal(settingFile.url, "https://f.test/{z}/{x}/{y}.png", "AC8: 取り込んだ url 自体は設定ファイルへ運ばれる");

    // 旧保存形（data 全コピー）を読んだ場合も、tileJsonSourceUrl は overrides へ入らない
    // （操作子が無いキーは移行時に捨てる。設計 §3.7）
    const legacyMaster = { uid: "uid-tj2", mapID: "tj2", data: { mapID: "tj2", lang: "ja", url: "https://g.test/{z}/{x}/{y}.png" } };
    const legacyLookup = createBaseMapMasterLookup([legacyMaster]);
    const raw = { sourceType: "base-map", mapID: "tj2", role: "base", data: { url: "https://g.test/{z}/{x}/{y}.png", tileJsonSourceUrl: "https://g.test/tiles.json" } };
    const normalized = normalizeAppSource(raw);
    assert.equal("tileJsonSourceUrl" in normalized.legacyData, false, "AC8: normalizeAppSource の時点で既に除去される");
    const composed2 = composeViewerSource(normalized, { lookup: legacyLookup });
    assert.equal("tileJsonSourceUrl" in composed2, false, "AC8: normalize→compose でも viewer 出力から除去される");
  }

  console.log("  [Part C] EDITOR_ONLY_KEYS strip (AC8): PASS");

  console.log("M6-T7 tilejson-import smoke passed");
} finally {
  for (const server of servers) {
    server.close();
  }
  await rm(workDir, { recursive: true, force: true });
}
