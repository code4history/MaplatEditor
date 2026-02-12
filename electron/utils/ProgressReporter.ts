import { BrowserWindow } from 'electron';

export class ProgressReporter {
  private channel: string;
  private total: number;
  private startMsg: string;
  private endMsg: string;
  private window: BrowserWindow | null = null;

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
    const percent = Math.floor((current / this.total) * 100);
    const progress = `${current} / ${this.total}`;
    
    const msg = current === this.total ? this.endMsg : this.startMsg;
    this.window.webContents.send(this.channel, {
      text: msg,
      percent: percent,
      progress: progress
    });
  }
}
