const path = require("path");
const fileUrl = require("file-url");
const storeHandler = require("@maplat/core/es5/source/store_handler");
const fs = require('fs').promises // eslint-disable-line no-undef

async function exists(filepath) {
  try {
    await fs.lstat(filepath);
    return true;
  } catch (e) {
    return false
  }
}

async function normalizeRequestData(json, thumbFolder) {
  let url_;
  const whReady = (json.width && json.height) || (json.compiled && json.compiled.wh);
  if (!whReady) return [json, ];

  await new Promise((resolve, reject) => { // eslint-disable-line no-unused-vars
    if (json.url) {
      url_ = json.url;
      resolve();
    } else {
      fs.readdir(thumbFolder, (err, thumbs) => {
        if (!thumbs) {
          resolve();
          return;
        }
        for (let i=0; i<thumbs.length; i++) {
          const thumb = thumbs[i];
          if (/^0\.(?:jpg|jpeg|png)$/.test(thumb)) {
            let thumbURL = fileUrl(thumbFolder + path.sep + thumb);
            thumbURL = thumbURL.replace(/\/0\/0\/0\./, '/{z}/{x}/{y}.');
            url_ = thumbURL;
            resolve();
            return;
          }
        }
      });
    }
  });

  const res = await storeHandler.store2HistMap(json, true);
  res[0].url_ = url_;
  return res;
}

module.exports = { // eslint-disable-line no-undef
  exists,
  normalizeRequestData
};