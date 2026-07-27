import Store from 'electron-store';
import fs from 'fs-extra';
import { AssetDraftStore } from '../../src/services/assetDraftStore';
import { resolveRuntimeStoragePaths } from './runtimeStoragePaths';
import { draftTileRoot, defaultDraftTileRoot, resolveDraftTileDir } from './draftTilePaths';
import { app } from 'electron';
import path from 'node:path';

const runtimeStoragePaths = resolveRuntimeStoragePaths(
  process.env.MAPLAT_E2E_ROOT,
  path.join(app.getPath('documents'), app.getName()),
  defaultDraftTileRoot(),
);
const store = new Store<Record<string, unknown>>(
  runtimeStoragePaths.assetDraftStoreCwd ? { cwd: runtimeStoragePaths.assetDraftStoreCwd } : {},
);

// M12-T20 (§5.1/§6.3): draft 削除の main 側チョークポイント。map kind の envelope 削除に
// 同期して staging dir (<draftTileRoot>/<assetUid>) を回収する。
// - パスは必ず共通バリデータ resolveDraftTileDir で解決（§5.0。null なら削除を skip して
//   warn — envelope 削除自体は完遂し、残渣は次回起動時孤児 GC の対象）
// - 削除プリミティブは fs.remove（symlink 非追従。§6.1 の契約 — リンク先へ降りない）
export default new AssetDraftStore(store, {
  onRemoved: (kind, assetUid) => {
    if (kind !== 'map') return;
    const stagingDir = resolveDraftTileDir(draftTileRoot, assetUid);
    if (!stagingDir) {
      console.warn(`[AssetDraftService] skip staging cleanup: unresolvable assetUid ${JSON.stringify(assetUid)}`);
      return;
    }
    void fs.remove(stagingDir).catch((cause) => {
      // 回収失敗は起動時孤児 GC が最終回収する（§6.3）
      console.warn(`[AssetDraftService] staging cleanup failed for ${stagingDir}:`, cause);
    });
  },
});
