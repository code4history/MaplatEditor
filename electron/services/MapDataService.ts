import fs from 'fs-extra';
import path from 'path';
import Datastore from '@seald-io/nedb';
import { BrowserWindow } from 'electron';
import SettingsService from './SettingsService';
import * as storeHandler from '../utils/store_handler';
import { ProgressReporter } from '../utils/ProgressReporter';

class MapDataService {
  private db: Datastore | null = null;

  private get folders() {
    const saveFolder = SettingsService.get('saveFolder');
    return {
      saveFolder,
      tileFolder: path.join(saveFolder, "tiles"),
      originalFolder: path.join(saveFolder, "originals"),
      uiThumbnailFolder: path.join(saveFolder, "tmbs"),
      mapFolder: path.join(saveFolder, "maps"),
      compFolder: path.join(saveFolder, "compiled"),
      dbFile: path.join(saveFolder, "nedb.db")
    };
  }

  private async getDB(): Promise<Datastore> {
    if (this.db) return this.db;
    const { dbFile } = this.folders;
    this.db = new Datastore({ filename: dbFile, autoload: true });
    return this.db;
  }

  async migrateIfNeeded(window: BrowserWindow) {
    const { compFolder } = this.folders;
    try {
      if (!fs.existsSync(compFolder)) return;
      if (fs.existsSync(path.join(compFolder, ".updated"))) return;

      await this.runMigration(window);
    } catch (e) {
      console.error("Migration check failed", e);
    }
  }

  async runMigration(window: BrowserWindow) {
    const { compFolder } = this.folders;
    const mapFiles = await fs.readdir(compFolder);
    const db = await this.getDB();
    
    const jsonFiles = mapFiles.filter(f => f.endsWith('.json'));
    const reporter = new ProgressReporter("taskProgress", jsonFiles.length, 'maplist.migrating', 'maplist.migrated');
    reporter.setWindow(window);

    let count = 0;
    reporter.update(0);

    for (const file of jsonFiles) {
      const mapID = file.replace('.json', '');
      try {
        const jsonLoad = await fs.readJson(path.join(compFolder, file));
        const [store, tins] = await storeHandler.store2HistMap(jsonLoad as any);
        const finalStore = await storeHandler.histMap2Store(store, tins);
        
        await db.updateAsync({ _id: mapID }, { $set: finalStore }, { upsert: true });
      } catch (e) {
        console.error(`Failed to migrate ${file}`, e);
      }
      count++;
      reporter.update(count);
      await new Promise(r => setTimeout(r, 50));
    }

    await fs.writeFile(path.join(compFolder, ".updated"), "done");
  }

  async requestMaps(query: string = '', page: number = 1, pageSize: number = 20): Promise<any> {
    const db = await this.getDB();
    let queryObj: any = {};
    if (query) {
       const regex = new RegExp(query, 'i');
       queryObj = { $or: [{ 'title.ja': regex }, { 'title.en': regex }, { title: regex }, { name: regex }] };
    }

    const skip = (page - 1) * pageSize;
    console.log(`[MapDataService] Requesting maps: query='${query}', page=${page}, skip=${skip}, limit=${pageSize}`);
    
    // Use manual Promise wrapper for exec() to ensure compatibility specific NeDB versions
    const docs = await new Promise<any[]>((resolve, reject) => {
        db.find(queryObj).sort({ _id: 1 }).skip(skip).limit(pageSize).exec((err: any, documents: any[]) => {
            if (err) reject(err);
            else resolve(documents);
        });
    });

    const results = await Promise.all(docs.map(async (doc: any) => {
        const mapID = doc._id || doc.mapID;
        let title = doc.title;
        if (typeof title === 'object') {
            title = title.ja || title.en || Object.values(title)[0];
        }

        const width = doc.width || (doc.compiled && doc.compiled.wh && doc.compiled.wh[0]);
        const height = doc.height || (doc.compiled && doc.compiled.wh && doc.compiled.wh[1]);

        const res: any = {
            mapID: mapID,
            title: title || mapID,
            width: width,
            height: height,
            image: null
        };

        // Legacy Aspect Ratio Logic (from backend/src/maplist.js)
        // Adjust width/height to fit within 190x190 while preserving aspect ratio
        if (res.width && res.height) {
            if (res.width > res.height) {
                res.height = Math.round(res.height * 190 / res.width);
                res.width = 190;
            } else {
                res.width = Math.round(res.width * 190 / res.height);
                res.height = 190;
            }
        } else {
            // Fallback if dimensions missing: assume square or standard ratio
            // Better to default to *showing* the image at max 190x190 via CSS if we don't know dimensions, 
            // but for now let's set a default 190x140 as a guess if it's landscape, or 190x190 if unknown.
            res.width = 190;
            res.height = 190;
        }

        const { tileFolder } = this.folders;
        // Search for level 0 tile directly in tiles directory
        const thumbFolder = path.join(tileFolder, mapID, "0", "0");
        let foundTile = false;

        if (fs.existsSync(thumbFolder)) {
             try {
                 const files = await fs.readdir(thumbFolder);
                 // Look for 0.jpg, 0.jpeg, 0.png
                 const tileFile = files.find(f => /^0\.(jpg|jpeg|png)$/.test(f));
                 if (tileFile) {
                     const tilePath = path.join(thumbFolder, tileFile);
                     // Replace backslashes with slashes for file:// URL
                     res.image = `file://${tilePath.split(path.sep).join('/')}`;
                     foundTile = true;
                 }
             } catch (e) {
                 console.error(`Error reading existing search result tile for ${mapID}`, e);
             }
        }
        
        if (!foundTile) {
            // Fallback to no image or legacy check if needed, but primarily rely on tiles
             res.image = null; 
        }
        return res;
    }));
    return results;
  }

  async generateThumbnail(from: string, to: string) {
      // Legacy behavior: Copy raw level 0 tile (256x256) directly without resizing
      // This ensures the image is "crisp" and not "sleepy"
      if (!fs.existsSync(path.dirname(to))) {
          await fs.ensureDir(path.dirname(to));
      }
      await fs.copy(from, to, { overwrite: true });
  }

  async switchDataFolder() {
      // Clear existing DB connection
      this.db = null;
      
      const { tileFolder, originalFolder, uiThumbnailFolder, mapFolder, compFolder } = this.folders;
      
      // Ensure all necessary folders exist
      try {
          await fs.ensureDir(tileFolder);
          await fs.ensureDir(originalFolder);
          await fs.ensureDir(uiThumbnailFolder);
          await fs.ensureDir(mapFolder);
          await fs.ensureDir(compFolder);
          console.log(`[MapDataService] Data folder switched and initialized: ${SettingsService.get('saveFolder')}`);
      } catch (e) {
          console.error("[MapDataService] Failed to initialize new data folders", e);
      }
  }
}

export default new MapDataService();
