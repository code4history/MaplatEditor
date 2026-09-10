// oct26-m4-t2 AC-7 (#36): CI 成果物検証の fixture smoke。
// 設計書 docs/superpowers/specs/2026-09-10-oct26-m4-t2-design.md §7 AC-7「ローカル単体検証」。
//
// fake build-meta.json + fake installer/blockmap + latest*.yml の一時ディレクトリを作り、
// scripts/oct26-m4-t2-ci-artifact-verify.mjs を spawn して RED/GREEN を assert する。
// AC-7 自体は push 後の orchestrator 実行だが、契約の検出力は本 fixture smoke で単体証明する。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const VERIFIER = path.join(projectRoot, "scripts", "oct26-m4-t2-ci-artifact-verify.mjs");

const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"; // 40 桁 hex
const VER = "1.0.0";

// electron-builder の artifactName 命名（electron-builder.config.cjs 実測）に合わせた実在命名形。
// いずれも「-<version>-<arch>…」を含むため契約 (d) の -<version>- 判定を満たす。
const greenMeta = () => JSON.stringify({ editor_sha: SHA, version: VER });

function writeGreenFixtures(d) {
  writeFileSync(path.join(d, "build-meta.json"), greenMeta());
  const win = path.join(d, "win-artifacts", "release", VER);
  mkdirSync(win, { recursive: true });
  writeFileSync(path.join(win, `MaplatEditor-Windows-${VER}-x64-Setup.exe`), "fake-exe");
  writeFileSync(path.join(win, `MaplatEditor-Windows-${VER}-x64-Setup.exe.blockmap`), "fake-blockmap");
  const mac = path.join(d, "mac-artifacts", "release", VER);
  mkdirSync(mac, { recursive: true });
  writeFileSync(path.join(mac, `MaplatEditor-Mac-${VER}-arm64.dmg`), "fake-dmg");
  const linux = path.join(d, "linux-artifacts", "release", VER);
  mkdirSync(linux, { recursive: true });
  writeFileSync(path.join(linux, `MaplatEditor-Linux-${VER}-x64.AppImage`), "fake-appimage");
  writeFileSync(path.join(win, "latest.yml"), `version: ${VER}\nfiles:\n  - url: x.exe\n`);
  writeFileSync(path.join(mac, "latest-mac.yml"), `version: ${VER}\nfiles:\n  - url: x.dmg\n`);
  writeFileSync(path.join(linux, "latest-linux.yml"), `version: ${VER}\nfiles:\n  - url: x.AppImage\n`);
}

function run(dir) {
  return spawnSync(
    process.execPath,
    [VERIFIER, "--dir", dir, "--expected-sha", SHA, "--expected-version", VER],
    { encoding: "utf8" },
  );
}

const root = mkdtempSync(path.join(os.tmpdir(), "oct26-m4t2-artifact-verify-"));
try {
  // --- exact GREEN ---
  {
    const d = path.join(root, "green");
    mkdirSync(d, { recursive: true });
    writeGreenFixtures(d);
    const r = run(d);
    assert.equal(r.status, 0, `exact GREEN が exit 0 になるべき（${r.stderr}${r.stdout}）`);
    assert.match(r.stdout, /CI artifact verify OK/);
    console.log("  [GREEN] 成果物 + build-meta（SHA/version 一致）exact: PASS");
  }

  // --- RED (b): editor_sha 不一致 ---
  {
    const d = path.join(root, "red-b");
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "build-meta.json"), JSON.stringify({ editor_sha: "d".repeat(40), version: VER }));
    const r = run(d);
    assert.equal(r.status, 1, "(b) editor_sha 不一致は exit 1 になるべき");
    assert.match(r.stderr, /provenance|editor_sha/);
    console.log("  [RED(b)] editor_sha 不一致 → exit 1: PASS");
  }

  // --- RED (c): version 不一致 ---
  {
    const d = path.join(root, "red-c");
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "build-meta.json"), JSON.stringify({ editor_sha: SHA, version: "9.9.9" }));
    const r = run(d);
    assert.equal(r.status, 1, "(c) version 不一致は exit 1 になるべき");
    assert.match(r.stderr, /version 不一致/);
    console.log("  [RED(c)] version 不一致 → exit 1: PASS");
  }

  // --- RED: build-meta.json 欠落 ---
  {
    const d = path.join(root, "red-nometa");
    mkdirSync(d, { recursive: true });
    const r = run(d);
    assert.equal(r.status, 1, "build-meta.json 欠落は exit 1 になるべき");
    assert.match(r.stderr, /build-meta\.json/);
    console.log("  [RED] build-meta.json 欠落 → exit 1: PASS");
  }

  // --- RED (d): installer ファイル名が -<version>- を含まない（MIN-R3-1） ---
  {
    const d = path.join(root, "red-d");
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "build-meta.json"), greenMeta());
    const mac = path.join(d, "mac-artifacts");
    mkdirSync(mac, { recursive: true });
    writeFileSync(path.join(mac, "MaplatEditor-Mac-latest.dmg"), "fake-dmg"); // -1.0.0- を含まない
    const r = run(d);
    assert.equal(r.status, 1, "(d) installer ファイル名の版不一致は exit 1 になるべき");
    assert.match(r.stderr, /ファイル名/);
    console.log("  [RED(d)] installer ファイル名に -<version>- 無し → exit 1: PASS");
  }

  // --- RED (e): latest*.yml の version: 不一致（MIN-R3-1） ---
  {
    const d = path.join(root, "red-e");
    mkdirSync(d, { recursive: true });
    writeGreenFixtures(d);
    const win = path.join(d, "win-artifacts", "release", VER);
    writeFileSync(path.join(win, "latest.yml"), "version: 9.9.9\n");
    const r = run(d);
    assert.equal(r.status, 1, "(e) latest*.yml の version 不一致は exit 1 になるべき");
    assert.match(r.stderr, /version 不一致/);
    console.log("  [RED(e)] latest*.yml の version: 不一致 → exit 1: PASS");
  }

  console.log("=== AC-7 契約 fixture smoke: GREEN 1 + RED 5: PASS ===");
} finally {
  rmSync(root, { recursive: true, force: true });
}