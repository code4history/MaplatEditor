/**
 * m19-t1 smoke test: preview viewer bundle の namespaceID 修正検証
 *
 * AC1: public/preview/maplat_ui.umd.js に showPoiLayer(\w+\.namespaceID) が含まれる
 * AC2: dist/preview/maplat_ui.umd.js に同修正が含まれる
 * AC3: （既存 E2E m12-t31 で検証 — この smoke では対象外）
 * AC4: pnpm build が成功する（build 前提でファイル存在確認）
 * AC5: maplat_ui.css が変更されない（MD5 比較: node_modules と public/preview）
 * AC6: pnpm-lock.yaml の @maplat/ui lock pin が 6503813e から更新されている
 * AC7: pnpm-lock.yaml の @maplat/core lock pin が 84c09697 から更新されている
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);

async function md5(filePath) {
  const buf = await readFile(filePath);
  return crypto.createHash("md5").update(buf).digest("hex");
}

async function grepFile(filePath, pattern) {
  const content = await readFile(filePath, "utf8");
  return content.match(pattern) ?? null;
}

let passed = 0;
const total = 6;

// AC1: public/preview/maplat_ui.umd.js に namespaceID 修正が含まれる
{
  const filePath = path.join(
    projectRoot,
    "public/preview/maplat_ui.umd.js"
  );
  const match = await grepFile(
    filePath,
    /showPoiLayer\([a-zA-Z0-9_]+\.namespaceID\)/
  );
  assert.ok(match, "AC1: public/preview に showPoiLayer(namespaceID) が含まれること");
  console.log("✅ AC1: public/preview/maplat_ui.umd.js に namespaceID 修正確認");
  passed++;
}

// AC2: dist/preview/maplat_ui.umd.js に namespaceID 修正が含まれる
{
  const filePath = path.join(
    projectRoot,
    "dist/preview/maplat_ui.umd.js"
  );
  const match = await grepFile(
    filePath,
    /showPoiLayer\([a-zA-Z0-9_]+\.namespaceID\)/
  );
  assert.ok(match, "AC2: dist/preview に showPoiLayer(namespaceID) が含まれること");
  console.log("✅ AC2: dist/preview/maplat_ui.umd.js に namespaceID 修正確認");
  passed++;
}

// AC4: pnpm build が成功している（dist/preview/maplat_ui.umd.js が存在・内容あり）
{
  const filePath = path.join(
    projectRoot,
    "dist/preview/maplat_ui.umd.js"
  );
  const stat = await readFile(filePath);
  assert.ok(
    stat.length > 0,
    "AC4: dist/preview/maplat_ui.umd.js が build 产物として存在する"
  );
  console.log("✅ AC4: pnpm build 产物の存在確認");
  passed++;
}

// AC5: maplat_ui.css が変更されない（MD5 一致）
{
  const publicCss = path.join(
    projectRoot,
    "public/preview/maplat_ui.css"
  );
  const nodeModulesCss = path.join(
    projectRoot,
    "node_modules/@maplat/ui/dist/maplat_ui.css"
  );
  const hashPublic = await md5(publicCss);
  const hashNodeModules = await md5(nodeModulesCss);
  assert.equal(
    hashPublic,
    hashNodeModules,
    "AC5: maplat_ui.css の MD5 が一致すること"
  );
  console.log("✅ AC5: maplat_ui.css MD5 一致確認");
  passed++;
}

// AC6: pnpm-lock.yaml の @maplat/ui lock pin が 6503813e から更新されている
{
  const lockContent = await readFile(
    path.join(projectRoot, "pnpm-lock.yaml"),
    "utf8"
  );
  assert.ok(
    !lockContent.includes("6503813e"),
    "AC6: pnpm-lock.yaml に旧 @maplat/ui pin (6503813e) が残っていないこと"
  );
  assert.ok(
    lockContent.includes("07ee37a5"),
    "AC6: pnpm-lock.yaml に新 @maplat/ui pin (07ee37a5) が含まれること"
  );
  console.log("✅ AC6: @maplat/ui lock pin 更新確認（6503813e → 07ee37a5）");
  passed++;
}

// AC7: pnpm-lock.yaml の @maplat/core lock pin が 84c09697 から更新されている
{
  const lockContent = await readFile(
    path.join(projectRoot, "pnpm-lock.yaml"),
    "utf8"
  );
  assert.ok(
    !lockContent.includes("84c09697"),
    "AC7: pnpm-lock.yaml に旧 @maplat/core pin (84c09697) が残っていないこと"
  );
  assert.ok(
    lockContent.includes("9b97eb5"),
    "AC7: pnpm-lock.yaml に新 @maplat/core pin (9b97eb5) が含まれること"
  );
  console.log("✅ AC7: @maplat/core lock pin 更新確認（84c09697 → 9b97eb5）");
  passed++;
}

console.log(`\n結果: ${passed}/${total} AC パス`);
console.log("AC3（既存 E2E m12-t31 回帰）は smoke 範囲外 — 別途実行してください");
