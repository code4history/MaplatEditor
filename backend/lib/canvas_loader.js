const [os, arch_abbr] = require("./os_arch")(); // eslint-disable-line no-undef
const asarPath = __dirname.match(/app\.asar/) ? // eslint-disable-line no-undef
  '../../../app.asar.unpacked/assets' : '../../assets';
const assetsPath = `${asarPath}/${os}_${arch_abbr}`;
if (os === 'mac') {
  process.env.DYLD_LIBRARY_PATH = [ // eslint-disable-line no-undef
    `${assetsPath}/lib`,
    '$DYLD_LIBRARY_PATH'
  ].join(':');
}
const canvasPath = `${assetsPath}/canvas`;
const { createCanvas, Image } = require(canvasPath); // eslint-disable-line no-undef

module.exports = { // eslint-disable-line no-undef
  assetsPath,
  createCanvas,
  Image
};