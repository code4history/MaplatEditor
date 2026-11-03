// The tools offered over MCP. Every input schema is strict (unknown keys are rejected) and no tool takes a
// path, URL or file name. Tools only read, through the read-only facade, and give back a small, plain view
// of what they read.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type * as ReadFacade from './readFacade';
import type { McpLimits } from './limits';
import { tileMaxZoom } from '../utils/tilePyramid';
import { mercatorToWgs84 } from '../utils/webMercator';
import { localizeTitle } from '../../src/utils/langResource';
import { compiledOf } from './compiled';

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

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

/** The facade throws "... not found" for a map reference that resolves to nothing. */
function isNotFound(error: unknown): boolean {
  return error instanceof Error && /\bnot found\b/.test(error.message);
}

type Point = [number, number];

function isPoint(value: unknown): value is Point {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

/** GCPs are stored as [[x, y] on the image, [x, y] in Web Mercator]; tools give the second as longitude and latitude. */
function gcpsInLonLat(gcps: unknown): [Point, Point][] {
  if (!Array.isArray(gcps)) return [];
  return gcps
    .filter((g): g is [Point, Point] => Array.isArray(g) && isPoint(g[0]) && isPoint(g[1]))
    .map(([image, merc]) => [[image[0], image[1]], mercatorToWgs84([merc[0], merc[1]])]);
}

/** Edges are kept as the editor stores them (pairs of GCP indexes with optional bend points). */
function plainEdges(edges: unknown): unknown[] {
  return Array.isArray(edges) ? JSON.parse(JSON.stringify(edges)) : [];
}

function mapRefSchema(limits: Readonly<McpLimits>) {
  return z.string().min(1).max(limits.maxMapRefLength).describe('The map uid or slug (from maps.list).');
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

  server.registerTool(
    'maps.get',
    {
      title: 'Get a map',
      description:
        'Reads one map by uid or slug: title, image width and height in pixels, maxZoom, the ground control ' +
        'points as [[x, y] on the image (pixels, origin at the top left), [longitude, latitude]], the edges, and ' +
        'hasCompiled, whether maps.transform can convert points for it.',
      inputSchema: z.object({ map: mapRefSchema(limits) }).strict(),
      annotations: READ_ONLY,
    },
    async ({ map }) => {
      checkAborted(signal);
      let read: any;
      try {
        read = await facade.readMapForEdit(map);
      } catch (error) {
        if (isNotFound(error)) return errorResult('map not found');
        throw error;
      }
      checkAborted(signal);
      const width = positiveSize(read.width);
      const height = positiveSize(read.height);
      return jsonResult({
        uid: String(read.uid),
        slug: String(read.mapID),
        title: localizeTitle(read.title, typeof read.lang === 'string' ? read.lang : 'ja') || String(read.mapID),
        width,
        height,
        maxZoom: maxZoomOf(width, height),
        gcps: gcpsInLonLat(read.gcps),
        edges: plainEdges(read.edges),
        hasCompiled: compiledOf(read) !== null,
      });
    },
  );

  server.registerTool(
    'maps.transform',
    {
      title: 'Convert points',
      description:
        'Converts points with the map\'s compiled transformation, as the map viewer does. forward: [x, y] on the ' +
        'image (pixels, origin at the top left) to [longitude, latitude]; backward: [longitude, latitude] to ' +
        '[x, y]. Up to ' + limits.maxTransformPoints + ' points. A point off the image (on either side) is null. ' +
        'Needs a map with hasCompiled true (maps.get).',
      inputSchema: z
        .object({
          map: mapRefSchema(limits),
          direction: z.enum(['forward', 'backward']),
          points: z.array(z.tuple([z.number(), z.number()])).min(1).max(limits.maxTransformPoints),
        })
        .strict(),
      annotations: READ_ONLY,
    },
    async ({ map, direction, points }) => {
      checkAborted(signal);
      let converted: Awaited<ReturnType<typeof facade.transformPoints>>;
      try {
        converted = await facade.transformPoints(map, points as [number, number][], direction, signal);
      } catch (error) {
        if (isNotFound(error)) return errorResult('map not found');
        if (error instanceof Error && error.message === 'backward not available') {
          return errorResult('backward conversion is not available for this map (its transformation folds over)');
        }
        throw error;
      }
      if (converted === null) return errorResult('map has no compiled transformation');
      return jsonResult({ points: converted });
    },
  );
};
