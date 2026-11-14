// Run with: node scripts/windows-update-signature-smoke.mjs
// Bundle the real updater service with stubs; never start Electron or PowerShell.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import childProcess from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(tmpRoot, { recursive: true });
const workDir = await mkdtemp(path.join(tmpRoot, 'windows-update-signature-'));
const platform = Object.getOwnPropertyDescriptor(process, 'platform');
const file = 'C:\\Users\\test\\AppData\\Local\\updater\\Setup.exe';
const subject = 'CN=Maplat, O=Maplat Project, S=Osaka, C=JP';
let passed = 0;

function reply(api, data = {}, error = null, stderr = '') {
  api.rawReply(JSON.stringify({
    Status: 0, Path: file, SignerCertificate: { Subject: subject }, ...data,
  }), error, stderr);
}

try {
  const electronStub = path.join(workDir, 'electron.mjs');
  const updaterStub = path.join(workDir, 'updater.mjs');
  const processStub = path.join(workDir, 'child-process.mjs');
  const settingsStub = path.join(workDir, 'settings.mjs');
  const entry = path.join(workDir, 'entry.mjs');
  const outDir = path.join(workDir, 'dist');
  await writeFile(electronStub, `
    export const app = { isPackaged: true, getVersion: () => '1.0.0' };
    export const progressValues = [];
    const win = { setProgressBar: (value) => progressValues.push(value) };
    export const BrowserWindow = { getAllWindows: () => [win] };
    export const dialogs = [];
    export const dialog = { showMessageBox: async (...args) => {
      const options = args.at(-1);
      dialogs.push(options);
      return { response: options.defaultId };
    } };
    export const shell = { openExternal: async () => {} };
  `);
  await writeFile(settingsStub, "export default { get: (key) => key === 'lang' ? 'en' : true };\n");
  await writeFile(updaterStub, `
    import { EventEmitter } from 'node:events';
    class NsisUpdater extends EventEmitter {
      verifyUpdateCodeSignature = async () => null;
      checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: { version: '2.0.0' } });
    }
    export default { NsisUpdater, autoUpdater: new NsisUpdater() };
  `);
  await writeFile(processStub, `
    export const calls = [];
    let response;
    export function rawReply(stdout, error = null, stderr = '') {
      response = { stdout, error, stderr };
    }
    export function execFile(...args) {
      calls.push(args);
      const { stdout, error, stderr } = response;
      args.at(-1)(error, stdout, stderr);
      return {};
    }
  `);
  await writeFile(entry, `
    export { configureUpdater } from ${JSON.stringify(path.join(projectRoot, 'electron/services/UpdateService.ts'))};
    export { default as electronUpdater } from ${JSON.stringify(updaterStub)};
    export { calls, rawReply } from ${JSON.stringify(processStub)};
    export { check } from ${JSON.stringify(path.join(projectRoot, 'electron/services/UpdateController.ts'))};
    export { progressValues, dialogs } from ${JSON.stringify(electronStub)};
  `);
  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: [
      { find: 'electron', replacement: electronStub },
      { find: 'electron-updater', replacement: updaterStub },
      { find: 'node:child_process', replacement: processStub },
      { find: './SettingsService', replacement: settingsStub },
    ] },
    build: {
      outDir, emptyOutDir: true, ssr: entry, target: 'node24',
      rollupOptions: { output: { entryFileNames: 'entry.mjs', format: 'es', inlineDynamicImports: true } },
    },
  });

  async function check(name, run, os = 'win32') {
    // A fresh single-file bundle resets both the service singleton and the stubs.
    const api = await import(`${pathToFileURL(path.join(outDir, 'entry.mjs')).href}?case=${passed}`);
    Object.defineProperty(process, 'platform', { ...platform, value: os });
    try {
      reply(api);
      await run(api);
      passed += 1;
      console.log(`ok ${passed}: ${name}`);
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
  }

  await check('valid signature, 120 second timeout, no shell', async (api) => {
    assert.equal(await api.configureUpdater().verifyUpdateCodeSignature([subject], file), null);
    assert.equal(api.calls.length, 1);
    const [executable, args, options, callback] = api.calls[0];
    assert.equal(executable, path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
    assert.ok(Array.isArray(args));
    assert.equal(typeof callback, 'function');
    assert.equal(options.timeout, 120_000);
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    assert.equal(options.encoding, 'utf8');
    assert.equal(Object.keys(options.env).some((key) => key.toLowerCase() === 'psmodulepath'), false);
  });

  await check('publisher mismatch returns a nonempty verification error', async (api) => {
    const result = await api.configureUpdater().verifyUpdateCodeSignature(['CN=Someone else'], file);
    assert.equal(typeof result, 'string');
    assert.notEqual(result, '');
  });

  await check('timeout rejects even with a valid signature in stdout', async (api) => {
    const error = Object.assign(new Error('signature verification timed out'), { killed: true, signal: 'SIGTERM' });
    reply(api, {}, error);
    await assert.rejects(api.configureUpdater().verifyUpdateCodeSignature([subject], file), (actual) => actual === error);
    assert.equal(api.calls.length, 1);
  });

  await check('PowerShell failure rejects even with a valid signature in stdout', async (api) => {
    const error = Object.assign(new Error('PowerShell failed'), { code: 1 });
    reply(api, {}, error);
    await assert.rejects(api.configureUpdater().verifyUpdateCodeSignature([subject], file), (actual) => actual === error);
    assert.equal(api.calls.length, 1);
  });

  await check('stderr rejects even with exit code zero', async (api) => {
    reply(api, {}, null, 'Get-AuthenticodeSignature failed');
    await assert.rejects(api.configureUpdater().verifyUpdateCodeSignature([subject], file));
  });

  for (const Status of [1, 2, 3, 4, 5, 6, '0', null]) {
    await check(`invalid signature status ${JSON.stringify(Status)}`, async (api) => {
      reply(api, { Status });
      assert.equal(typeof await api.configureUpdater().verifyUpdateCodeSignature([subject], file), 'string');
    });
  }

  for (const stdout of ['', '{bad json', 'null', '[]']) {
    await check(`malformed or incomplete JSON ${JSON.stringify(stdout)}`, async (api) => {
      api.rawReply(stdout);
      await assert.rejects(api.configureUpdater().verifyUpdateCodeSignature([subject], file));
    });
  }

  for (const Path of [undefined, null, '', 'C:\\other\\Setup.exe', file.toLowerCase()]) {
    await check(`missing or mismatched returned path ${JSON.stringify(Path)}`, async (api) => {
      reply(api, { Path });
      await assert.rejects(api.configureUpdater().verifyUpdateCodeSignature([subject], file));
    });
  }

  await check('equivalent normalized Windows paths', async (api) => {
    reply(api, { Path: 'C:/Users/test/AppData/Local/updater/./Setup.exe' });
    assert.equal(await api.configureUpdater().verifyUpdateCodeSignature([subject], file), null);
    assert.equal(api.calls.length, 1);
  });

  for (const SignerCertificate of [undefined, null, {}, { Subject: 42 }, { Subject: '' }]) {
    await check(`missing or malformed certificate ${JSON.stringify(SignerCertificate)}`, async (api) => {
      reply(api, { SignerCertificate });
      await assert.rejects(api.configureUpdater().verifyUpdateCodeSignature([subject], file));
    });
  }

  await check('empty publisher list is not accepted', async (api) => {
    assert.equal(typeof await api.configureUpdater().verifyUpdateCodeSignature([], file), 'string');
  });

  await check('upstream DN parser and publisher rules (13 pairs)', async (api) => {
    const require = createRequire(import.meta.url);
    const { parseDn } = createRequire(require.resolve('electron-updater'))('builder-util-runtime');
    const pairs = [
      [[subject], subject],
      [['CN=Maplat, C=JP'], subject],
      [['Maplat'], subject],
      [['CN=Other', subject], subject],
      [['CN=Maplat, ST=Osaka'], subject],
      [['CN=maplat'], subject],
      [['O=Other'], subject],
      [['CN="Maplat, Inc.", O=Maps'], 'O=Maps,CN="Maplat, Inc.",C=JP'],
      [['CN=Maplat\\, Inc.'], 'CN="Maplat, Inc."'],
      [['CN=Maplat\\2c Inc.'], 'CN="Maplat, Inc."'],
      [['CN=Maplat+O=Maps'], 'O=Maps; CN=Maplat'],
      [['CN=  地図  , O= Karten Ü'], 'O=Karten Ü,CN=地図'],
      [[''], subject],
    ];
    const verifier = api.configureUpdater().verifyUpdateCodeSignature;
    for (const [names, Subject] of pairs) {
      reply(api, { SignerCertificate: { Subject } });
      const dn = parseDn(Subject);
      const expected = names.some((name) => {
        const candidate = parseDn(name);
        return candidate.size
          ? [...candidate].every(([key, value]) => dn.get(key) === value)
          : name === dn.get('CN');
      });
      assert.equal((await verifier(names, file)) === null, expected, JSON.stringify([names, Subject]));
    }
  });

  for (const hostilePath of [
    "C:\\地図 O'Brien\\‘’“”`$() & %TEMP% [1];calc;\\Setup.exe",
    '\\\\server\\share\\地図\\Setup.exe',
    '\\\\?\\C:\\' + 'long-directory\\'.repeat(30) + 'Setup.exe',
  ]) {
    await check('hostile, UNC and long paths stay data, never PowerShell syntax', async (api) => {
      reply(api, { Path: hostilePath });
      assert.equal(await api.configureUpdater().verifyUpdateCodeSignature([subject], hostilePath), null);
      const args = api.calls[0][1];
      assert.deepEqual(args.slice(0, -1), ['-NoProfile', '-NonInteractive', '-InputFormat', 'None', '-EncodedCommand']);
      const command = Buffer.from(args.at(-1), 'base64').toString('utf16le');
      assert.equal(command.includes(hostilePath), false);
      const encodedPath = command.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)?.[1];
      assert.notEqual(encodedPath, undefined);
      assert.equal(Buffer.from(encodedPath, 'base64').toString('utf16le'), hostilePath);
      assert.ok(command.includes('Get-AuthenticodeSignature -LiteralPath $updatePath'));
      assert.ok(command.includes('[Console]::OutputEncoding'));
      assert.ok(command.includes("$ErrorActionPreference = 'Stop'"));
      assert.ok(command.startsWith("$ProgressPreference = 'SilentlyContinue'\n"));
    });
  }

  await check('non-NSIS updater keeps its verifier on Windows', async (api) => {
    const original = async () => 'other updater';
    api.electronUpdater.autoUpdater = { verifyUpdateCodeSignature: original };
    assert.equal(api.configureUpdater().verifyUpdateCodeSignature, original);
    assert.equal(api.calls.length, 0);
  });

  await check('module path keys are removed without mutating the parent environment', async (api) => {
    const saved = process.env;
    process.env = { ...saved, PSModulePath: 'parent modules', pSmOdUlEpAtH: 'other modules', SystemRoot: 'D:\\Windows' };
    try {
      assert.equal(await api.configureUpdater().verifyUpdateCodeSignature([subject], file), null);
      const [exe, , options] = api.calls[0];
      assert.equal(exe, 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
      assert.equal(Object.keys(options.env).some((key) => key.toLowerCase() === 'psmodulepath'), false);
      assert.equal(process.env.PSModulePath, 'parent modules');
      assert.equal(process.env.pSmOdUlEpAtH, 'other modules');
    } finally {
      process.env = saved;
    }
  });

  await check('updater is configured only once', async (api) => {
    const first = api.configureUpdater();
    const verifier = first.verifyUpdateCodeSignature;
    assert.equal(api.configureUpdater(), first);
    assert.equal(api.configureUpdater().verifyUpdateCodeSignature, verifier);
  });

  for (const os of ['darwin', 'linux']) {
    await check(`default verifier stays unchanged on ${os}`, async (api) => {
      const original = api.electronUpdater.autoUpdater.verifyUpdateCodeSignature;
      assert.equal(api.configureUpdater().verifyUpdateCodeSignature, original);
      assert.equal(api.calls.length, 0);
    }, os);
  }

  for (const fail of [false, true]) {
    await check(`Windows progress stays indeterminate during verification and clears after ${fail ? 'failure' : 'success'}`, async (api) => {
      const updater = api.configureUpdater();
      let observed;
      updater.downloadUpdate = async () => {
        updater.emit('download-progress', { percent: 50 });
        updater.emit('download-progress', { percent: 100 });
        observed = [...api.progressValues];
        if (fail) reply(api, {}, new Error('signature timed out'));
        await updater.verifyUpdateCodeSignature([subject], file);
        return [file];
      };
      const warnings = [];
      const warn = console.warn;
      console.warn = (...args) => warnings.push(args);
      try {
        await api.check({ manual: true });
      } finally {
        console.warn = warn;
      }
      assert.equal(warnings.length, fail ? 1 : 0);
      if (fail) assert.equal(warnings[0][1].message, 'signature timed out');
      assert.deepEqual(observed, [0.5, 2]);
      assert.deepEqual(api.progressValues, [0.5, 2, -1]);
      assert.equal(updater.listenerCount('download-progress'), 1, 'only the permanent service listener remains');
      assert.equal(api.dialogs.at(-1).type, fail ? 'error' : 'info');
      assert.equal(api.calls.length, 1);
    });
  }

  const installerCheck = await import('./win-sign/verify-win-install.mjs');
  assert.equal(installerCheck.UPDATER_SIGNATURE_TIMEOUT_MS, 120_000);
  assert.equal(typeof installerCheck.verifyInstallerUpdateSignature, 'function');
  const originalExecFile = childProcess.execFile;
  try {
    for (const scenario of ['valid', 'publisher mismatch', 'timeout', 'stderr']) {
      let invocation;
      childProcess.execFile = (...args) => {
        invocation = args;
        args.at(-1)(scenario === 'timeout' ? new Error('timed out') : null,
          JSON.stringify({ Status: 0, Path: file, SignerCertificate: { Subject: subject } }),
          scenario === 'stderr' ? 'PowerShell error' : '');
      };
      syncBuiltinESMExports();
      const result = await installerCheck.verifyInstallerUpdateSignature(
        file, scenario === 'publisher mismatch' ? ['Other'] : [subject]);
      assert.equal(result.ok, scenario === 'valid');
      if (result.ok) assert.equal(result.result, null);
      else assert.ok(result.error || typeof result.result === 'string');
      assert.ok(Number.isFinite(result.elapsedMs) && result.elapsedMs >= 0);
      assert.equal(invocation[2].timeout, 120_000);
      assert.ok(invocation[1].includes('-EncodedCommand'));
      console.log(`ok: installer uses shared verifier and records ${scenario}`);
    }
  } finally {
    childProcess.execFile = originalExecFile;
    syncBuiltinESMExports();
  }

  assert.equal(passed, 40, 'all migrated cases must run');
  console.log(`windows update signature smoke: ${passed} cases PASS`);
} finally {
  Object.defineProperty(process, 'platform', platform);
  await rm(workDir, { recursive: true, force: true });
}
