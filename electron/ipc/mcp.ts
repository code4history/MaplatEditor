// IPC for the local MCP server. Registered through the shared registry, so every call is checked for its
// sender frame. The token never crosses to the renderer: status carries only its last four characters, and
// the registration command reaches the clipboard only after the user presses "Copy" in a native dialog.
import { app, BrowserWindow, clipboard, dialog, type MessageBoxOptions } from 'electron';
import { ipc } from './registry';
import SettingsService from '../services/SettingsService';
import { getMcpController, type McpClientKind, type McpController } from '../mcp/controller';
import { mcpText } from '../mcp/messages';
import { isValidPort } from '../mcp/limits';

export interface McpIpcDeps {
  controller: McpController;
  showMessageBox: (parent: BrowserWindow | null, options: MessageBoxOptions) => Promise<{ response: number }>;
  clipboard: { writeText(text: string): void; readText(): string; clear(): void };
  lang: () => string | undefined;
  windowFor: (event: Electron.IpcMainInvokeEvent) => BrowserWindow | null;
  broadcast: (channel: string, payload: unknown) => void;
}

const CLIENTS: readonly McpClientKind[] = ['claude-code', 'mcp-remote'];

function invalidArgument(): never {
  throw new Error('invalid argument');
}

let pendingClipboard: { text: string; timer: ReturnType<typeof setTimeout> } | null = null;
let activeClipboard: McpIpcDeps['clipboard'] | null = null;

/** Clears the copied command if the clipboard still holds it. Called by the timer and before the app quits. */
export function clearCopiedConnectionCommand(): void {
  if (!pendingClipboard || !activeClipboard) return;
  clearTimeout(pendingClipboard.timer);
  try {
    if (activeClipboard.readText() === pendingClipboard.text) activeClipboard.clear();
  } finally {
    pendingClipboard = null;
  }
}

function defaultDeps(): McpIpcDeps {
  return {
    controller: getMcpController(() => app.getVersion()),
    showMessageBox: (parent, options) => (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)),
    clipboard,
    lang: () => SettingsService.get('lang') as string | undefined,
    windowFor: (event) => BrowserWindow.fromWebContents(event.sender),
    broadcast: (channel, payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(channel, payload);
      }
    },
  };
}

export function registerMcpHandlers(overrides: Partial<McpIpcDeps> = {}): McpController {
  const deps: McpIpcDeps = { ...defaultDeps(), ...overrides };
  const { controller } = deps;
  activeClipboard = deps.clipboard;

  controller.onStatusChange((status) => deps.broadcast('mcp:status', status));

  ipc.handle('mcp:get-status', () => controller.status());

  ipc.handle('mcp:set-enabled', async (event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') invalidArgument();
    if (!controller.featureEnabled) throw new Error('feature disabled');
    if (!enabled) return controller.disable();
    if (controller.status().enabled && controller.status().listening) return controller.status();
    const lang = deps.lang();
    // Both defaultId and cancelId point at "Cancel": Enter, Esc and closing the dialog do not turn it on.
    const { response } = await deps.showMessageBox(deps.windowFor(event), {
      type: 'warning',
      title: mcpText(lang, 'enable.title'),
      message: mcpText(lang, 'enable.message'),
      detail: mcpText(lang, 'enable.detail'),
      buttons: [mcpText(lang, 'enable.ok'), mcpText(lang, 'cancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return controller.status();
    return controller.enable();
  });

  ipc.handle('mcp:set-port', (_event, port: unknown) => {
    if (!isValidPort(port)) invalidArgument();
    return controller.setPort(port);
  });

  ipc.handle('mcp:regenerate-token', () => controller.regenerateToken());

  ipc.handle('mcp:copy-connection-command', async (event, client: unknown) => {
    if (typeof client !== 'string' || !CLIENTS.includes(client as McpClientKind)) invalidArgument();
    const lang = deps.lang();
    const { response } = await deps.showMessageBox(deps.windowFor(event), {
      type: 'question',
      title: mcpText(lang, 'copy.title'),
      message: mcpText(lang, 'copy.message'),
      detail: mcpText(lang, 'copy.detail'),
      buttons: [mcpText(lang, 'copy.ok'), mcpText(lang, 'cancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return { copied: false };
    clearCopiedConnectionCommand();
    const text = controller.connectionCommand(client as McpClientKind);
    deps.clipboard.writeText(text);
    pendingClipboard = { text, timer: setTimeout(clearCopiedConnectionCommand, controller.limits.clipboardClearMs) };
    return { copied: true };
  });

  return controller;
}
