// 生成金色线性 PNG 图标（60px，替换 emoji，双主题通用）
// 用法：NODE_PATH=$WS/node_modules node tools/gen-icons.mjs
import { createRequire } from "module";
import fs from "fs";
import path from "path";
const require = createRequire("/Users/chenqianyuan/.workbuddy/binaries/node/workspace/");
const { Resvg } = require("@resvg/resvg-js");

const GOLD = "#d4a94e";
const OUT = path.resolve(process.cwd(), "images/icons");

const SHAPES = {
  cloud: '<path d="M7.2 18.5h9.6a3.9 3.9 0 0 0 .4-7.78A5.9 5.9 0 0 0 6.3 9.6a4.4 4.4 0 0 0 .9 8.9z"/>',
  snow: '<path d="M12 2.5v19"/><path d="M3.8 7l16.4 10"/><path d="M20.2 7L3.8 17"/><path d="M12 6.2l-2.2 1.9M12 6.2l2.2 1.9"/><path d="M12 17.8l-2.2-1.9M12 17.8l2.2-1.9"/>',
  thunder: '<path d="M13.2 2.5L4.6 13.6h5.9l-1 7.9 8.9-11.6h-5.9z"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12.5h15a3 3 0 1 1-3 3"/><path d="M3 17h8"/>',
  hot: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"/>',
  umbrella: '<path d="M3.2 12.5a8.8 8.8 0 0 1 17.6 0z"/><path d="M12 12.5v6.2a2.2 2.2 0 0 0 4.4 0"/><path d="M12 3v9.5"/>',
  medal: '<circle cx="12" cy="14.6" r="5.4"/><path d="M12 17.2l1.5 1.7-1.5 1.3-1.5-1.3z"/><path d="M8.4 9.6L5.6 2.5h5.2"/><path d="M15.6 9.6l2.8-7.1H13.2"/>',
  shield: '<path d="M12 2.6l7.2 2.6v6.4c0 4.6-3 8.4-7.2 10.2-4.2-1.8-7.2-5.6-7.2-10.2V5.2z"/><path d="M8.8 12.2l2.3 2.3 4.1-4.4"/>',
  pie: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9h9"/><path d="M12 12l6.4 6.4"/>',
  bill: '<path d="M5 2.8h14v18.4l-2.3-1.6-2.4 1.6-2.3-1.6-2.4 1.6L7.3 21.2 5 22.8z"/><path d="M8.4 7.6h7.2M8.4 11.4h7.2M8.4 15.2h4.4"/>',
  scan: '<path d="M3.6 8.2V5.4a1.8 1.8 0 0 1 1.8-1.8h2.8"/><path d="M20.4 8.2V5.4a1.8 1.8 0 0 0-1.8-1.8h-2.8"/><path d="M3.6 15.8v2.8a1.8 1.8 0 0 0 1.8 1.8h2.8"/><path d="M20.4 15.8v2.8a1.8 1.8 0 0 1-1.8 1.8h-2.8"/><path d="M7.6 12h8.8"/>',
  backpack: '<path d="M5.4 8.6a4 4 0 0 1 4-2.2h5.2a4 4 0 0 1 4 2.2v10.2a1.6 1.6 0 0 1-1.6 1.6H7a1.6 1.6 0 0 1-1.6-1.6z"/><path d="M9 6.4V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.4"/><path d="M9.4 12.6h5.2v3.4H9.4z"/><path d="M7.4 20v-2.6M16.6 20v-2.6"/>'
};

const wrap = inner => `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="${GOLD}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

let n = 0;
for (const [name, inner] of Object.entries(SHAPES)) {
  const png = new Resvg(wrap(inner), { fitTo: { mode: "width", value: 60 } }).render().asPng();
  fs.writeFileSync(path.join(OUT, name + ".png"), png);
  n++;
}
console.log("generated", n, "icons ->", OUT);
