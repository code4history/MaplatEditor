// Reads the declared size of a tile from its first bytes, without decoding it. A tile is decoded only when its
// bytes are of the kind its extension says and it declares no more than one tile of pixels: an image decoder
// picks the format from the bytes and allocates what the header declares, so a small file that declares a huge
// image (or an image of another format under the tile's name) would otherwise hold the main process for seconds.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface DeclaredSize {
  width: number;
  height: number;
}

/** PNG: the signature, then the IHDR chunk with the width and height at bytes 16..23. */
function pngSize(bytes: Uint8Array): DeclaredSize | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * JPEG: FF D8 FF, then the segments up to the first frame header (SOF0..SOF15, but not C4 DHT, C8 JPG or CC
 * DAC), whose height and width are at bytes 5..8 of the segment. Null when no frame header comes before the
 * image data.
 */
function jpegSize(bytes: Uint8Array): DeclaredSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    let marker = bytes[i + 1];
    // Fill bytes before a marker
    while (marker === 0xff && i + 2 < bytes.length) {
      i += 1;
      marker = bytes[i + 1];
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    if (i + 3 >= bytes.length) return null;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 8 >= bytes.length) return null;
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + length;
  }
  return null;
}

/**
 * The size a tile file declares, when its bytes are of the kind of its extension (png, jpg or jpeg). Null when
 * they are not, or when the header cannot be read.
 */
export function declaredTileSize(bytes: Uint8Array, ext: string): DeclaredSize | null {
  if (ext === 'png') return pngSize(bytes);
  if (ext === 'jpg' || ext === 'jpeg') return jpegSize(bytes);
  return null;
}
