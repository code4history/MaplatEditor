const pf = process.platform;
const canvasPath = pf == 'darwin' ? './assets/mac/canvas' : './assets/win/canvas';
const { createCanvas, loadImage } = require(canvasPath);
const fs = require('fs-extra');

//=== Temp test data ===
const imagePath = 'C:\\Users\\10467\\OneDrive\\MaplatEditor\\originals\\naramachi_yasui_bunko.jpg';
const tileRoot = 'C:\\Users\\10467\\OneDrive\\MaplatEditor\\tiles';
const mapID = 'naramachi_2';
const extension = 'jpg';

handleMaxZoom(imagePath, tileRoot, mapID, extension);

async function handleMaxZoom(imagePath, tileRoot, mapID, extension) {
    const image = await loadImage(imagePath);
    const width = image.width;
    const height = image.height;

    const maxZoom = Math.ceil(Math.log(Math.max(width, height) / 256)/ Math.log(2));

    for (let z = maxZoom; z >= 0; z--) {
        const pw = Math.round(width / Math.pow(2, maxZoom - z));
        const ph = Math.round(height / Math.pow(2, maxZoom - z));
        for (let tx = 0; tx * 256 < pw; tx++) {
            const tw = (tx + 1) * 256 > pw ? pw - tx * 256 : 256;
            const sx = tx * 256 * Math.pow(2, maxZoom - z);
            const sw = (tx + 1) * 256 * Math.pow(2, maxZoom - z) > width ? width - sx : 256 * Math.pow(2, maxZoom - z);
            const tileFolder = `${tileRoot}\\${mapID}\\${z}\\${tx}`;
            await fs.ensureDir(tileFolder);
            for (let ty = 0; ty * 256 < ph; ty++) {
                const th = (ty + 1) * 256 > ph ? ph - ty * 256 : 256;
                const sy = ty * 256 * Math.pow(2, maxZoom - z);
                const sh = (ty + 1) * 256 * Math.pow(2, maxZoom - z) > height ? height - sy : 256 * Math.pow(2, maxZoom - z);
                const canvas = createCanvas(tw, th);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, sx, sy, sw, sh, 0, 0, tw, th);

                const tileFile = `${tileFolder}\\${ty}.${extension}`;

                const jpgTile = canvas.toBuffer('image/jpeg', {quality: 0.9});
                await fs.outputFile(tileFile, jpgTile);
            }
        }
    }
}