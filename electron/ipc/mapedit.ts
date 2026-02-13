import { ipcMain } from 'electron';
import MapEditService from '../services/MapEditService';

export const registerMapEditHandlers = () => {
    ipcMain.handle('mapedit:request', async (event, mapID: string) => {
        try {
            return await MapEditService.request(mapID);
        } catch (e) {
            console.error('Failed to handle mapedit:request', e);
            throw e;
        }
    });

    // Placeholder for other handlers (Phase 3+)
    /*
    ipcMain.handle('mapedit:updateTin', ...)
    */
};
