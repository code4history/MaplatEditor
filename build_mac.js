const config = {
  "appId": "jp.maplat.editor",
  "asarUnpack": [
    "assets/mac/imagemagick"
  ],
  "directories": {
    "output": "dist"
  },
  "files": [
    "assets/mac",
    "backend",
    "css",
    "frontend/dist",
    "html",
    "img",
    "locales",
    "package.json",
    "package-lock.json",
    "tms_list.json"
  ],
  "afterSign": "script/notarize/notarize.js",
  "mac": {
    "icon": "assets/mac/icon_mac.icns",
    "target": [
      "dmg"
    ],
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "script/notarize/entitlements.mac.plist",
    "entitlementsInherit": "script/notarize/entitlements.mac.plist",
  },
  "win": {
    "icon": "assets/win/icon_win.ico",
    "target": "nsis"
  },
  "nsis":{
    "oneClick": false,
    "allowToChangeInstallationDirectory": true
  }
};

module.exports = config;