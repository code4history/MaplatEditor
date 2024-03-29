'use strict';

const {Jimp} = require('../lib/utils'); // eslint-disable-line no-undef

const Tin = require('@maplat/tin').default; // eslint-disable-line no-undef

const path = require('path'); // eslint-disable-line no-undef
//const app = require('electron').app; // eslint-disable-line no-undef
const fs = require('fs-extra'); // eslint-disable-line no-undef
const {ipcMain} = require("electron"); // eslint-disable-line no-undef
const settings = require('./settings').init(); // eslint-disable-line no-undef

const MERC_MAX = 20037508.342789244;
const ProgressReporter = require('../lib/progress_reporter'); // eslint-disable-line no-undef

let mapFolder;
let wmtsFolder;
let originalFolder;
let tmpFolder; // eslint-disable-line no-unused-vars

let initialized = false;

const WmtsGenerator = {
  init() {
    const saveFolder = settings.getSetting('saveFolder');
    mapFolder = path.resolve(saveFolder, "maps");
    fs.ensureDir(mapFolder, () => {
    });
    wmtsFolder = path.resolve(saveFolder, "wmts");
    fs.ensureDir(wmtsFolder, () => {
    });
    originalFolder = path.resolve(saveFolder, "originals");
    fs.ensureDir(originalFolder, () => {
    });
    tmpFolder = settings.getSetting('tmpFolder');

    if (!initialized) {
      initialized = true;
      ipcMain.on('wmtsGen_generate', async (event, mapID, width, height, tinSerial, extKey, hash) => {
        this.generate(event, mapID, width, height, tinSerial, extKey, hash);
      });
    }
  },
  async generate(ev, mapID, width, height, tinSerial, extKey, hash) {
    try {
      const self = this;
      const tin = new Tin({});
      tin.setCompiled(tinSerial);
      extKey = extKey ? extKey : 'jpg';
      const imagePath = path.resolve(originalFolder, `${mapID}.${extKey}`);
      const tileRoot = path.resolve(wmtsFolder, mapID);

      const lt = tin.transform([0, 0], false, true);
      const rt = tin.transform([width, 0], false, true);
      const rb = tin.transform([width, height], false, true);
      const lb = tin.transform([0, height], false, true);

      const pixelLongest = Math.sqrt(Math.pow(width, 2) + Math.pow(height, 2));
      const ltrbLong = Math.sqrt(Math.pow(lt[0] - rb[0], 2) + Math.pow(lt[1] - rb[1], 2));
      const rtlbLong = Math.sqrt(Math.pow(rt[0] - lb[0], 2) + Math.pow(rt[1] - lb[1], 2));

      const wwRate = MERC_MAX * 2 / 256;
      const mapRate = Math.min(ltrbLong / pixelLongest, rtlbLong / pixelLongest);
      const maxZoom = Math.ceil(Math.log2(wwRate / mapRate));
      const minSide = Math.min(width, height);
      const deltaZoom = Math.ceil(Math.log2(minSide / 256));
      const minZoom = maxZoom - deltaZoom;

      const edgeValues = [lt, lb, rt, rb];
      for (let px = 1; px < width; px++) {
        edgeValues.push(tin.transform([px, 0], false, true));
        edgeValues.push(tin.transform([px, height], false, true));
      }
      for (let py = 1; py < height; py++) {
        edgeValues.push(tin.transform([0, py], false, true));
        edgeValues.push(tin.transform([width, py], false, true));
      }
      const txs = edgeValues.map((item) => item[0]);
      const tys = edgeValues.map((item) => item[1]);

      const pixelXw = (Math.min(...txs) + MERC_MAX) / (2 * MERC_MAX) * 256 * Math.pow(2, maxZoom);
      const pixelXe = (Math.max(...txs) + MERC_MAX) / (2 * MERC_MAX) * 256 * Math.pow(2, maxZoom);
      const pixelYn = (MERC_MAX - Math.max(...tys)) / (2 * MERC_MAX) * 256 * Math.pow(2, maxZoom);
      const pixelYs = (MERC_MAX - Math.min(...tys)) / (2 * MERC_MAX) * 256 * Math.pow(2, maxZoom);

      const tileXw = Math.floor(pixelXw / 256);
      const tileXe = Math.floor(pixelXe / 256);
      const tileYn = Math.floor(pixelYn / 256);
      const tileYs = Math.floor(pixelYs / 256);

      const processArray = [];
      for (let z = maxZoom; z >= minZoom; z--) {
        const txw = Math.floor(tileXw / Math.pow(2, maxZoom - z));
        const txe = Math.floor(tileXe / Math.pow(2, maxZoom - z));
        const tyn = Math.floor(tileYn / Math.pow(2, maxZoom - z));
        const tys = Math.floor(tileYs / Math.pow(2, maxZoom - z));
        for (let x = txw; x <= txe; x++) {
          for (let y = tyn; y <= tys; y++) {
            processArray.push([z, x, y]);
          }
        }
      }

      const imageJimp = await Jimp.read(imagePath);
      const imageBuffer = imageJimp.bitmap.data;

      const progress = new ProgressReporter("mapedit", processArray.length, 'wmtsgenerate.generating_tile');
      progress.update(ev, 0);

      for (let i = 0; i < processArray.length; i++) {
        const process = processArray[i];
        if (process[0] === maxZoom) {
          await self.maxZoomTileLoop(tin, process[0], process[1], process[2], imageBuffer, width, height, tileRoot);
        } else {
          await self.upperZoomTileLoop(process[0], process[1], process[2], tileRoot);
        }
        await new Promise((s) => setTimeout(s, 1)); // eslint-disable-line no-undef
        progress.update(ev, i + 1);
      }
      ev.reply('wmtsGen_wmtsGenerated', {
        hash
      });
    } catch (err) {
      console.log(err); // eslint-disable-line no-undef
      ev.reply('wmtsGen_wmtsGenerated', {
        err,
        hash
      });
    }
  },
  async upperZoomTileLoop(z, x, y, tileRoot) {
    const downZoom = z + 1;

    const tileJimp = await new Jimp(256, 256);

    for (let dx = 0; dx < 2; dx++) {
      const ux = x * 2 + dx;
      const ox = dx * 128;
      for (let dy = 0; dy < 2; dy ++) {
        const uy = y * 2 + dy;
        const oy = dy * 128;
        const upImage = path.resolve(tileRoot, `${downZoom}`, `${ux}`, `${uy}.png`);
        try {
          const imageJimp = (await Jimp.read(upImage)).resize(128, 128);
          await tileJimp.composite(imageJimp, ox, oy);
        } catch(e) { // eslint-disable-line no-empty
        }
      }
    }

    const tileFolder = path.resolve(tileRoot, `${z}`, `${x}`);
    const tileFile = path.resolve(tileFolder, `${y}.png`);
    await fs.ensureDir(tileFolder);
    await tileJimp.write(tileFile);
  },
  async maxZoomTileLoop(tin, z, x, y, imageBuffer, width, height, tileRoot) {
    const self = this;
    const unitPerPixel = (2 * MERC_MAX) / (256 * Math.pow(2, z));
    const startPixelX = x * 256;
    const startPixelY = y * 256;

    const tileJimp = await new Jimp(256, 256);
    const tileData = tileJimp.bitmap.data;

    const range = [-1, 0, 1, 2];
    let pos = 0;

    for (let py = 0; py < 256; py++) {
      const my = MERC_MAX - ((py + startPixelY) * unitPerPixel);
      for (let px = 0; px < 256; px++) {
        const mx = (px + startPixelX) * unitPerPixel - MERC_MAX;
        const xy = tin.transform([mx, my], true, true);
        const rangeX = range.map((i) => i + ~~xy[0]);
        const rangeY = range.map((i) => i + ~~xy[1]);

        let r = 0, g = 0, b = 0, a = 0;
        for (const y of rangeY) {
          const weightY = self.getWeight(y, xy[1]);
          for (const x of rangeX) {
            const weight = weightY * self.getWeight(x, xy[0]);
            if (weight === 0) {
              continue;
            }

            const color = self.rgba(imageBuffer, width, height, x, y);
            r += color.r * weight;
            g += color.g * weight;
            b += color.b * weight;
            a += color.a * weight;
          }
        }

        tileData[pos] = ~~r;
        tileData[pos+1] = ~~g;
        tileData[pos+2] = ~~b;
        tileData[pos+3] = ~~a;

        pos = pos + 4;
      }
    }

    tileJimp.bitmap.data = tileData;

    const tileFolder = path.resolve(tileRoot, `${z}`, `${x}`);
    const tileFile = path.resolve(tileFolder, `${y}.png`);
    await fs.ensureDir(tileFolder);
    await tileJimp.write(tileFile);
  },
  norm(val) {
    const ret = ~~val;
    return ret < 0 ? 0 : ret;
  },
  rgba(pixels, w, h, x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) {
      return {r: 0, g: 0, b: 0, a: 0};
    }
    const p = ((w * y) + x) * 4;
    return { r: pixels[p], g: pixels[p+1], b: pixels[p+2], a: pixels[p+3]};
  },
  getWeight(t1, t2) {
    const a = -1;
    const d = Math.abs(t1 - t2);
    if (d < 1) {
      return (a + 2) * Math.pow(d, 3) - (a + 3) * Math.pow(d, 2) + 1;
    } else if (d < 2) {
      return a * Math.pow(d, 3) - 5 * a * Math.pow(d, 2) + 8 * a * d - 4 * a;
    } else {
      return 0;
    }
  }
};

module.exports = WmtsGenerator; // eslint-disable-line no-undef