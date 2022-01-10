const config = {
  "appId": "jp.maplat.editor",
  "asarUnpack": [
    "assets/mac_arm/canvas"
  ],
  "directories": {
    "output": "dist"
  },
  "files": [
    "assets/mac_arm",
    "backend",
    "css",
    "frontend/dist",
    "frontend/fonts",
    "html",
    "img",
    "locales",
    "package.json",
    "package-lock.json",
    "tms_list.json"
  ],
  "afterSign": "script/notarize/notarize.js",
  "mac": {
    "icon": "assets/mac_arm/icon_mac.icns",
    "target": [
      "dmg"
    ],
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "script/notarize/entitlements.mac.plist",
    "entitlementsInherit": "script/notarize/entitlements.mac.plist"
  }
};

module.exports = config;