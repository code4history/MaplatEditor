'use strict';

const fs = require('fs-extra'); // eslint-disable-line no-undef

const pf = process.platform; // eslint-disable-line no-undef
const isAsar = __dirname.match(/app\.asar/); // eslint-disable-line no-undef
const assetsPath = pf == 'darwin' ?
  isAsar ? '../../../app.asar.unpacked/assets/mac' : '../../assets/mac' :
  isAsar ? '../../../app.asar.unpacked/assets/win' : '../../assets/win';
const canvasPath = `${assetsPath}/canvas`;
const { createCanvas, loadImage } = require(canvasPath); // eslint-disable-line no-undef

exports.make_thumbnail = async function(from, to, oldSpec) { // eslint-disable-line no-undef
  const extractor = async function(from, to) {
    const image = await loadImage(from);

    const width = image.width;
    const height = image.height;
    const w = width > height ? 52 : Math.ceil(52 * width / height);
    const h = width > height ? Math.ceil(52 * height / width) : 52;

    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, w, h);

    const jpgTile = canvas.toBuffer('image/jpeg', {quality: 0.9});
    await fs.outputFile(to, jpgTile);
  };

  if (oldSpec) {
    try {
      await fs.stat(oldSpec);
      await fs.move(oldSpec, to, {overwrite: true});
    } catch (noOldSpec) {
      if (noOldSpec.code === 'ENOENT'){
        try {
          await fs.stat(to);
        } catch (noTo) {
          if (noTo.code === 'ENOENT') {
            await extractor(from, to);
          } else throw noTo;
        }
      } else throw noOldSpec;
    }
  } else {
    await extractor(from, to);
  }
};