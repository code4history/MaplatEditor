// 経緯度の直接入力の検査（src/utils/envelopeCoordInput.ts）の smoke。
// 小窓（EnvelopeEditorModal）と AppSourceEditor が共有する検査そのものを、
// どちらの画面も起動せずに確かめる。既存 smoke と同じ Vite lib build + import の方式。
//
// 使い方: node scripts/envelope-coord-input-smoke.mjs
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, ".tmp-smoke");
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, "envelope-coord-input-"));
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
        entry: path.join(projectRoot, "src/utils/envelopeCoordInput.ts"),
        formats: ["es"],
        fileName: () => "envelopeCoordInput.mjs",
      },
      rollupOptions: { external: [] },
    },
  });

  const module = await import(pathToFileURL(path.join(outDir, "envelopeCoordInput.mjs")).href);
  const {
    parseCoordInput, coordRange, outOfRangeFields, orderViolations, missingFields,
    cropToCoverage, bboxEquals, round6, evaluateCoordInputs, COORD_FIELDS,
  } = module;

  // t の代わり: 文言キーと補語をそのまま記録する（文言そのものではなく段取りを見る）
  const t = (key, params) => (params ? `${key}(${JSON.stringify(params)})` : key);
  const texts = (west, south, east, north) => ({ west, south, east, north });

  // ---- parseCoordInput: 空欄・半角・全角・小数点のコンマ・数字でない ----
  {
    assert.deepEqual(parseCoordInput(""), { blank: true, value: null });
    assert.deepEqual(parseCoordInput("  "), { blank: true, value: null });
    assert.deepEqual(parseCoordInput("139.45"), { blank: false, value: 139.45 });
    assert.deepEqual(parseCoordInput("-35.5"), { blank: false, value: -35.5 });
    // 全角の数字・小数点は半角に寄せて受け付ける
    assert.deepEqual(parseCoordInput("１３９．４５"), { blank: false, value: 139.45 });
    // 小数点のコンマ（点が無いときだけ）も受け付ける
    assert.deepEqual(parseCoordInput("139,85"), { blank: false, value: 139.85 });
    assert.deepEqual(parseCoordInput("１３９，８５"), { blank: false, value: 139.85 });
    // 数字でない値（空欄とは区別する）
    assert.deepEqual(parseCoordInput("abc"), { blank: false, value: null });
    assert.deepEqual(parseCoordInput("139.4.5"), { blank: false, value: null });
    assert.deepEqual(parseCoordInput("1e2"), { blank: false, value: 100 });
  }

  // ---- 範囲外の判定（経度 ±180 / 緯度 ±90）----
  {
    assert.deepEqual(coordRange("west"), [-180, 180]);
    assert.deepEqual(coordRange("east"), [-180, 180]);
    assert.deepEqual(coordRange("south"), [-90, 90]);
    assert.deepEqual(coordRange("north"), [-90, 90]);
    const parsed = {
      west: parseCoordInput("300"),      // 経度の範囲外
      south: parseCoordInput("91"),      // 緯度の範囲外
      east: parseCoordInput("139"),      // ちょうど範囲内
      north: parseCoordInput("-90"),     // ちょうど範囲内
    };
    assert.deepEqual(outOfRangeFields(parsed), ["west", "south"]);
    // 数字でない欄は範囲外の判定に入らない
    assert.deepEqual(outOfRangeFields({ ...parsed, west: parseCoordInput("abc") }), ["south"]);
  }

  // ---- 順序の判定（西は東より小さい・南は北より小さい）----
  {
    const parsed = {
      west: parseCoordInput("139.5"),
      south: parseCoordInput("35.5"),
      east: parseCoordInput("139.9"),
      north: parseCoordInput("35.9"),
    };
    assert.deepEqual(orderViolations(parsed), []);
    assert.deepEqual(
      orderViolations({ ...parsed, east: parseCoordInput("139.5") }),
      [{ low: "west", high: "east" }],
    );
    assert.deepEqual(
      orderViolations({ ...parsed, north: parseCoordInput("35.5") }),
      [{ low: "south", high: "north" }],
    );
    assert.deepEqual(
      orderViolations({ ...parsed, east: parseCoordInput("139"), north: parseCoordInput("35") }),
      [{ low: "west", high: "east" }, { low: "south", high: "north" }],
    );
    // すでに正しくない欄（範囲外）は順序の判定から外す
    const outOfRange = { ...parsed, west: parseCoordInput("300"), east: parseCoordInput("130") };
    assert.deepEqual(orderViolations(outOfRange, { west: true, south: false, east: false, north: false }), []);
  }

  // ---- 4 つが揃っているかの判定 ----
  {
    const parsed = {
      west: parseCoordInput("1"),
      south: parseCoordInput(""),
      east: parseCoordInput("3"),
      north: parseCoordInput("4"),
    };
    assert.deepEqual(missingFields(parsed), ["south"]);
    assert.deepEqual(missingFields({
      west: parseCoordInput("1"), south: parseCoordInput("2"),
      east: parseCoordInput("3"), north: parseCoordInput("4"),
    }), []);
    assert.equal(missingFields({
      west: parseCoordInput(""), south: parseCoordInput(""),
      east: parseCoordInput(""), north: parseCoordInput(""),
    }).length, 4);
  }

  // ---- cropToCoverage（存在範囲の内側への切り詰め）----
  {
    const coverage = [130.25, 32.5, 131.75, 33.8];
    // ちょうど重なる部分まで切り詰める
    assert.deepEqual(
      cropToCoverage([131, 32.6, 133, 33], coverage),
      [131, 32.6, 131.75, 33],
    );
    // 内側の値は変えない
    assert.deepEqual(
      cropToCoverage([130.5, 32.6, 131.5, 33.5], coverage),
      [130.5, 32.6, 131.5, 33.5],
    );
    // 重ならないときは null（未選択のまま）
    assert.equal(cropToCoverage([140.5, 35.5, 141, 36], coverage), null);
    assert.equal(cropToCoverage([120, 30, 130, 32.6], coverage), null);
    // 存在範囲が無いときはそのまま
    assert.deepEqual(cropToCoverage([140.5, 35.5, 141, 36], null), [140.5, 35.5, 141, 36]);
    // 切り詰めた値は小数 6 桁に丸める
    assert.equal(round6(1.23456789), 1.234568);
    assert.ok(bboxEquals([1, 2, 3, 4], [1, 2, 3, 4]));
    assert.ok(!bboxEquals([1, 2, 3, 4], [1, 2, 3, 5]));
  }

  // ---- evaluateCoordInputs: 小窓と同じ段取りで理由を返す ----
  {
    const coverage = [130.25, 32.5, 131.75, 33.8];
    // 4 つそろい・範囲内・順序どおり → 反映できる
    const ok = evaluateCoordInputs(texts("130.5", "32.6", "131.5", "33.5"), coverage, t);
    assert.equal(ok.kind, "apply");
    assert.deepEqual(ok.cropped, [130.5, 32.6, 131.5, 33.5]);
    assert.equal(ok.wasCropped, false);

    // 数字でない値 → 矩形を変えず理由を出す。欄はその欄だけ印が付く
    const badNumber = evaluateCoordInputs(texts("abc", "32.6", "131.5", "33.5"), coverage, t);
    assert.equal(badNumber.kind, "invalid");
    assert.deepEqual(badNumber.diagnostics.map((d) => d.key), ["number-west"]);
    assert.deepEqual(badNumber.diagnostics[0].message, 'appedit.envelope_coord_error_number({"name":"appedit.envelope_west_name"})');
    assert.deepEqual(badNumber.invalid, { west: true, south: false, east: false, north: false });

    // 経緯度の範囲の外 → 1 つの理由（poisource.errors.coord_range）にまとめる
    const badRange = evaluateCoordInputs(texts("300", "91", "131.5", "33.5"), coverage, t);
    assert.equal(badRange.kind, "invalid");
    assert.deepEqual(badRange.diagnostics.map((d) => d.key), ["coord-range"]);
    assert.deepEqual(badRange.invalid, { west: true, south: true, east: false, north: false });

    // 西が東以上・南が北以上 → 順序の理由
    const badOrder = evaluateCoordInputs(texts("131.5", "33.5", "130.5", "32.6"), coverage, t);
    assert.equal(badOrder.kind, "invalid");
    assert.deepEqual(badOrder.diagnostics.map((d) => d.key), ["order-west-east", "order-south-north"]);
    assert.deepEqual(badOrder.invalid, { west: true, south: true, east: true, north: true });

    // 4 つそろわない → そろわない理由。空の欄に印が付く
    const incomplete = evaluateCoordInputs(texts("130.5", "", "131.5", "33.5"), coverage, t);
    assert.equal(incomplete.kind, "invalid");
    assert.deepEqual(incomplete.diagnostics.map((d) => d.key), ["incomplete"]);
    assert.deepEqual(incomplete.invalid, { west: false, south: true, east: false, north: false });

    // 全部空 → 範囲なし（クリアと同じ扱い）
    assert.equal(evaluateCoordInputs(texts("", "", "", ""), coverage, t).kind, "clear");

    // 存在範囲の外まで伸びる値 → 切り詰めて、切ったことを知らせる
    const cropped = evaluateCoordInputs(texts("131", "32.6", "133", "33"), coverage, t);
    assert.equal(cropped.kind, "apply");
    assert.deepEqual(cropped.entered, [131, 32.6, 133, 33]);
    assert.deepEqual(cropped.cropped, [131, 32.6, 131.75, 33]);
    assert.equal(cropped.wasCropped, true);

    // 存在範囲と重ならない → 反映せず理由を出す
    const noOverlap = evaluateCoordInputs(texts("140.5", "35.5", "141", "36"), coverage, t);
    assert.equal(noOverlap.kind, "invalid");
    assert.deepEqual(noOverlap.diagnostics.map((d) => d.key), ["no-overlap"]);

    // 全角の数字と小数点のコンマのまま入れても、半角の値として扱う
    const fullWidth = evaluateCoordInputs(texts("１３０．４５", "３２．６", "131,5", "３３．５"), coverage, t);
    assert.equal(fullWidth.kind, "apply");
    assert.deepEqual(fullWidth.cropped, [130.45, 32.6, 131.5, 33.5]);
  }

  // COORD_FIELDS は 4 欄（西・南・東・北）
  assert.deepEqual([...COORD_FIELDS], ["west", "south", "east", "north"]);

  console.log("envelope-coord-input smoke: OK");
} finally {
  await rm(workDir, { recursive: true, force: true });
}
