import { readFileSync } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '../../..');

/** Same pattern as the server smoke: the flag file is TypeScript, so it is read as text. */
export const MCP_FLAG_PATTERN = /MCP_FEATURE_ENABLED\b[^=]*=\s*(true|false)/;

export function readMcpFlag(text: string): boolean {
  const match = MCP_FLAG_PATTERN.exec(text);
  if (!match) throw new Error('MCP_FEATURE_ENABLED declaration not found');
  return match[1] === 'true';
}

// Positive controls: if the pattern stops reading these, every MCP spec would silently pick the wrong branch.
if (
  readMcpFlag('export const MCP_FEATURE_ENABLED = false;') !== false ||
  readMcpFlag('export const MCP_FEATURE_ENABLED: boolean = false') !== false ||
  readMcpFlag('export const MCP_FEATURE_ENABLED = true;') !== true
) {
  throw new Error('MCP_FEATURE_ENABLED pattern failed its positive controls');
}

export const MCP_FEATURE_ENABLED = readMcpFlag(
  readFileSync(path.join(projectRoot, 'electron/mcp/featureFlag.ts'), 'utf8'),
);
