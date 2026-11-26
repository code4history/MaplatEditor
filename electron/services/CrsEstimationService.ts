import { randomUUID } from 'node:crypto';
import type { UtilityProcess } from 'electron';
import type { CrsCandidateInput, CrsEstimationInput, CrsEstimationResponse } from '../../src/types/crsEstimation';
import { OVERALL_TIMEOUT_MS, type CrsEstimationRequest, type CrsEstimationWorkerResult } from '../workers/crsEstimationProtocol.ts';

const MAX_ESTIMATION_GCPS = 500;
const IDLE_TTL_MS = 5 * 60_000;
const CANCEL_GRACE_MS = 1_500;
const STOP_WAIT_MS = 5_000;

type Child = Pick<UtilityProcess, 'on' | 'postMessage' | 'kill'>;
type Timer = ReturnType<typeof setTimeout>;
type StopReason = 'canceled' | 'timeout';

interface ActiveRequest {
  requestId: string;
  resolve: (result: CrsEstimationResponse) => void;
  watchdog: Timer;
  grace?: Timer;
  stopReason?: StopReason;
}

interface StoppingChild {
  child: Child;
  promise: Promise<boolean>;
  resolve: (exited: boolean) => void;
  timer?: Timer;
  killAccepted?: boolean;
}

function isFinitePair(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

function isValidInput(input: CrsEstimationInput, candidateId?: string): boolean {
  return Array.isArray(input?.gcps) && input.gcps.length >= 3 &&
    (input.onshoreOnly === undefined || typeof input.onshoreOnly === 'boolean') &&
    (candidateId === undefined || (typeof candidateId === 'string' && /^[^:\s]+:[^:\s]+$/.test(candidateId))) &&
    Array.from(input.gcps).every(point => isFinitePair(point?.pixel) && isFinitePair(point?.geo));
}

export class CrsEstimationService {
  private child: Child | undefined;
  private stoppingChild: StoppingChild | undefined;
  private active: ActiveRequest | undefined;
  private starting = false;
  private idleTimer: Timer | undefined;
  private disposed = false;
  private readonly fork: () => Child;
  private readonly overallTimeoutMs: number;
  private readonly cancelGraceMs: number;
  private readonly idleTtlMs: number;
  private readonly stopWaitMs: number;

  constructor(
    fork: () => Child,
    timings: { overallTimeoutMs?: number; cancelGraceMs?: number; idleTtlMs?: number; stopWaitMs?: number } = {},
  ) {
    this.fork = fork;
    this.overallTimeoutMs = timings.overallTimeoutMs ?? OVERALL_TIMEOUT_MS;
    this.cancelGraceMs = timings.cancelGraceMs ?? CANCEL_GRACE_MS;
    this.idleTtlMs = timings.idleTtlMs ?? IDLE_TTL_MS;
    this.stopWaitMs = timings.stopWaitMs ?? STOP_WAIT_MS;
  }

  estimate(input: CrsEstimationInput): Promise<CrsEstimationResponse> {
    return this.start(input);
  }

  estimateCandidate(input: CrsCandidateInput): Promise<CrsEstimationResponse> {
    return this.start(input, input?.candidateId ?? '');
  }

  private async start(input: CrsEstimationInput, candidateId?: string): Promise<CrsEstimationResponse> {
    const requestId = randomUUID();
    if (input?.gcps?.length > MAX_ESTIMATION_GCPS) {
      return { requestId, status: 'failed', failureReason: 'too_many_gcps' };
    }
    if (!isValidInput(input, candidateId)) {
      return { requestId, status: 'failed', failureReason: 'invalid_input' };
    }
    if (this.disposed || this.active || this.starting) {
      return { requestId, status: 'failed', failureReason: 'busy' };
    }

    clearTimeout(this.idleTimer);
    this.starting = true;
    try {
      const stopping = this.stoppingChild;
      if (stopping && !(await stopping.promise)) {
        return { requestId, status: 'failed', failureReason: 'worker_crashed', errorMessage: 'CRS 推定プロセスの終了を確認できませんでした' };
      }
      if (this.disposed) return { requestId, status: 'failed', failureReason: 'busy' };
      const child = this.child ?? this.spawn();
      return await new Promise(resolve => {
        const watchdog = setTimeout(() => this.stop('timeout'), this.overallTimeoutMs);
        this.active = { requestId, resolve, watchdog };
        const message: CrsEstimationRequest = { type: 'estimate', requestId, input, candidateId };
        try {
          child.postMessage(message);
        } catch (error) {
          this.failWorker(String(error));
        }
      });
    } catch (error) {
      this.dropChild();
      return { requestId, status: 'failed', failureReason: 'worker_crashed', errorMessage: String(error) };
    } finally {
      this.starting = false;
    }
  }

  private spawn(): Child {
    const child = this.fork();
    this.child = child;
    child.on('message', (message: CrsEstimationWorkerResult) => {
      const active = this.active;
      if (child !== this.child || !active || message?.type !== 'result' ||
          message.requestId !== active.requestId) return;

      const { type: _type, ...result } = message;
      const stopped = this.stoppedResult(active);
      this.finish(stopped ?? result, Boolean(stopped) ||
        (result.status === 'failed' && ['timeout', 'worker_error', 'estimation_failed'].includes(result.failureReason)));
    });
    child.on('exit', code => {
      if (child !== this.child) return;
      this.child = undefined;
      this.markChildExited(child);
      this.failWorker(`CRS 推定プロセスが終了しました（終了コード: ${code}）`);
    });
    child.on('error', (_type, location, report) => {
      if (child === this.child) this.failWorker(location || report || 'CRS 推定プロセスでエラーが発生しました');
    });
    return child;
  }

  cancel(requestId?: string): boolean {
    const active = this.active;
    if (!active || (requestId !== undefined && requestId !== active.requestId)) return false;
    this.stop('canceled');
    return true;
  }

  private stop(reason: StopReason): void {
    const active = this.active;
    if (!active || active.stopReason) return;
    active.stopReason = reason;
    clearTimeout(active.watchdog);
    active.grace = setTimeout(() => this.finish(this.stoppedResult(active)!, true), this.cancelGraceMs);
    try {
      const message: CrsEstimationRequest = { type: 'cancel', requestId: active.requestId };
      this.child?.postMessage(message);
    } catch {
      this.finish(this.stoppedResult(active)!, true);
    }
  }

  private stoppedResult({ requestId, stopReason }: ActiveRequest): CrsEstimationResponse | undefined {
    if (stopReason === 'canceled') return { requestId, status: 'canceled' };
    if (stopReason === 'timeout') return { requestId, status: 'failed', failureReason: 'timeout' };
  }

  private failWorker(errorMessage: string): void {
    this.dropChild();
    const active = this.active;
    if (!active) return;
    this.finish(this.stoppedResult(active) ?? {
      requestId: active.requestId, status: 'failed', failureReason: 'worker_crashed', errorMessage,
    }, true);
  }

  private finish(result: CrsEstimationResponse, recycle: boolean): void {
    const active = this.active;
    if (!active) return;
    this.active = undefined;
    clearTimeout(active.watchdog);
    clearTimeout(active.grace);
    // 取消や異常終了の後は PROJ の未完了処理を含めてプロセスごと破棄する。
    if (recycle) this.dropChild();
    else this.idleTimer = setTimeout(() => this.dropChild(), this.idleTtlMs);
    active.resolve(result);
  }

  private dropChild(): void {
    clearTimeout(this.idleTimer);
    const child = this.child;
    if (!child || this.stoppingChild?.child === child) return;

    let resolve!: (exited: boolean) => void;
    const promise = new Promise<boolean>(done => { resolve = done; });
    const stopping: StoppingChild = { child, promise, resolve };
    this.stoppingChild = stopping;
    // kill() が false を返す場合も終了イベントが届くかを期限まで確認し、参照はその間保持する。
    try {
      stopping.killAccepted = child.kill();
    } catch {
      // kill の失敗も終了待ちにし、期限切れなら次の子を起動させない。
    }
    stopping.timer = setTimeout(() => resolve(false), this.stopWaitMs);
    void promise.then(exited => {
      clearTimeout(stopping.timer);
      if (exited && this.stoppingChild === stopping) this.stoppingChild = undefined;
    });
  }

  private markChildExited(child: Child): void {
    const stopping = this.stoppingChild;
    if (stopping?.child !== child) return;
    clearTimeout(stopping.timer);
    this.stoppingChild = undefined;
    stopping.resolve(true);
  }

  dispose(): void {
    this.disposed = true;
    if (this.active) this.finish({ requestId: this.active.requestId, status: 'canceled' }, true);
    else this.dropChild();
  }
}
