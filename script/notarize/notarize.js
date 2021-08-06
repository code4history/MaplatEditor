require('dotenv').config();
const { notarize } = require('electron-notarize');
const mac_build = require('../../build_mac');

exports.default = async function notarizing(context) {
    const { electronPlatformName, appOutDir } = context;
    const appName = context.packager.appInfo.productFilename;

    const isMac = electronPlatformName === 'darwin';
    if (!isMac) {
        console.log('Notarization is skipped on OSs other than macOS.');
        return;
    }

    const isPackageTest = !!process.env.PLM_PACKAGE_TEST;
    if (isPackageTest) {
        console.log('Notarization is skipped in package test.');
        return;
    }

    console.log('Started notarization.');
    await notarize({
        appBundleId: mac_build.appId,
        appPath: `${appOutDir}/${appName}.app`,
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    });
    console.log('Finished notarization.');
};