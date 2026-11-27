import { utilityProcess } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CrsCandidateInput, CrsEstimationInput } from '../../src/types/crsEstimation';
import { CrsEstimationService } from '../services/CrsEstimationService';
import { ipc } from './registry';

const service = new CrsEstimationService(() => utilityProcess.fork(
  join(dirname(fileURLToPath(import.meta.url)), 'crsEstimationProcess.js'),
  [],
  { serviceName: 'Maplat CRS 推定', stdio: 'ignore' },
));

export function registerCrsHandlers(): void {
  ipc.handle('crs:estimate', (_event, input: CrsEstimationInput) => service.estimate(input));
  ipc.handle('crs:estimateCandidate', (_event, input: CrsCandidateInput) => service.estimateCandidate(input));
  ipc.handle('crs:cancel', (_event, requestId?: string) => service.cancel(requestId));
}

export function disposeCrsEstimation(): void {
  service.dispose();
}
