import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const workspaceRoot = path.resolve(import.meta.dir, '../..');
const m2DataRoot = path.join(workspaceRoot, '.tmp', 'electrobun-m2');

export function resolveM2LocalPath(relativePath: string): string {
  const resolved = path.resolve(m2DataRoot, relativePath);
  if (!resolved.startsWith(m2DataRoot + path.sep)) {
    throw new Error(`Refusing to access path outside M2 data root: ${relativePath}`);
  }
  return resolved;
}

export async function writeM2TextFile(relativePath: string, text: string): Promise<string> {
  const filePath = resolveM2LocalPath(relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, 'utf8');
  return filePath;
}

export async function readM2TextFile(relativePath: string): Promise<{ text: string; path: string }> {
  const filePath = resolveM2LocalPath(relativePath);
  return {
    text: await readFile(filePath, 'utf8'),
    path: filePath,
  };
}

export function getM2ViteArtifactStatus(): { exists: boolean; indexPath: string } {
  const indexPath = path.join(workspaceRoot, 'dist', 'index.html');
  return {
    exists: Bun.file(indexPath).size > 0,
    indexPath,
  };
}
