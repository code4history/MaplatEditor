// PNG-in-ICO パッカー (純関数)。アプリエクスポートの favicon.ico 生成に使う。
// pwa-asset-generator は favicon を PNG でしか出力しないため、その PNG を .ico コンテナに包む。
//
// ICO (ICONDIR) フォーマット仕様 (すべて little-endian):
//   ICONDIR (6 bytes)
//     WORD reserved  = 0
//     WORD type      = 1 (icon; 2 は cursor)
//     WORD count     = エントリ数
//   ICONDIRENTRY (16 bytes × count)
//     BYTE  width      画像幅 (256 以上は 0 と記す)
//     BYTE  height     画像高さ (256 以上は 0 と記す)
//     BYTE  colorCount パレット色数 (パレット無しは 0)
//     BYTE  reserved   = 0
//     WORD  planes     カラープレーン数 (慣例的に 1)
//     WORD  bitCount   ピクセルあたりビット数 (PNG は 32)
//     DWORD bytesInRes 画像データのバイト長
//     DWORD imageOffset ファイル先頭からの画像データオフセット
//   画像データ (count 個連結)
//     Vista 以降 / 全モダンブラウザは BMP の代わりに PNG をそのまま格納できる
//     (PNG マジック 89 50 4E 47 で始まるデータを無加工で置く)

export type IcoEntry = {
  // PNG エンコード済みバイト列 (無加工で格納される)
  data: Buffer;
  width: number;
  height: number;
};

const ICONDIR_SIZE = 6;
const ICONDIRENTRY_SIZE = 16;

// 256px 以上は仕様上 0 と記す (BYTE 幅のため)
function dimensionByte(value: number): number {
  return value >= 256 ? 0 : Math.max(0, Math.floor(value));
}

export function packIco(entries: IcoEntry[]): Buffer {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('packIco: entries must be a non-empty array');
  }

  const header = Buffer.alloc(ICONDIR_SIZE + ICONDIRENTRY_SIZE * entries.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(entries.length, 4); // count

  let offset = header.length;
  entries.forEach((entry, index) => {
    const base = ICONDIR_SIZE + ICONDIRENTRY_SIZE * index;
    header[base] = dimensionByte(entry.width);
    header[base + 1] = dimensionByte(entry.height);
    header[base + 2] = 0; // colorCount
    header[base + 3] = 0; // reserved
    header.writeUInt16LE(1, base + 4); // planes
    header.writeUInt16LE(32, base + 6); // bitCount
    header.writeUInt32LE(entry.data.length, base + 8); // bytesInRes
    header.writeUInt32LE(offset, base + 12); // imageOffset
    offset += entry.data.length;
  });

  return Buffer.concat([header, ...entries.map(entry => entry.data)]);
}
