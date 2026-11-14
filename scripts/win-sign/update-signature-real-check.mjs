// Windows の実機（GitHub の x64 と arm64 の runner）で、自動更新の署名確認の部品
// （electron/utils/windowsUpdateSignatureRuntime.mjs）を本物の PowerShell で走らせる。
// smoke（scripts/windows-update-signature-smoke.mjs）は execFile を差し替えて試すので、
// 起動のしかた（-EncodedCommand・出力の文字コード・PSModulePath の削除）が実機で動くことはここで確かめる。
//
// 対象は Microsoft の署名が付いた powershell.exe 自身（Setup.exe を作らずに済む）。
//   (a) 証明書の subject そのものを publisherName に渡すと合格（null）
//   (b) 違う publisherName では不一致の文言を返す（合格にしない）
//   (c) 署名の無いファイルは合格にしない
// 所要時間を GITHUB_STEP_SUMMARY に書く。Windows 以外では失敗にする（skip で緑にしない）。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { verifyWindowsUpdateSignature, SIGNATURE_TIMEOUT_MS } from '../../electron/utils/windowsUpdateSignatureRuntime.mjs'

assert.equal(process.platform, 'win32', 'Windows の runner で実行すること')
const target = win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
// 本体と同じく PSModulePath を消して Windows PowerShell 5.1 を起動する（runner の既定の pwsh 7 の
// PSModulePath を受け継ぐと Get-AuthenticodeSignature のモジュールが読めない）。パスは引用符の中で '' に逃がす。
const env = { ...process.env }
for (const key of Object.keys(env)) {
  if (key.toLowerCase() === 'psmodulepath') delete env[key]
}
const quoted = target.replaceAll("'", "''")
const subject = execFileSync(target, ['-NoProfile', '-NonInteractive', '-Command',
  `(Get-AuthenticodeSignature -LiteralPath '${quoted}').SignerCertificate.Subject`], { encoding: 'utf8', env }).trim()
assert.ok(subject.includes('CN='), `subject が取れない: ${subject}`)

const timed = async (label, fn) => {
  const t0 = Date.now()
  const value = await fn()
  const ms = Date.now() - t0
  console.log(`${label}: ${ms} ms → ${value === null ? 'null（合格）' : value}`)
  return { value, ms }
}

const ok = await timed('(a) 正しい publisher', () => verifyWindowsUpdateSignature([subject], target))
assert.equal(ok.value, null, '(a) 本物の署名と正しい publisher で合格になること')

const ng = await timed('(b) 違う publisher', () => verifyWindowsUpdateSignature(['CN=Example Publisher, O=Example, C=JP'], target))
assert.equal(typeof ng.value, 'string', '(b) 違う publisher は合格にしないこと')
assert.match(ng.value, /does not match/)

const dir = mkdtempSync(join(tmpdir(), 'upd-sig-'))
const unsigned = join(dir, 'unsigned.exe')
writeFileSync(unsigned, 'MZ not a signed file')
let unsignedResult
const t0 = Date.now()
try {
  unsignedResult = await verifyWindowsUpdateSignature([subject], unsigned)
} catch (error) {
  unsignedResult = error
}
const unsignedMs = Date.now() - t0
const unsignedText = unsignedResult instanceof Error ? `reject: ${unsignedResult.message}` : String(unsignedResult)
console.log(`(c) 署名なし: ${unsignedMs} ms → ${unsignedText}`)
assert.notEqual(unsignedResult, null, '(c) 署名の無いファイルは合格にしないこと')
assert.ok(unsignedResult instanceof Error || /not valid/.test(unsignedResult), '(c) 署名が無効という理由で不合格になること')

const arch = process.arch
const summary = [
  `### 自動更新の署名確認（${arch}）`,
  '',
  `- 正しい publisher: ${ok.ms} ms（合格）`,
  `- 違う publisher: ${ng.ms} ms（不一致）`,
  `- 署名なし: ${unsignedMs} ms（${unsignedResult instanceof Error ? '更新エラー' : '無効'}）`,
  `- 待ちの上限: ${SIGNATURE_TIMEOUT_MS} ms`,
  '',
].join('\n')
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
console.log('PASS update-signature-real-check')
