import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const out = process.argv[2] || path.resolve("assets/SkyTrace.ico");
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mix = (a, b, t) => a + (b - a) * t;

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function pngFromPixels(width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    pixels.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function roundedRectSdf(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - (halfW - radius);
  const qy = Math.abs(y - cy) - (halfH - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersects = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = size / 1024;
  const cx = size / 2;
  const cy = size / 2;
  const half = 458 * scale;
  const radius = 220 * scale;
  const borderWidth = Math.max(1, 12 * scale);

  function overPixel(i, r, g, b, a) {
    const sa = clamp(a, 0, 1);
    if (sa <= 0) return;
    const da = pixels[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    pixels[i] = Math.round((r * sa + pixels[i] * da * (1 - sa)) / oa);
    pixels[i + 1] = Math.round((g * sa + pixels[i + 1] * da * (1 - sa)) / oa);
    pixels[i + 2] = Math.round((b * sa + pixels[i + 2] * da * (1 - sa)) / oa);
    pixels[i + 3] = Math.round(oa * 255);
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const d = roundedRectSdf(x + 0.5, y + 0.5, cx, cy, half, half, radius);
      const alpha = clamp(0.5 - d, 0, 1);
      if (!alpha) continue;
      const t = y / Math.max(1, size - 1);
      const base = Math.round(mix(18, 14, t));
      pixels[i] = base;
      pixels[i + 1] = base + 1;
      pixels[i + 2] = base + 3;
      pixels[i + 3] = Math.round(alpha * 255);
      if (d > -borderWidth - 1.5) {
        const borderAlpha = clamp((d + borderWidth + 0.5) / 1.5, 0, 1) * alpha;
        overPixel(i, 42, 44, 49, borderAlpha * 0.9);
      }
    }
  }

  const star = [
    [512, 322], [558, 464], [706, 512], [558, 560],
    [512, 748], [466, 560], [318, 512], [466, 464]
  ].map(([x, y]) => [x * scale, y * scale]);
  const samples = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  for (let y = Math.max(0, Math.floor(300 * scale)); y < Math.min(size, Math.ceil(770 * scale)); y++) {
    for (let x = Math.max(0, Math.floor(300 * scale)); x < Math.min(size, Math.ceil(724 * scale)); x++) {
      let cover = 0;
      for (const [sx, sy] of samples) if (insidePolygon(x + sx, y + sy, star)) cover++;
      if (!cover) continue;
      overPixel((y * size + x) * 4, 213, 214, 217, cover / samples.length);
    }
  }
  return pngFromPixels(size, size, pixels);
}

const images = SIZES.map(size => ({ size, data: render(size) }));
const header = Buffer.alloc(6 + images.length * 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
for (let i = 0; i < images.length; i++) {
  const { size, data } = images[i];
  const p = 6 + i * 16;
  header[p] = size === 256 ? 0 : size;
  header[p + 1] = size === 256 ? 0 : size;
  header[p + 2] = 0;
  header[p + 3] = 0;
  header.writeUInt16LE(1, p + 4);
  header.writeUInt16LE(32, p + 6);
  header.writeUInt32LE(data.length, p + 8);
  header.writeUInt32LE(offset, p + 12);
  offset += data.length;
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([header, ...images.map(image => image.data)]));
console.log(`Created ${out} (${SIZES.join(", ")} px)`);
