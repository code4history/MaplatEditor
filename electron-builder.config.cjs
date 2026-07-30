// electron-builder 設定ファイル
//
// 署名の判定ロジック:
//   macOS 署名のみ: MAC_SIGN=true で Hardened Runtime 付き署名（公証なし。テスター配布用）
//   macOS 署名+公証: APPLE_ID 環境変数が設定されている場合（リリース用）
//   Windows: WIN_CSC_LINK または CSC_LINK が設定されている場合のみ署名
//
// ローカルビルド: .env ファイルに APPLE_ID 等を記載すれば署名+公証される
// CI: build.yml がトリガー種別に応じて環境変数を出し分ける（詳細は build.yml 冒頭コメント）

// macOS: 署名（Hardened Runtime）は「署名のみ」「署名+公証」のどちらでも有効化
const isMacNotarize = !!process.env.APPLE_ID;
const isMacSigning = isMacNotarize || process.env.MAC_SIGN === 'true';

// Windows: WIN_CSC_LINK または CSC_LINK が設定されていれば署名
const isWinSigning = !!process.env.WIN_CSC_LINK || !!process.env.CSC_LINK;

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
