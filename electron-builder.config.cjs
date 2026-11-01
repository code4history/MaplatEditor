// electron-builder 設定ファイル
//
// 署名の判定ロジック（m6-t12 §2.3/§2.4）:
//   macOS 署名のみ: MAC_SIGN=true で Hardened Runtime 付き署名（公証なし）
//   macOS 署名+公証: APPLE_ID 環境変数が設定されている場合（リリース用）
//   Windows: 配布物に入る全 PE（exe・dll・Windows 用 .node・elevate.exe・アンインストーラー・
//   インストーラー・NSIS プラグイン DLL）を electron-builder のファイルごとの署名フック
//   （scripts/win-sign/win-sign.cjs）に渡す。WIN_SIGN_MODE で切り替える（off=既定・署名しない /
//   record=記録だけ・課金ゼロ / collect=署名専用ジョブ〔Azure Artifact Signing〕へ渡すために集める・
//   同じ実行の署名済みに差し替える / esigner=SSL.com eSigner で署名する退路）。手順は docs/release-signing.md
//
// ローカルビルド: .env ファイルに APPLE_ID 等を記載すれば署名+公証される
// CI: build.yml が release 実行時のみ環境変数を出し分ける（詳細は build.yml 冒頭コメント）

// Windows NSIS ペイロードの圧縮フィルタは electron-builder 26.15.6 以降が BCJ に固定する
// （上流 #9988・v26 への backport #9989。環境変数では変えられない）。
// m19-t13 の回避策（BCJ2 の指定）は nov26-m6-t2 で撤去した。生成物の検査は
// scripts/m19-t13/verify-win-payload-codec.mjs（G2）。

// Windows: 全 PE 署名（2026-10-03・SAC 起動拒否への対処。詳細は scripts/win-sign/win-sign.cjs 冒頭）
const winSign = require('./scripts/win-sign/win-sign.cjs');
const winSignEnabled = winSign.getMode() !== 'off';
// pack-win-1 と pack-win-2 でアンインストーラーを同じバイト列に作る（でないと署名済みに差し替えられない）。
// app-builder-lib が NSIS の言語メッセージ 2 ファイルを並行に取り込む順を固定する。詳細は nsis-message-order.cjs 冒頭
if (winSignEnabled) require('./scripts/win-sign/nsis-message-order.cjs').install();

// 自動更新（nov26-m7-t5・#141）: Windows の更新ファイルの署名者を electron-updater が照らす publisherName。
// 正本は scripts/win-sign/signer-identity.json の artifact-signing.publisherSubject（Get-AuthenticodeSignature の
// SignerCertificate.Subject の文字列そのもの）。**加工しない**: electron-updater は builder-util-runtime の parseDn で
// 両側を読み、キー名を正規化せずに全キーの値を比べる（S と ST は別のキー・値は 1 文字も変えられない）。
// 照合の写しは scripts/win-sign/updater-publisher-match.cjs、実物の Setup.exe との突き合わせは verify-win-install
const signerIdentity = require('./scripts/win-sign/signer-identity.json');

// macOS: 署名（Hardened Runtime）は「署名のみ」「署名+公証」のどちらでも有効化
const isMacNotarize = !!process.env.APPLE_ID;
const isMacSigning = isMacNotarize || process.env.MAC_SIGN === 'true';

/** @type {import('electron-builder').Configuration} */
const config = {
    appId: 'jp.maplat.editor',
    productName: 'MaplatEditor',
    asar: true,
    directories: {
        output: 'release/${version}',
        buildResources: 'build',
    },
    // 自動更新の更新元（nov26-m7-t5）。ビルドは --publish never のまま（公開はしない）。この設定は electron-builder が
    // resources/app-update.yml を書くために要る。publisherName を win.signtoolOptions に置かないのは、そこが
    // WIN_SIGN_MODE=off で消え、CN だけ（または無し）に落ちるため（app-builder-lib の PublishManager は
    // publish の publisherName を先に使う）。publisherName は Windows（NsisUpdater）だけが読む
    publish: [
        {
            provider: 'github',
            owner: 'code4history',
            repo: 'MaplatEditor',
            releaseType: 'release',
            publisherName: [signerIdentity['artifact-signing'].publisherSubject],
        },
    ],
    // m1-t2: 内部パッケージ（@maplat/* / @c4h/*）は outer の pnpm workspace により
    // 兄弟リポジトリの作業ディレクトリへ symlink 解決される。electron-builder は
    // その実体を丸ごと収集するため、各リポジトリの package.json の files 指定
    // （publish 時のみ有効）では防げず、public/ docs/ spec/ e2e/ dist-demo/ や
    // 入れ子 node_modules まで asar へ入ってしまう（実測: @maplat/core だけで
    // 3408 ファイル・うち public/ が 1197）。配布物には dist / src / parts のみ
    // 必要なため、明示的に除外する。
    files: [
        'dist',
        'dist-electron',
        // 開発用ディレクトリを除外（実測: 除外前は @maplat/core だけで 3408 ファイル、
        // うち public/ が 1197。除外後は 147 ファイル・asar は 330MB → 214MB）。
        // node_modules/ は除外しないこと — 内部パッケージの実依存（@turf /
        // lodash.template / whatwg-fetch 等）が入っており、消すと実行時に解決できない。
        '!node_modules/@{maplat,c4h}/*/{public,docs,spec,e2e,tests,demo,dist-demo,scripts,.github}/**',
        '!node_modules/@{maplat,c4h}/*/{*.md,*.log,.editorconfig,.prettierrc,eslint.config.*,vite.config.*,vitest.config.*,playwright*.config.*,tsconfig*.json,pnpm-lock.yaml}',
        // Windows 用 .node はビルド中の CPU 向けだけを入れる（x64 のインストーラーに arm64 の .node を入れない。逆も同じ）。
        // 実行時は @electron-internal/extract-zip（extract-zip の置き換え）の binding.js が process.arch で
        // index.win32-<arch>-msvc.node を選ぶため、他 CPU 向けは読まれず、署名の課金だけが増える。
        // ${arch} は electron-builder がアーキテクチャごとに展開する（!(…) は minimatch の否定 extglob）。
        // ${os} は win / mac / linux に展開されるので、'${os}32' は Windows ビルドでだけ 'win32' になり、
        // mac / linux ビルドでは何にも当たらない（macOS・Linux の同梱物は変えない）。
        // **win.files に置かないこと**: platform 側の files は root の files を置き換え、dist / dist-electron の
        // 限定が外れてプロジェクト全体が asar に入る（2026-10-03 に実測。builder-debug.yml の
        // firstOrDefaultFilePatterns が '**/*' になった）
        '!**/*.${os}32-!(${arch})-msvc.node',
    ],

    // macOS ビルド設定
    mac: {
        icon: 'build/icon.icns',
        target: [
            { target: 'dmg', arch: ['x64', 'arm64'] },
            // 自動更新（Squirrel.Mac）は zip を要る（nov26-m7-t5）。名前は下の artifactName（MaplatEditor-Mac-<版>-<arch>.zip）
            { target: 'zip', arch: ['x64', 'arm64'] },
        ],
        artifactName: '${productName}-Mac-${version}-${arch}.${ext}',
        // Hardened Runtime は公証に必須だが、APPLE_ID 未設定時は無効化
        hardenedRuntime: isMacSigning,
        gatekeeperAssess: false,
        // 公証は afterSign（scripts/notarize/notarize.cjs）が担うため、electron-builder
        // 自前の公証は明示的に止める。**false を省略できない**: electron-builder 24.13.3 は
        // APPLE_ID を env に見つけると notarizeIfProvided を起動し、mac.notarize が未定義だと
        // macPackager.js:501 の `const { appBundleId, ascProvider } = options` が undefined を
        // 分解して落ちる（m6-t12 AC7 の初回実走で実測。回帰止めは AC9）。
        // 仮に落ちなくても afterSign と二重に公証してしまう
        notarize: false,
        ...(isMacSigning && {
            entitlements: 'scripts/notarize/entitlements.mac.plist',
            entitlementsInherit: 'scripts/notarize/entitlements.mac.plist',
        }),
    },
    // 公証: APPLE_ID が設定されている場合のみ実行（スクリプト内でも再確認）
    afterSign: isMacNotarize ? 'scripts/notarize/notarize.cjs' : undefined,
    // Windows: NSIS プラグイン DLL を署名済みの複写に差し替える（WIN_SIGN_MODE=off では登録しない）。
    // --prepackaged（build.yml の pack のジョブ）では呼ばれないので、そこでは scripts/win-sign/prepare-nsis-toolset.mjs が用意する
    beforePack: winSignEnabled ? winSign.beforePack : undefined,

    dmg: {
        artifactName: '${productName}-Mac-${version}-${arch}.${ext}',
    },

    // Windows ビルド設定
    win: {
        icon: 'build/icon.ico',
        target: [
            { target: 'nsis', arch: ['x64', 'arm64'] },
        ],
        artifactName: '${productName}-Windows-${version}-${arch}-Setup.${ext}',
        ...(winSignEnabled && {
            // .dll と .node もフックへ渡す（既定は .exe だけ）。除外（!xxx.dll）は書かない:
            // app-builder-lib の shouldSignFile は肯定パターンを先に評価するため、'.dll' がある限り
            // '!d3dcompiler_47.dll' は効かない（winPackager.js shouldSignFile）。
            // Microsoft 署名済み DLL と非 Windows の .node はフック側（既存の署名 / PE 判定）で除く
            signExts: ['.dll', '.node'],
            signtoolOptions: {
                sign: winSign.sign,
                // 既定は ['sha1', 'sha256'] で**1 ファイルにつきフックが 2 回**呼ばれる（課金が倍）。sha256 だけにする
                signingHashAlgorithms: ['sha256'],
            },
        }),
    },
    nsis: {
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
        deleteAppDataOnUninstall: false,
        // arch 別 2 本（x64 / arm64）のみを配布する。統合版（arch 無し）は生成しない（m1-t4）。
        // 2 本の .exe 名は artifactName テンプレート由来であり、この設定では変わらない。
        buildUniversalInstaller: false,
    },

    // Linux ビルド設定（署名不要）
    linux: {
        icon: 'build/icon.png',
        target: [
            { target: 'AppImage', arch: ['x64', 'arm64'] },
        ],
        artifactName: '${productName}-Linux-${version}-${arch}.${ext}',
        category: 'Graphics',
    },
};

module.exports = config;
