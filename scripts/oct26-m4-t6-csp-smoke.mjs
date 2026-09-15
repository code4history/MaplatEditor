// oct26-m4-t6: renderer の Content-Security-Policy（MaplatEditor#120）の smoke（Electron を起動しない）。
//
// 実起動のヘッダ・注入・違反 0・保存フォルダ内スクリプトの拒否は tests/e2e/oct26-m4-t6-csp.spec.ts が測る。
// 本 smoke は e2e を回さない場面でも、次が外されたら落ちるように固定する:
//   [AC1] createAppSchemeHandler の同梱 HTML（index.html・about.html）の応答に RENDERER_CSP が付き、値は設計 v3 §2.1。
//         script-src／worker-src は 'self' を含まずパスで限定（MAJ-1）。同梱の非 HTML には付かない。__local の応答は
//         localResponseHeaders() と完全一致（renderer CSP を重ねない）。実ビルド（dist/）の script・Worker が許可パスに収まる
//   [AC2] public/about.html にインライン script・style・meta CSP・innerHTML が無く、about.js／about.css を参照する
//   [AC7] handler 単体: __local のスクリプト系 MIME（.js/.mjs・大文字拡張子を含む）は 403・__local の応答に nosniff
//
// AC ごとに PASS/FAIL を表示し、1 つでも FAIL なら exit 1（変更前・層ごとの変異で、どの AC が赤になるかを読めるように）。
// 前提: `vite build` 済みの dist/ があること（無ければ AC1 を FAIL にする。黙って合格しない）。
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as appScheme from "../electron/utils/appScheme.ts";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const readSrc = (rel) => readFile(path.join(projectRoot, rel), "utf8");

// 設計 v3 §2.1 の本番ポリシー（逐語）。製品側の唯一の定義は appScheme.ts の RENDERER_CSP。
const DESIGN_POLICY =
  "default-src 'self'; script-src app://bundle/assets/ app://bundle/about.js; style-src 'self'; img-src 'self' data: https: http:; font-src 'self'; connect-src 'self' https: http://localhost:*; worker-src app://bundle/assets/; frame-src http://localhost:*; child-src 'none'; media-src 'self'; object-src 'none'; manifest-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'";

const parsePolicy = (policy) =>
  Object.fromEntries(
    policy.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
      const [name, ...values] = d.split(/\s+/);
      return [name, values];
    }),
  );

const results = [];
async function section(label, fn) {
  try {
    await fn();
    results.push([label, "PASS"]);
    console.log(`  ${label}: PASS`);
  } catch (e) {
    results.push([label, "FAIL"]);
    console.log(`  ${label}: FAIL — ${e?.message ?? e}`);
  }
}

// handler を一時 dist / 保存フォルダで作る（same-origin smoke と同じ様式）
const work = await mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), "oct26-m4-t6-csp-smoke-"));
const dist = path.join(work, "dist");
const save = path.join(work, "save");
await mkdir(path.join(dist, "assets"), { recursive: true });
await mkdir(path.join(save, "tiles"), { recursive: true });
await writeFile(path.join(dist, "index.html"), "<!doctype html>");
await writeFile(path.join(dist, "about.html"), "<!doctype html>");
await writeFile(path.join(dist, "about.js"), "void 0");
await writeFile(path.join(dist, "assets", "index-x.js"), "void 0");
await writeFile(path.join(save, "tiles", "0.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
await writeFile(path.join(save, "evil.html"), "<!doctype html><script>1</script>");
for (const f of ["evil.js", "evil.mjs", "EVIL2.JS", "evil.txt", "evil.json", "evil"]) {
  await writeFile(path.join(save, f), "window.__t6 = 1");
}
const handler = typeof appScheme.createAppSchemeHandler === "function"
  ? appScheme.createAppSchemeHandler({
    getRoots: () => ({ bundleRoots: [dist], localRoots: [save] }),
    fetchFile: async (p) => new Response(await readFile(p)),
    warn: () => {},
  })
  : null;
const get = (u) => handler(new Request(u));
const L = (f) => appScheme.localFileUrl(path.join(save, f));

await section("[AC1] renderer CSP（handler の実挙動・v3 のパス限定・__local に重ねない・実ビルドが許可パスに収まる）", async () => {
  const { RENDERER_CSP, bundleDocumentHeaders, localResponseHeaders } = appScheme;
  assert.equal(typeof RENDERER_CSP, "string", "appScheme.ts が RENDERER_CSP を export していない");
  assert.equal(RENDERER_CSP, DESIGN_POLICY, "RENDERER_CSP が設計 v3 §2.1 のポリシーと一致しない");
  assert.deepEqual(bundleDocumentHeaders(), { "content-security-policy": RENDERER_CSP });

  const p = parsePolicy(RENDERER_CSP);
  // R2-MIN-1: §2.1 を正とする。script-src／worker-src は 'self' を含まない（含むと __local 全体に戻る）
  assert.deepEqual(p["script-src"], ["app://bundle/assets/", "app://bundle/about.js"], "script-src は assets/ と about.js だけ");
  assert.deepEqual(p["worker-src"], ["app://bundle/assets/"], "worker-src は assets/ だけ");
  assert.ok(!p["script-src"].includes("'self'") && !p["worker-src"].includes("'self'"), "script-src／worker-src に 'self' を書かない（MAJ-1）");
  assert.doesNotMatch(RENDERER_CSP, /unsafe-inline|unsafe-eval|unsafe-hashes|wasm-unsafe-eval/);
  assert.deepEqual(p["object-src"], ["'none'"]);
  assert.deepEqual(p["frame-ancestors"], ["'none'"]);
  assert.ok(!("sandbox" in p), "renderer CSP に sandbox を含めない");

  for (const u of ["app://bundle/index.html", "app://bundle/about.html", "app://bundle/about.html?appVersion=1"]) {
    const res = await get(u);
    assert.equal(res.status, 200, u);
    assert.equal(res.headers.get("content-type"), "text/html", u);
    assert.equal(res.headers.get("content-security-policy"), RENDERER_CSP, `${u} に renderer CSP が無い`);
  }
  for (const u of ["app://bundle/about.js", "app://bundle/assets/index-x.js"]) {
    const res = await get(u);
    assert.equal(res.status, 200, u);
    assert.equal(res.headers.get("content-security-policy"), null, `同梱の非 HTML（${u}）には CSP を付けない`);
  }
  const expectedLocal = localResponseHeaders();
  for (const u of [L("tiles/0.png"), L("evil.html"), L("evil.txt"), L("tiles/9.png")]) {
    const res = await get(u);
    const actual = {};
    for (const k of ["content-security-policy", "x-content-type-options"]) {
      if (res.headers.get(k) !== null) actual[k] = res.headers.get(k);
    }
    assert.deepEqual(actual, expectedLocal, `__local の応答（${u}）は localResponseHeaders() と完全一致（renderer CSP を重ねない）`);
    assert.notEqual(res.headers.get("content-security-policy"), RENDERER_CSP);
  }

  // §2.5: 実ビルド物が許可パスに収まる（Vite の既定 assetsDir に依存しているため）
  const distRoot = path.join(projectRoot, "dist");
  assert.ok(existsSync(path.join(distRoot, "index.html")), "dist/index.html が無い（先に vite build すること。黙って合格しない）");
  const indexHtml = await readFile(path.join(distRoot, "index.html"), "utf8");
  const scriptSrcs = [...indexHtml.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(scriptSrcs.length >= 1, "dist/index.html に script が無い");
  for (const tag of scriptSrcs) {
    const src = tag.match(/\bsrc="([^"]+)"/)?.[1];
    assert.ok(src, `dist/index.html にインライン script がある: ${tag}`);
    assert.match(src, /^\.\/assets\/[^/]+\.js$/, `dist/index.html の script が ./assets/ 配下でない: ${src}`);
  }
  for (const m of indexHtml.matchAll(/<link\b[^>]*rel="modulepreload"[^>]*>/g)) {
    assert.match(m[0], /href="\.\/assets\//, `modulepreload が ./assets/ 配下でない: ${m[0]}`);
  }
  const assets = await readdir(path.join(distRoot, "assets"));
  assert.ok(assets.some((f) => /^tinComputeWorker-.*\.js$/.test(f)), "dist/assets/ に tinComputeWorker-*.js が無い（worker-src の許可パスから外れた）");
  const aboutDist = await readFile(path.join(distRoot, "about.html"), "utf8");
  const aboutScripts = [...aboutDist.matchAll(/<script\b[^>]*>/g)].map((m) => m[0].match(/\bsrc="([^"]+)"/)?.[1] ?? "(inline)");
  assert.deepEqual(aboutScripts, ["about.js"], "dist/about.html の script は about.js だけ");
  const viteConfig = await readSrc("vite.config.ts");
  assert.doesNotMatch(viteConfig, /assetsDir/, "vite.config.ts に assetsDir を足すと許可パス app://bundle/assets/ から外れうる");
  assert.doesNotMatch(viteConfig, /^\s*worker\s*:/m, "vite.config.ts に worker 設定を足すと Worker の出力先が変わりうる");
});

await section("[AC2] about.html の外出し（インライン script/style・meta CSP・innerHTML が無い・about.js／about.css を参照）", async () => {
  const html = await readSrc("public/about.html");
  assert.equal([...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].filter((m) => m[1].trim() !== "").length, 0, "インライン <script> 本文がある");
  assert.equal((html.match(/<style\b/g) || []).length, 0, "<style> がある");
  assert.equal((html.match(/http-equiv=["']Content-Security-Policy/gi) || []).length, 0, "meta CSP がある");
  assert.equal((html.match(/innerHTML/g) || []).length, 0, "innerHTML がある");
  assert.equal((html.match(/\sstyle=/g) || []).length, 0, "style 属性がある（style-src 'self' で拒否される）");
  assert.match(html, /<script\s+src="about\.js"><\/script>/, "about.html が about.js を参照していない");
  assert.match(html, /<link\s+rel="stylesheet"\s+href="about\.css">/, "about.html が about.css を参照していない");
  const js = await readSrc("public/about.js");
  assert.match(js, /new URLSearchParams\(location\.search\)/, "about.js が query を URLSearchParams(location.search) で受けていない");
  assert.equal((js.match(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/g) || []).length, 0, "about.js が HTML 文字列を差し込んでいる");
  assert.ok(existsSync(path.join(projectRoot, "public/about.css")), "public/about.css が無い");
});

await section("[AC7] handler: __local のスクリプト系 MIME は 403・__local の応答に nosniff（MAJ-1 の案 B）", async () => {
  assert.equal(appScheme.localResponseHeaders()["x-content-type-options"], "nosniff", "localResponseHeaders() に nosniff が無い");
  for (const f of ["evil.js", "evil.mjs", "EVIL2.JS"]) {
    const res = await get(L(f));
    assert.equal(res.status, 403, `__local の ${f} が 403 にならない`);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff", `__local の ${f} の 403 に nosniff が無い`);
    assert.match(res.headers.get("content-security-policy") ?? "", /(^|;\s*)sandbox(;|$)/, `__local の ${f} の 403 に sandbox CSP が無い`);
  }
  for (const f of ["evil.txt", "evil.json", "evil", "tiles/0.png"]) {
    const res = await get(L(f));
    assert.equal(res.status, 200, f);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff", `__local の ${f} に nosniff が無い`);
  }
  // 旧 app://local も __local と同じ扱い
  const legacy = await get(`app://local${encodeURI(path.join(save, "evil.js"))}`);
  assert.equal(legacy.status, 403, "旧 app://local の .js が 403 にならない");
  // 同梱の .js は対象外（製品の assets を止めない）
  assert.equal((await get("app://bundle/assets/index-x.js")).status, 200);
});

const failed = results.filter(([, s]) => s === "FAIL");
console.log(failed.length === 0
  ? "=== oct26-m4-t6 CSP smoke: PASS ==="
  : `=== oct26-m4-t6 CSP smoke: FAIL (${failed.map(([l]) => l.slice(0, 5)).join(" ")}) ===`);
process.exit(failed.length === 0 ? 0 : 1);
