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

// --- Part C2: useSlugAvailability の 6 状態写像（D1） ---
const avail = await readSrc("src/composables/useSlugAvailability.ts");
assert.match(avail, /invalid-format|invalid_format/, "must expose invalid-format state (D1)");
assert.match(avail, /reserved-by-other/, "must map taken -> reserved-by-other (D1)");
assert.match(avail, /check-failed|check_failed/, "must map unavailable -> check-failed (D1)");

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
