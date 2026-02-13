import path from 'path';
import fs from 'fs-extra';
// @ts-ignore
import fileUrl from 'file-url';
import MapDataService from './MapDataService';
import * as storeHandler from '../utils/store_handler';
import SettingsService from './SettingsService';

class MapEditService {
    async request(mapID: string) {
        const db = await MapDataService.getDBInstance();
        const json = await db.findOneAsync({ _id: mapID });

        if (!json) throw new Error(`Map with ID ${mapID} not found`);

        const saveFolder = SettingsService.get('saveFolder');
        const tileFolder = path.join(saveFolder, "tiles");
        // Legacy path structure: tiles/mapID/0/0
        const thumbFolder = path.join(tileFolder, mapID, "0", "0");

        const res = await this.normalizeRequestData(json, thumbFolder);

        // Add additional MapEdit specific fields
        res[0].mapID = mapID;
        res[0].status = 'Update';
        res[0].onlyOne = true; // Since it exists in DB

        return res[0];
    }

    private async normalizeRequestData(json: any, thumbFolder: string) {
        let url_: string | undefined;
        // Check if map dimensions are ready
        const whReady = (json.width && json.height) || (json.compiled && json.compiled.wh);
        
        if (!whReady) {
            // Return as is if dimensions not ready? Legacy does this.
            return [json];
        }

        if (json.url) {
            url_ = json.url;
        } else {
             try {
                if (await fs.pathExists(thumbFolder)) {
                    const thumbs = await fs.readdir(thumbFolder);
                    const tileFile = thumbs.find(f => /^0\.(jpg|jpeg|png)$/.test(f));
                    if (tileFile) {
                        // Construct tile URL pattern
                        // file-url returns file:///...
                        // We need to transform .../0/0/0.ext to .../{z}/{x}/{y}.ext
                        let thumbURL = fileUrl(path.join(thumbFolder, tileFile));
                        
                        // Legacy replacement logic:
                        // thumbURL is like file:///.../tiles/mapId/0/0/0.jpg
                        // We want file:///.../tiles/mapId/{z}/{x}/{y}.jpg
                        // Note: path separator handling might be tricky with fileUrl on Windows
                        
                        // Robust replacement:
                        // Find the last occurrence of /0/0/0.
                        const pattern = /\/0\/0\/0\.(jpg|jpeg|png)$/;
                        url_ = thumbURL.replace(pattern, '/{z}/{x}/{y}.$1');
                    }
                }
             } catch (e) {
                 console.error("Error finding tiles:", e);
             }
        }

        const [store, tins] = await storeHandler.store2HistMap(json, true);
        (store as any).url_ = url_;

        const res = [store, tins];
        return res;
    }
}

export default new MapEditService();
