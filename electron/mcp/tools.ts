// The tools offered over MCP. Every input schema is strict (unknown keys are rejected) and no tool takes a
// path, URL or file name. Tools only read, through the read-only facade.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type * as ReadFacade from './readFacade';
import type { McpLimits } from './limits';

export interface ToolContext {
  facade: typeof ReadFacade;
  limits: Readonly<McpLimits>;
  /** Aborted when the request runs past the time limit. Checked between I/O steps. */
  signal: AbortSignal;
  /** Editor version reported by editor.ping. */
  version: string;
}

export type RegisterTools = (server: McpServer, context: ToolContext) => void;

function jsonResult<T extends Record<string, unknown>>(value: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

export const registerTools: RegisterTools = (server, context) => {
  server.registerTool(
    'editor.ping',
    {
      title: 'Ping',
      description: 'Checks the connection to Maplat Editor. Returns ok and the editor version.',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => jsonResult({ ok: true, version: context.version }),
  );
};
