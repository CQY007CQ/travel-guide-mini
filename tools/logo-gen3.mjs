// v1.8.1 logo 第三轮候选（v3 方向：拉大风格差异）
//   A 夜色奢牌 · 深墨蓝底 + 烫金航迹 + 远山 + 飞机
//   B 极简线条 · 白底 + 极细灰线 画"地图+路线+pin" 时尚
//   C 多彩渐变 · 蓝紫橙 极光 + 金色太阳 + 山脊 + 路线
// 输出: outputs/logo-candidates/logo3-{A,B,C}{,-1024}.png + compare3.png
import { createRequire } from "module";
import fs from "fs";
import path from "path";
const require = createRequire("/Users/chenqianyuan/.workbuddy/binaries/node/workspace/");
const { Resvg } = require("@resvg/resvg-js");

const OUT = "/Users/chenqianyuan/WorkBuddy/2026-08-21-10-53-28/outputs/logo-candidates";
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const G = "#d4a94e";     // 主金
const GL = "#f0c878";    // 亮金
const W = "#ffffff";

// A · 夜色奢牌（深墨蓝 + 烫金）
const A = `
  <defs>
    <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0e1a2b"/>
      <stop offset="1" stop-color="#1c2840"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="1024" height="1024" rx="230" fill="url(#gA)"/>
  <!-- 顶部细线：远山三层 -->
  <path d="M120 360 Q280 290 460 340 T880 320" fill="none" stroke="${G}" stroke-width="3" opacity="0.55" stroke-linecap="round"/>
  <path d="M120 410 Q320 360 500 400 T900 390" fill="none" stroke="${G}" stroke-width="2" opacity="0.32" stroke-linecap="round"/>
  <!-- 飞机航迹（弧线 + 飞机） -->
  <path d="M180 600 Q480 300 860 480" fill="none" stroke="${G}" stroke-width="10" stroke-linecap="round" opacity="0.95"/>
  <g transform="translate(852 478) rotate(20)">
    <path d="M-58 0 L58 0 L46 -22 L0 -38 L-46 -22 Z" fill="${G}"/>
  </g>
  <!-- 起点小圆 -->
  <circle cx="180" cy="600" r="14" fill="${G}"/>
  <!-- 底部 logo 名（金色细字） -->
  <text x="512" y="900" font-family="Helvetica, Arial, sans-serif"
        font-size="36" font-weight="500" fill="${G}" text-anchor="middle" letter-spacing="14" opacity="0.85">TRAVEL · PLANNER</text>
`;

// B · 极简白底线条（时尚）
const B = `
  <rect x="0" y="0" width="1024" height="1024" rx="230" fill="#fafaf7"/>
  <!-- 中心十字坐标（地图意象） -->
  <line x1="512" y1="160" x2="512" y2="280" stroke="#1c2230" stroke-width="3" stroke-linecap="round" opacity="0.4"/>
  <line x1="160" y1="512" x2="280" y2="512" stroke="#1c2230" stroke-width="3" stroke-linecap="round" opacity="0.4"/>
  <line x1="744" y1="512" x2="864" y2="512" stroke="#1c2230" stroke-width="3" stroke-linecap="round" opacity="0.4"/>
  <line x1="512" y1="744" x2="512" y2="864" stroke="#1c2230" stroke-width="3" stroke-linecap="round" opacity="0.4"/>
  <!-- 圆环（地图外圈） -->
  <circle cx="512" cy="512" r="220" fill="none" stroke="#1c2230" stroke-width="3" opacity="0.55"/>
  <!-- 三段路线：起点 折线 终点 pin -->
  <path d="M340 720 L460 580 L580 640 L700 460" fill="none" stroke="#1c2230" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="340" cy="720" r="14" fill="#1c2230"/>
  <circle cx="460" cy="580" r="10" fill="#1c2230"/>
  <circle cx="580" cy="640" r="10" fill="#1c2230"/>
  <!-- 终点 pin -->
  <g transform="translate(700 460)">
    <path d="M0 -56 C 30 -56 50 -36 50 -6 C 50 30 0 64 0 64 C 0 64 -50 30 -50 -6 C -50 -36 -30 -56 0 -56 Z" fill="${G}" stroke="#1c2230" stroke-width="6"/>
    <circle cx="0" cy="-6" r="14" fill="#fafaf7"/>
  </g>
`;

// C · 多彩渐变（蓝紫橙极光）
const C = `
  <defs>
    <linearGradient id="gC1" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a4f8a"/>
      <stop offset="0.55" stop-color="#7a4a9c"/>
      <stop offset="1" stop-color="#e87a4a"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="1024" height="1024" rx="230" fill="url(#gC1)"/>
  <!-- 太阳（金色） -->
  <circle cx="720" cy="360" r="80" fill="${G}"/>
  <circle cx="720" cy="360" r="120" fill="${G}" opacity="0.25"/>
  <!-- 山脊（多色三层） -->
  <path d="M0 700 L180 560 L320 640 L480 520 L640 620 L800 540 L1024 600 L1024 1024 L0 1024 Z" fill="#1a1a2e" opacity="0.4"/>
  <path d="M0 800 L160 690 L300 760 L480 660 L620 740 L800 670 L1024 730 L1024 1024 L0 1024 Z" fill="#1a1a2e" opacity="0.6"/>
  <!-- 金色路线弧线 -->
  <path d="M150 480 Q420 220 820 320" fill="none" stroke="${G}" stroke-width="12" stroke-linecap="round"/>
  <!-- 金色飞机 -->
  <g transform="translate(812 318) rotate(22)">
    <path d="M-50 0 L50 0 L40 -20 L0 -34 L-40 -20 Z" fill="${G}"/>
  </g>
  <!-- 起点圆 -->
  <circle cx="150" cy="480" r="14" fill="${G}"/>
`;

const ALL = { A, B, C };

for (const [name, inner] of Object.entries(ALL)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${inner}</svg>`;
  const r512 = new Resvg(svg, { fitTo: { mode: "width", value: 512 } });
  fs.writeFileSync(path.join(OUT, `logo3-${name}.png`), r512.render().asPng());
  const r1024 = new Resvg(svg, { fitTo: { mode: "width", value: 1024 } });
  fs.writeFileSync(path.join(OUT, `logo3-${name}-1024.png`), r1024.render().asPng());
}

const cellW = 512, gap = 88, x0 = 64, y0 = 56, labelY = 612;
const cw = x0 * 2 + cellW * 3 + gap * 2;
const descMap = { A: "夜色奢牌", B: "极简线条", C: "多彩渐变" };
const parts = Object.keys(ALL).map((k, i) => {
  const x = x0 + i * (cellW + gap);
  return `<g transform="translate(${x} ${y0})">${ALL[k]}</g>
  <text x="${x + 256}" y="${labelY}" font-family="Helvetica,Arial,sans-serif" font-size="40" font-weight="700" fill="#8f6a1f" text-anchor="middle">${k} · ${descMap[k]}</text>`;
}).join("\n");
const cmp = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="660" viewBox="0 0 ${cw} 660"><rect width="${cw}" height="660" fill="#f8f7f4"/>${parts}</svg>`;
fs.writeFileSync(path.join(OUT, "compare3.png"), new Resvg(cmp, { fitTo: { mode: "width", value: cw } }).render().asPng());

console.log("生成 logo 第三轮候选: A 夜色 / B 极简 / C 多彩 + compare3.png");
