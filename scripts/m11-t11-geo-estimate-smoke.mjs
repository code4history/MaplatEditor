import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, ".tmp-smoke");
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, "geo-estimate-"));
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
        entry: path.join(projectRoot, "src/utils/geoEstimate.ts"),
        formats: ["es"],
        fileName: () => "geoEstimate.mjs",
      },
      rollupOptions: { external: [] },
    },
  });

  // Vite lib build outputs ESM file in outDir; import with file URL.
  const bundlePath = path.join(outDir, "geoEstimate.mjs");
  const bundleUrl = pathToFileURL(bundlePath).href;
  const { computeBboxAndCentroid, estimateZoomForBbox, unionBboxes, expandBboxByRatio, bboxToEnvelope } = await import(bundleUrl);

  // 1. 複数点の bbox / 重心
  {
    const result = computeBboxAndCentroid([
      [139.7, 35.6],
      [139.8, 35.7],
      [139.75, 35.65],
    ]);
    assert.ok(result);
    const [w, s, e, n] = result.bbox;
    assert.ok(w < e && s < n, "bbox は正しい範囲を持つ");
    assert.ok(w <= 139.7 && e >= 139.8, "経度の min/max を含む");
    assert.ok(s <= 35.6 && n >= 35.7, "緯度の min/max を含む");
    assert.ok(Math.abs(result.centroid[0] - 139.75) < 0.01, "重心の経度が平均に近い");
    assert.ok(Math.abs(result.centroid[1] - 35.65) < 0.01, "重心の緯度が平均に近い");
  }

  // 2. 1点のみ → 1km 相当の正方形 bbox + その点が重心
  {
    const result = computeBboxAndCentroid([[139.7, 35.6]]);
    assert.ok(result);
    const [w, s, e, n] = result.bbox;
    const width = e - w;
    const height = n - s;
    assert.ok(Math.abs(width - height) < 1e-6, "1点の場合は正方形 bbox");
    assert.ok(width > 0.008 && width < 0.01, "1km 程度の広がり (≈0.009°; lat 35° で 1km≈0.009°)");
    assert.equal(result.centroid[0], 139.7);
    assert.equal(result.centroid[1], 35.6);
  }

  // 3. 同一直線上の多点 → 退化した軸のみ拡張される
  {
    // 横長（緯度方向が退化）
    const result = computeBboxAndCentroid([
      [139.7, 35.6],
      [139.8, 35.6],
    ]);
    assert.ok(result);
    const [w, s, e, n] = result.bbox;
    const width = e - w;
    const height = n - s;
    assert.ok(Math.abs(width - 0.1) < 1e-6, "経度幅は元の 0.1° を維持");
    assert.ok(Math.abs(height - 0.009) < 1e-6, "緯度幅は 1km 相当に拡張される");
    assert.ok(Math.abs(result.centroid[1] - 35.6) < 1e-6, "重心の緯度は元の中心");

    // 縦長（経度方向が退化）
    const result2 = computeBboxAndCentroid([
      [139.7, 35.6],
      [139.7, 35.7],
    ]);
    assert.ok(result2);
    const width2 = result2.bbox[2] - result2.bbox[0];
    const height2 = result2.bbox[3] - result2.bbox[1];
    assert.ok(Math.abs(width2 - 0.009) < 1e-6, "経度幅は 1km 相当に拡張される");
    assert.ok(Math.abs(height2 - 0.1) < 1e-6, "緯度幅は元の 0.1° を維持");
  }

  // 4. 長方形（非退化）→ 元の bbox を維持
  {
    const result = computeBboxAndCentroid([
      [139.7, 35.6],
      [139.8, 35.6],
      [139.8, 35.7],
      [139.7, 35.7],
    ]);
    assert.ok(result);
    const [w, s, e, n] = result.bbox;
    assert.ok(Math.abs(e - w - 0.1) < 1e-6, "非退化の場合は元の経度幅");
    assert.ok(Math.abs(n - s - 0.1) < 1e-6, "非退化の場合は元の緯度幅");
  }

  // 5. zoom 推定: 幅の大小に応じた clamp
  {
    // 広域
    const zWorld = estimateZoomForBbox([-180, -90, 180, 90], 18);
    assert.equal(zWorld, 1, "全球は最小 zoom");
    // 狭域 (1km)
    const zNarrow = estimateZoomForBbox([139.7, 35.6, 139.709, 35.609], 18);
    assert.ok(zNarrow >= 15 && zNarrow <= 18, "1km 程度は高 zoom");
    // 南北長 bbox でも高い方に合わせてズーム
    const zTall = estimateZoomForBbox([139.7, 35.6, 139.705, 35.65], 18);
    assert.ok(zTall >= 12 && zTall <= 18, "南北長 bbox でも適切な zoom");
    // maxZoom clamp
    const zTiny = estimateZoomForBbox([139.7, 35.6, 139.7005, 35.6005], 16);
    assert.equal(zTiny, 16, "maxZoom を超えない");
  }

  // 6. bbox の union
  {
    const u = unionBboxes([
      [139.7, 35.6, 139.8, 35.7],
      [139.75, 35.65, 139.9, 35.8],
    ]);
    assert.deepEqual(u, [139.7, 35.6, 139.9, 35.8]);
    assert.equal(unionBboxes([]), null);
  }

  // 7. expandBboxByRatio
  {
    const expanded = expandBboxByRatio([139.7, 35.6, 139.8, 35.7], 0.05);
    const [w, s, e, n] = expanded;
    assert.ok(w < 139.7 && e > 139.8, "5% 外側に広がる");
    assert.ok(Math.abs((e - w) - (139.8 - 139.7) * 1.1) < 1e-5, "経度幅が 5%*2 拡張");
    assert.deepEqual(bboxToEnvelope([w, s, e, n]), [[w, s], [e, s], [e, n], [w, n]]);
  }

  console.log("m11-t11 smoke geoEstimate: OK");
} finally {
  await rm(workDir, { recursive: true, force: true });
}
