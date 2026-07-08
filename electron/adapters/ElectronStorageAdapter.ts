import MapDataService from '../services/MapDataService';
import MapEditService from '../services/MapEditService';
import SqliteDataService from '../services/SqliteDataService';
import {
  ServiceBackedStorageAdapter,
} from './StorageAdapter';

export default new ServiceBackedStorageAdapter({
  listMaps: (query, page, pageSize) => MapDataService.requestMaps(query, page, pageSize),
  deleteMap: (uidOrMapID) => MapDataService.deleteMap(uidOrMapID),
  readMapForEdit: (uidOrMapID) => MapEditService.request(uidOrMapID),
  readMapForPreview: (uidOrMapID) => MapEditService.requestPreviewSource(uidOrMapID),
  saveMapForEdit: (request) => MapEditService.save(request),
  // slugの可用性判定はasset_registry横断(map/app/base_map全kind)で一意性を見る (ADR-0007)
  isSlugAvailable: (slug, excludeUid) => SqliteDataService.isSlugAvailable(slug, excludeUid),
});
