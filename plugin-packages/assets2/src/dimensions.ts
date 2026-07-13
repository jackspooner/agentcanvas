export interface RasterDimensions {
  width: number;
  height: number;
}

function uint16Le(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function uint24Le(view: DataView, offset: number): number {
  return view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
}

function png(bytes: Uint8Array): RasterDimensions | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

function gif(bytes: Uint8Array): RasterDimensions | null {
  if (bytes.length < 10) return null;
  const signature = new TextDecoder('ascii').decode(bytes.slice(0, 6));
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: uint16Le(view, 6), height: uint16Le(view, 8) };
}

function webp(bytes: Uint8Array): RasterDimensions | null {
  if (bytes.length < 25) return null;
  const header = new TextDecoder('ascii').decode(bytes.slice(0, 12));
  if (!header.startsWith('RIFF') || header.slice(8, 12) !== 'WEBP') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunk = new TextDecoder('ascii').decode(bytes.slice(12, 16));
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return { width: uint24Le(view, 24) + 1, height: uint24Le(view, 27) + 1 };
  }
  if (chunk === 'VP8L') {
    const b0 = view.getUint8(21);
    const b1 = view.getUint8(22);
    const b2 = view.getUint8(23);
    const b3 = view.getUint8(24);
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + ((b3 << 6) | (b2 >> 2) | ((b1 & 0xc0) << 6))
    };
  }
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    return { width: uint16Le(view, 26) & 0x3fff, height: uint16Le(view, 28) & 0x3fff };
  }
  return null;
}

function jpeg(bytes: Uint8Array): RasterDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = bytes[offset + 1];
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1;
      marker = bytes[offset + 1];
    }
    if (marker === 0xd9 || marker === 0xda || offset + 4 > bytes.length) return null;
    const length = view.getUint16(offset + 2, false);
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 7) {
      return { width: view.getUint16(offset + 7, false), height: view.getUint16(offset + 5, false) };
    }
    offset += 2 + length;
  }
  return null;
}

export function readRasterDimensions(bytes: Uint8Array): RasterDimensions | null {
  return png(bytes) ?? gif(bytes) ?? webp(bytes) ?? jpeg(bytes);
}
