import { createRequire } from "module";
import fs from "fs";
import path from "path";
const require = createRequire("/Users/chenqianyuan/.workbuddy/binaries/node/workspace/");
const { Resvg } = require("@resvg/resvg-js");

const OUT = path.resolve("images/icons");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const G = "#d4a94e";
const S = (extra = "") => `fill="none" stroke="${G}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}`;
const SF = (op) => `fill="${G}" fill-opacity="${op}" stroke="none"`;
const wrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 24 24">${inner}</svg>`;

const ICONS = {
  // 热力图：九宫格不同深浅
  heat: wrap(`
    <rect x="3" y="3" width="5" height="5" rx="1.2" ${S()} />
    <rect x="9.5" y="3" width="5" height="5" rx="1.2" ${SF(0.35)} />
    <rect x="16" y="3" width="5" height="5" rx="1.2" ${S()} />
    <rect x="3" y="9.5" width="5" height="5" rx="1.2" ${SF(0.2)} />
    <rect x="9.5" y="9.5" width="5" height="5" rx="1.2" ${SF(0.85)} />
    <rect x="16" y="9.5" width="5" height="5" rx="1.2" ${SF(0.45)} />
    <rect x="3" y="16" width="5" height="5" rx="1.2" ${S()} />
    <rect x="9.5" y="16" width="5" height="5" rx="1.2" ${SF(0.5)} />
    <rect x="16" y="16" width="5" height="5" rx="1.2" ${S()} />
  `),
  // 骰子（旅行灵感 / 随机目的地）
  dice: wrap(`
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" ${S()} />
    <circle cx="8.5" cy="8.5" r="1.25" fill="${G}" />
    <circle cx="15.5" cy="15.5" r="1.25" fill="${G}" />
    <circle cx="12" cy="12" r="1.25" fill="${G}" />
  `),
  // 相机（消费凭证）
  camera: wrap(`
    <path d="M3 8.5h3.2l1.3-2.2h7l1.3 2.2H21a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 21 19.5H3A1.5 1.5 0 0 1 1.5 18v-8A1.5 1.5 0 0 1 3 8.5Z" ${S()} />
    <circle cx="12" cy="13.6" r="3.6" ${S()} />
  `),
  // 海报 / 长图
  poster: wrap(`
    <rect x="5" y="2.5" width="14" height="19" rx="2.5" ${S()} />
    <path d="M8.5 7h7" ${S()} />
    <path d="M8.5 11h7" ${S()} />
    <path d="M8.5 15h4" ${S()} />
    <circle cx="15.5" cy="16.5" r="2" ${S()} />
  `),
  // 公交 / 交通
  bus: wrap(`
    <rect x="4" y="3.5" width="16" height="13.5" rx="2.5" ${S()} />
    <path d="M4 10.5h16" ${S()} />
    <path d="M7.5 20.5 9 17" ${S()} />
    <path d="M16.5 20.5 15 17" ${S()} />
    <circle cx="8" cy="13.8" r="0.9" fill="${G}" />
    <circle cx="16" cy="13.8" r="0.9" fill="${G}" />
  `),
  // 证件
  badge: wrap(`
    <rect x="3" y="4.5" width="18" height="13" rx="2.5" ${S()} />
    <circle cx="9" cy="10" r="2.4" ${S()} />
    <path d="M5.4 15.6c.6-1.7 1.9-2.6 3.6-2.6s3 .9 3.6 2.6" ${S()} />
    <path d="M14.5 9h4" ${S()} />
    <path d="M14.5 12h3" ${S()} />
  `),
  // 星星闪烁（灵感/推荐）
  sparkle: wrap(`
    <path d="M12 2.8l1.9 5.1 5.1 1.9-5.1 1.9L12 16.8l-1.9-5.1L5 9.8l5.1-1.9z" ${S()} />
    <path d="M18.4 16.2l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" ${S()} />
  `)
};

let n = 0;
for (const [name, svg] of Object.entries(ICONS)) {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: 60 } });
  fs.writeFileSync(path.join(OUT, name + ".png"), r.render().asPng());
  n++;
}
console.log("生成 " + n + " 个图标");
