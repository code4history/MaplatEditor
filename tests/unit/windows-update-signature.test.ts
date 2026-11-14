import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
vi.mock('electron', () => ({ app: { isPackaged: true } }))
vi.mock('electron-updater', () => {
  class NsisUpdater {
    verifyUpdateCodeSignature = vi.fn(async (): Promise<string | null> => null)
  }
  return { default: { NsisUpdater, autoUpdater: new NsisUpdater() } }
})

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const file = 'C:\\Users\\test\\AppData\\Local\\updater\\Setup.exe'
const subject = 'CN=Maplat, O=Maplat Project, S=Osaka, C=JP'
type Reply = { Status?: unknown, Path?: unknown, SignerCertificate?: unknown }

function reply(data: Reply = {}, error: Error | null = null, stderr = '') {
  const stdout = JSON.stringify({ Status: 0, Path: file, SignerCertificate: { Subject: subject }, ...data })
  rawReply(stdout, error, stderr)
}

function rawReply(stdout: string, error: Error | null = null, stderr = '') {
  vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void
    callback(error, stdout, stderr)
    return {} as ChildProcess
  })
}

async function updater() {
  const { configureUpdater } = await import('../../electron/services/UpdateService')
  return configureUpdater() as unknown as {
    verifyUpdateCodeSignature: (publishers: string[], path: string) => Promise<string | null>
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
  reply()
})

afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
})

describe('Windows update signature verification', () => {
  it('accepts a valid signature and uses a 120 second timeout without a shell', async () => {
    await expect((await updater()).verifyUpdateCodeSignature([subject], file)).resolves.toBeNull()
    expect(execFile).toHaveBeenCalledWith('powershell.exe', expect.any(Array), expect.objectContaining({
      timeout: 120_000, shell: false, windowsHide: true, encoding: 'utf8',
      env: expect.objectContaining({ PSModulePath: '' }),
    }), expect.any(Function))
  })

  it('returns a verification error for a different publisher', async () => {
    const result = await (await updater()).verifyUpdateCodeSignature(['CN=Someone else'], file)
    expect(result).toEqual(expect.any(String))
    expect(result).not.toBe('')
  })

  it('rejects a timeout even if stdout contains a valid signature', async () => {
    const error = Object.assign(new Error('signature verification timed out'), { killed: true, signal: 'SIGTERM' })
    reply({}, error)
    await expect((await updater()).verifyUpdateCodeSignature([subject], file)).rejects.toBe(error)
    expect(execFile).toHaveBeenCalledTimes(1)
  })

  it('rejects a PowerShell failure even if stdout contains a valid signature', async () => {
    const error = Object.assign(new Error('PowerShell failed'), { code: 1 })
    reply({}, error)
    await expect((await updater()).verifyUpdateCodeSignature([subject], file)).rejects.toBe(error)
    expect(execFile).toHaveBeenCalledTimes(1)
  })

  it('rejects stderr even with exit code zero', async () => {
    reply({}, null, 'Get-AuthenticodeSignature failed')
    await expect((await updater()).verifyUpdateCodeSignature([subject], file)).rejects.toThrow()
  })

  it.each([1, 2, 3, 4, 5, 6, '0', null])('rejects signature status %s', async (Status) => {
    reply({ Status })
    expect(await (await updater()).verifyUpdateCodeSignature([subject], file)).toEqual(expect.any(String))
  })

  it.each(['', '{bad json', 'null', '[]'])('rejects malformed or incomplete JSON (%s)', async (stdout) => {
    rawReply(stdout)
    await expect((await updater()).verifyUpdateCodeSignature([subject], file)).rejects.toThrow()
  })

  it.each([undefined, null, '', 'C:\\other\\Setup.exe'])('rejects missing or mismatched returned path (%s)', async (Path) => {
    reply({ Path })
    await expect((await updater()).verifyUpdateCodeSignature([subject], file)).rejects.toThrow()
  })

  it('accepts equivalent normalized Windows paths', async () => {
    reply({ Path: 'C:/Users/test/AppData/Local/updater/./Setup.exe' })
    await expect((await updater()).verifyUpdateCodeSignature([subject], file)).resolves.toBeNull()
    expect(execFile).toHaveBeenCalledOnce()
  })

  it.each([undefined, null, {}, { Subject: 42 }, { Subject: '' }])('rejects missing or malformed certificate (%j)', async (SignerCertificate) => {
    reply({ SignerCertificate })
    await expect((await updater()).verifyUpdateCodeSignature([subject], file)).rejects.toThrow()
  })

  it('does not accept an empty publisher list', async () => {
    expect(await (await updater()).verifyUpdateCodeSignature([], file)).toEqual(expect.any(String))
  })

  it('matches the upstream DN parser and publisher rules', async () => {
    const require = createRequire(import.meta.url)
    const { parseDn } = createRequire(require.resolve('electron-updater'))('builder-util-runtime')
    const pairs: Array<[string[], string]> = [
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
    ]
    const verifier = (await updater()).verifyUpdateCodeSignature
    for (const [names, Subject] of pairs) {
      reply({ SignerCertificate: { Subject } })
      const dn = parseDn(Subject)
      const expected = names.some((name) => {
        const candidate: Map<string, string> = parseDn(name)
        return candidate.size
          ? [...candidate].every(([key, value]) => dn.get(key) === value)
          : name === dn.get('CN')
      })
      expect((await verifier(names, file)) === null, JSON.stringify([names, Subject])).toBe(expected)
    }
  })

  it('passes hostile and Unicode paths as data, never PowerShell syntax', async () => {
    const hostilePath = "C:\\地図 O'Brien\\‘’“”`$() & %TEMP% [1];calc;\\Setup.exe"
    reply({ Path: hostilePath })
    await expect((await updater()).verifyUpdateCodeSignature([subject], hostilePath)).resolves.toBeNull()
    const args = vi.mocked(execFile).mock.calls[0][1] as string[]
    expect(args.slice(0, -1)).toEqual(['-NoProfile', '-NonInteractive', '-InputFormat', 'None', '-EncodedCommand'])
    const command = Buffer.from(args.at(-1)!, 'base64').toString('utf16le')
    expect(command).not.toContain(hostilePath)
    const encodedPath = command.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)?.[1]
    expect(encodedPath).toBeDefined()
    expect(Buffer.from(encodedPath!, 'base64').toString('utf16le')).toBe(hostilePath)
    expect(command).toContain('Get-AuthenticodeSignature -LiteralPath $updatePath')
    expect(command).toContain('[Console]::OutputEncoding')
    expect(command).toContain("$ErrorActionPreference = 'Stop'")
  })

  it('configures the updater only once', async () => {
    const first = await updater()
    const verifier = first.verifyUpdateCodeSignature
    expect(await updater()).toBe(first)
    expect((await updater()).verifyUpdateCodeSignature).toBe(verifier)
  })

  it.each(['darwin', 'linux'])('leaves the default verifier unchanged on %s', async (os) => {
    Object.defineProperty(process, 'platform', { ...platform, value: os })
    const { default: electronUpdater } = await import('electron-updater')
    const original = (electronUpdater.autoUpdater as unknown as Awaited<ReturnType<typeof updater>>).verifyUpdateCodeSignature
    expect((await updater()).verifyUpdateCodeSignature).toBe(original)
    expect(execFile).not.toHaveBeenCalled()
  })
})
