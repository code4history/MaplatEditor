import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

// SlugReservationService は electron 依存なしの純ロジックにするため、node で直接 import できる。
// (electron の app/ipcMain には依存させない — 接続と instanceId/now を注入する)
import {
  createSlugReservationService,
  slugCheckResultIsAvailable,
} from "../electron/services/SlugReservationService.ts";
import { toRegistryKind, toDraftKind } from "../electron/services/slugReservationKind.ts";

const readSrc = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, ".tmp-smoke");
await mkdir(scratchRoot, { recursive: true });

async function importSource(relativeEntry, fileName) {
  const workDir = await mkdtemp(path.join(scratchRoot, "m11-t7-renderer-"));
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
          entry: path.join(projectRoot, relativeEntry),
          formats: ["es"],
          fileName: () => fileName,
        },
        rollupOptions: { external: [] },
      },
    });
    return await import(`${pathToFileURL(path.join(outDir, fileName)).href}?t=${Date.now()}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

// --- 一時 DB を作り slug_reservations スキーマを張る ---
function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(`
    CREATE TABLE asset_registry (
      uid TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE
    );
    CREATE TABLE slug_reservations (
      slug TEXT PRIMARY KEY,
      asset_uid TEXT NOT NULL,
      asset_kind TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      draft_uid TEXT,
      lease_expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

const UID_A = "11111111-1111-4111-8111-111111111111";
const UID_B = "22222222-2222-4222-8222-222222222222";

// 旧 asset:checkSlug boolean wrapper の戻り値互換（availableのみtrue）。
assert.equal(slugCheckResultIsAvailable("available"), true);
assert.equal(slugCheckResultIsAvailable("taken"), false);
assert.equal(slugCheckResultIsAvailable("reserved-by-other"), false);

// --- Part A0: 公開 check の registry + 予約 Single Source（§7.2/D2/D7） ---
{
  const db = makeDb();
  const now = () => new Date("2026-07-15T00:00:00Z").toISOString();
  const draftExists = (kind, draftUid) => kind === "map" && draftUid === "protected-draft";
  const svc = createSlugReservationService({
    db,
    instanceId: "inst-A",
    now,
    draftExists,
    registryOwner: (slug) => {
      const row = db.prepare("SELECT uid FROM asset_registry WHERE slug=?").get(slug);
      return row == null ? null : String(row.uid);
    },
  });
  db.prepare("INSERT INTO asset_registry(uid, kind, slug) VALUES (?, ?, ?)")
    .run(UID_A, "map", "registry-slug");
  assert.equal(svc.check({ slug: "registry-slug" }), "taken", "他uidのregistry行はtaken");
  assert.equal(svc.check({ slug: "registry-slug", excludeUid: UID_A }), "available", "自uidのregistry行は除外");

  assert.equal(svc.reserve({ slug: "reserved", assetUid: UID_B, assetKind: "app", draftUid: "d-B" }).result, "ok");
  assert.equal(svc.check({ slug: "reserved", excludeUid: UID_A }), "reserved-by-other", "他owner予約はreserved");
  assert.equal(svc.check({ slug: "reserved", excludeUid: UID_B }), "available", "自owner予約は除外");
  assert.equal(svc.check({ slug: "fresh", excludeUid: UID_A }), "available", "空きslugはavailable");

  assert.equal(svc.reserve({ slug: "expired-protected-check", assetUid: UID_B, assetKind: "map", draftUid: "protected-draft" }).result, "ok");
  db.prepare("UPDATE slug_reservations SET lease_expires_at=? WHERE slug=?")
    .run("2026-07-14T00:00:00Z", "expired-protected-check");
  assert.equal(svc.check({ slug: "expired-protected-check", excludeUid: UID_A }), "reserved-by-other",
    "expiredでもdraftが残る他owner予約は保護する");
  db.close();
}

// --- Part A1: kind 写像（§7.3） ---
assert.equal(toRegistryKind("poi-source"), "poi_source");
assert.equal(toRegistryKind("base-map"), "base_map");
assert.equal(toRegistryKind("image-asset"), "asset");
assert.equal(toRegistryKind("map"), "map");
assert.equal(toDraftKind("poi_source"), "poi");
assert.equal(toDraftKind("base_map"), "base-map");
assert.equal(toDraftKind("asset"), "image-asset");

// --- Part A2: reserve 競合（AC2） ---
{
  const db = makeDb();
  let clock = Date.parse("2026-07-15T00:00:00Z");
  const now = () => new Date(clock).toISOString();
  const svcA = createSlugReservationService({ db, instanceId: "inst-A", now });
  const svcB = createSlugReservationService({ db, instanceId: "inst-B", now });
  const r1 = svcA.reserve({ slug: "shared", assetUid: UID_A, assetKind: "map", draftUid: "d-A" });
  assert.equal(r1.result, "ok");
  // 別 instance / 別 asset_uid が同 slug を予約 → conflict（AC2）
  const r2 = svcB.reserve({ slug: "shared", assetUid: UID_B, assetKind: "map", draftUid: "d-B" });
  assert.equal(r2.result, "conflict");
  // check は reserved-by-other（excludeUid=UID_B）
  assert.equal(svcB.check({ slug: "shared", excludeUid: UID_B }), "reserved-by-other");
  // 自 asset_uid の再 reserve は冪等 ok（claim: instance/lease 付け替え）
  const r3 = svcA.reserve({ slug: "shared", assetUid: UID_A, assetKind: "map", draftUid: "d-A" });
  assert.equal(r3.result, "ok");
  const row = db.prepare("SELECT instance_id, asset_uid FROM slug_reservations WHERE slug=?").get("shared");
  assert.equal(row.asset_uid, UID_A);
  db.close();
}

// --- Part A3: move / 元 slug 復帰 release / draft 破棄 release（AC15） ---
{
  const db = makeDb();
  const now = () => new Date().toISOString();
  const svc = createSlugReservationService({ db, instanceId: "inst-A", now });
  svc.reserve({ slug: "old", assetUid: UID_A, assetKind: "app", draftUid: "d-A" });
  // move: 旧予約解放 + 新予約が単一操作（AC15）
  const m = svc.move({ fromSlug: "old", toSlug: "new", assetUid: UID_A, assetKind: "app", draftUid: "d-A" });
  assert.equal(m.result, "ok");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM slug_reservations WHERE slug=?").get("old").c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM slug_reservations WHERE slug=?").get("new").c, 1);
  // release（元 slug 復帰 / draft 破棄）
  svc.release({ slug: "new", assetUid: UID_A });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM slug_reservations").get().c, 0);
  db.close();
}

// --- Part A3b: move の後段失敗は旧予約解放を rollback（AC15） ---
{
  const db = makeDb();
  const now = () => new Date("2026-07-15T00:00:00Z").toISOString();
  const svc = createSlugReservationService({ db, instanceId: "inst-A", now });
  assert.equal(svc.reserve({ slug: "rollback-old", assetUid: UID_A, assetKind: "app", draftUid: "d-A" }).result, "ok");
  db.exec(`
    CREATE TRIGGER fail_move_insert
    BEFORE INSERT ON slug_reservations
    WHEN NEW.slug = 'rollback-new'
    BEGIN
      SELECT RAISE(ABORT, 'injected move failure');
    END;
  `);
  const moved = svc.move({
    fromSlug: "rollback-old",
    toSlug: "rollback-new",
    assetUid: UID_A,
    assetKind: "app",
    draftUid: "d-A",
  });
  assert.equal(moved.result, "error");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM slug_reservations WHERE slug=?").get("rollback-old").c, 1,
    "old reservation must be restored when acquiring the new slug fails");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM slug_reservations WHERE slug=?").get("rollback-new").c, 0);
  db.close();
}

// --- Part A3c: expired reservation takeover / draft protection（D2/D4/D6） ---
{
  const db = makeDb();
  const now = () => new Date("2026-07-15T00:00:00Z").toISOString();
  const svcA = createSlugReservationService({ db, instanceId: "inst-A", now, draftExists: () => false });
  const svcB = createSlugReservationService({ db, instanceId: "inst-B", now, draftExists: () => false });
  assert.equal(svcA.reserve({ slug: "expired-orphan", assetUid: UID_A, assetKind: "map", draftUid: "d-A" }).result, "ok");
  db.prepare("UPDATE slug_reservations SET lease_expires_at=? WHERE slug=?")
    .run("2026-07-14T00:00:00Z", "expired-orphan");
  assert.equal(svcB.reserve({ slug: "expired-orphan", assetUid: UID_B, assetKind: "asset", draftUid: "d-B" }).result, "ok");
  const takeover = db.prepare(`
    SELECT asset_uid, asset_kind, instance_id, draft_uid, lease_expires_at, updated_at
    FROM slug_reservations WHERE slug=?
  `).get("expired-orphan");
  assert.equal(takeover.asset_uid, UID_B);
  assert.equal(takeover.asset_kind, "asset");
  assert.equal(takeover.instance_id, "inst-B");
  assert.equal(takeover.draft_uid, "d-B");
  assert.ok(String(takeover.lease_expires_at) > now());
  assert.equal(takeover.updated_at, now());
  assert.deepEqual(svcB.promoteWithin(db, { slug: "expired-orphan", assetUid: UID_B }), { ok: true });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM slug_reservations WHERE slug=?").get("expired-orphan").c, 0);
  db.close();
}

{
  const db = makeDb();
  const now = () => new Date("2026-07-15T00:00:00Z").toISOString();
  let draftChecks = 0;
  const draftExists = (kind, draftUid) => {
    draftChecks += 1;
    return kind === "map" && draftUid === "protected-draft";
  };
  const svcA = createSlugReservationService({ db, instanceId: "inst-A", now, draftExists });
  const svcB = createSlugReservationService({ db, instanceId: "inst-B", now, draftExists });
  assert.equal(svcA.reserve({ slug: "expired-protected", assetUid: UID_A, assetKind: "map", draftUid: "protected-draft" }).result, "ok");
  db.prepare("UPDATE slug_reservations SET lease_expires_at=? WHERE slug=?")
    .run("2026-07-14T00:00:00Z", "expired-protected");
  assert.equal(svcB.check({ slug: "expired-protected", excludeUid: UID_B }), "reserved-by-other");
  assert.equal(svcB.reserve({ slug: "expired-protected", assetUid: UID_B, assetKind: "app", draftUid: "d-B" }).result, "conflict");
  assert.equal(draftChecks, 2, "check and reserve conflicts must both be based on draft protection");
  const protectedRow = db.prepare("SELECT asset_uid, asset_kind, draft_uid FROM slug_reservations WHERE slug=?")
    .get("expired-protected");
  assert.equal(protectedRow.asset_uid, UID_A);
  assert.equal(protectedRow.asset_kind, "map");
  assert.equal(protectedRow.draft_uid, "protected-draft");
  assert.deepEqual(svcB.promoteWithin(db, { slug: "expired-protected", assetUid: UID_B }),
    { ok: false, reason: "conflict" },
    "promote must preserve another asset's expired reservation while its draft exists");
  db.close();
}

// DatabaseSync は同期APIのため、同一threadの2接続barrierは決定的に構成できない。
// 代わりに、所有権SELECTが BEGIN IMMEDIATE 後、書込とCOMMITの前にあることを記録DBで固定する。
{
  const db = makeDb();
  const calls = [];
  const tracedDb = {
    exec(sql) {
      calls.push(`exec:${sql}`);
      return db.exec(sql);
    },
    prepare(sql) {
      calls.push(`prepare:${sql}`);
      return db.prepare(sql);
    },
  };
  const now = () => new Date("2026-07-15T00:00:00Z").toISOString();
  const svc = createSlugReservationService({ db: tracedDb, instanceId: "inst-A", now });
  assert.equal(svc.reserve({ slug: "atomic", assetUid: UID_A, assetKind: "map", draftUid: "d-A" }).result, "ok");
  const beginAt = calls.findIndex((call) => call === "exec:BEGIN IMMEDIATE");
  const selectAt = calls.findIndex((call) => call.startsWith("prepare:SELECT"));
  const writeAt = calls.findIndex((call) => call.startsWith("prepare:INSERT"));
  const commitAt = calls.findIndex((call) => call === "exec:COMMIT");
  assert.ok(beginAt >= 0 && beginAt < selectAt && selectAt < writeAt && writeAt < commitAt,
    `reserve ownership check/write must be enclosed by BEGIN IMMEDIATE: ${calls.join(" | ")}`);
  db.close();
}

// move中のdraft判定結果が変化しても、conflictなら旧予約を失わない。
{
  const db = makeDb();
  const now = () => new Date("2026-07-15T00:00:00Z").toISOString();
  const owner = createSlugReservationService({ db, instanceId: "inst-B", now });
  assert.equal(owner.reserve({ slug: "unstable-target", assetUid: UID_B, assetKind: "map", draftUid: "d-B" }).result, "ok");
  db.prepare("UPDATE slug_reservations SET lease_expires_at=? WHERE slug=?")
    .run("2026-07-14T00:00:00Z", "unstable-target");
  let checks = 0;
  const mover = createSlugReservationService({
    db,
    instanceId: "inst-A",
    now,
    draftExists: () => ++checks >= 2,
  });
  assert.equal(mover.reserve({ slug: "unstable-old", assetUid: UID_A, assetKind: "app", draftUid: "d-A" }).result, "ok");
  const result = mover.move({
    fromSlug: "unstable-old",
    toSlug: "unstable-target",
    assetUid: UID_A,
    assetKind: "app",
    draftUid: "d-A",
  });
  assert.equal(result.result, "conflict");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM slug_reservations WHERE slug=? AND asset_uid=?")
    .get("unstable-old", UID_A).c, 1,
    "a normal conflict after the target check must not commit deletion of the old reservation");
  assert.equal(db.prepare("SELECT asset_uid FROM slug_reservations WHERE slug=?").get("unstable-target").asset_uid, UID_B);
  db.close();
}

// draft lookup障害は空き扱いにせず、reserve/moveをrollbackしpromote transactionへ伝播する。
{
  const db = makeDb();
  db.exec("CREATE TABLE promoted_assets (slug TEXT PRIMARY KEY)");
  const now = () => new Date("2026-07-15T00:00:00Z").toISOString();
  const owner = createSlugReservationService({ db, instanceId: "inst-B", now });
  for (const slug of ["lookup-reserve", "lookup-move", "lookup-promote"]) {
    assert.equal(owner.reserve({ slug, assetUid: UID_B, assetKind: "map", draftUid: "d-B" }).result, "ok");
  }
  db.prepare("UPDATE slug_reservations SET lease_expires_at=?")
    .run("2026-07-14T00:00:00Z");
  const failing = createSlugReservationService({
    db,
    instanceId: "inst-A",
    now,
    draftExists: () => { throw new Error("draft lookup failed"); },
  });

  const reserved = failing.reserve({ slug: "lookup-reserve", assetUid: UID_A, assetKind: "app", draftUid: "d-A" });
  assert.equal(reserved.result, "error");
  assert.equal(db.prepare("SELECT asset_uid FROM slug_reservations WHERE slug=?").get("lookup-reserve").asset_uid, UID_B);

  assert.equal(failing.reserve({ slug: "lookup-old", assetUid: UID_A, assetKind: "app", draftUid: "d-A" }).result, "ok");
  let moveChecks = 0;
  const failingMove = createSlugReservationService({
    db,
    instanceId: "inst-A",
    now,
    draftExists: () => {
      moveChecks += 1;
      if (moveChecks === 1) return false;
      throw new Error("draft lookup failed during move");
    },
  });
  const moved = failingMove.move({
    fromSlug: "lookup-old",
    toSlug: "lookup-move",
    assetUid: UID_A,
    assetKind: "app",
    draftUid: "d-A",
  });
  assert.equal(moved.result, "error");
  assert.equal(db.prepare("SELECT asset_uid FROM slug_reservations WHERE slug=?").get("lookup-old").asset_uid, UID_A);
  assert.equal(db.prepare("SELECT asset_uid FROM slug_reservations WHERE slug=?").get("lookup-move").asset_uid, UID_B);

  db.exec("BEGIN IMMEDIATE");
  assert.throws(() => {
    db.prepare("INSERT INTO promoted_assets (slug) VALUES (?)").run("lookup-promote");
    failing.promoteWithin(db, { slug: "lookup-promote", assetUid: UID_A });
  }, /draft lookup failed/);
  db.exec("ROLLBACK");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM promoted_assets").get().c, 0);
  assert.equal(db.prepare("SELECT asset_uid FROM slug_reservations WHERE slug=?").get("lookup-promote").asset_uid, UID_B);
  db.close();
}

// --- Part A4: lease 直接 UPDATE + GC（AC3） ---
{
  const db = makeDb();
  const now = () => new Date("2026-07-15T00:00:00Z").toISOString();
  const svc = createSlugReservationService({ db, instanceId: "inst-A", now });
  svc.reserve({ slug: "with-draft", assetUid: UID_A, assetKind: "map", draftUid: "d-A" });
  svc.reserve({ slug: "orphan", assetUid: UID_B, assetKind: "map", draftUid: "d-B" });
  // 双方の lease を失効させ、updated_at を 24h 超過へ直接 UPDATE（D8改 の直接 UPDATE 方式）
  db.prepare("UPDATE slug_reservations SET lease_expires_at=?, updated_at=?")
    .run("2026-07-14T00:00:00Z", "2026-07-13T00:00:00Z");
  // draft 存在判定: with-draft の (kind,draft_uid) は生きている / orphan は無い
  const draftExists = (kind, draftUid) => draftUid === "d-A";
  svc.gc({ draftExists });
  // draft 保護（AC3）: with-draft は残る、orphan は消える
  assert.equal(db.prepare("SELECT COUNT(*) c FROM slug_reservations WHERE slug=?").get("with-draft").c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM slug_reservations WHERE slug=?").get("orphan").c, 0);
  db.close();
}

console.log("m11-t7 smoke Part A (service unit): OK");

// --- Part B1: promote conflict / 成立 / rollback（AC4） ---
// promoteWithin の単体挙動を一時 DB で検証（save 統合は E2E/後続 build で担保）。
{
  const db = makeDb();
  const now = () => new Date("2026-07-15T00:00:00Z").toISOString();
  const svc = createSlugReservationService({ db, instanceId: "inst-A", now });
  // 他 asset_uid の有効予約 → promote conflict（本体を作らないことは呼び出し側が rollback）
  svc.reserve({ slug: "taken", assetUid: UID_B, assetKind: "map", draftUid: "d-B" });
  assert.deepEqual(svc.promoteWithin(db, { slug: "taken", assetUid: UID_A }), { ok: false, reason: "conflict" });
  // 自 asset_uid の予約 → 成立し、予約を消化
  svc.reserve({ slug: "mine", assetUid: UID_A, assetKind: "map", draftUid: "d-A" });
  assert.deepEqual(svc.promoteWithin(db, { slug: "mine", assetUid: UID_A }), { ok: true });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM slug_reservations WHERE slug=?").get("mine").c, 0);
  // 予約が「無い」slug も成立（registry unique が最終防衛）
  assert.deepEqual(svc.promoteWithin(db, { slug: "fresh", assetUid: UID_A }), { ok: true });
  db.close();
}

// --- Part B2: source 契約 assert ---
const preload = await readSrc("electron/preload.ts");
assert.match(preload, /exposeInMainWorld\(['"]slugReservations['"]/, "preload must expose window.slugReservations");
assert.doesNotMatch(preload, /slugReservations[\s\S]*?ipcRenderer\b(?![.]invoke|[.]on|[.]removeListener)/, "no raw ipcRenderer leak");

const sqlite = await readSrc("electron/services/SqliteDataService.ts");
assert.match(sqlite, /isSlugAvailable[\s\S]{0,400}checkSlugReservation/,
  "legacy boolean API must delegate to the unified tri-state check");
assert.doesNotMatch(sqlite, /private slugReservationDraftExists[\s\S]{0,400}?\bcatch\b/,
  "SqliteDataService must propagate draft lookup/kind conversion failures");
// promote 検証が withTransaction 内(6 helper)へ差し込まれている
assert.match(sqlite, /promoteWithin/, "SqliteDataService must call promoteWithin inside save paths");
// slug_reservations は search/export helper に現れない（AC12）
assert.doesNotMatch(sqlite, /INSERT INTO (search|export)[\s\S]*slug_reservations/, "reservations must not leak to search/export");

const mapEdit = await readSrc("electron/services/MapEditService.ts");
assert.match(mapEdit, /renameFromSlug/, "MapEditService must use renameFromSlug (D5)");
assert.doesNotMatch(mapEdit, /Change:/, "MapEditService must drop Change: status rescue (D5)");

const storage = await readSrc("electron/adapters/StorageAdapter.ts");
assert.match(storage, /create\?:\s*boolean/, "MapSaveRequest must add create flag (D11)");
assert.match(storage, /renameFromSlug\?:\s*string/, "MapSaveRequest must add renameFromSlug (D5)");

console.log("m11-t7 smoke Part B: OK");

// --- Part B3: 専用 create endpoint の preset uid 転送（フェーズA補完、D11改/AC6） ---
// SlugField は renderer 事前採番 uid で予約する(帰属=asset_uid)。POI/画像アセット/ベースマップの
// 新規保存が同じ uid で行を作らないと promoteWithin が conflict になるため、3経路とも
// preset uid を service 層まで転送していることを source 契約で固定する。
const poiSvcSrc = await readSrc("electron/services/PoiSourceService.ts");
assert.match(poiSvcSrc, /createLocal\(input: \{[^}]*uid\?: string/s,
  "PoiSourceService.createLocal must accept preset uid (D11)");
assert.match(poiSvcSrc, /createPoiSource\(trimmed, \{[\s\S]*?\},\s*presetUid\)/,
  "PoiSourceService.createSource must forward preset uid to createPoiSource");
const imgSvcSrc = await readSrc("electron/services/ImageAssetService.ts");
assert.match(imgSvcSrc, /async add\(input: \{[^}]*uid\?: string/s,
  "ImageAssetService.add must accept preset uid (D11)");
assert.match(imgSvcSrc, /createAsset\(slug, \{[\s\S]*?\},\s*presetUid\)/,
  "ImageAssetService.add must forward preset uid to createAsset");
// saveUserBaseMap: create===true で payload.uid を preset 採用(§7.2b)。
// 既存の uid 有無 dispatch(update 経路の NotFound throw=復活防止)は不変。
assert.match(sqlite, /BaseMapSavePayload \{[\s\S]{0,400}?create\?:\s*boolean/,
  "BaseMapSavePayload must add create flag (§7.2b)");
assert.match(sqlite, /payload[?]?\.create === true/,
  "saveUserBaseMap must dispatch preset uid on create flag");
console.log("m11-t7 smoke Part B3: OK");

const LOCALES = ["de", "en", "es", "fr", "id", "ja", "ko", "th", "vi", "zh", "zh-TW"];

// --- Part C0: renderer 予約状態機械（Major-2） ---
{
  const { createSlugReservationHarness } = await importSource(
    "scripts/fixtures/m11-t7-slug-reservation-harness.ts",
    "slugReservationHarness.mjs",
  );
  const calls = { reserve: [], move: [], release: [], check: [] };
  let reserveImpl = async () => ({ result: "ok" });
  let moveImpl = async () => ({ result: "ok" });
  let checkImpl = async () => "available";
  globalThis.window = {
    slugReservations: {
      reserve: async (payload) => { calls.reserve.push(payload); return reserveImpl(payload); },
      move: async (payload) => { calls.move.push(payload); return moveImpl(payload); },
      release: async (payload) => { calls.release.push(payload); },
      check: async (payload) => { calls.check.push(payload); return checkImpl(payload); },
    },
  };

  // reserve conflict/error/throw は held を更新せず、UI向け状態を返す。
  const reserveHarness = createSlugReservationHarness({ currentSlug: "conflict" });
  reserveImpl = async () => ({ result: "conflict" });
  assert.equal(await reserveHarness.reservation.onAvailable("conflict"), "reserved-by-other");
  reserveImpl = async () => ({ result: "error", message: "disk" });
  assert.equal(await reserveHarness.reservation.onAvailable("error"), "check-failed");
  reserveImpl = async () => { throw new Error("ipc"); };
  assert.equal(await reserveHarness.reservation.onAvailable("throw"), "check-failed");
  reserveImpl = async () => ({ result: "ok" });
  assert.equal(await reserveHarness.reservation.onAvailable("held"), "available");
  assert.equal(calls.move.length, 0, "failed reserve must not become held");

  // move conflict は旧 held を維持し、次の move でも旧slugをfromSlugにする。
  moveImpl = async () => ({ result: "conflict" });
  assert.equal(await reserveHarness.reservation.onAvailable("blocked"), "reserved-by-other");
  moveImpl = async () => ({ result: "ok" });
  assert.equal(await reserveHarness.reservation.onAvailable("next"), "available");
  assert.equal(calls.move.at(-1).fromSlug, "held");

  // A/B逆転: stale AはUI状態を上書きせず、実held AからBへ直列moveする。
  let resolveStaleA;
  reserveImpl = ({ slug }) => slug === "a"
    ? new Promise((resolve) => { resolveStaleA = resolve; })
    : Promise.resolve({ result: "ok" });
  moveImpl = async () => ({ result: "ok" });
  const staleHarness = createSlugReservationHarness({ currentSlug: "a" });
  const a = staleHarness.reservation.onAvailable("a");
  staleHarness.setCurrentSlug("b");
  const b = staleHarness.reservation.onAvailable("b");
  await Promise.resolve();
  resolveStaleA({ result: "ok" });
  assert.equal(await a, null, "stale response must not publish a field state");
  assert.equal(await b, "available");
  assert.equal(calls.move.at(-1).fromSlug, "a", "B must move from actual stale-success held A");
  reserveImpl = async () => ({ result: "ok" });
  await staleHarness.reservation.onAvailable("c");
  assert.equal(calls.move.at(-1).fromSlug, "b", "stale A must not overwrite current held B");

  // 後続onAvailableがないinvalid入力への変更では、stale成功分をqueue完了時に解放する。
  {
    const dbHeld = new Set();
    let resolveInvalidA;
    window.slugReservations.reserve = async ({ slug }) => { dbHeld.add(slug); return { result: "ok" }; };
    window.slugReservations.move = async (payload) => new Promise((resolve) => {
      resolveInvalidA = () => {
        dbHeld.delete(payload.fromSlug);
        dbHeld.add(payload.toSlug);
        resolve({ result: "ok" });
      };
    });
    window.slugReservations.release = async ({ slug }) => { dbHeld.delete(slug); };
    const invalidHarness = createSlugReservationHarness({ currentSlug: "h" });
    await invalidHarness.reservation.onAvailable("h");
    const invalidatedMove = invalidHarness.reservation.onAvailable("a");
    invalidHarness.setCurrentSlug("bad slug");
    await Promise.resolve();
    resolveInvalidA();
    assert.equal(await invalidatedMove, null);
    assert.deepEqual([...dbHeld], [], "stale success without a successor must be released");
  }

  // held H から A/B を並行要求してもmutationは直列化する。A成功後にBが失敗した場合、
  // Bは実held Aからmoveを試し、DB/内部heldともAを維持する。
  for (const bFailure of ["conflict", "error", "throw"]) {
    const dbHeld = new Set();
    let resolveA;
    const serialCalls = [];
    window.slugReservations.reserve = async ({ slug }) => {
      dbHeld.add(slug);
      return { result: "ok" };
    };
    window.slugReservations.move = async (payload) => {
      serialCalls.push(payload);
      if (payload.toSlug === "a") {
        return new Promise((resolve) => {
          resolveA = () => {
            dbHeld.delete(payload.fromSlug);
            dbHeld.add(payload.toSlug);
            resolve({ result: "ok" });
          };
        });
      }
      if (payload.toSlug === "b") {
        if (bFailure === "throw") throw new Error("ipc");
        return bFailure === "conflict"
          ? { result: "conflict" }
          : { result: "error", message: "disk" };
      }
      return { result: "conflict" };
    };
    window.slugReservations.release = async ({ slug }) => { dbHeld.delete(slug); };
    const serialHarness = createSlugReservationHarness({ currentSlug: "h" });
    assert.equal(await serialHarness.reservation.onAvailable("h"), "available");
    const moveA = serialHarness.reservation.onAvailable("a");
    serialHarness.setCurrentSlug("b");
    const moveB = serialHarness.reservation.onAvailable("b");
    await Promise.resolve();
    assert.equal(serialCalls.length, 1, "B move must wait until A move settles");
    resolveA();
    assert.equal(await moveA, null);
    assert.equal(await moveB, bFailure === "conflict" ? "reserved-by-other" : "check-failed");
    assert.deepEqual([...dbHeld], ["a"], `B ${bFailure}: DB must retain actual held A`);
    await serialHarness.reservation.onAvailable("probe");
    assert.equal(serialCalls.at(-1).fromSlug, "a", `B ${bFailure}: local held must advance to A`);
    assert.deepEqual([...dbHeld], ["a"]);
  }

  // confirm: taken/reserved/error は false。変更slugは再reserve成功時のみtrue。
  window.slugReservations.reserve = async (payload) => { calls.reserve.push(payload); return reserveImpl(payload); };
  window.slugReservations.move = async (payload) => { calls.move.push(payload); return moveImpl(payload); };
  window.slugReservations.release = async (payload) => { calls.release.push(payload); };
  window.slugReservations.check = async (payload) => { calls.check.push(payload); return checkImpl(payload); };
  const confirmHarness = createSlugReservationHarness({ originalSlug: "original", currentSlug: "changed" });
  for (const result of ["taken", "reserved-by-other"]) {
    checkImpl = async () => result;
    assert.deepEqual(await confirmHarness.confirmForSave(), { ok: false, state: "reserved-by-other" });
  }
  checkImpl = async () => { throw new Error("offline"); };
  assert.deepEqual(await confirmHarness.confirmForSave(), { ok: false, state: "check-failed" });
  checkImpl = async () => "available";
  reserveImpl = async () => ({ result: "ok" });
  assert.deepEqual(await confirmHarness.confirmForSave(), { ok: true, state: "available" });

  // check後の保存raceでreserve conflictならUI競合 + false。
  const raceHarness = createSlugReservationHarness({ originalSlug: "original", currentSlug: "race" });
  reserveImpl = async () => ({ result: "conflict" });
  assert.deepEqual(await raceHarness.confirmForSave(), { ok: false, state: "reserved-by-other" });

  // 未変更はregistry自己ownerのavailable確認だけでtrue。reserve/moveは呼ばない。
  const unchangedHarness = createSlugReservationHarness({ originalSlug: "same", currentSlug: "same" });
  const writesBefore = calls.reserve.length + calls.move.length;
  checkImpl = async () => "available";
  assert.deepEqual(await unchangedHarness.confirmForSave(), { ok: true, state: "available" });
  assert.equal(calls.reserve.length + calls.move.length, writesBefore);
  checkImpl = async () => "taken";
  assert.deepEqual(await unchangedHarness.confirmForSave(), { ok: false, state: "reserved-by-other" });
}

// --- Part C1: SlugField 契約 ---
const slugField = await readSrc("src/components/editor-ui/SlugField.vue");
assert.match(slugField, /assetKind/, "SlugField must accept assetKind prop");
assert.match(slugField, /assetUid/, "SlugField must accept assetUid prop");
assert.match(slugField, /draftUid/, "SlugField must accept draftUid prop");
assert.match(slugField, /originalSlug/, "SlugField must accept originalSlug prop");
assert.match(slugField, /confirmForSave/, "SlugField must expose confirmForSave");
assert.match(slugField, /role="status"/, "SlugField must expose accessible status");
assert.match(slugField, /reserved-by-other/, "SlugField must map reserved-by-other state (§7.1)");
assert.match(slugField, /editor_ui\.slug_label/, "SlugField must use editor_ui.slug_label");
assert.match(slugField, /await reservation\.onAvailable/, "SlugField must await reservation result");
assert.match(slugField, /reservationState\.value\s*=\s*result/, "SlugField must reflect reservation result in field state");
assert.doesNotMatch(slugField, /void reservation\.onAvailable/, "SlugField must not discard reservation result");

// --- Part C2: useSlugAvailability の 6 状態写像（D1） ---
const avail = await readSrc("src/composables/useSlugAvailability.ts");
assert.match(avail, /invalid-format|invalid_format/, "must expose invalid-format state (D1)");
assert.match(avail, /reserved-by-other/, "must map taken -> reserved-by-other (D1)");
assert.match(avail, /check-failed|check_failed/, "must map unavailable -> check-failed (D1)");
assert.match(avail, /window\.slugReservations\.check/, "Slug UI composable must use the new tri-state API");
assert.doesNotMatch(avail, /window\.assets\.checkSlug/, "Slug UI composable must not depend on the legacy API (AC17)");

// AC17は5 Edit直書きだけでなく、共通SlugField→composableの依存グラフまで監査する。
assert.match(slugField, /useSlugAvailability/, "SlugField must depend on the sanctioned availability composable");
for (const rel of [
  "src/components/editor-ui/SlugField.vue",
  "src/composables/useSlugAvailability.ts",
  "src/views/MapEdit.vue",
  "src/views/AppEdit.vue",
  "src/views/PoiEdit.vue",
  "src/views/PoiSourceList.vue",
  "src/components/basemap/BaseMapEdit.vue",
  "src/components/assets/AssetEdit.vue",
]) {
  const src = await readSrc(rel);
  assert.doesNotMatch(src, /window\.assets\.checkSlug/, `${rel} must not use legacy checkSlug in the slug UI graph (AC17)`);
}

// --- Part C3: 新 label キー（11 locale） ---
for (const loc of LOCALES) {
  const t = JSON.parse(await readSrc(`public/locales/${loc}/translation.json`));
  assert.ok(t.editor_ui?.slug_label != null, `editor_ui.slug_label missing in ${loc}`);
  assert.ok(t.editor_ui?.default_lang_label != null, `editor_ui.default_lang_label missing in ${loc}`);
}
const ja = JSON.parse(await readSrc("public/locales/ja/translation.json"));
assert.equal(ja.editor_ui.slug_label, "スラッグ (ID)"); // §18b 決定2 確定語彙
assert.equal(ja.editor_ui.default_lang_label, "デフォルト言語");

console.log("m11-t7 smoke Part C: OK");

// --- Part D: BaseMap/Asset が SlugField を使い、生 checkSlug が残らない ---
for (const rel of ["src/components/basemap/BaseMapEdit.vue", "src/components/assets/AssetEdit.vue"]) {
  const src = await readSrc(rel);
  assert.match(src, /SlugField/, `${rel} must use SlugField`);
  assert.doesNotMatch(src, /window\.assets\.checkSlug/, `${rel} must drop raw checkSlug (AC17)`);
  const discard = src.slice(src.indexOf("async function discardDraft"), src.indexOf("function saveFailure"));
  assert.match(discard, /await slugField\.value\?\.release\(\)/,
    `${rel} new draft discard must await slug reservation release`);
  assert.ok(discard.indexOf("await slugField.value?.release()") < discard.indexOf("await draftLifecycle.discard()"),
    `${rel} must release reservation before discarding/closing the draft`);
}
console.log("m11-t7 smoke Part D: OK");

// --- Part E: POI Edit + 作成モーダルが SlugField、生 checkSlug 撤去 ---
for (const rel of ["src/views/PoiEdit.vue", "src/views/PoiSourceList.vue"]) {
  const src = await readSrc(rel);
  assert.match(src, /SlugField/, `${rel} must use SlugField`);
  assert.doesNotMatch(src, /window\.assets\.checkSlug/, `${rel} must drop raw checkSlug (AC17)`);
}
console.log("m11-t7 smoke Part E: OK");

// --- Part F1: AppEdit が SlugField、一意性ボタン撤去 ---
const appEditSrc = await readSrc("src/views/AppEdit.vue");
assert.match(appEditSrc, /SlugField/, "AppEdit must use SlugField");
assert.doesNotMatch(appEditSrc, /appedit\.uniqueness_button/, "AppEdit must drop uniqueness button (AC1)");
assert.doesNotMatch(appEditSrc, /window\.assets\.checkSlug/, "AppEdit must drop raw checkSlug (AC17)");
console.log("m11-t7 smoke Part F1: OK");

// --- Part F2: MapEdit が SlugField、旧改名 flow 撤去、renameFromSlug を保存へ渡す ---
const mapEditVue = await readSrc("src/views/MapEdit.vue");
assert.match(mapEditVue, /SlugField/, "MapEdit must use SlugField");
assert.doesNotMatch(mapEditVue, /mapedit\.uniqueness_button/, "MapEdit must drop uniqueness button (AC1)");
assert.doesNotMatch(mapEditVue, /copy_or_move/, "MapEdit must drop copy_or_move dialog (AC5)");
assert.doesNotMatch(mapEditVue, /`Change:\$\{/, "MapEdit must drop Change: status (D5)");
assert.match(mapEditVue, /renameFromSlug/, "MapEdit must pass renameFromSlug on rename save (D5)");
assert.doesNotMatch(mapEditVue, /window\.assets\.checkSlug/, "MapEdit must drop raw checkSlug (AC17)");
console.log("m11-t7 smoke Part F2: OK");

// --- Part G: 5 Edit 先頭が タイトル→スラッグ(ID)→デフォルト言語、ラベル統一(AC7/§18b決定2) ---
// 順序は template 内の初出 index で検証する(title label → <SlugField → default_lang_label)。
const EDIT_ORDER = [
  ["src/views/MapEdit.vue", 'mapedit.map_name_repr'],
  ["src/views/AppEdit.vue", 'appedit.app_name'],
  ["src/views/PoiEdit.vue", 'poisource.title_label'],
  ["src/components/basemap/BaseMapEdit.vue", 'basemap.modal.title_label'],
  ["src/components/assets/AssetEdit.vue", 'assetlist.title_label'],
];
for (const [rel, titleKey] of EDIT_ORDER) {
  const src = await readSrc(rel);
  assert.match(src, /editor_ui\.default_lang_label/, `${rel} must use editor_ui.default_lang_label (AC7)`);
  const titleAt = src.indexOf(titleKey);
  const slugAt = src.indexOf("<SlugField");
  const langAt = src.indexOf("editor_ui.default_lang_label");
  assert.ok(titleAt >= 0 && slugAt >= 0 && langAt >= 0, `${rel} must contain title/slug/default-lang fields`);
  assert.ok(titleAt < slugAt && slugAt < langAt,
    `${rel} field order must be title -> slug -> default language (AC7): title@${titleAt} slug@${slugAt} lang@${langAt}`);
}
// 廃止キーは未参照化のみ(削除は T12)。参照が 0 であることを確認。
for (const [rel, keys] of [
  ["src/views/MapEdit.vue", /mapedit\.uniqueness_button|mapedit\.check_uniqueness|mapedit\.copy_or_move/],
  ["src/views/AppEdit.vue", /appedit\.uniqueness_button|appedit\.check_uniqueness/],
]) {
  const src = await readSrc(rel);
  assert.doesNotMatch(src, keys, `${rel} must not reference retired keys (D10)`);
}
console.log("m11-t7 smoke Part G: OK");

// --- Part H: 診断が DiagnosticFeedback/EditorField へ移行、旧 alert/独自 banner 撤去(AC8) ---
for (const rel of ["src/views/MapEdit.vue", "src/views/AppEdit.vue", "src/views/PoiEdit.vue", "src/views/PoiSourceList.vue"]) {
  const src = await readSrc(rel);
  assert.match(src, /DiagnosticFeedback|EditorField/, `${rel} must use diagnostic primitives (AC8)`);
  // 保存 operation エラーは DiagnosticFeedback scope="operation" で表示する
  assert.match(src, /scope="operation"/, `${rel} must surface save errors as operation diagnostics (AC8)`);
  // window.alert の独自診断は残らない
  assert.doesNotMatch(src, /window\.alert\(|[^.\w]alert\(t\(/, `${rel} must not use raw alert for diagnostics (AC8)`);
}
// AppEdit の旧 is-invalid 条件付き appIDError banner が残らない
const appH = await readSrc("src/views/AppEdit.vue");
assert.doesNotMatch(appH, /appIDError && appIDError !== 'appedit\.check_uniqueness'/, "AppEdit must drop legacy is-invalid banner");
console.log("m11-t7 smoke Part H: OK");

// --- Part I: EditorTabs が nav-tabs 同等 DOM を出力し、Map/App が採用(AC9/§9) ---
const tabs = await readSrc("src/components/editor-ui/EditorTabs.vue");
assert.match(tabs, /nav-tabs/, "EditorTabs must output nav-tabs DOM (S6)");
assert.match(tabs, /nav-link/, "EditorTabs must output nav-link");
assert.match(tabs, /aria-selected/, "EditorTabs must set aria-selected");
assert.match(tabs, /role="tab"/, "EditorTabs must set role=tab");
assert.match(tabs, /tabindex/, "EditorTabs must manage tabindex");
assert.match(tabs, /disabledReasonKey|disabled-reason/, "EditorTabs must support disabled reason tooltip");
const mapI = await readSrc("src/views/MapEdit.vue");
assert.match(mapI, /EditorTabs/, "MapEdit must use EditorTabs");
assert.match(mapI, /editor_ui\.tabs\./, "MapEdit must use §9 tab vocabulary");
const appI = await readSrc("src/views/AppEdit.vue");
assert.match(appI, /EditorTabs/, "AppEdit must use EditorTabs");
assert.match(appI, /editor_ui\.tabs\./, "AppEdit must use §9 tab vocabulary");
// §9 tab 語彙(11 locale) の存在
for (const loc of LOCALES) {
  const t = JSON.parse(await readSrc(`public/locales/${loc}/translation.json`));
  assert.ok(t.editor_ui?.tabs != null, `editor_ui.tabs missing in ${loc}`);
}
// ja の §9 確定語彙
const jaI = JSON.parse(await readSrc("public/locales/ja/translation.json"));
assert.equal(jaI.editor_ui.tabs.metadata, "メタデータ編集");
assert.equal(jaI.editor_ui.tabs.gcps, "対応点編集");
assert.equal(jaI.editor_ui.tabs.base_maps, "ベースマップ選択");
assert.equal(jaI.editor_ui.tabs.pois, "POI選択");
assert.equal(jaI.editor_ui.tabs.maps, "地図選択");
assert.equal(jaI.editor_ui.tabs.preview, "プレビュー");
console.log("m11-t7 smoke Part I: OK");

// --- Part J1: placeholder 全角 …(AppEdit picker 系、AC11 = T6 Info-10 持ち越し) ---
// AppEdit の picker 検索 placeholder(ベースマップ検索)は i18n 値側に半角 ... が残っていた。
for (const loc of LOCALES) {
  const t = JSON.parse(await readSrc(`public/locales/${loc}/translation.json`));
  assert.doesNotMatch(String(t.appedit?.search_base_maps ?? ""), /\.\.\./,
    `appedit.search_base_maps must use full-width … in ${loc} (AC11)`);
}

// --- Part J2: assetDraftLifecycleCore の checkpoint clean 即時除去(D9/AC10、vite bundle → node) ---
{
  const { mkdir, mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const path = await import("node:path");
  const { build } = await import("vite");
  const projectRoot = new URL("..", import.meta.url).pathname;
  const scratchRoot = path.join(projectRoot, ".tmp-smoke");
  await mkdir(scratchRoot, { recursive: true });
  const workDir = await mkdtemp(path.join(scratchRoot, "t7-draft-core-"));
  const entryFile = path.join(workDir, "entry.ts");
  const outFile = path.join(workDir, "dist", "entry.mjs");
  await writeFile(entryFile, `
import assert from "node:assert/strict";
import { createAssetDraftLifecycleCore } from ${JSON.stringify(path.join(projectRoot, "src/composables/assetDraftLifecycleCore.ts"))};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// fake api: put/remove を記録。setTimeoutFn は callback を捕捉して手動実行する
function makeHarness() {
  const api = {
    puts: [] as unknown[],
    removed: [] as Array<{ kind: string; assetUid: string }>,
    put(draft: any) { this.puts.push(draft); return Promise.resolve(); },
    remove(kind: any, assetUid: string) { this.removed.push({ kind, assetUid }); return Promise.resolve(); },
    flushSync() { return { ok: true }; },
  };
  let pending: (() => void | Promise<void>) | null = null;
  const core = createAssetDraftLifecycleCore({
    api,
    delayMs: 1,
    setTimeoutFn: (cb) => { pending = cb; return 0 as any; },
    clearTimeoutFn: () => { pending = null; },
  });
  return { api, core, firePending: async () => { const cb = pending; pending = null; if (cb) await cb(); } };
}

// (1) dirty → 手動 persist → schedule(false)(checkpoint clean)で remove が即時呼ばれる(D9)
{
  const { api, core, firePending } = makeHarness();
  core.open({ kind: "map", assetUid: "uid-1", baseRevision: 3 }, () => ({ v: 1 }));
  core.schedule(true);
  await firePending(); // 手動 persist
  assert.equal(api.puts.length, 1);
  core.schedule(false); // Undo 等で checkpoint clean
  await flush();
  assert.deepEqual(api.removed, [{ kind: "map", assetUid: "uid-1" }]);
}

// (2) wasDirty ガード: 一度も dirty になっていない schedule(false) は remove しない
{
  const { api, core } = makeHarness();
  core.open({ kind: "app", assetUid: "uid-2", baseRevision: null }, () => ({}));
  core.schedule(false);
  await flush();
  assert.deepEqual(api.removed, []);
}

// (3) clean → clean の再 schedule(false) は remove を重ねない(遷移時のみ)
{
  const { api, core, firePending } = makeHarness();
  core.open({ kind: "map", assetUid: "uid-3", baseRevision: 1 }, () => ({}));
  core.schedule(true);
  await firePending();
  core.schedule(false);
  await flush();
  core.schedule(false);
  await flush();
  assert.equal(api.removed.length, 1);
}

console.log("m11-t7 draft core unit: OK");
`);
  await build({
    root: workDir,
    configFile: false,
    logLevel: "error",
    build: {
      outDir: path.join(workDir, "dist"),
      lib: { entry: entryFile, formats: ["es"], fileName: () => "entry.mjs" },
      rollupOptions: { external: ["node:assert/strict"] },
      minify: false,
      emptyOutDir: true,
    },
  });
  await import(path.resolve(outFile));
  await rm(workDir, { recursive: true, force: true });
}
console.log("m11-t7 smoke Part J: OK");
