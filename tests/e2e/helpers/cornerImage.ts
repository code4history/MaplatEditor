// 四隅に色の違う四角を置いた画像を作り、512px サムネイルの四隅の色を確かめる e2e の助け。
// 大きさだけでは分からない、縫い合わせのずれ・端の切れ・白い帯を見る。
import { expect } from '@playwright/test';
import path from 'node:path';
import { Jimp } from 'jimp';
import { transcodeImage } from '../../../electron/utils/thumbnail512Codec';

// 四隅に色の違う四角を置いた画像。地は灰色。出力の四隅の色を見れば、ずれと端の切れが分かる
// （512px への縮小で消えないよう、四角は短辺の 1/10、最小 4px）
const BACKGROUND = { r: 0x80, g: 0x80, b: 0x80 };
const CORNERS = [
  { name: '左上', at: (_w: number, _h: number) => [0, 0], color: { r: 0xff, g: 0x00, b: 0x00 } },
  { name: '右上', at: (w: number, _h: number) => [w - 1, 0], color: { r: 0x00, g: 0xc0, b: 0x00 } },
  { name: '左下', at: (_w: number, h: number) => [0, h - 1], color: { r: 0x00, g: 0x00, b: 0xff } },
  { name: '右下', at: (w: number, h: number) => [w - 1, h - 1], color: { r: 0xff, g: 0xff, b: 0x00 } },
] as const;

function rgba(c: { r: number; g: number; b: number }): number {
  return ((c.r << 24) | (c.g << 16) | (c.b << 8) | 0xff) >>> 0;
}

export async function writeCornerImage(dest: string, width: number, height: number): Promise<void> {
  const image = new Jimp({ width, height, color: rgba(BACKGROUND) });
  const block = Math.max(4, Math.round(Math.min(width, height) / 10));
  for (const corner of CORNERS) {
    const [cx, cy] = corner.at(width, height);
    const x0 = cx === 0 ? 0 : width - block;
    const y0 = cy === 0 ? 0 : height - block;
    const color = rgba(corner.color);
    for (let y = y0; y < y0 + block; y++) {
      for (let x = x0; x < x0 + block; x++) image.setPixelColor(color, x, y);
    }
  }
  await image.write(dest as `${string}.${string}`);
}

// 512px の webp を png へ写して読み、四隅の色と中央の地の色を確かめる（webp は非可逆なので幅を持たせる）
export async function expectCornerColors(thumbPath: string, workDir: string): Promise<void> {
  const pngPath = path.join(workDir, `corners-${Date.now()}.png`);
  await transcodeImage(thumbPath, pngPath);
  const image = await Jimp.read(pngPath);
  const { width, height } = image.bitmap;
  const near = (x: number, y: number, c: { r: number; g: number; b: number }, label: string) => {
    const idx = (y * width + x) * 4;
    const got = { r: image.bitmap.data[idx], g: image.bitmap.data[idx + 1], b: image.bitmap.data[idx + 2] };
    const diff = Math.max(Math.abs(got.r - c.r), Math.abs(got.g - c.g), Math.abs(got.b - c.b));
    expect(diff, `${label} (${x},${y}) の色 ${JSON.stringify(got)} が ${JSON.stringify(c)} に近い`).toBeLessThanOrEqual(48);
  };
  for (const corner of CORNERS) {
    const [x, y] = corner.at(width, height);
    near(x, y, corner.color, corner.name);
  }
  near(Math.floor(width / 2), Math.floor(height / 2), BACKGROUND, '中央');
}
