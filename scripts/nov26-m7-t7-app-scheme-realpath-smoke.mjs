// nov26-m7-t7（#138）: app:// のローカル配信の封じ込めを **realpath（実体）** で判定する smoke。
//
// 背景: 従来の封じ込め（resolveAppUrl の isUnderRoot）は path.resolve の字面の前方一致で、許可ルートの**中**に
// 置かれた symlink・ジャンクションが外を指していても、その先を配信していた（#138）。本 smoke は
// createAppSchemeHandler の実挙動（実ファイル・node の Response）で、次を固定する:
//   (a) 外を指すリンク（ディレクトリ・ファイル）は 403。ディレクトリのリンク越しは warn を 1 件残す（link-escapes）
//   (b) 中を指すリンクは 200。MIME は**要求側（字面）**の拡張子で決める（実体が .html でも要求が .png なら image/png）
//   (c) 許可ルートそのものがリンクでも通す（判定は両側の実体で行う・J-8）
//   (d) 欠損は 404（warn 0）・外の欠損は 403・**外を指す壊れたリンクと生きたリンクは同じ 403**（MIN-10）・
//       中を指す壊れたリンクは 404・リンクの連鎖と自己ループは 403
//   (e) URL の正規化で `..` が畳まれた後に外を指す要求は 403
//   (f) 存在しない許可ルートは許可しない（404 でなく 403）。後から作れば 200（要求ごとに判定）
//   (h) 実体が .js のリンクは 403（スクリプトの拒否を実体側にも広げる）
//   (i) 形で落ちる要求（UNC・`\\?\`・`\\.\`・/net/ 等。要求者が URL で選べるパス）は fs に触れずに 403
//       （MAJ-3。数える fs を deps.fs に注入して、候補・祖先・リンクの先への呼び出しが 0 であることを断言する）
//   (j) 形の検査 localPathShape の純関数（win32 の規則も macOS で測る）
//   (g1)〜(g4)（Windows のみ）: 大文字小文字・8.3 名・ドライブ文字・ジャンクション
//   (k) 既存の形の回帰: EACCES は 403＋warn（POSIX のみ。理由は実行時に出力する）・外の実在ファイルは 403
//
// 最後に「実行した項目の数」を OS ごとの期待の数と照らす（走査 0 件の合格を作らない）。
// `node --experimental-strip-types` で electron/utils/appScheme.ts を直接 import する（appScheme.ts は electron を import しない）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  appUrlToLocalPath,
  createAppSchemeHandler,
  localFileUrl,
  localPathShape,
  localResponseHeaders,
  resolveLocalReal,
} from "../electron/utils/appScheme.ts";

const isWin = process.platform === "win32";
const windowsRequired = process.env.NOV26_M7_T7_WINDOWS_REQUIRED === "1";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// 実行した項目の記録。1 項目が失敗しても止めずに集約する（検査群を `&&` で連ねない・H-2）
const passed = [];
const failed = [];
const item = async (id, fn) => {
  try {
    await fn();
    passed.push(id);
    console.log(`[PASS] ${id}`);
  } catch (e) {
    failed.push(id);
    console.log(`[FAIL] ${id}: ${e?.message ?? e}`);
  }
};
const section = (title) => console.log(`\n=== ${title} ===`);

// OS ごとの期待の項目（設計 §3.4 の表の 1 行 1 項目。OS で分けるのは (g1)〜(g4)・(i) の一部・(k) の EACCES だけ）
const POSIX_EXPECTED = [
  "a1", "a2", "a3",
  "b1", "b2",
  "c1", "c2",
  "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8",
  "e1",
  "f1", "f2",
  "h1", "h2",
  "i1", "i2", "i3", "i4", "i5", "i6", "i7", "i8",
  "j1", "j2",
  "k1", "k2",
];
const WIN_EXPECTED = [
  "a1", "a2", "a3",
  "b1", "b2",
  "c1", "c2",
  "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8",
  "e1",
  "f1", "f2",
  "h1", "h2",
  "i1", "i2", "i3", "i4", "i5", "i9",
  "j1", "j2",
  "g1", "g2", "g3", "g4",
  "k3",
];
const EXPECTED = isWin ? WIN_EXPECTED : POSIX_EXPECTED;

const localHeaders = localResponseHeaders();
const hasLocalHeaders = (res) => Object.entries(localHeaders).every(([k, v]) => res.headers.get(k) === v);
const bodyOf = (res) => res.text();

// ディレクトリのリンク（Windows はジャンクション。Node の lstat はどちらも isSymbolicLink() が真）
const linkDir = (target, linkPath) => symlink(target, linkPath, isWin ? "junction" : "dir");
const linkFile = (target, linkPath) => symlink(target, linkPath, isWin ? "file" : "file");

// 数える fs（(i)。realpath・lstat・readlink の呼び出しを記録してから本物へ渡す）
function countingFs() {
  const calls = [];
  return {
    calls,
    fs: {
      realpath: (p) => {
        calls.push({ kind: "realpath", p });
        return realpath(p);
      },
      lstat: (p) => {
        calls.push({ kind: "lstat", p });
        return lstat(p);
      },
      readlink: (p) => {
        calls.push({ kind: "readlink", p });
        return readlink(p);
      },
    },
  };
}

const work = await mkdtemp(path.join(process.env.RUNNER_TEMP || process.env.TMPDIR || os.tmpdir(), "nov26-m7-t7-smoke-"));
const save = path.join(work, "save");
const outside = path.join(work, "outside");
const dist = path.join(work, "dist");
const rootlink = path.join(work, "rootlink");
const noperm = path.join(save, "noperm.png");
const warns = [];

function makeHandler(localRoots, extra = {}) {
  return createAppSchemeHandler({
    getRoots: () => ({ bundleRoots: [dist], localRoots }),
    fetchFile: async (p) => new Response(await readFile(p)),
    warn: (...args) => warns.push(args.join(" ")),
    ...extra,
  });
}

console.log(`nov26-m7-t7 smoke: platform=${process.platform} work=${work}`);

await mkdir(path.join(save, "tiles"), { recursive: true });
await mkdir(outside, { recursive: true });
await mkdir(dist, { recursive: true });
await writeFile(path.join(dist, "index.html"), "<!doctype html>");
await writeFile(path.join(save, "tiles", "0.png"), PNG);
await writeFile(path.join(save, "real.html"), "<!doctype html><title>real</title>");
await writeFile(path.join(save, "evil.js"), "window.__x = 1");
await writeFile(path.join(outside, "secret.png"), PNG);
await writeFile(noperm, PNG);
await linkDir(outside, path.join(save, "link-out"));
await linkDir(path.join(save, "tiles"), path.join(save, "link-in"));
await linkDir(save, rootlink);
await linkFile(path.join(outside, "secret.png"), path.join(save, "file-out.png"));
await linkFile(path.join(outside, "missing.png"), path.join(save, "broken-out.png"));
await linkFile(path.join(outside, "secret.png"), path.join(save, "live-out.png"));
await linkFile(path.join(save, "real.html"), path.join(save, "alias.png"));
await linkFile(path.join(save, "evil.js"), path.join(save, "innocent.png"));
await linkFile(path.join(save, "nowhere"), path.join(save, "dangling.png"));
await linkFile(path.join(save, "b"), path.join(save, "a"));
await linkFile(path.join(outside, "missing.png"), path.join(save, "b"));
await linkFile(path.join(save, "loop"), path.join(save, "loop"));

const handler = makeHandler([save]);
const request = (u) => handler(new Request(u));

// --- (a) 外を指すリンク ---
section("(a) 外を指すリンクは 403");
await item("a1", async () => {
  const res = await request(localFileUrl(path.join(save, "link-out")));
  assert.equal(res.status, 403, "外を指すディレクトリのリンクそのものは 403");
});
await item("a2", async () => {
  warns.length = 0;
  const res = await request(localFileUrl(path.join(save, "link-out", "secret.png")));
  assert.equal(res.status, 403, "外を指すリンク越しの既存ファイルは 403");
  assert.ok(hasLocalHeaders(res), "403 にも local の防御ヘッダを付ける");
  assert.equal(await bodyOf(res), "Forbidden");
  assert.equal(warns.length, 1, "字面ではルートの配下だが実体が外（link-escapes）は warn を 1 件残す");
  assert.match(warns[0], /link-escapes/);
});
await item("a3", async () => {
  warns.length = 0;
  const res = await request(localFileUrl(path.join(save, "file-out.png")));
  assert.equal(res.status, 403, "外を指すファイルのリンクは 403");
});

// --- (b) 中を指すリンク ---
section("(b) 中を指すリンクは 200（MIME は要求側）");
await item("b1", async () => {
  const res = await request(localFileUrl(path.join(save, "link-in", "0.png")));
  assert.equal(res.status, 200, "中を指すディレクトリのリンク越しは 200");
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.ok(hasLocalHeaders(res));
});
await item("b2", async () => {
  const res = await request(localFileUrl(path.join(save, "alias.png")));
  assert.equal(res.status, 200, "中を指すファイルのリンク（実体は .html）は 200");
  assert.equal(res.headers.get("content-type"), "image/png", "MIME は実体でなく要求側（字面）の拡張子で決める");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

// --- (c) ルートそのものがリンク ---
section("(c) 許可ルートそのものがリンクでも通す（J-8）");
const rootlinkHandler = makeHandler([rootlink]);
await item("c1", async () => {
  const res = await rootlinkHandler(new Request(localFileUrl(path.join(rootlink, "tiles", "0.png"))));
  assert.equal(res.status, 200, "ルートの字面（リンク）越しの要求は 200");
});
await item("c2", async () => {
  const res = await rootlinkHandler(new Request(localFileUrl(path.join(save, "tiles", "0.png"))));
  assert.equal(res.status, 200, "ルートの実体の表記でも 200");
});

// --- (d) 欠損・外の欠損・壊れたリンク ---
section("(d) 欠損と外（存在の有無を外へ漏らさない）");
await item("d1", async () => {
  warns.length = 0;
  const res = await request(localFileUrl(path.join(save, "tiles", "9", "9.png")));
  assert.equal(res.status, 404, "ルート内の欠損は 404");
  assert.ok(hasLocalHeaders(res));
  assert.equal(warns.length, 0, "欠損は正常系（MaplatCore は範囲外タイルも要求する）ので warn しない");
});
await item("d2", async () => {
  warns.length = 0;
  const res = await request(localFileUrl(path.join(outside, "none.png")));
  assert.equal(res.status, 403, "ルートの外の欠損ファイルも 403（外の有無を漏らさない）");
});
const signature = async (res) => ({
  status: res.status,
  csp: res.headers.get("content-security-policy"),
  nosniff: res.headers.get("x-content-type-options"),
  body: await bodyOf(res),
});
let brokenSig = null;
await item("d3", async () => {
  const res = await request(localFileUrl(path.join(save, "broken-out.png")));
  assert.equal(res.status, 403, "外を指す壊れたリンクは 403（MIN-10）");
  brokenSig = await signature(res);
});
await item("d4", async () => {
  const res = await request(localFileUrl(path.join(save, "live-out.png")));
  assert.equal(res.status, 403, "外を指す生きたリンクも 403");
  assert.deepEqual(await signature(res), brokenSig, "壊れたリンクと生きたリンクの応答（status・ヘッダ・本文）は同じ");
});
await item("d5", async () => {
  const res = await request(localFileUrl(path.join(save, "link-out", "none.png")));
  assert.equal(res.status, 403, "外を指す生きたディレクトリのリンクの下の無いファイルは 403");
});
await item("d6", async () => {
  warns.length = 0;
  const res = await request(localFileUrl(path.join(save, "dangling.png")));
  assert.equal(res.status, 404, "中を指す壊れたリンクは 404（既存の ff smoke [4] の dangling.png と同じ）");
  assert.equal(warns.length, 0);
});
await item("d7", async () => {
  const res = await request(localFileUrl(path.join(save, "a")));
  assert.equal(res.status, 403, "リンクの連鎖（a → b → 外の欠損）は 403");
});
await item("d8", async () => {
  const res = await request(localFileUrl(path.join(save, "loop")));
  assert.equal(res.status, 403, "自分を指す輪は 403（budget で止まる）");
});

// --- (e) `..` が畳まれた後に外 ---
section("(e) URL の正規化で外へ出る要求");
await item("e1", async () => {
  warns.length = 0;
  // URL に `..` をそのまま書く（URL の正規化で畳まれた後に外を指す。path.join で先に畳ませない）
  const raw = `${localFileUrl(path.join(save, "link-out"))}/../../outside/secret.png`;
  assert.match(new URL(raw).pathname, /\/outside\/secret\.png$/, "URL の正規化で `..` が畳まれて外を指す");
  const res = await request(raw);
  assert.equal(res.status, 403, "`..` が畳まれて外を指す要求は 403");
  assert.equal(warns.length, 0, "字面でも外なら warn しない");
});

// --- (f) 存在しないルート ---
section("(f) 存在しない許可ルートは許可しない");
const notYet = path.join(save, "not-yet");
const notYetHandler = makeHandler([notYet]);
await item("f1", async () => {
  warns.length = 0;
  const res = await notYetHandler(new Request(localFileUrl(path.join(notYet, "x.png"))));
  assert.equal(res.status, 403, "存在しない許可ルートの下の要求は 404 でなく 403");
  assert.equal(warns.length, 0, "無いルートに warn しない");
});
await item("f2", async () => {
  await mkdir(notYet, { recursive: true });
  await writeFile(path.join(notYet, "x.png"), PNG);
  const res = await notYetHandler(new Request(localFileUrl(path.join(notYet, "x.png"))));
  assert.equal(res.status, 200, "後から作ったルートの下は 200（ルートは要求ごとに実体で判定する）");
});

// --- (h) 実体が .js のリンク ---
section("(h) スクリプトの拒否を実体側にも広げる");
await item("h1", async () => {
  warns.length = 0;
  const res = await request(localFileUrl(path.join(save, "innocent.png")));
  assert.equal(res.status, 403, "実体が .js のリンク（要求は .png）は 403");
  assert.equal(warns.length, 1);
});
await item("h2", async () => {
  const res = await request(localFileUrl(path.join(save, "evil.js")));
  assert.equal(res.status, 403, "ローカルの .js を直接は 403（既存の oct26-m4-t6 MAJ-1 案 B）");
});

// --- (i) 形で落ちる要求は fs に触れない（MAJ-3） ---
section("(i) 形で落ちる要求は fs に触れずに 403");
const saveReal = await realpath(save);
async function assertShapeReject(url) {
  const counter = countingFs();
  const h = makeHandler([save], { fs: counter.fs });
  const res = await h(new Request(url));
  assert.equal(res.status, 403, `形で落ちる要求（${url}）は 403`);
  // 記録されてよいのはルートの realpath（(1)）だけ。候補・祖先・リンクの先への呼び出しは 0
  const allowed = new Set([save, saveReal]);
  const offenders = counter.calls.filter((c) => !(c.kind === "realpath" && allowed.has(c.p)));
  assert.deepEqual(offenders, [], `形で落ちる要求（${url}）で候補・祖先・リンクの先に fs が触れた`);
}
await item("i1", () => assertShapeReject("app://bundle/__local//host/share/x.png"));
await item("i2", () => assertShapeReject("app://local//host/share/x.png"));
await item("i3", () => assertShapeReject("app://bundle/__local//%3F/C:/x.png"));
await item("i4", () => assertShapeReject("app://bundle/__local//./pipe/x"));
await item("i5", () => assertShapeReject("app://bundle/__local/\\\\host\\share\\x.png"));
if (!isWin) {
  await item("i6", () => assertShapeReject(localFileUrl("/net/x/y.png")));
  await item("i7", () => assertShapeReject(localFileUrl("/Volumes/nov26-m7-t7-none/y.png")));
  await item("i8", () => assertShapeReject(localFileUrl("/Network/x.png")));
} else {
  // Windows: ルートの無いドライブ（runner に無いドライブ文字を選ぶ）
  await item("i9", async () => {
    const used = (saveReal.match(/^([A-Za-z]):/) ?? [])[1]?.toLowerCase();
    const orphan = ["b", "e", "f", "g", "h"].find((d) => d !== used);
    await assertShapeReject(localFileUrl(`${orphan.toUpperCase()}:/x.png`));
  });
}

// --- (j) 形の検査の純関数（win32 の規則も macOS で測る） ---
section("(j) localPathShape の純関数");
await item("j1", async () => {
  const winRoots = ["C:\\Save"];
  for (const p of ["\\\\host\\share\\x", "//host/share/x", "\\\\?\\C:\\x", "\\\\.\\pipe\\x", "Z:\\x"]) {
    assert.equal(localPathShape(p, winRoots, "win32"), "reject", `win32: ${p} は reject`);
  }
  // 【NOV26-IR-M7-T7-0445 MAJOR-1】区切りが 3 つ並ぶ UNC 形は、cwd が許可ルートと同じドライブでも reject
  const realCwd = process.cwd;
  try {
    process.cwd = () => "C:\\work";
    for (const p of ["/\\\\host\\share\\x", "//\\host\\share\\x", "/x", "\\x"]) {
      assert.equal(localPathShape(p, winRoots, "win32"), "reject", `win32: ${p} は cwd が C: でも reject`);
    }
  } finally {
    process.cwd = realCwd;
  }
  assert.equal(localPathShape("c:\\save\\x", winRoots, "win32"), "ok", "win32: 大文字小文字を区別しない");
  assert.equal(localPathShape("C:\\Save\\x", winRoots, "win32"), "ok");
  assert.equal(localPathShape("C:\\x", [], "win32"), "reject", "win32: ルートが空なら reject");
});
await item("j2", async () => {
  const posixRoots = ["/var/folders/ab/T/x/save"];
  for (const p of ["/net/h/x", "/Volumes/s/x", "/Network/x", "/etc/hosts"]) {
    assert.equal(localPathShape(p, posixRoots, "darwin"), "reject", `posix: ${p} は reject`);
  }
  // ルートの字面と実体（/var → /private/var）の両方を渡す（§3.1 (0)）
  const both = [posixRoots[0], "/private/var/folders/ab/T/x/save"];
  assert.equal(localPathShape("/private/var/folders/ab/T/x/save/a.png", both, "darwin"), "ok", "実体側の表記でも通す");
  assert.equal(localPathShape("/var/folders/ab/T/x/save/a.png", both, "darwin"), "ok", "字面側の表記でも通す");
  assert.equal(localPathShape("/Volumes/s/x", ["/Volumes"], "darwin"), "ok", "ルートが 1 段なら 1 段だけ比べる");
  assert.equal(localPathShape("/etc/x", [], "darwin"), "reject", "posix: ルートが空なら reject");
});

// --- (g) Windows のみ（skip の経路を持たない） ---
if (isWin) {
  section("(g) Windows の表記の揺れ（大文字小文字・8.3 名・ドライブ文字・ジャンクション）");
  const withUpperDrive = (p) => p.replace(/^([a-z]):/, (_, d) => `${d.toUpperCase()}:`);
  const withLowerDrive = (p) => p.replace(/^([A-Z]):/, (_, d) => `${d.toLowerCase()}:`);
  await item("g1", async () => {
    // 許可ルートを大文字小文字の違う表記で渡し、元の表記の URL で要求する
    const res = await makeHandler([save.toUpperCase()])(new Request(localFileUrl(path.join(save, "tiles", "0.png"))));
    assert.equal(res.status, 200, "ルートの表記（大文字小文字）が URL と違っても 200");
  });
  await item("g2", async () => {
    const longDir = path.join(save, "LongDirectoryName-tiles");
    await mkdir(path.join(longDir, "0"), { recursive: true });
    await writeFile(path.join(longDir, "0", "0.png"), PNG);
    const shortOut = execFileSync("cmd", ["/d", "/c", `for %I in ("${longDir}") do @echo %~sI`], { encoding: "utf8" }).trim();
    if (!shortOut || shortOut.toLowerCase() === longDir.toLowerCase()) {
      throw new Error(
        `8.3 名を得られない（${longDir} → ${shortOut || "(空)"}）。fsutil 8dot3name で有効にした場所で測ること`,
      );
    }
    const longUrl = localFileUrl(path.join(longDir, "0", "0.png"));
    const shortUrl = localFileUrl(path.join(shortOut, "0", "0.png"));
    // 失敗したときに Windows の実測が残るよう、realpath の結果と warn を添える
    const diag = async () =>
      JSON.stringify({
        shortOut,
        longDir,
        longUrl,
        realShort: await realpath(shortOut).catch((e) => `ERR ${e.code}`),
        realLongFile: await realpath(path.join(longDir, "0", "0.png")).catch((e) => `ERR ${e.code}`),
        nativeOfLongUrl: appUrlToLocalPath(longUrl),
        warns: warns.slice(-3),
      });
    {
      const st = (await makeHandler([shortOut])(new Request(longUrl))).status;
      if (st !== 200) assert.fail(`短い名前のルート × 長い名前の URL: ${st} !== 200 ${await diag()}`);
    }
    assert.equal((await makeHandler([longDir])(new Request(shortUrl))).status, 200, "長い名前のルート × 短い名前の URL");
  });
  await item("g3", async () => {
    const res = await makeHandler([withLowerDrive(save)])(new Request(localFileUrl(withUpperDrive(path.join(save, "tiles", "0.png")))));
    assert.equal(res.status, 200, "ルートを小文字のドライブ文字で渡し、大文字の URL で要求しても 200");
  });
  await item("g4", async () => {
    // (a)(c) をジャンクションで（本節の fixture は isWin のとき linkDir がジャンクションを作る）
    const junctionOut = await lstat(path.join(save, "link-out"));
    const junctionRoot = await lstat(rootlink);
    assert.ok(junctionOut.isSymbolicLink(), "link-out はジャンクション（lstat で isSymbolicLink が真）");
    assert.ok(junctionRoot.isSymbolicLink(), "rootlink はジャンクション");
    assert.equal((await request(localFileUrl(path.join(save, "link-out", "secret.png")))).status, 403, "ジャンクション越しの外は 403");
    assert.equal(
      (await rootlinkHandler(new Request(localFileUrl(path.join(rootlink, "tiles", "0.png"))))).status,
      200,
      "ジャンクションのルート越しは 200",
    );
  });
} else if (windowsRequired) {
  failed.push("windows-required");
  console.log("[FAIL] NOV26_M7_T7_WINDOWS_REQUIRED=1 だが process.platform が win32 でない（Windows の項目を実行できない）");
}

// --- (k) 既存の形の回帰 ---
section("(k) 既存の形の回帰（EACCES・外の実在ファイル）");
if (!isWin) {
  await item("k1", async () => {
    await chmod(noperm, 0o000);
    warns.length = 0;
    const res = await request(localFileUrl(noperm));
    assert.equal(res.status, 403, "EACCES は 404 に畳まず 403");
    assert.equal(warns.length, 1, "EACCES は warn を残す");
    assert.match(warns[0], /EACCES/);
  });
  await item("k2", async () => {
    const res = await request(localFileUrl("/etc/hosts"));
    assert.equal(res.status, 403, "ルートの外の実在ファイルは 403");
  });
} else {
  console.log("[INFO] (k1) EACCES の項は POSIX のみ: Windows の chmod は読み取り専用属性しか変えられず EACCES を作れない。");
  console.log("       代わりに (k3) で「ルートの外の実在ファイルは 403」を確かめる（設計 §3.4「既存の形」の OS 分け）。");
  await item("k3", async () => {
    warns.length = 0;
    const res = await request(localFileUrl(path.join(outside, "secret.png")));
    assert.equal(res.status, 403, "ルートの外の実在ファイルは 403");
    assert.ok(hasLocalHeaders(res));
  });
}

// --- resolveLocalReal を直接呼べる（handler 経由だけでなく公開 API として成立する） ---
{
  const direct = await resolveLocalReal(path.join(outside, "secret.png"), [save]);
  assert.equal(direct.ok, false, "ルートの外は ok:false");
  assert.equal(direct.status, 403);
  const inside = await resolveLocalReal(path.join(save, "tiles", "0.png"), [save]);
  assert.equal(inside.ok, true, "ルートの中は ok:true");
  assert.equal(inside.realPath, path.join(saveReal, "tiles", "0.png"), "realPath は実体");
  assert.equal(inside.lexicalPath, path.join(save, "tiles", "0.png"), "lexicalPath は字面");
}

// --- 結果の集約（走査 0 件の合格を作らない） ---
await chmod(noperm, 0o644).catch(() => {});
section("まとめ");
const missing = EXPECTED.filter((id) => !passed.includes(id));
const unexpected = passed.filter((id) => !EXPECTED.includes(id));
if (missing.length) console.log(`[FAIL] 実行されなかった項目（期待 ${EXPECTED.length} 件）: ${missing.join(", ")}`);
if (unexpected.length) console.log(`[FAIL] 期待に無い項目: ${unexpected.join(", ")}`);
if (failed.length) console.log(`[FAIL] 失敗した項目: ${failed.join(", ")}`);
if (missing.length || unexpected.length || failed.length) {
  console.log(`\nnov26-m7-t7 smoke: NG（platform=${process.platform} 実行 ${passed.length}/${EXPECTED.length} 件・失敗 ${failed.length} 件）`);
  process.exitCode = 1;
} else {
  console.log(`\nnov26-m7-t7 smoke: OK（platform=${process.platform} 実行 ${passed.length}/${EXPECTED.length} 件）`);
}


