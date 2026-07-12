import { BrowserWindow } from 'electron';

export interface ProgressReporterOptions {
  // 送信throttleの%変化しきい値。既定5(旧実装踏襲: 6%以上の変化で送信)。
  // 0を指定すると1%刻みでも送信する(タイルコピーのような大量ステップ向け)
  minPercentDelta?: number;
  // 送信throttleの時間しきい値(ms)。既定30000(旧実装踏襲)
  heartbeatMs?: number;
}

export class ProgressReporter {
  private channel: string;
  private total: number;
  private startMsg: string;
  private endMsg: string;
  private window: BrowserWindow | null = null;
  // 旧実装の throttle 制御: 5%以上の変化 or 30秒経過 or 100%時に送信
  private lastPercent: number | null = null;
  private lastTime: Date | null = null;
  private minPercentDelta: number;
  private heartbeatMs: number;

  constructor(
    channel: string,
    total: number,
    startMsg: string,
    endMsg: string,
    options?: ProgressReporterOptions,
  ) {
    this.channel = channel;
    this.total = total;
    this.startMsg = startMsg;
    this.endMsg = endMsg;
    this.minPercentDelta = options?.minPercentDelta ?? 5;
    this.heartbeatMs = options?.heartbeatMs ?? 30000;
  }

  setWindow(window: BrowserWindow) {
    this.window = window;
  }

  // progressTextOverride: バー内側に表示する詳細テキスト。未指定時は旧実装と同じ "(current/total)"。
  // 呼び出し側のスロットル(例: 100件ごと/200ms間隔)に加え、ここでも%変化/heartbeatでの
  // 二重throttleを行う(既定のminPercentDelta/heartbeatMsは旧実装のまま=挙動不変)
  update(current: number, progressTextOverride?: string) {
    if (!this.window) return;
    const currentPercent = Math.floor((current / this.total) * 100);
    const currentTime = new Date();

    // 旧実装と同じ throttle ロジック(minPercentDelta/heartbeatMsで調整可能)
    if (
      this.lastPercent == null ||
      this.lastTime == null ||
      currentPercent === 100 ||
      currentPercent - this.lastPercent > this.minPercentDelta ||
      currentTime.getTime() - this.lastTime.getTime() > this.heartbeatMs
    ) {
      this.lastPercent = currentPercent;
      this.lastTime = currentTime;
      // 旧実装と同じ形式: "(current/total)"。上書き指定時はそちらを使う
      const progress = progressTextOverride ?? `(${current}/${this.total})`;
      const msg = currentPercent === 100 && this.endMsg ? this.endMsg : this.startMsg;
      this.window.webContents.send(this.channel, {
        text: msg,
        percent: currentPercent,
        progress: progress
      });
    }
  }
}
