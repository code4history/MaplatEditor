// 512px サムネイルをタイルの段から作る。取り込みの直後（MapUploadService）と
// 起動時の補完（SqliteDataService）の両方がこの 1 つの実装を呼ぶ。
//
// 段の大きさは数式ではなくタイルの実寸から出す。端のタイルは余白を付けずに実寸で
// 書かれるので、各タイルの (tx*256 + 幅) / (ty*256 + 高さ) の最大値が段の正確な大きさになる。
// ∴ DB の width/height が欠けていても、取り込みの直後と同じ切り抜きになる。
import fs from 'fs-extra';
import path from 'path';
import { Jimp } from 'jimp';
import { TILE_SIZE } from './tilePyramid';
import { writeImageByExt } from './thumbnail512Codec';

/** 512px の元にする段の上限。ズーム2の段の長辺は 1024px 以下で、長辺 512px への縮小に足りる。 */
export const THUMB_512_MAX_LEVEL = 2;

/** 長辺の上限。これより小さい画像は拡大しない。 */
const THUMB_512_LONG_SIDE = 512;

/** タイルのファイル名（{ty}.{ext}）。拡張子は取り込んだ画像の形式に従うので限らない。 */
const TILE_FILE = /^\d+\.[A-Za-z0-9]+$/;
const NUMERIC_DIR = /^\d+$/;

async function readNumericDirs(dir: string): Promise<number[]> {
  try {
    return (await fs.readdir(dir)).filter((d) => NUMERIC_DIR.test(d)).map((d) => parseInt(d, 10));
  } catch {
    return [];
  }
}

async function levelHasTile(levelDir: string): Promise<boolean> {
  for (const tx of await readNumericDirs(levelDir)) {
    try {
      if ((await fs.readdir(path.join(levelDir, `${tx}`))).some((f) => TILE_FILE.test(f))) return true;
    } catch {
      // 列がファイルなどで読めないときは次の列へ
    }
  }
  return false;
}

/**
 * 512px の元にする段を選ぶ。
 * タイルのファイルが 1 枚以上ある段のうち、ズーム2以下で最大のもの。該当が無ければ null。
 * @param tilesRoot - 1 枚の地図のタイルのフォルダ（{z}/{x}/{y}.{ext} の親）
 */
export async function selectThumbnail512Level(tilesRoot: string): Promise<number | null> {
  const levels = (await readNumericDirs(tilesRoot))
    .filter((z) => z <= THUMB_512_MAX_LEVEL)
    .sort((a, b) => b - a);
  for (const z of levels) {
    if (await levelHasTile(path.join(tilesRoot, `${z}`))) return z;
  }
  return null;
}

/**
 * 1 つの段のタイルを縫い合わせ、長辺 512px（それ以下の画像は原寸）のサムネイルを dest へ書く。
 * 書き出しは拡張子で符号化器を選ぶ writeImageByExt を通る。dest のフォルダはここで作る。
 * 読めたタイルが 1 枚も無ければ投げる（何も書かない）。
 * @param levelDir - 段のフォルダ（{x}/{y}.{ext} の親）
 * @param dest - 出力ファイルの絶対パス
 */
export async function stitchThumbnail512(levelDir: string, dest: string): Promise<void> {
  const columns = (await readNumericDirs(levelDir)).sort((a, b) => a - b);

  // 先に全列の行の最大を確定させ、キャンバスを 1 度だけ作る
  const tiles: Array<{ tx: number; ty: number; file: string }> = [];
  let maxX = 0;
  let maxY = 0;
  for (const tx of columns) {
    let names: string[];
    try {
      names = await fs.readdir(path.join(levelDir, `${tx}`));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!TILE_FILE.test(name)) continue;
      const ty = parseInt(name, 10);
      tiles.push({ tx, ty, file: path.join(levelDir, `${tx}`, name) });
      maxX = Math.max(maxX, tx);
      maxY = Math.max(maxY, ty);
    }
  }

  const canvas = new Jimp({
    width: (maxX + 1) * TILE_SIZE,
    height: (maxY + 1) * TILE_SIZE,
    color: 0xffffffff,
  });
  let contentWidth = 0;
  let contentHeight = 0;
  let tilesRead = 0;
  for (const { tx, ty, file } of tiles) {
    try {
      const tile = await Jimp.read(file);
      tilesRead++;
      contentWidth = Math.max(contentWidth, tx * TILE_SIZE + tile.width);
      contentHeight = Math.max(contentHeight, ty * TILE_SIZE + tile.height);
      canvas.composite(tile, tx * TILE_SIZE, ty * TILE_SIZE);
    } catch {
      // 読めないタイルは白のまま残す
    }
  }
  if (tilesRead === 0) throw new Error(`no tiles could be read in ${path.basename(levelDir)}`);

  // タイルの実寸から出した範囲へ切り抜く（グリッドの切り上げで生じた白を除く）
  const cropW = Math.min(canvas.width, contentWidth);
  const cropH = Math.min(canvas.height, contentHeight);
  if (cropW < canvas.width || cropH < canvas.height) {
    canvas.crop({ x: 0, y: 0, w: cropW, h: cropH });
  }

  // 長辺 512px へ縮小（512px 以下は拡大しない）
  const longSide = Math.max(canvas.width, canvas.height);
  if (longSide > THUMB_512_LONG_SIDE) {
    const scale = THUMB_512_LONG_SIDE / longSide;
    canvas.resize({
      w: Math.max(1, Math.round(canvas.width * scale)),
      h: Math.max(1, Math.round(canvas.height * scale)),
    });
  }

  await fs.ensureDir(path.dirname(dest));
  await writeImageByExt(canvas, dest);
}
