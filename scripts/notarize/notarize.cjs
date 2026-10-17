// macOS 公証スクリプト（@electron/notarize v2 / notarytool 対応）
// APPLE_ID 環境変数が設定されていない場合は公証をスキップする
require('dotenv').config();
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
    const { electronPlatformName, appOutDir } = context;

    if (electronPlatformName !== 'darwin') {
        console.log('公証: macOS 以外のプラットフォームのためスキップします。');
        return;
    }

    if (!process.env.APPLE_ID) {
        console.log('公証: APPLE_ID 環境変数が未設定のためスキップします。');
        console.log('公証を行う場合は .env ファイルに APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID を設定してください。');
        return;
    }

    const appName = context.packager.appInfo.productFilename;
    const appBundleId = context.packager.appInfo.id;

    console.log(`公証: ${appName} (${appBundleId}) の公証を開始します...`);

    // @electron/notarize は notarytool だけを使う（v3 で tool・appBundleId の指定が廃止。v2 でも notarytool では使われない）
    await notarize({
        appPath: `${appOutDir}/${appName}.app`,
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
    });

    console.log('公証: 完了しました。');
};
