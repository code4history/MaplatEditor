import { ipcMain } from 'electron';
import AppDraftService from '../services/AppDraftService';

export function registerAppDraftHandlers() {
  ipcMain.handle('appdraft:save', async (_event, draft) => {
    AppDraftService.save(draft);
  });

  ipcMain.handle('appdraft:load', async () => {
    return AppDraftService.load();
  });
}
