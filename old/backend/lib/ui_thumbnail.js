'use strict';

const fs = require('fs-extra'); // eslint-disable-line no-undef
const {Jimp} = require('../lib/utils'); // eslint-disable-line no-undef

exports.make_thumbnail = async function(from, to, oldSpec) { // eslint-disable-line no-undef
  const extractor = async function(from, to) {
    const imageJimp = await Jimp.read(from);

    const width = imageJimp.bitmap.width;
    const height = imageJimp.bitmap.height;
    const w = width > height ? 52 : Math.ceil(52 * width / height);
    const h = width > height ? Math.ceil(52 * height / width) : 52;

    await imageJimp.resize(w, h).write(to);
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