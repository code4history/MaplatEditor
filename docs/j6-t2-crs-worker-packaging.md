# J6-T2 CRS 推定ワーカーの配布検証

## 最小 PoC の実測

macOS arm64、Electron 43.8.13、electron-builder 26.17.0、Atlas `b1db74f`、proj-wasm 0.1.0-alpha8。Editor の `electronFuses` 5 項目を流用し、窓を作らずに `utilityProcess.fork()` で ASAR 内の ESM 入口を起動した。京都付近を検索した結果、下表の両構成で Atlas が候補を 5 件返した。

| 資産 | 全部を `app.asar` に格納 | `proj-wasm/dist/**` のみ `asarUnpack` |
| --- | --- | --- |
| `utilityProcess` の入口 JS | `app.asar/dist-electron/` から起動 | 同左 |
| `@c4h/atlas/dist/atlas.js` | `app.asar/node_modules/` から ESM import | 同左 |
| `proj.mjs` | `app.asar` の論理パスから解決・読込 | `app.asar` の論理パスから解決し、`app.asar.unpacked` から読込 |
| `proj.db`・`proj.ini` | `app.asar` から `fs.readFileSync`。DB は 10,207,232 バイト | `fs.readFileSync` が ASAR の論理パスを展開先の実ファイルに振り分けた |
| `proj-worker.mjs`・`fetch-worker.mjs` | ASAR 内のスクリプトでワーカーが初期化完了 | 展開先のスクリプトでワーカーが初期化完了 |
| `proj-emscripten.js`・`proj-emscripten.wasm` | ASAR 内の資産で WASM が初期化され、候補検索に成功 | 展開先の資産で WASM が初期化され、候補検索に成功 |

入口と ESM のパスは `import.meta.url` と `import.meta.resolve()` で記録した。資産の格納箇所は `original-fs.existsSync()` で調べ、DB と INI の読込先は `fs.readFileSync` の引数を記録した。ワーカースクリプトと WASM は、格納箇所と PROJ の初期化・候補検索の成功から読込を確認した。proj-worker は fetch-worker からの ready を待って初期化する。

**J2b は見送る。** Atlas の Node 経路は `projWasmAssetBaseUrl` を参照しない。PoC では Electron の ASAR 解決によって展開版も動いたため、Editor は既存の `initializeProjWasmRuntime({ enableNetwork: false })` を使う。配布物では `proj-wasm/dist/**` のみ展開し、Atlas 内に含まれるブラウザ用の資産の複製を除外する。

## 再現手順

1. ローカルの Electron zip、Atlas、proj-wasm とその依存 `cherry-cljs`・`resource-tracker`・`xhr2` を用意する。使い捨ての app ディレクトリに ESM の main とワーカーを置き、上記のライブラリを `node_modules` に同梱する。main では `app.whenReady().then(...)` の中でワーカーを起動し、応答またはタイムアウトを受けて子を終了させ、exit を待ってアプリを終了する。
2. ワーカーは `@c4h/atlas` を import し、`initializeProjWasmRuntime({ enableNetwork: false })` の後、`listProjectedCrsFromProjWasm` に `extent: { west: 135.7, south: 34.9, east: 135.8, north: 35 }` と `onshoreOnly: true` を渡す。候補件数を `process.parentPort` へ返す。
3. Editor の `electronFuses` を流用し、`electronDist` でローカルの zip を指定する。アプリを 2 通りに包装する。いずれも `asar: { smartUnpack: false }` を使い、一方だけに `asarUnpack: ['**/proj-wasm/dist/**']` を設定する。Editor の `node_modules/.bin/electron-builder` を `--mac dir --arm64 --publish never` で起動する。
4. ローカル確認では開発者証明書による署名を `mac.identity: null` で無効にし、**fuse の書き換え後、起動前に** `codesign --force --deep --sign - <アプリ.app>` でアドホック署名する。`codesign --verify --deep --strict <アプリ.app>` と `@electron/fuses` の `read --app` で確認してから起動する。初回は再署名せずに起動したため macOS が `SIGKILL (Code Signature Invalid)` で強制終了した。再署名後は両構成を確認できた。正式配布では fuse と ASAR の整合性情報を確定した後で配布用の署名を行う。

## Windows での確認点

Electron 43 は macOS と Windows の両方で ASAR 整合性検証をサポートし、Electron の ASAR 仮想ファイルシステムを使うため、同じモジュール配置で解決できる見込み。Windows では `resources\app.asar` の整合性情報を実行ファイルの PE リソースに入れる。macOS では `Info.plist` に入れる。Windows 用配布では fuse・PE リソースの反映後に Authenticode 署名を検証し、Windows 実機で ESM、WASM、DB、ワーカーと初回推定を確認する。今回の Windows の包装・実行はいずれも未確認。 [Electron の ASAR アーカイブ](https://www.electronjs.org/docs/latest/tutorial/asar-archives)、[ASAR 整合性検証](https://www.electronjs.org/docs/latest/tutorial/asar-integrity)

## Editor 配布物での確認

同じ Electron とビルダーで Editor の macOS arm64 `.app` を包装し、アドホック署名・署名検証・5 つの fuse の読戻しを済ませてから起動した。rc 公開前の 4 依存は検証用の包装設定でローカルビルドを差し込んだ。ASAR の目録でワーカー入口と 4 依存が格納され、PROJ 資産が展開されていることを確認した。

検証用入口から Editor の main と preload を起動し、非表示のウィンドウの `window.crs` を呼んだ。推定前に子プロセスは 0 件。4 GCP の初回推定は `ok_with_warnings` で 6 候補を返し、最良は `EPSG:3857`。単体再推定は `EPSG:3094` を返した。正式配布用の依存解決、署名と公証、Windows 実機は別途確認が必要。
