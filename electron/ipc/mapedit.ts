import { ipcMain } from 'electron';
import MapEditService from '../services/MapEditService';
// @ts-ignore
import Tin from '@maplat/tin';

async function createTinFromGcpsAsync(
    gcps: any[], edges: any[], wh: any, bounds: any, strict: any, vertex: any
): Promise<any> {
    if (gcps.length < 3) return 'tooLessGcps';
    return new Promise((resolve, reject) => {
        const tin = new Tin({});
        if (wh) {
            tin.setWh(wh);
        } else if (bounds) {
            tin.setBounds(bounds);
        } else {
            reject('Both wh and bounds are missing');
            return;
        }
        tin.setStrictMode(strict);
        tin.setVertexMode(vertex);
        tin.setPoints(gcps);
        tin.setEdges(edges);
        tin.updateTinAsync()
            .then(() => {
                resolve(tin.getCompiled());
            })
            .catch((err: any) => {
                const e = String(err);
                console.log('[mapedit:updateTin] TIN error:', e);
                if (e.includes('SOME POINTS OUTSIDE')) resolve('pointsOutside');
                else if (e.indexOf('TOO LINEAR') === 0) resolve('tooLinear');
                else if (e.includes('Vertex indices') || e.includes('is degenerate!') ||
                    e.includes('already exists or intersects with an existing edge!')) resolve('edgeError');
                else reject(err);
            });
    });
}

export const registerMapEditHandlers = () => {
    ipcMain.handle('mapedit:request', async (_event, mapID: string) => {
        try {
            return await MapEditService.request(mapID);
        } catch (e) {
            console.error('Failed to handle mapedit:request', e);
            throw e;
        }
    });

    // TIN計算をNode.jsプロセスで実行してコンパイル済みデータを返す
    ipcMain.handle('mapedit:updateTin', async (
        _event,
        gcps: any[], edges: any[], index: number, bounds: any, strict: any, vertex: any
    ) => {
        try {
            const wh = index === 0 ? bounds : null;
            const bd = index !== 0 ? bounds : null;
            const compiled = await createTinFromGcpsAsync(gcps, edges, wh, bd, strict, vertex);
            return [index, compiled];
        } catch (e) {
            console.error('Failed to handle mapedit:updateTin', e);
            throw e;
        }
    });
};

