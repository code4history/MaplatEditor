import MapDataService from '../services/MapDataService';
import MapEditService from '../services/MapEditService';
import SqliteDataService from '../services/SqliteDataService';
import {
  ServiceBackedStorageAdapter,
} from './StorageAdapter';

export default new ServiceBackedStorageAdapter({
  listMaps: (query, page, pageSize, options) => MapDataService.requestMaps(query, page, pageSize, options),
  deleteMap: (uidOrMapID) => MapDataService.deleteMap(uidOrMapID),
  readMapForEdit: (uidOrMapID) => MapEditService.request(uidOrMapID),
  readMapForPreview: (uidOrMapID) => MapEditService.requestPreviewSource(uidOrMapID),
  saveMapForEdit: (request) => MapEditService.save(request),
  // slugの可用性判定はasset_registry横断(map/app/base_map全kind)で一意性を見る (資産の正本の識別子は変わらない uid とし、slug は全種類で一意な利用者向けの名前とする決まり)
  isSlugAvailable: (slug, excludeUid) => SqliteDataService.isSlugAvailable(slug, excludeUid),
});
