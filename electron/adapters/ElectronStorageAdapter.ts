import MapDataService from '../services/MapDataService';
import MapEditService from '../services/MapEditService';
import SqliteDataService from '../services/SqliteDataService';
import {
  ServiceBackedStorageAdapter,
} from './StorageAdapter';

export default new ServiceBackedStorageAdapter({
  listMaps: (query, page, pageSize) => MapDataService.requestMaps(query, page, pageSize),
  deleteMap: (mapID) => MapDataService.deleteMap(mapID),
  readMapForEdit: (mapID) => MapEditService.request(mapID),
  readMapForPreview: (mapID) => MapEditService.requestPreviewSource(mapID),
  saveMapForEdit: (mapObject, tins) => MapEditService.save(mapObject, tins),
  // IDの可用性判定はWrite Storeに一本化する。Maplat地図とベースマップ(ビルトイン含む)は
  // ID空間を共有するため(tmbs/{mapID}.* を共有)、maps/base_maps横断で判定される
  isMapIdAvailable: (mapID) => SqliteDataService.isMapIdAvailable(mapID),
});
