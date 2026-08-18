import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

const out = process.argv[2] || path.resolve("assets/SkyTrace.png");
const W = 1024;
const H = 1024;
const pixels = Buffer.alloc(W * H * 4);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mix = (a, b, t) => a + (b - a) * t;

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

function roundedRectSdf(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - (halfW - radius);
  const qy = Math.abs(y - cy) - (halfH - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

const cx = W / 2;
const cy = H / 2;
const half = 458;
const radius = 220;

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const d = roundedRectSdf(x + 0.5, y + 0.5, cx, cy, half, half, radius);
    const alpha = clamp(0.5 - d, 0, 1);
    if (!alpha) continue;

    const t = y / (H - 1);
    const base = Math.round(mix(18, 14, t));
    pixels[i] = base;
    pixels[i + 1] = base + 1;
    pixels[i + 2] = base + 3;
    pixels[i + 3] = Math.round(alpha * 255);

    const borderWidth = 12;
    const borderAlpha = clamp((d + borderWidth + 0.5) / 1.5, 0, 1) * alpha;
    if (d > -borderWidth - 1.5) {
      overPixel(i, 42, 44, 49, borderAlpha * 0.9);
    }
  }
}

const star = [
  [512, 322], [558, 464], [706, 512], [558, 560],
  [512, 748], [466, 560], [318, 512], [466, 464]
];

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

const samples = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
for (let y = 300; y <= 770; y++) {
  for (let x = 300; x <= 724; x++) {
    let cover = 0;
    for (const [sx, sy] of samples) if (insidePolygon(x + sx, y + sy, star)) cover++;
    if (!cover) continue;
    const i = (y * W + x) * 4;
    overPixel(i, 213, 214, 217, cover / samples.length);
  }
}

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

const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  const row = y * (W * 4 + 1);
  raw[row] = 0;
  pixels.copy(raw, row + 1, y * W * 4, (y + 1) * W * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0))
]);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`Created ${out}`);
