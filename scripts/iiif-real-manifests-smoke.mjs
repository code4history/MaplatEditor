// 既存 smoke と同じ Vite SSR + 子プロセス方式。ネットワークは preload で禁止。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const scratch = path.join(root, '.tmp-smoke');
await mkdir(scratch, { recursive: true });
const work = await mkdtemp(path.join(scratch, 'iiif-real-'));
try {
  const commonStub = path.join(work, 'common.mjs');
  await writeFile(commonStub, `export function sanitizeIiifHtml() { throw new Error('試験は sanitize を明示して渡します'); }`);
  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: {
      alias: [
        { find: '@maplat/core/common', replacement: commonStub },
        { find: '@maplat/core/src', replacement: path.join(root, 'node_modules/@maplat/core/src') },
      ],
    },
    build: {
      outDir: path.join(work, 'dist'),
      ssr: path.join(root, 'tests/iiif-real-manifests.mjs'),
      target: 'node22',
      rollupOptions: { output: { entryFileNames: 'suite.mjs', format: 'es' } },
    },
  });
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    '--import', path.join(root, 'tests/helpers/iiif-deny-network.mjs'),
    '--test', path.join(work, 'dist/suite.mjs'),
  ], { cwd: root, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await rm(work, { recursive: true, force: true });
}
