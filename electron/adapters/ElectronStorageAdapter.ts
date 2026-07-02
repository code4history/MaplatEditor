import MapDataService from '../services/MapDataService';
import MapEditService from '../services/MapEditService';
import {
  ServiceBackedStorageAdapter,
} from './StorageAdapter';

export default new ServiceBackedStorageAdapter({
  listMaps: (query, page, pageSize) => MapDataService.requestMaps(query, page, pageSize),
  deleteMap: (mapID) => MapDataService.deleteMap(mapID),
  readMapForEdit: (mapID) => MapEditService.request(mapID),
  readMapForPreview: async (mapID) => {
    const db = await MapDataService.getDBInstance();
    const found = await db.findOneAsync({ _id: mapID });
    if (!found) throw new Error(`Map with ID ${mapID} not found`);
    return { ...found, mapID };
  },
  saveMapForEdit: (mapObject, tins) => MapEditService.save(mapObject, tins),
  isMapIdAvailable: async (mapID) => {
    const db = await MapDataService.getDBInstance();
    const found = await db.findOneAsync({ _id: mapID });
    return !found;
  },
});
