/**
 * Minimal dependency-free raster codec for the image editor pipeline.
 *
 * PNG decode (8-bit, non-interlaced, gray/RGB/palette/gray+alpha/RGBA) and
 * encode (RGBA) built on node:zlib, plus a JPEG size probe. The pipeline needs
 * this because the skill scripts may not spawn a child process at all: DSH's
 * file sandbox refuses piped stdio and blocks spawning an interpreter from
 * Node, so all pixel work happens in-process.
 */

import zlib from "node:zlib";

const PNG_SIGNATURE = 0x89504e47;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** One decoded image: RGBA8 pixels, row-major, top-left origin. */
export class Raster {
  constructor(width, height, data) {
    this.width = width;
    this.height = height;
    this.data = data; // Uint8Array, length = width*height*4
  }

  index(x, y) { return (y * this.width + x) * 4; }

  static create(width, height, rgba = [0, 0, 0, 0]) {
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3];
    }
    return new Raster(width, height, data);
  }

  clone() { return new Raster(this.width, this.height, Uint8Array.from(this.data)); }
}

/** Read the pixel size of a PNG or JPEG buffer. */
export function probeSize(buffer) {
  if (buffer.length > 8 && buffer.readUInt32BE(0) === PNG_SIGNATURE) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: "png" };
  }
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), format: "jpeg" };
      }
      offset += 2 + length;
    }
    throw new Error("无法解析 JPEG 尺寸");
  }
  throw new Error("只支持 PNG / JPEG（PNG 可读写，JPEG 仅可读尺寸：请先转成 PNG）");
}

/** Decode one PNG buffer into RGBA8. */
export function decodePng(buffer) {
  if (buffer.length < 8 || buffer.readUInt32BE(0) !== PNG_SIGNATURE) throw new Error("不是 PNG 文件");
  let offset = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  const idat = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        bitDepth: data[8], colorType: data[9], interlace: data[12],
      };
    } else if (type === "PLTE") palette = Buffer.from(data);
    else if (type === "tRNS") transparency = Buffer.from(data);
    else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!header) throw new Error("PNG 缺少 IHDR");
  if (header.bitDepth !== 8) throw new Error(`PNG 位深 ${header.bitDepth} 不支持（请用 8 位图）`);
  if (header.interlace !== 0) throw new Error("不支持隔行 PNG（请重新导出）");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  if (!channels) throw new Error(`PNG 色彩类型 ${header.colorType} 不支持`);
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const { width, height } = header;
  const stride = width * channels;
  const raw = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[pos++];
    const row = inflated.subarray(pos, pos + stride);
    pos += stride;
    const out = raw.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? raw.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prior ? prior[x] : 0;
      const c = prior && x >= channels ? prior[x - channels] : 0;
      const value = row[x];
      let result;
      switch (filter) {
        case 0: result = value; break;
        case 1: result = value + a; break;
        case 2: result = value + b; break;
        case 3: result = value + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
          result = value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`未知 PNG 行滤波器 ${filter}`);
      }
      out[x] = result & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = y * stride + x * channels;
      const dst = (y * width + x) * 4;
      if (header.colorType === 0) {
        const g = raw[src];
        rgba[dst] = g; rgba[dst + 1] = g; rgba[dst + 2] = g;
        rgba[dst + 3] = transparency && raw[src] === transparency.readUInt16BE(0) ? 0 : 255;
      } else if (header.colorType === 2) {
        rgba[dst] = raw[src]; rgba[dst + 1] = raw[src + 1]; rgba[dst + 2] = raw[src + 2]; rgba[dst + 3] = 255;
      } else if (header.colorType === 3) {
        const entry = raw[src] * 3;
        rgba[dst] = palette[entry]; rgba[dst + 1] = palette[entry + 1]; rgba[dst + 2] = palette[entry + 2];
        rgba[dst + 3] = transparency && raw[src] < transparency.length ? transparency[raw[src]] : 255;
      } else if (header.colorType === 4) {
        const g = raw[src];
        rgba[dst] = g; rgba[dst + 1] = g; rgba[dst + 2] = g; rgba[dst + 3] = raw[src + 1];
      } else {
        rgba[dst] = raw[src]; rgba[dst + 1] = raw[src + 1]; rgba[dst + 2] = raw[src + 2]; rgba[dst + 3] = raw[src + 3];
      }
    }
  }
  return new Raster(width, height, rgba);
}

/** Encode one RGBA8 raster as a PNG buffer. */
export function encodePng(raster) {
  const { width, height, data } = raster;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // 滤波器 0（None）：实现简单，压缩交给 zlib
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}
