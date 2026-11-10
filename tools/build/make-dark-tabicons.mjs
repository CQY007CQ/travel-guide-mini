/**
 * tools/build/make-dark-tabicons.mjs —— 生成深色 tabBar 图标
 *
 * 背景（真实缺陷）：applyTabBar() 在深色模式下把图标指向 images/tab-*.png，
 * 但项目里只有 tab-light-*.png（浅色 tabBar 用的深灰图标），深色那 4 个文件**根本不存在** →
 * 深色模式底部图标变成破图占位。
 *
 * 做法：把 tab-light-*.png 的像素重着色为深色主题的浅灰蓝（#8495ad，与 tabBar 未选中文字同色），
 * 保持 alpha 不变。纯 JS 实现（解析/反滤波/重滤波/deflate），不引第三方图像库。
 *
 * 用法：node tools/build/make-dark-tabicons.mjs
 */
import fs from "fs";
import zlib from "zlib";

const TARGET = [0x84, 0x95, 0xad];   // 与 applyTabBar 的未选中文字色一致
const SRC = [
  ["images/tab-light-index.png", "images/tab-index.png"],
  ["images/tab-light-today.png", "images/tab-today.png"],
  ["images/tab-light-plan.png", "images/tab-plan.png"],
  ["images/tab-light-more.png", "images/tab-more.png"],
];

/* ---------- CRC32 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function readPng(file) {
  const b = fs.readFileSync(file);
  if (b.toString("ascii", 12, 16) !== "IHDR") throw new Error("非 PNG: " + file);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  const bitDepth = b[24], colorType = b[25], interlace = b[28];
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error("只支持 8bit RGBA 非交错：" + file);
  }
  const idat = [];
  let off = 8;
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString("ascii", off + 4, off + 8);
    if (type === "IDAT") idat.push(b.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  return { w, h, raw };
}

// 反滤波（PNG 五种行滤波）
function unfilter(raw, w, h) {
  const bpp = 4, stride = w * bpp;
  const out = Buffer.alloc(stride * h);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return out;
}

// 重着色：保留 alpha，RGB 统一替换为目标色
function recolor(pixels) {
  let touched = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] > 0) {
      pixels[i] = TARGET[0];
      pixels[i + 1] = TARGET[1];
      pixels[i + 2] = TARGET[2];
      touched++;
    }
  }
  return touched;
}

// 用 filter=0 重新组装并编码
function encodePng(w, h, pixels, sRGB) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;   // filter type 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr)];
  if (sRGB) parts.push(chunk("sRGB", sRGB));
  parts.push(chunk("IDAT", zlib.deflateSync(raw, { level: 9 })));
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

let ok = 0;
for (const [src, dst] of SRC) {
  if (!fs.existsSync(src)) { console.log("  ✗ 源缺失: " + src); continue; }
  const { w, h, raw } = readPng(src);
  const px = unfilter(raw, w, h);
  const touched = recolor(px);
  const png = encodePng(w, h, px, Buffer.from([0, 0, 0, 0]));
  fs.writeFileSync(dst, png);
  console.log("  ✓ " + dst + "  " + w + "×" + h + "  着色像素 " + touched + "  " + png.length + "B");
  ok++;
}
console.log("\n生成 " + ok + " 个深色 tabBar 图标（颜色 #8495ad，alpha 保持不变）");
