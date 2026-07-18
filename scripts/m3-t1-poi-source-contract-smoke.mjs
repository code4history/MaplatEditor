import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const workDir = await mkdtemp(path.join(tmpdir(), 'maplat-editor-m3-t1-'));

try {
  // --- Part 1: Contract export shape ---
  const contractSource = await readFile(
    path.join(projectRoot, 'src/services/registeredPoiSourceCatalog.ts'),
    'utf8'
  );

  assert.match(contractSource, /export\s+type\s+PoiSourceCatalogKey/, 'PoiSourceCatalogKey がない');
  assert.match(contractSource, /export\s+type\s+PoiSourceMode/, 'PoiSourceMode がない');
  assert.match(contractSource, /export\s+type\s+PoiSourceStatus/, 'PoiSourceStatus がない');
  assert.match(contractSource, /export\s+type\s+PoiSourceValidationErrorCode/, 'PoiSourceValidationErrorCode がない');
  assert.match(contractSource, /export\s+interface\s+PoiSourceValidation/, 'PoiSourceValidation がない');
  assert.match(contractSource, /export\s+interface\s+PoiSourceSummary/, 'PoiSourceSummary がない');
  assert.match(contractSource, /export\s+interface\s+PoiSourceListRequest/, 'PoiSourceListRequest がない');
  assert.match(contractSource, /export\s+interface\s+PoiSourceListResponse/, 'PoiSourceListResponse がない');
  assert.match(contractSource, /export\s+type\s+PoiFeatureCollection/, 'PoiFeatureCollection がない');
  assert.match(contractSource, /export\s+interface\s+PoiSourceDocument/, 'PoiSourceDocument がない');
  assert.match(contractSource, /export\s+interface\s+PoiSourceCreateLocalInput/, 'PoiSourceCreateLocalInput がない');
  assert.match(contractSource, /export\s+interface\s+PoiSourceRegisterRemoteInput/, 'PoiSourceRegisterRemoteInput がない');
  assert.match(contractSource, /export\s+type\s+PoiSourceValidateRemoteInput/, 'PoiSourceValidateRemoteInput がない');
  assert.match(contractSource, /export\s+interface\s+SelectedPoiSourceRef/, 'SelectedPoiSourceRef がない');

  assert.doesNotMatch(contractSource, /interface\s+PoiSourceSummary[\s\S]*?storagePath/, 'PoiSourceSummary に storagePath が残存している');
  assert.match(contractSource, /kind\s*:\s*"source"/, 'PoiSourceValidateRemoteInput に kind: "source" がない');
  assert.match(contractSource, /kind\s*:\s*"url"/, 'PoiSourceValidateRemoteInput に kind: "url" がない');

  console.log('  [1/6] Contract export shape: PASS');

  // --- Part 2: Storage backend shape (v2: Write Store 上の薄い domain layer) ---
  const serviceSource = await readFile(
    path.join(projectRoot, 'electron/services/PoiSourceService.ts'),
    'utf8'
  );

  // 正本は SqliteDataService (poi_sources テーブル)。旧 electron-store + poi-sources/ ファイル
  // 実装の残滓が無いこと
  assert.match(serviceSource, /from\s+['"]\.\/SqliteDataService['"]/, 'PoiSourceService が SqliteDataService を使っていない');
  assert.doesNotMatch(serviceSource, /from\s+['"]electron-store['"]/, 'PoiSourceService に electron-store import が残存している');
  assert.doesNotMatch(serviceSource, /from\s+['"]fs-extra['"]/, 'PoiSourceService に fs-extra import が残存している');
  assert.doesNotMatch(serviceSource, /storageRelativePath/, 'PoiSourceService に storageRelativePath が残存している');
  assert.doesNotMatch(serviceSource, /app\.getPath/, 'PoiSourceService に app.getPath が残存している (userData 直書きの旧実装)');
  assert.doesNotMatch(contractSource, /storageRelativePath/, 'renderer contract に storageRelativePath が残存している');

  console.log('  [2/6] Storage backend shape: PASS');

  // --- Part 3: Validation delegation ---
  // GeoJSON 検証・正規化は src/utils/poiGeoJson.ts の純関数へ委譲し重複実装しない
  // (検証ロジック自体の単体検証は m9-t1、service 経由の実挙動は m9-t3 が担う)
  assert.match(
    serviceSource,
    /from\s+['"]\.\.\/\.\.\/src\/utils\/poiGeoJson['"]/,
    'PoiSourceService が poiGeoJson 純関数を import していない'
  );
  assert.match(serviceSource, /validateFeatureCollection/, 'PoiSourceService が validateFeatureCollection を使っていない');
  // M11: legacy 正規化は poiGeoJson.normalizePoiSourceCollection に集約され、service はその窓口を使う
  assert.match(serviceSource, /normalizePoiSourceCollection/, 'PoiSourceService が normalizePoiSourceCollection を使っていない');
  const poiGeoJsonSource = await readFile(
    path.join(projectRoot, 'src/utils/poiGeoJson.ts'),
    'utf8'
  );
  assert.match(poiGeoJsonSource, /export function normalizePoiSourceCollection[\s\S]{0,400}?normalizeLegacyPoiList/,
    'normalizePoiSourceCollection が normalizeLegacyPoiList を内包していない');
  assert.match(serviceSource, /ensureDisplayIds/, 'PoiSourceService が ensureDisplayIds を使っていない');
  assert.match(serviceSource, /ensureFeatureUids/, 'PoiSourceService が ensureFeatureUids を使っていない');
  // level='error' issue が 1 つでもあれば保存/取込を拒否する
  assert.match(serviceSource, /level\s*===\s*['"]error['"]/, 'PoiSourceService に error-level 拒否ガードがない');
  assert.match(serviceSource, /['"]Invalid['"]/, 'PoiSourceService に Invalid 結果がない');

  console.log('  [3/6] Validation delegation: PASS');

  // --- Part 4: Title normalization + save path ---
  // title は保存/import/登録の全経路で normalizeLangResource を通し内部形を強制 (ADR-0005)
  assert.match(serviceSource, /normalizeLangResource/, 'PoiSourceService が normalizeLangResource を使っていない');
  // 保存は revision 楽観ロック付き upsert (maps/apps と同じ RevisionConflictError 写像)
  assert.match(serviceSource, /upsertPoiSource/, 'PoiSourceService が upsertPoiSource を使っていない');
  assert.match(serviceSource, /RevisionConflictError/, 'PoiSourceService が RevisionConflictError を扱っていない');
  assert.match(serviceSource, /['"]revision-conflict['"]/, 'PoiSourceService が revision-conflict 結果を返していない');

  console.log('  [4/6] Title normalization + save path: PASS');

  // --- Part 5: Remote fetch guard ---
  // http/https のみ許可 + POI-121 の payload サイズガード (warn/max)
  assert.match(serviceSource, /https?:/, 'PoiSourceService に scheme 検査がない');
  assert.match(serviceSource, /payload-too-large/, 'PoiSourceService に payload-too-large ガードがない');
  assert.match(serviceSource, /remoteWarnBytes|REMOTE_WARN_BYTES/, 'PoiSourceService に warn 閾値がない');
  assert.match(serviceSource, /remoteMaxBytes|REMOTE_MAX_BYTES/, 'PoiSourceService に max 閾値がない');
  // 明示再取得 (POI-118)
  assert.match(serviceSource, /refreshRemote/, 'PoiSourceService に refreshRemote がない');

  console.log('  [5/6] Remote fetch guard: PASS');

  // --- Part 6: Remote read-only guard ---
  // remote ソースへの save は拒否 (read-only、cloneToLocal へ誘導)
  assert.match(serviceSource, /['"]ReadOnly['"]/, 'PoiSourceService に ReadOnly 結果がない');
  assert.match(serviceSource, /cloneToLocal/, 'PoiSourceService に cloneToLocal がない');
  // singleton default export (AppDataService と同機構)
  assert.match(serviceSource, /export\s+default\s+new\s+PoiSourceService/, 'PoiSourceService が singleton を export default していない');

  console.log('  [6/6] Remote read-only guard: PASS');

  console.log('M3-T1 poi-source-contract smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
