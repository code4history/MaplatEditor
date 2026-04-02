// electron-builder 設定ファイル
//
// 署名の判定ロジック:
//   macOS: APPLE_ID 環境変数が設定されている場合のみ Hardened Runtime・公証を有効化
//   Windows: WIN_CSC_LINK または CSC_LINK が設定されている場合のみ署名
//
// ローカルビルド: .env ファイルに APPLE_ID 等を記載すれば署名される
// CI (master): GitHub Secrets が設定されていれば署名、未設定なら署名なし
// CI (branch/手動): 環境変数を渡さないため署名なし

// macOS: APPLE_ID が設定されていれば署名・公証を行う
const isMacSigning = !!process.env.APPLE_ID;

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
    files: ['dist', 'dist-electron'],

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
    afterSign: isMacSigning ? 'scripts/notarize/notarize.cjs' : undefined,

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
