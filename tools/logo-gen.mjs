// v1.8 小程序头像候选（极简纯色：金块白形）
// 输出: outputs/logo-candidates/{logo-A,B,C}.png + compare.png
import { createRequire } from "module";
import fs from "fs";
import path from "path";
const require = createRequire("/Users/chenqianyuan/.workbuddy/binaries/node/workspace/");
const { Resvg } = require("@resvg/resvg-js");

const OUT = "/Users/chenqianyuan/WorkBuddy/2026-08-21-10-53-28/outputs/logo-candidates";
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const GOLD = "#d4a94e";
const W = "#ffffff";
const rect = (rx = 230) => `<rect x="0" y="0" width="1024" height="1024" rx="${rx}" fill="${GOLD}"/>`;

// A 罗盘：金块 + 白色罗盘针与外环（方向 / 探索）
const A = `
  ${rect()}
  <circle cx="512" cy="512" r="336" fill="none" stroke="${W}" stroke-width="42" opacity="0.22"/>
  <path d="M512 170 L594 512 L512 854 L430 512 Z" fill="${W}"/>
  <circle cx="512" cy="512" r="46" fill="${GOLD}"/>
`;

// B 出发→到站：起点圆点 → 折线 → 终点小旗（从太原出发的心智）
const B = `
  ${rect()}
  <circle cx="316" cy="742" r="62" fill="${W}"/>
  <path d="M374 742 L544 566 H676 V406" fill="none" stroke="${W}" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M676 406 L824 440 L676 474 Z" fill="${W}"/>
`;

// C 定位针：想去哪 / 就在哪
const C = `
  ${rect()}
  <path d="M512 192 C 636 330 752 468 752 608 A 240 240 0 1 1 272 608 C 272 468 388 330 512 192 Z" fill="${W}"/>
  <circle cx="512" cy="608" r="92" fill="${GOLD}"/>
`;

const ALL = { A, B, C };

// 单款导出（512 预览）
for (const [name, inner] of Object.entries(ALL)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${inner}</svg>`;
  const r = new Resvg(svg, { fitTo: { mode: "width", value: 512 } });
  fs.writeFileSync(path.join(OUT, `logo-${name}.png`), r.render().asPng());
}
// 1024 高清（后台上传用）
for (const [name, inner] of Object.entries(ALL)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${inner}</svg>`;
  const r = new Resvg(svg, { fitTo: { mode: "width", value: 1024 } });
  fs.writeFileSync(path.join(OUT, `logo-${name}-1024.png`), r.render().asPng());
}

// 对比图（白底 + 三格）
const cellW = 512, gap = 88, x0 = 64, y0 = 56, labelY = 612;
const cw = x0 * 2 + cellW * 3 + gap * 2;
const parts = Object.keys(ALL).map((k, i) => {
  const x = x0 + i * (cellW + gap);
  return `<g transform="translate(${x} ${y0})">${ALL[k]}</g>
  <text x="${x + 256}" y="${labelY}" font-family="Helvetica,Arial,sans-serif" font-size="44" font-weight="700" fill="#8f6a1f" text-anchor="middle">${k}</text>`;
}).join("\n");
const cmp = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="660" viewBox="0 0 ${cw} 660"><rect width="${cw}" height="660" fill="#f8f7f4"/>${parts}</svg>`;
fs.writeFileSync(path.join(OUT, "compare.png"), new Resvg(cmp, { fitTo: { mode: "width", value: cw } }).render().asPng());

console.log("生成 logo 候选: A罗盘 / B出发到站 / C定位针 + compare.png");
