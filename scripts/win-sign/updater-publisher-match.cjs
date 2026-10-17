// nov26-m7-t5（§3.2・MAJ-2）: electron-updater が更新ファイルの署名者を照らす判定の**写し**。
// 依存を入れない verify-win-install（scripts/win-sign/verify-win-install.mjs）が、配布物の app-update.yml の
// publisherName と Setup.exe の SignerCertificate.Subject を、electron-updater と同じ判定で比べるために使う。
//
// 写し元（npm の公開物。版を上げたら写し直し、smoke の突き合わせ〔t5/AC1 (iv)〕で確かめる）:
//   - parseDn: builder-util-runtime 9.7.0 out/rfc2253Parser.js 4〜79 行（逐語。var の書き方だけ揃えた）
//   - 判定:    electron-updater 6.8.10 out/windowsExecutableCodeSignatureVerifier.js 70〜87 行
//              （Subject を parseDn で読み、publisherName の各要素を parseDn で読み、属性があれば
//               publisherName 側の全キーで値が完全一致。属性が無ければ CN と文字列で比べる）
// キー名は正規化しない（S と ST は別のキー）。∴ publisherName は Subject の文字列を加工せずに書く。
// 本物との突き合わせ: scripts/nov26-m7-t5-update-foundation-smoke.mjs [3]
'use strict';

/** builder-util-runtime 9.7.0 の parseDn の写し（RFC 2253 風の DN を Map に読む） */
function parseDn(seq) {
  let quoted = false;
  let key = null;
  let token = '';
  let nextNonSpace = 0;
  seq = seq.trim();
  const result = new Map();
  for (let i = 0; i <= seq.length; i++) {
    if (i === seq.length) {
      if (key !== null) {
        result.set(key, token);
      }
      break;
    }
    const ch = seq[i];
    if (quoted) {
      if (ch === '"') {
        quoted = false;
        continue;
      }
    } else {
      if (ch === '"') {
        quoted = true;
        continue;
      }
      if (ch === '\\') {
        i++;
        const ord = parseInt(seq.slice(i, i + 2), 16);
        if (Number.isNaN(ord)) {
          token += seq[i];
        } else {
          i++;
          token += String.fromCharCode(ord);
        }
        continue;
      }
      if (key === null && ch === '=') {
        key = token;
        token = '';
        continue;
      }
      if (ch === ',' || ch === ';' || ch === '+') {
        if (key !== null) {
          result.set(key, token);
        }
        key = null;
        token = '';
        continue;
      }
    }
    if (ch === ' ' && !quoted) {
      if (token.length === 0) {
        continue;
      }
      if (i > nextNonSpace) {
        let j = i;
        while (seq[j] === ' ') {
          j++;
        }
        nextNonSpace = j;
      }
      if (nextNonSpace >= seq.length
        || seq[nextNonSpace] === ','
        || seq[nextNonSpace] === ';'
        || (key === null && seq[nextNonSpace] === '=')
        || (key !== null && seq[nextNonSpace] === '+')) {
        i = nextNonSpace - 1;
        continue;
      }
    }
    token += ch;
  }
  return result;
}

/**
 * electron-updater 6.8.10 の判定の写し。
 * @param {string[]} publisherNames app-update.yml の publisherName
 * @param {string} subject Get-AuthenticodeSignature の SignerCertificate.Subject（生の文字列）
 * @returns {boolean} electron-updater が「署名者が一致する」とみなすなら true
 */
function matchesPublisher(publisherNames, subject) {
  const subjectDn = parseDn(subject);
  let match = false;
  for (const name of publisherNames) {
    const dn = parseDn(name);
    if (dn.size) {
      const allKeys = Array.from(dn.keys());
      match = allKeys.every((key) => dn.get(key) === subjectDn.get(key));
    } else if (name === subjectDn.get('CN')) {
      match = true;
    }
    if (match) return true;
  }
  return false;
}

module.exports = { parseDn, matchesPublisher };
