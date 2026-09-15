// About ウィンドウのスクリプト（oct26-m4-t6: about.html のインライン script を CSP のため外出しした）。
// m19-t4a (§6/§7.4): main プロセスから loadURL の query で受け取る
// （preload なし・contextBridge なし・IPC なし。露出面ゼロ）。
// 値は HTML 文字列として差し込まず、DOM を組み立てて textContent で入れる。
(() => {
  const versions = document.getElementById('versions');
  try {
    const q = new URLSearchParams(location.search);
    const g = (k) => q.get(k) ?? '-';
    document.getElementById('appVersion').textContent = 'Version ' + g('appVersion');
    versions.replaceChildren(...['electron', 'chrome', 'node', 'v8'].map((k) => {
      const row = document.createElement('div');
      const label = document.createElement('span');
      label.textContent = k;
      row.append(label, ': ' + g(k));
      return row;
    }));
  } catch (e) {
    const err = document.createElement('div');
    // CSSOM による設定は style-src の対象外（style 属性をマークアップに書くと拒否される）。
    // m19-t4a の e2e が赤字要素（style*="color: red"）を数えるので、従来と同じく赤字にする
    err.style.color = 'red';
    err.textContent = 'Error: ' + e.message;
    versions.replaceChildren(err);
  }
  document.addEventListener('contextmenu', (event) => event.preventDefault());
})();
