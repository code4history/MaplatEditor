import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function inspectElectronInstallation(packageDir) {
  const pathFile = path.join(packageDir, 'path.txt');
  const versionFile = path.join(packageDir, 'dist', 'version');
  if (!(await exists(pathFile))) return { ready: false, reason: 'path.txt is missing' };
  if (!(await exists(versionFile))) return { ready: false, reason: 'dist/version is missing' };

  const executableName = (await readFile(pathFile, 'utf8')).trim();
  if (!executableName) return { ready: false, reason: 'path.txt is empty' };
  const executable = path.resolve(packageDir, 'dist', executableName);
  if (!(await exists(executable))) return { ready: false, reason: 'Electron executable is missing' };
  return { ready: true, executable };
}

function runOfficialInstall(packageDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(packageDir, 'install.js')], {
      cwd: packageDir,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Electron install failed (${signal ?? `exit ${code}`})`));
    });
  });
}

export async function ensureElectronInstallation({ packageDir, runInstall = runOfficialInstall }) {
  const before = await inspectElectronInstallation(packageDir);
  if (before.ready) return false;
  console.log(`[ensure-electron] ${before.reason}; running Electron's official installer...`);
  await runInstall(packageDir);
  const after = await inspectElectronInstallation(packageDir);
  if (!after.ready) throw new Error(`[ensure-electron] Repair did not complete: ${after.reason}`);
  return true;
}

async function main() {
  const packageJson = require.resolve('electron/package.json');
  await ensureElectronInstallation({ packageDir: path.dirname(packageJson) });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
