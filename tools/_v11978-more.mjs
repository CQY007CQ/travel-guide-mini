// v1.19.78：更多页加「城市深度玩法」入口（有无行程都能进）
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const P = (p) => path.join(ROOT, p);

function once(file, needle, repl, label) {
  const abs = P(file);
  let s = fs.readFileSync(abs, "utf8");
  const n = s.split(needle).length - 1;
  if (n !== 1) {
    console.error(`✗ [${label}] 命中 ${n} 次（期望 1 次）→ ${file}`);
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(abs, s.replace(needle, repl));
  console.log(`✓ [${label}] ${file}`);
}

const ITEM = `            { key: "deep", icon: "bulb", t: "城市深度玩法", d: "本地节奏 / 避坑 / 机位 / 顺手加一日" },\n`;

// 有行程：「旅途中」组 —— 插在本地速查之前
once(
  "pages/more/more.js",
  `            { key: "assistant", icon: "search", t: "本地速查", d: "离线速查：天气/美食/门票/预算…" },`,
  ITEM + `            { key: "assistant", icon: "search", t: "本地速查", d: "离线速查：天气/美食/门票/预算…" },`,
  "more.js/hasPlan-menu"
);

// 无行程：「行前与账本」组 —— 插在百宝箱之前
once(
  "pages/more/more.js",
  `            { key: "toolkit", icon: "sparkle", t: "旅行百宝箱", d: "城市灵感池随时可用" }`,
  ITEM + `            { key: "toolkit", icon: "sparkle", t: "旅行百宝箱", d: "城市灵感池随时可用" }`,
  "more.js/noPlan-menu"
);

// 无行程也允许进入
once(
  "pages/more/more.js",
  `if (!this.data.hasPlan && k !== "ledger" && k !== "assistant" && k !== "toolkit" && k !== "boost")`,
  `if (!this.data.hasPlan && k !== "ledger" && k !== "assistant" && k !== "toolkit" && k !== "boost" && k !== "deep")`,
  "more.js/allow-noplan"
);

// 路由表：deep 在 subai 分包
once(
  "pages/more/more.js",
  `boost: "/subdata/boost/boost" };`,
  `boost: "/subdata/boost/boost", deep: "/subai/deep/deep" };`,
  "more.js/route"
);
