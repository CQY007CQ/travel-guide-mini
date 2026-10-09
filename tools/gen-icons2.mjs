// v1.6.0 新增图标（金色线性 PNG 60px）
// 用法：node tools/gen-icons2.mjs
import { createRequire } from "module";
import fs from "fs";
import path from "path";
const require = createRequire("/Users/chenqianyuan/.workbuddy/binaries/node/workspace/");
const { Resvg } = require("@resvg/resvg-js");

const GOLD = "#d4a94e";
const OUT = path.resolve(process.cwd(), "images/icons");

const SHAPES = {
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  timer: '<circle cx="12" cy="13.4" r="7.4"/><path d="M12 9.4v4l2.6 1.8"/><path d="M9.4 2.6h5.2"/><path d="M12 2.6v3.4"/>',
  trend: '<path d="M3.4 16.6l5-5 3.4 3.4 5.6-6"/><path d="M14.6 9h3.4v3.4"/><path d="M3.4 20.4h17.2"/>',
  summary: '<path d="M6 3.4h9.2l3.4 3.4v14.2a1.4 1.4 0 0 1-1.4 1.4H6a1.4 1.4 0 0 1-1.4-1.4V4.8A1.4 1.4 0 0 1 6 3.4z"/><path d="M14.8 3.4v3.6h3.6"/><path d="M8.4 11.6h7.2M8.4 15.2h7.2M8.4 18.6h4.4"/>',
  city: '<path d="M3.6 20.4h16.8"/><path d="M5.6 20.4V8.6l5.2-3.4v15.2"/><path d="M10.8 20.4V10.4l7.6 2.2v7.8"/><path d="M7.6 11h1.6M7.6 14h1.6M7.6 17h1.6M13.6 14h1.8M13.6 17h1.8"/>',
  filter: '<path d="M3.6 5.4h16.8l-6.4 7.6v5.6l-4-2.2v-3.4z"/>',
  auto: '<circle cx="12" cy="12" r="8.6"/><path d="M12 3.4v17.2"/><path d="M12 3.4a8.6 8.6 0 0 1 0 17.2z" fill="' + GOLD + '" fill-opacity="0.18"/>',
  coin: '<ellipse cx="12" cy="6.6" rx="7.6" ry="3.2"/><path d="M4.4 6.6v10.8c0 1.8 3.4 3.2 7.6 3.2s7.6-1.4 7.6-3.2V6.6"/><path d="M4.4 12c0 1.8 3.4 3.2 7.6 3.2s7.6-1.4 7.6-3.2"/>',
  calendar2: '<rect x="3.6" y="5.2" width="16.8" height="15.2" rx="2"/><path d="M3.6 10h16.8"/><path d="M8.2 3.4v3.6M15.8 3.4v3.6"/><path d="M8 14h3M8 17.4h6"/>'
};

const wrap = inner => `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="${GOLD}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

let n = 0;
for (const [name, inner] of Object.entries(SHAPES)) {
  const png = new Resvg(wrap(inner), { fitTo: { mode: "width", value: 60 } }).render().asPng();
  fs.writeFileSync(path.join(OUT, name + ".png"), png);
  n++;
}
console.log("generated", n, "icons ->", OUT);
