// The tools offered over MCP. Every input schema is strict (unknown keys are rejected) and no tool takes a
// path, URL or file name. Tools only read, through the read-only facade, and give back a small, plain view
// of what they read.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type * as ReadFacade from './readFacade';
import type { McpLimits } from './limits';
import { tileMaxZoom } from '../utils/tilePyramid';

export interface ToolContext {
  facade: typeof ReadFacade;
  limits: Readonly<McpLimits>;
  /** Aborted when the request runs past the time limit. Checked between I/O steps. */
  signal: AbortSignal;
  /** Editor version reported by editor.ping. */
  version: string;
}

export type RegisterTools = (server: McpServer, context: ToolContext) => void;

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

function jsonResult<T extends Record<string, unknown>>(value: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

/** Stops a tool between steps once the request has run past its time limit. */
function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('aborted');
}

function positiveSize(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function maxZoomOf(width: number | null, height: number | null): number | null {
  return width !== null && height !== null ? tileMaxZoom(width, height) : null;
}

export const registerTools: RegisterTools = (server, context) => {
  const { facade, limits, signal } = context;

  server.registerTool(
    'editor.ping',
    {
      title: 'Ping',
      description: 'Checks the connection to Maplat Editor. Returns ok and the editor version.',
      inputSchema: z.object({}).strict(),
      annotations: READ_ONLY,
    },
    async () => jsonResult({ ok: true, version: context.version }),
  );

  server.registerTool(
    'maps.list',
    {
      title: 'List maps',
      description:
        'Lists the maps saved in Maplat Editor, a page at a time. query filters by text (title, slug and other ' +
        'fields). Each map has its uid, slug, title, image width and height in pixels, and maxZoom, the largest ' +
        'zoom level of its 256 px tiles. next tells whether another page follows; total counts all matching maps.',
      inputSchema: z
        .object({
          query: z.string().max(limits.maxQueryLength).optional(),
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(1).max(limits.maxListPageSize).optional(),
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ query, page, pageSize }) => {
      checkAborted(signal);
      const requestedPage = page ?? 1;
      const result = await facade.listMaps({ query: query ?? '', page: requestedPage, pageSize: pageSize ?? 20 }, { sourceSize: true });
      checkAborted(signal);
      const maps = result.docs.map((doc) => {
        const width = positiveSize(doc.sourceWidth);
        const height = positiveSize(doc.sourceHeight);
        return {
          uid: String(doc.uid),
          slug: String(doc.mapID),
          title: typeof doc.title === 'string' ? doc.title : String(doc.mapID),
          width,
          height,
          maxZoom: maxZoomOf(width, height),
        };
      });
      const total = (result as { total?: unknown }).total;
      return jsonResult({
        maps,
        total: typeof total === 'number' ? total : maps.length,
        page: result.pageUpdate ?? requestedPage,
        next: result.next,
      });
    },
  );
};
