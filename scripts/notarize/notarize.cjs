// macOS 公証スクリプト（@electron/notarize 3.x / notarytool 対応）。
// afterSign は資格情報なしなら省略し、DMG の CLI は full 専用なので失敗にする。
require('dotenv').config();
const path = require('node:path');
const { readdirSync } = require('node:fs');
const { notarize } = require('@electron/notarize');

async function notarizePath(appPath, { env = process.env, notarize: submit = notarize } = {}) {
    await submit({
        // DMG の相対パスはライブラリ内の一時ディレクトリから解決されるため絶対パスにする。
        appPath: path.resolve(appPath),
        appleId: env.APPLE_ID,
        appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: env.APPLE_TEAM_ID,
    });
    console.log('公証: 完了しました。');
}

exports.default = async function notarizing(context, dependencies = {}) {
    const { electronPlatformName, appOutDir } = context;
    const env = dependencies.env ?? process.env;
    if (electronPlatformName !== 'darwin') {
        console.log('公証: macOS 以外のプラットフォームのためスキップします。');
        return;
    }
    if (!env.APPLE_ID) {
        console.log('公証: APPLE_ID 環境変数が未設定のためスキップします。');
        console.log('公証を行う場合は .env ファイルに APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID を設定してください。');
        return;
    }
    const appName = context.packager.appInfo.productFilename;
    const appBundleId = context.packager.appInfo.id;
    console.log(`公証: ${appName} (${appBundleId}) の公証を開始します...`);
    await notarizePath(path.join(appOutDir, `${appName}.app`), dependencies);
};

exports.runCli = async function runCli(args, dependencies = {}) {
    try {
        if (args.length !== 2 || args[0] !== '--dmg' || !args[1]) {
            throw new Error('使い方: node scripts/notarize/notarize.cjs --dmg <dir>');
        }
        const env = dependencies.env ?? process.env;
        if (!env.APPLE_ID) throw new Error('DMG の公証には APPLE_ID が必要です。');
        const dir = path.resolve(args[1]);
        const dmgs = readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith('.dmg'))
            .map((entry) => path.join(dir, entry.name)).sort();
        if (dmgs.length !== 2) throw new Error(`DMG は 2 本必要です（検出: ${dmgs.length} 本）。`);
        for (const dmg of dmgs) {
            console.log(`公証: ${path.basename(dmg)} の公証を開始します...`);
            await notarizePath(dmg, dependencies);
        }
        return 0;
    } catch (error) {
        // ライブラリが付ける notarytool の診断も省略せず、CI の失敗ログへ残す。
        console.error(error);
        return 1;
    }
};

if (require.main === module) {
    exports.runCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
