// v1.8.1 logo 第二轮候选（v2 方向：渐变 + 文化 + 节点图）
//   A 风景 · 暮色山脊 + 飞机弧线（旅行/出发意象）
//   B 文化 · 金底 + 墨色「游」字（水墨+品牌动词，最不像地图 App）
//   C 工具 · 路线节点 · 起点/途经/终点（金色节点连线）
// 输出: outputs/logo-candidates/logo2-{A,B,C}{,-1024}.png + compare2.png
import { createRequire } from "module";
import fs from "fs";
import path from "path";
const require = createRequire("/Users/chenqianyuan/.workbuddy/binaries/node/workspace/");
const { Resvg } = require("@resvg/resvg-js");

const OUT = "/Users/chenqianyuan/WorkBuddy/2026-08-21-10-53-28/outputs/logo-candidates";
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const GOLD_L = "#f0c878";   // 高光金
const GOLD = "#d4a94e";     // 主金
const GOLD_D = "#a0762a";   // 暗金/阴影
const INK = "#1c2230";      // 墨色
const W = "#ffffff";

const bgGrad = (id, c1, c2) => `
  <defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${c1}"/>
      <stop offset="1" stop-color="${c2}"/>
    </linearGradient>
  </defs>`;

// A · 暮色山脊 + 飞机弧线（旅行出发感）
const A = `
  ${bgGrad("gA", GOLD_L, GOLD_D)}
  <rect x="0" y="0" width="1024" height="1024" rx="230" fill="url(#gA)"/>
  <!-- 太阳 -->
  <circle cx="760" cy="332" r="92" fill="${W}" opacity="0.9"/>
  <!-- 山脊（近/远两层） -->
  <path d="M0 740 L140 600 L260 680 L400 540 L520 640 L660 500 L820 620 L1024 560 L1024 1024 L0 1024 Z" fill="${INK}" opacity="0.18"/>
  <path d="M0 830 L160 720 L300 780 L460 680 L600 760 L760 680 L900 760 L1024 700 L1024 1024 L0 1024 Z" fill="${INK}" opacity="0.32"/>
  <!-- 飞机弧线 + 小三角 -->
  <path d="M150 430 Q480 130 880 280" fill="none" stroke="${W}" stroke-width="14" stroke-linecap="round" opacity="0.95"/>
  <g transform="translate(870 270) rotate(28)">
    <path d="M-46 0 L46 0 L36 -18 L0 -32 L-36 -18 Z" fill="${W}"/>
  </g>
  <!-- 左下小圆 · 出发点 -->
  <circle cx="150" cy="430" r="14" fill="${W}"/>
`;

// B · 金底 + 墨色「游」（水墨+品牌核心字，最具差异）
const B = `
  ${bgGrad("gB", GOLD_L, GOLD)}
  <rect x="0" y="0" width="1024" height="1024" rx="230" fill="url(#gB)"/>
  <!-- 顶部细线（远山意象） -->
  <path d="M120 280 Q300 220 500 270 T880 260" fill="none" stroke="${INK}" stroke-width="8" opacity="0.35" stroke-linecap="round"/>
  <!-- 墨色「游」字 · 大字粗体居中 -->
  <text x="512" y="700" font-family="PingFang SC, Hiragino Sans GB, STHeiti, Microsoft YaHei, SimHei, sans-serif"
        font-size="560" font-weight="900" fill="${INK}" text-anchor="middle" letter-spacing="20">游</text>
  <!-- 底部小字 · 品牌名 -->
  <text x="512" y="830" font-family="Helvetica, Arial, sans-serif"
        font-size="40" font-weight="700" fill="${INK}" text-anchor="middle" letter-spacing="8" opacity="0.75">TRAVEL PLANNER</text>
`;

// C · 路线节点图（起点/途经/终点 + 折线，工具叙事）
const C = `
  ${bgGrad("gC", GOLD_L, GOLD)}
  <rect x="0" y="0" width="1024" height="1024" rx="230" fill="url(#gC)"/>
  <!-- 折线路径 -->
  <path d="M200 720 L380 540 L540 640 L720 380 L860 480"
        fill="none" stroke="${INK}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>
  <!-- 节点：起点 终点 略大，中间小 -->
  <circle cx="200" cy="720" r="42" fill="${INK}"/>
  <circle cx="200" cy="720" r="18" fill="${GOLD_L}"/>
  <circle cx="380" cy="540" r="22" fill="${INK}"/>
  <circle cx="540" cy="640" r="22" fill="${INK}"/>
  <circle cx="720" cy="380" r="22" fill="${INK}"/>
  <!-- 终点 = 实心大点 + 旗形 -->
  <circle cx="860" cy="480" r="46" fill="${INK}"/>
  <path d="M860 434 L946 460 L860 486 Z" fill="${INK}"/>
  <!-- 顶部小标识 · 三角飞行器 -->
  <g transform="translate(360 240) rotate(-10)">
    <path d="M-60 0 L60 0 L48 -22 L0 -42 L-48 -22 Z" fill="${INK}"/>
  </g>
`;

const ALL = { A, B, C };

// 单款 512 + 1024 双尺寸
for (const [name, inner] of Object.entries(ALL)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${inner}</svg>`;
  const r512 = new Resvg(svg, { fitTo: { mode: "width", value: 512 } });
  fs.writeFileSync(path.join(OUT, `logo2-${name}.png`), r512.render().asPng());
  const r1024 = new Resvg(svg, { fitTo: { mode: "width", value: 1024 } });
  fs.writeFileSync(path.join(OUT, `logo2-${name}-1024.png`), r1024.render().asPng());
}

// 对比图（白底三格 + 标签）
const cellW = 512, gap = 88, x0 = 64, y0 = 56, labelY = 612;
const cw = x0 * 2 + cellW * 3 + gap * 2;
const descMap = { A: "风景", B: "文化", C: "节点" };
const parts = Object.keys(ALL).map((k, i) => {
  const x = x0 + i * (cellW + gap);
  return `<g transform="translate(${x} ${y0})">${ALL[k]}</g>
  <text x="${x + 256}" y="${labelY}" font-family="Helvetica,Arial,sans-serif" font-size="44" font-weight="700" fill="#8f6a1f" text-anchor="middle">${k} · ${descMap[k]}</text>`;
}).join("\n");
const cmp = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="660" viewBox="0 0 ${cw} 660"><rect width="${cw}" height="660" fill="#f8f7f4"/>${parts}</svg>`;
fs.writeFileSync(path.join(OUT, "compare2.png"), new Resvg(cmp, { fitTo: { mode: "width", value: cw } }).render().asPng());

console.log("生成 logo 第二轮候选: A 风景 / B 文化 / C 节点 + compare2.png");
