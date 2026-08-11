// M12-T1 smoke: edgeSplitMath 純粋関数（旧版 mapedit.js:405-489 の計算部移植）。
// m11-t11-geo-estimate 型: vite lib build → node assert で純粋関数を検証する。
// シナリオ:
//   (a) 中間 node なし・中央クリック: ratio=0.5 で反対側が線形補間される
//   (b) 中間 node あり: node を含むポリライン上の最近セグメントと比率が旧版式どおり計算される
//   (c) 分割 node 分配: thisPrev/thisLast/thatPrev/thatLast が旧版の slice 規則どおり
//   (d) EDGE_ZERO_LENGTH: 端点同一（全長0）では mutation せず error code を返す
//   (e) INVALID_COORDINATE_ARRAY: 構造不正（null node / 非配列 xy / 要素欠落）を検出する
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, ".tmp-smoke");
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, "edge-split-"));
const outDir = path.join(workDir, "dist");

try {
  await build({
    root: projectRoot,
    logLevel: "error",
    configFile: false,
    build: {
      outDir,
      emptyOutDir: true,
      lib: {
        entry: path.join(projectRoot, "src/utils/edgeSplitMath.ts"),
        formats: ["es"],
        fileName: () => "edgeSplitMath.mjs",
      },
      rollupOptions: { external: [] },
    },
  });

  const bundleUrl = pathToFileURL(path.join(outDir, "edgeSplitMath.mjs")).href;
  const { edgeSplit } = await import(bundleUrl);
  assert.equal(typeof edgeSplit, "function", "edgeSplit を export すること");

  // (a) 中間 node なし・中央クリック → ratio 0.5 で反対側補間
  {
    const result = edgeSplit({
      thisNodes: [],
      thatNodes: [],
      thisEnd1: [0, 0],
      thisEnd2: [100, 0],
      thatEnd1: [1000, 1000],
      thatEnd2: [1100, 1000],
      xy: [50, 0],
    });
    assert.deepEqual(result.ok, true, JSON.stringify(result));
    if (result.ok) {
      assert.deepEqual(result.thatXy, [1050, 1000], "反対側は ratio 0.5 で補間されるはず");
      assert.deepEqual(result.thisPrevNodes, []);
      assert.deepEqual(result.thisLastNodes, []);
      assert.deepEqual(result.thatPrevNodes, []);
      assert.deepEqual(result.thatLastNodes, []);
    }
    console.log("ok: (a) midpoint click interpolates the opposite side by ratio");
  }

  // (b) 中間 node あり: 旧版式の最近セグメント（垂直距離）と nearestLength 計算。
  //   this 側ポリライン: [0,0] → [50,40] → [100,0]（中間 node [50,40]）。
  //   xy=[50,10] はセグメント2([50,40]-[100,0]) との距離が最小ではなくセグメント1直上。
  //   セグメント1 ([0,0]-[50,40]) 上の xy への垂線距離は 30（線 x*0.8=y に対し |40*50-50*10|/sqrt(40^2+50^2)）。
  {
    const result = edgeSplit({
      thisNodes: [[50, 40]],
      thatNodes: [[1050, 1040]],
      thisEnd1: [0, 0],
      thisEnd2: [100, 0],
      thatEnd1: [1000, 1000],
      thatEnd2: [1100, 1000],
      xy: [50, 10],
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok) {
      // 手計算（旧版式の逐語移植）:
      // seg1: length=sqrt(50^2+40^2)=64.031、distance=|40*50-50*10|/64.031=1500/64.031=23.426
      //   nearestIndex=1、nearestLength=0+sqrt(50^2+10^2)=50.990
      // seg2: prev=[50,40]、length=64.031、distance=|(-40)*50-50*10+50*0-40*(-100)|/64.031
      //        =|-2000-500+4000|/64.031=1500/64.031=23.426 → nearest 更新なし（strict <）
      // nearestRatio = 50.990 / 128.062 = 0.39817...
      // that 側ポリライン: [1000,1000] → [1050,1040] → [1100,1000]、全長 128.062
      // thatLengthToXy = 50.990 → seg1 上で localRatio = 50.990/64.031 = 0.79634...
      // thatXy = [1000+50*0.79634, 1000+40*0.79634] ≈ [1039.817, 1031.854]
      assert.ok(Math.abs(result.thatXy[0] - 1039.817) < 0.01, `thatXy[0]: ${result.thatXy[0]}`);
      assert.ok(Math.abs(result.thatXy[1] - 1031.854) < 0.01, `thatXy[1]: ${result.thatXy[1]}`);
    }
    console.log("ok: (b) nearest segment + ratio follow the legacy formula");
  }

  // (c) 分割 node 分配: 旧版の slice 規則どおり前後 node が分配される
  {
    // this 側は非直線ポリライン [0,0] → [30,30] → [70,0] → [100,0]、xy=[55,10]。
    // 旧版式は「無限直線への垂直距離」のため、直線ポリラインでは全セグメント同距離になる。
    // セグメント2 ([30,30]-[70,0]) への距離が最小（≈1）で nearestIndex=2 になるケース
    const result = edgeSplit({
      thisNodes: [[30, 30], [70, 0]],
      thatNodes: [[1030, 1000], [1070, 1000]],
      thisEnd1: [0, 0],
      thisEnd2: [100, 0],
      thatEnd1: [1000, 1000],
      thatEnd2: [1100, 1000],
      xy: [55, 10],
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok) {
      // 手計算（旧版式の逐語移植）:
      //   nearestLength = seg1長(42.4264) + |[55,10]-[30,30]|(32.0156) = 74.442
      //   ratio = 74.442 / 全長(122.4264) = 0.60805
      assert.deepEqual(result.thisPrevNodes, [[30, 30]]);
      assert.deepEqual(result.thisLastNodes, [[70, 0]]);
      // that 側全長 100、thatLengthToXy=60.805 → seg2 で localRatio=0.7701 → thatXy=[1060.805,1000]
      assert.ok(Math.abs(result.thatXy[0] - 1060.805) < 0.01, `thatXy[0]: ${result.thatXy[0]}`);
      assert.ok(Math.abs(result.thatXy[1] - 1000) < 0.01, `thatXy[1]: ${result.thatXy[1]}`);
      assert.deepEqual(result.thatPrevNodes, [[1030, 1000]]);
      assert.deepEqual(result.thatLastNodes, [[1070, 1000]]);
    }
    console.log("ok: (c) node split distribution follows the legacy slice rules");
  }

  // (d) EDGE_ZERO_LENGTH: 端点同一
  {
    const result = edgeSplit({
      thisNodes: [],
      thatNodes: [],
      thisEnd1: [50, 50],
      thisEnd2: [50, 50],
      thatEnd1: [1000, 1000],
      thatEnd2: [1000, 1000],
      xy: [50, 50],
    });
    assert.deepEqual(result, { ok: false, code: "EDGE_ZERO_LENGTH" });
    console.log("ok: (d) zero-length polyline returns EDGE_ZERO_LENGTH");
  }

  // (e) INVALID_COORDINATE_ARRAY
  {
    for (const bad of [
      { thisNodes: [null], thatNodes: [], thisEnd1: [0, 0], thisEnd2: [1, 1], thatEnd1: [0, 0], thatEnd2: [1, 1], xy: [0, 0] },
      { thisNodes: [], thatNodes: [], thisEnd1: [0, 0], thisEnd2: [1, 1], thatEnd1: [0, 0], thatEnd2: [1, 1], xy: null },
      { thisNodes: [[0]], thatNodes: [], thisEnd1: [0, 0], thisEnd2: [1, 1], thatEnd1: [0, 0], thatEnd2: [1, 1], xy: [0, 0] },
    ]) {
      // @ts-expect-error 検証用の不正入力
      const result = edgeSplit(bad);
      assert.deepEqual(result, { ok: false, code: "INVALID_COORDINATE_ARRAY" }, JSON.stringify(bad));
    }
    console.log("ok: (e) malformed structures return INVALID_COORDINATE_ARRAY");
  }

  console.log("m12-t1 edge-split smoke: ALL PASS");
} finally {
  await rm(workDir, { recursive: true, force: true });
}

// --- Part 2: parity 監査台帳（AC1/AC2/AC3）---
// AC1: 台帳が全領域を網羅し、全行に旧版・現行参照と判定根拠がある
// AC2: intentionally_removed 行に設計文書の証跡がある
// AC3: missing 行があれば audit_finding_id 付き task が nayuta-state.json に登録されている
{
  const auditPath = path.join(projectRoot, '..', 'docs', 'superpowers', 'reviews', '2026-07-18-m12-t1-modernized-parity-audit.md');
  const audit = await readFile(auditPath, 'utf8');
  const sections = ['## MapList 領域', '## MapEdit 領域', '## AppList / App 領域', '## Settings 領域', '## Import / Export 領域', '## IPC / menu 領域', '## Backend 領域'];
  for (const section of sections) {
    assert.ok(audit.includes(section), `台帳に領域セクション ${section} があること`);
  }
  // 全行が 旧版参照・現行版参照・判定・根拠 の4列を持つこと（台帳表形式の検査）
  const dataRows = audit.split('\n').filter((line) => /^\| (ML|ME|AP|ST|IO|IP|BE)-\d+ /.test(line));
  assert.ok(dataRows.length >= 40, `台帳に40行以上の監査行があること（実績: ${dataRows.length}）`);
  for (const row of dataRows) {
    const cells = row.split('|').map((c) => c.trim()).filter((c) => c !== '');
    assert.ok(cells.length >= 5, `監査行が必須列を持つこと: ${row.slice(0, 60)}`);
    const judgment = cells[3];
    assert.ok(
      ['ported', 'fulfilled_differently', 'intentionally_removed', 'missing', 'human_decision_required'].some((j) => judgment.includes(j)),
      `判定が分類語彙に属すること: ${judgment}`,
    );
    assert.ok(cells[4].length > 0, `根拠が記載されていること: ${cells[0]}`);
  }
  console.log('ok: AC1 audit ledger covers all areas with references and rationale');

  // AC2: intentionally_removed 行に設計文書の参照がある
  const removedRows = dataRows.filter((row) => row.includes('intentionally_removed'));
  assert.ok(removedRows.length >= 3, `intentionally_removed 行が3件以上あること（実績: ${removedRows.length}）`);
  for (const row of removedRows) {
    assert.ok(/20\d{2}-\d{2}-\d{2}-[a-z0-9-]+\.md/.test(row), `intentionally_removed 行に設計文書参照があること: ${row.slice(0, 80)}`);
  }
  console.log('ok: AC2 intentionally_removed rows cite design documents');

  // AC3: missing 行の後続 task 登録。判定列が厳密に `missing` の行のみを未解消とみなす
  // （`missing → 本タスクで解消` や根拠文中の "missing" 文字列は未解消に含めない）。
  // 本台帳では m12-t1 解消の1件のみで、M12-T5 以降への登録対象は 0 件
  const statePath = path.join(projectRoot, '..', 'docs', 'superpowers', 'state', 'nayuta-state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const m12Tasks = state.milestones.m12.tasks;
  // audit_finding_id は後続の別監査 (M12-T3 人間検証の F1〜F10、m12-t4 セキュリティレビューの
  // m12-t4-sec-* 等) からも登録される。本台帳 (m12-t1 parity audit) と対応検査するのは
  // 本台帳の行 ID 語彙 (ML|ME|AP|ST|IO|IP|BE)-n に一致する finding のみ
  const LEDGER_FINDING_ID = /^(ML|ME|AP|ST|IO|IP|BE)-\d+$/;
  const auditRegistered = (Array.isArray(m12Tasks) ? m12Tasks : Object.values(m12Tasks))
    .filter((t) => t.audit_finding_id && LEDGER_FINDING_ID.test(t.audit_finding_id));
  const unresolvedMissing = dataRows.filter((row) => {
    const cells = row.split('|').map((c) => c.trim()).filter((c) => c !== '');
    return cells[3] === 'missing' || cells[3] === '**missing**';
  });
  assert.equal(unresolvedMissing.length, 0, `未解消の missing 行がないこと（実績: ${unresolvedMissing.length}）`);
  for (const t of auditRegistered) {
    assert.ok(audit.includes(t.audit_finding_id), `audit_finding_id ${t.audit_finding_id} が台帳の missing 行と対応すること`);
  }
  console.log(`ok: AC3 missing registrations are consistent (unresolved missing: ${unresolvedMissing.length}, registered: ${auditRegistered.length})`);

  console.log('m12-t1 audit smoke: ALL PASS');
}
