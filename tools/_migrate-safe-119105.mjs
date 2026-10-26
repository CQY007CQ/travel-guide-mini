#!/usr/bin/env node
// 一次性迁移（v1.19.105）：把各页散落的 `const app = new Proxy(...)` + `Page({` 收口为 utils/app.js 的
// getAppSafe / SafePage；并把 plan.js 的 `app.globalData.plan` 收口为 currentPlan()。
// 幂等：已迁移过的文件再跑不会重复注入 / 重复包裹。
import { readFileSync, writeFileSync } from "fs";
const ROOT = process.cwd();

const FILES = [
  "pages/splash/splash.js",
  "pages/today/today.js",
  "pages/plan/plan.js",
  "pages/more/more.js",
  "pages/index/index.js",
  "subpkg/assistant/assistant.js",
  "subpkg/guide/guide.js",
  "subpkg/prep/prep.js",
  "subpkg/ledger/ledger.js",
  "subpkg/map/map.js",
  "subpkg/food/food.js",
  "subpkg/rank/rank.js",
  "subpkg/toolkit/toolkit.js",
  "subdata/boost/boost.js"
];

const IMPORT = 'const { getAppSafe, SafePage } = require("../../utils/app.js");';

for (const f of FILES) {
  const p = ROOT + "/" + f;
  let s = readFileSync(p, "utf8");

  // 1) 注入 require：顶置（任何 CommonJS 模块都安全；避免「文件无 require 时插到文件尾」破坏收尾括号）
  if (!s.includes('require("../../utils/app.js")')) {
    s = IMPORT + "\n" + s;
  }

  // 2) 裸代理块 → getAppSafe()
  if (s.includes("const app = new Proxy({}, {")) {
    s = s.replace(/const app = new Proxy\(\{\}, \{[\s\S]*?\}\);/, "const app = getAppSafe();");
  }

  // 3) Page({ → Page(SafePage({ （仅首个），并补上收尾的 )。文件以 `});` 收尾（对象} + Page) + 语句;），
  //    需变成 `}));`（额外补一个 ) 给 SafePage）。
  const pi = s.indexOf("Page({");
  if (pi !== -1) {
    s = s.slice(0, pi + 5) + "SafePage(" + s.slice(pi + 5);
    s = s.replace(/\}\)\s*;?\s*$/, "})));");
  }

  writeFileSync(p, s, "utf8");
  console.log("✓ " + f);
}

// 4) plan.js：app.globalData.plan → currentPlan()（等价于更安全的单点访问器）
const planP = ROOT + "/pages/plan/plan.js";
let ps = readFileSync(planP, "utf8");
const before = (ps.match(/app\.globalData\.plan/g) || []).length;
ps = ps.replace(/app\.globalData\.plan/g, "currentPlan()");
writeFileSync(planP, ps, "utf8");
console.log("✓ plan.js  app.globalData.plan → currentPlan()  （" + before + " 处）");

console.log("\n迁移完成。下一步：node --check + ./allcheck.sh");
