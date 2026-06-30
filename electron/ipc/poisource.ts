import { ipcMain } from 'electron';
import PoiSourceService from '../services/PoiSourceService';

const service = new PoiSourceService();

export function registerPoisourceHandlers() {
  ipcMain.handle('poisource:list', (_, request) => service.list(request));
  ipcMain.handle('poisource:get', (_, sourceId) => service.get(sourceId));
  ipcMain.handle('poisource:createLocal', (_, input) => service.createLocal(input));
  ipcMain.handle('poisource:registerRemote', (_, input) => service.registerRemote(input));
  ipcMain.handle('poisource:validateRemote', (_, input) => service.validateRemote(input));
  ipcMain.handle('poisource:saveLocal', (_, sourceId, geojson) => service.saveLocal(sourceId, geojson));
  ipcMain.handle('poisource:delete', (_, sourceId) => service.delete(sourceId));
}
