const config = {
  "appId": "jp.maplat.editor",
  "directories": {
    "output": "dist"
  },
  "files": [
    "assets/win",
    "backend",
    "css",
    "frontend/api",
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
    "icon": "assets/win/icon_win.ico",
    "target": "nsis"
  },
  "nsis":{
    "oneClick": false,
    "allowToChangeInstallationDirectory": true
  }
};

module.exports = config;