'use strict';

const im = require('./imagemagick_modified.js'); // eslint-disable-line no-undef
const fs = require('fs-extra'); // eslint-disable-line no-undef

exports.make_thumbnail = function(from, to, existCheck) {
    let extractor;
    const extractor_ = function(resolve, reject) {
        im.identify(from, (err, features) => {
            if (err) {
                reject(err);
                return;
            }

            const width = features.width;
            const height = features.height;
            const w = width > height ? 52 : Math.ceil(52 * width / height);
            const h = width > height ? Math.ceil(52 * height / width) : 52;
            const args = [from, '-geometry', `${w}x${h}!`, to];
            im.convert(args, (err, stdout, stderr) => { // eslint-disable-line no-unused-vars
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    };

    if (existCheck) {
        extractor = function(resolve, reject) {
            fs.stat(to, (err) => {
                if (err != null && err.code === 'ENOENT') {
                    extractor_(resolve, reject);
                    return;
                }
                resolve();
            });
        };
    } else {
        extractor = extractor_;
    }

    return new Promise(extractor);
};