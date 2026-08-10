// electron-builder 設定ファイル
//
// 署名の判定ロジック（m6-t12 §2.3/§2.4）:
//   macOS 署名のみ: MAC_SIGN=true で Hardened Runtime 付き署名（公証なし）
//   macOS 署名+公証: APPLE_ID 環境変数が設定されている場合（リリース用）
//   Windows: electron-builder では署名しない。SSL.com eSigner による post-build 署名へ
//   一本化した（クラウド署名のため証明書ファイルを配れない。手順は docs/release-signing.md）
//
// ローカルビルド: .env ファイルに APPLE_ID 等を記載すれば署名+公証される
// CI: build.yml が release 実行時のみ環境変数を出し分ける（詳細は build.yml 冒頭コメント）

// ───────────────────────────────────────────────
// Windows NSIS ペイロードの圧縮フィルタを BCJ2 に固定する（m19-t13）
//
// electron-builder 26 系は ARM64 フィルタ（7-Zip 21.07 で追加）を持つ 7-Zip を取得し、
// arm64 PE に対してそれを自動適用する。ところが NSIS 同梱の nsis7z（nsis-resources 由来）は
// ARM64 フィルタを解けず、**解けないエントリを黙って落として最後まで走り切る**。
// v1.0.0-rc2 の arm64 インストーラでは MaplatEditor.exe と DLL 8 本が展開されないまま
// 「インストール成功」で終わり、アプリだけが存在しない状態になった（実測 2026-08-10）。
// 24.13.3 は ARM64 を知らない 7za 16.02 を使っていたため BCJ2 が選ばれており、
// rc1 の arm64 は健全だった。∴ 本不具合は electron-builder 26 化（m18-t8）の退行である。
//
// BCJ2 は「いま x64 で現に動いているコーデック」であり、nsis7z が解けることの唯一の直接証拠を持つ。
// arm64 ペイロードは約 +6.2%（161MB → 約 171MB）になるが、増分はほぼ全量が
// 「ARM64 コードに ARM64 フィルタを使えない分」であり、rc1（233MB）よりなお小さい。
//
// ここ（build.yml の env: ではなく設定ファイル）に置くのは、electron-builder を起動する
// **全経路**（CI / ローカルの pnpm run dist:win / dist:win:arm64）を1箇所で覆うためである。
// 集合外の値は electron-builder 自身が throw し、集合内の危険値は
// scripts/m19-t13/verify-win-payload-codec.mjs（G2）が生成物側で捕まえる。
// ───────────────────────────────────────────────
process.env.ELECTRON_BUILDER_7Z_FILTER = 'BCJ2';

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
    ],

    // macOS ビルド設定
    mac: {
        icon: 'build/icon.icns',
        target: [
            { target: 'dmg', arch: ['x64', 'arm64'] },
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
    },
    nsis: {
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
        deleteAppDataOnUninstall: false,
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
