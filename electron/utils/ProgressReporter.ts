import { BrowserWindow } from 'electron';

export class ProgressReporter {
  private channel: string;
  private total: number;
  private startMsg: string;
  private endMsg: string;
  private window: BrowserWindow | null = null;
  // 旧実装の throttle 制御: 5%以上の変化 or 30秒経過 or 100%時に送信
  private lastPercent: number | null = null;
  private lastTime: Date | null = null;

  constructor(channel: string, total: number, startMsg: string, endMsg: string) {
    this.channel = channel;
    this.total = total;
    this.startMsg = startMsg;
    this.endMsg = endMsg;
  }

  setWindow(window: BrowserWindow) {
    this.window = window;
  }

  update(current: number) {
    if (!this.window) return;
    const currentPercent = Math.floor((current / this.total) * 100);
    const currentTime = new Date();

    // 旧実装と同じ throttle ロジック
    if (
      this.lastPercent == null ||
      this.lastTime == null ||
      currentPercent === 100 ||
      currentPercent - this.lastPercent > 5 ||
      currentTime.getTime() - this.lastTime.getTime() > 30000
    ) {
      this.lastPercent = currentPercent;
      this.lastTime = currentTime;
      // 旧実装と同じ形式: "(current/total)"
      const progress = `(${current}/${this.total})`;
      const msg = currentPercent === 100 && this.endMsg ? this.endMsg : this.startMsg;
      this.window.webContents.send(this.channel, {
        text: msg,
        percent: currentPercent,
        progress: progress
      });
    }
  }
}
