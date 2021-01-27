'use strict';

const fs = require('fs-extra'); // eslint-disable-line no-undef

const pf = process.platform;
var isAsar = __dirname.match(/app\.asar/);
const canvasPath = pf == 'darwin' ?
    isAsar ? '../../../app.asar.unpacked/assets/mac/canvas' : '../../assets/mac/canvas' :
    isAsar ? '../../../app.asar.unpacked/assets/win/canvas' : '../../assets/win/canvas';
const { createCanvas, loadImage } = require(canvasPath);

exports.make_thumbnail = async function(from, to, oldSpec) {
    const extractor = async function(from, to) {
        try {
            const image = await loadImage(from);

            const width = image.width;
            const height = image.height;
            const w = width > height ? 52 : Math.ceil(52 * width / height);
            const h = width > height ? Math.ceil(52 * height / width) : 52;

            const canvas = createCanvas(w, h);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0, w, h);

            const jpgTile = canvas.toBuffer('image/jpeg', {quality: 0.9});
            fs.outputFile(to, jpgTile);
        } catch (e) {
            throw e;
        }
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