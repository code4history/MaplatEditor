const config = {
  "appId": "jp.maplat.editor",
  "asarUnpack": [
    "assets/win_x64/canvas"
  ],
  "directories": {
    "output": "dist"
  },
  "files": [
    "assets/win_x64",
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
  "win": {
    "icon": "assets/win_x64/icon_win.ico",
    "target": "nsis"
  },
  "nsis":{
    "oneClick": false,
    "allowToChangeInstallationDirectory": true
  }
};

module.exports = config;