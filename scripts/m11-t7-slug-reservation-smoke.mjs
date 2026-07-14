import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";

// SlugReservationService は electron 依存なしの純ロジックにするため、node で直接 import できる。
// (electron の app/ipcMain には依存させない — 接続と instanceId/now を注入する)
import { createSlugReservationService } from "../electron/services/SlugReservationService.ts";
import { toRegistryKind, toDraftKind } from "../electron/services/slugReservationKind.ts";

const readSrc = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");

// --- 一時 DB を作り slug_reservations スキーマを張る ---
function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(`
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
