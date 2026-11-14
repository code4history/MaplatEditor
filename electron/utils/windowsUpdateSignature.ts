import { execFile } from 'node:child_process'
import { win32 as path } from 'node:path'
import type { VerifyUpdateCodeSignature } from 'electron-updater'

// The upstream verifier (electron-updater 6.8.10) hardcodes 20s and can fail open
// after errors. It has no timeout option, so retain its Status/Path/DN checks here.
// Windows 11 arm64 CI took 39.5s / 24.7s (x64: 4.9s); allow 120s for slower hosts.
// https://github.com/code4history/MaplatEditor/actions/runs/42280636266
const SIGNATURE_TIMEOUT_MS = 120_000

export const verifyWindowsUpdateSignature: VerifyUpdateCodeSignature = (publisherNames, file) => {
  // Only base64 data enters the script: quotes (including PowerShell smart quotes),
  // backticks, $, %, & and Unicode in paths cannot become code. No cmd.exe shell.
  // -EncodedCommand expects UTF-16LE; explicitly output UTF-8 instead of using chcp.
  const encodedPath = Buffer.from(file, 'utf16le').toString('base64')
  const command = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$updatePath = [System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String('${encodedPath}'))`,
    'Get-AuthenticodeSignature -LiteralPath $updatePath | ConvertTo-Json -Compress',
  ].join('\n')

  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-InputFormat', 'None',
      '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64'),
    ], {
      timeout: SIGNATURE_TIMEOUT_MS,
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
      // Match upstream's reset of inherited module paths, without modifying our env.
      env: { ...process.env, PSModulePath: '' },
    }, (error, stdout, stderr) => {
      // Never use upstream's old-Windows / ConvertTo-Json fallback to skip validation.
      if (error) { reject(error); return }
      if (stderr) { reject(new Error(`Cannot verify update signature: ${stderr}`)); return }
      try {
        const data = JSON.parse(stdout.replace(/^\uFEFF/, ''))
        if (!data || typeof data !== 'object' || Array.isArray(data) || !('Status' in data)) {
          throw new Error('Invalid update signature response')
        }
        if (data.Status !== 0) {
          resolve(`Update signature is not valid (status: ${data.Status})`)
          return
        }
        // Unlike upstream, missing Path is also an error, never a skipped check.
        if (typeof data.Path !== 'string' || !data.Path || path.normalize(data.Path) !== path.normalize(file)) {
          throw new Error('Signature verification returned a different or missing update path')
        }
        if (typeof data.SignerCertificate?.Subject !== 'string' || !data.SignerCertificate.Subject) {
          throw new Error('Signature verification returned no certificate subject')
        }
        const subject = parseDn(data.SignerCertificate.Subject)
        const matches = publisherNames.some((name) => {
          const dn = parseDn(name)
          // Same upstream rules: all configured DN keys, or legacy CN-only match.
          // Do not normalize attribute names (e.g. S and ST are different).
          return dn.size
            ? [...dn].every(([key, value]) => subject.get(key) === value)
            : name === subject.get('CN')
        })
        resolve(matches ? null : `Update publisher does not match: ${publisherNames.join(' | ')}`)
      } catch (error) {
        reject(error)
      }
    })
  })
}

// builder-util-runtime 9.7.0 out/rfc2253Parser.js (MIT), also copied in
// scripts/win-sign/updater-publisher-match.cjs. Keep the parsing semantics intact.
// It is a transitive dependency only; do not rely on package-manager hoisting.
// Unit tests compare the resulting publisher decisions against the installed parser.
function parseDn(seq: string): Map<string, string> {
  let quoted = false
  let key: string | null = null
  let token = ''
  let nextNonSpace = 0
  seq = seq.trim()
  const result = new Map<string, string>()
  for (let i = 0; i <= seq.length; i++) {
    if (i === seq.length) {
      if (key !== null) result.set(key, token)
      break
    }
    const ch = seq[i]
    if (quoted) {
      if (ch === '"') {
        quoted = false
        continue
      }
    } else {
      if (ch === '"') {
        quoted = true
        continue
      }
      if (ch === '\\') {
        i++
        const ord = parseInt(seq.slice(i, i + 2), 16)
        if (Number.isNaN(ord)) {
          token += seq[i]
        } else {
          i++
          token += String.fromCharCode(ord)
        }
        continue
      }
      if (key === null && ch === '=') {
        key = token
        token = ''
        continue
      }
      if (ch === ',' || ch === ';' || ch === '+') {
        if (key !== null) result.set(key, token)
        key = null
        token = ''
        continue
      }
    }
    if (ch === ' ' && !quoted) {
      if (token.length === 0) continue
      if (i > nextNonSpace) {
        let j = i
        while (seq[j] === ' ') j++
        nextNonSpace = j
      }
      if (nextNonSpace >= seq.length
        || seq[nextNonSpace] === ','
        || seq[nextNonSpace] === ';'
        || (key === null && seq[nextNonSpace] === '=')
        || (key !== null && seq[nextNonSpace] === '+')) {
        i = nextNonSpace - 1
        continue
      }
    }
    token += ch
  }
  return result
}
