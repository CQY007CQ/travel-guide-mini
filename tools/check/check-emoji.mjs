#!/usr/bin/env node
/**
 * tools/check/check-emoji.mjs —— 随包 UI 层不得出现 emoji（v1.20.25）
 *
 * 为什么有这条门禁：
 *   emoji 的**字形由系统字体决定**，iOS / Android / 各厂商 ROM 画出来完全不同 ——
 *   同一个 🤖 在 iPhone 是立体机器人、在部分安卓机上会退化成黑白方块或豆腐块。
 *   本项目要求「高级感 + 品牌一致」，emoji 混在自绘线性图标中间必然出戏（彩色立体图形
 *   夹在单色线条里），且一旦系统缺字形就是空白，属于**静默的视觉缺陷**：不报错、不白屏，
 *   只是难看或消失，靠人眼逐个页面翻才能发现。
 *
 *   因此统一改为自绘图标：`images/icons/*.png`，32×32 单色 #DAAE50 线条，
 *   与既有 54 个图标同一套语言。新增的 9 个（lock / robot / warn / tag / sunrise /
 *   sunset / medical / coat / robot-dark）由 /tmp/draw_icons.py 那套画法生成：
 *   4x 超采样（128→32 LANCZOS）抗锯齿、7px 线宽。
 *
 *   纯文本输出（AI 回答、复制到剪贴板的行程）里放不了图片，那部分直接去掉 emoji 前缀、
 *   保留文字（如「🍜 吉安 必吃」→「吉安 必吃」），不用符号代替 —— 半角符号同样依赖字体。
 *
 * 白名单只有法务符号：© ® ™。它们有明确法律含义，不是装饰图案，且各平台字形稳定。
 *
 * v1.20.27 补漏：首版只扫 `pages/subpkg/subai/components` 四个包，于是
 *   · `utils/travel.js` 封面占位用的 COVER_GLYPH（🏯🏛🏘🏞🧸🎡…）漏了 —— 它**真的会渲染**
 *     进行程页封面（`.tl-thumb-emoji`），21 页检查却全绿；
 *   · `utils/ai-intent.js` 的 3 处回答前缀漏了；
 *   · 整个 `web/` 版（公开演示链接）漏了，FAB 还是 🧭。
 * 这正是「扫描范围塌缩 → 假绿」的典型：门禁绿不代表覆盖全。现在把 utils/ 与 web/ 一起扫，
 * 并断言扫描文件数下限（低于下限视为范围又缩了）。
 *
 * 不新增 allcheck 步数：串在既有「审计整改 + AI 全场景守卫」step 里。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// utils/ 也随包发布，且是 AI 回答、封面图标的来源 —— 必须一起扫（v1.20.27 补漏）
const PKG_DIRS = ["pages", "subpkg", "subai", "components", "utils"];
// web/ 是公开演示链接，与小程序同源同 UI。排除构建产物（由源文件保证干净）：
//   web/lib/modules.js 由 tools/web/build.mjs 从上面这些源文件生成；
//   web/index.html 是壳模板产物。
const WEB_SKIP = [/^web\/lib\/modules\.js$/, /^web\/index\.html$/];
const ROOT_FILES = ["app.js", "app.wxss"];
const EXT = /\.(wxml|js|wxss|json)$/;
// 法务符号：保留（不是装饰图案，字形跨平台稳定）
const ALLOW = new Set(["\u00A9", "\u00AE", "\u2122"]);
const EMOJI = /\p{Extended_Pictographic}/gu;

function walk(d, out = []) {
  if (!fs.existsSync(d)) return out;
  for (const f of fs.readdirSync(d)) {
    if (f === "node_modules" || f.startsWith(".")) continue;
    const p = path.join(d, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXT.test(p)) out.push(p);
  }
  return out;
}

const files = [];
for (const d of PKG_DIRS) files.push(...walk(path.join(ROOT, d)));
for (const f of ROOT_FILES) if (fs.existsSync(path.join(ROOT, f))) files.push(path.join(ROOT, f));
for (const f of walk(path.join(ROOT, "web"))) {
  if (!/\.(js|css|html)$/.test(f)) continue;
  const rel = path.relative(ROOT, f).split(path.sep).join("/");
  if (WEB_SKIP.some((re) => re.test(rel))) continue;
  files.push(f);
}

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name + (detail ? "  → " + detail : "")); }
}

console.log("【emoji 清零】");

const hits = [];
let chars = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  chars += src.length;
  src.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(EMOJI)) {
      if (ALLOW.has(m[0])) continue;
      hits.push(path.relative(ROOT, f) + ":" + (i + 1) + " 「" + m[0] + "」 " + line.trim().slice(0, 60));
    }
  });
}

ok(hits.length === 0, "随包 + 网页版（" + files.length + " 个文件）零 emoji 残留",
  hits.slice(0, 8).join(" / ") + (hits.length > 8 ? " …共 " + hits.length + " 处" : ""));

// 反向护栏：扫描范围塌缩成空集时上一条会假绿（0 个文件 → 0 处 emoji）
ok(files.length > 150 && chars > 400000, "扫描范围未塌缩（防 0 文件假绿）",
  files.length + " 个文件 / " + Math.round(chars / 1024) + "KB");
// 分区断言：utils/ 与 web/ 必须真的被扫到（任一为空集就说明白名单被改窄了）
const hasUtils = files.some((f) => path.relative(ROOT, f).startsWith("utils" + path.sep));
const hasWeb = files.some((f) => path.relative(ROOT, f).startsWith("web" + path.sep));
ok(hasUtils && hasWeb, "utils/ 与 web/ 都在扫描范围内（这两处曾漏扫导致假绿）",
  "utils=" + hasUtils + " web=" + hasWeb);

// 自绘图标必须真的在包里：wxml 引用了但文件缺失 → 图片静默不显示
// 含 {{ }} 的动态拼接路径静态无法判定（如 {{d.riskIcon}}.png），跳过 —— 不假装覆盖，
// 这与 check-tap-target 对动态 class 的处理口径一致。
const iconRefs = new Set();
for (const f of files.filter((x) => x.endsWith(".wxml"))) {
  for (const m of fs.readFileSync(f, "utf8").matchAll(/src\s*=\s*"(\/images\/icons\/[^"]+)"/g)) {
    if (m[1].includes("{{")) continue;
    iconRefs.add(m[1]);
  }
}
const missing = [...iconRefs].filter((r) => !fs.existsSync(path.join(ROOT, r.replace(/^\//, "").split("?")[0])));
ok(missing.length === 0, "wxml 引用的自绘图标全部存在（" + iconRefs.size + " 个引用）", missing.join(" / "));

/* 图标名映射表兜底：封面分类走 `{{it.thumbIcon}}.png` 这类动态拼接，上面的静态引用检查
 * 按设计跳过它们（不假装覆盖）。但值写错同样是**静默 404**——封面变空白、页面不报错。
 * 所以把映射表里的每个名字都验一遍文件存在。
 * 只读**可读源码**（tools/_src-backup 与页面目录）：utils/ 是压缩产物，正则按行匹配不到，
 * 扫了也是假覆盖。 */
const mapDirs = ["tools/_src-backup", "pages", "subpkg", "subai", "components"]
  .map((d) => path.join(ROOT, d)).filter((d) => fs.existsSync(d));
const iconNames = new Set();
// v1.20.34：封面分类表的图标走**另一套图**（images/covers/*.png，96x96），与 icons/ 的
// 32x32 UI 图标分开收集、分开校验。为什么不是同一套：封面要 104rpx、图标 60rpx，在
// pixelRatio 3.5 的设备上要撑到 ~100 物理像素，32x32 拉伸 2.5 倍会发虚（真机报障
// 「规格和图不匹配」）。混在一起查会变成「要么封面缺文件、要么被迫合并两套图」。
const coverIconNames = new Set();
let mapCount = 0, coverMapCount = 0;
for (const d of mapDirs) {
  for (const f of walk(d).filter((x) => x.endsWith(".js"))) {
    const src = fs.readFileSync(f, "utf8");
    // 形态 ①：对象字面量映射表（const X_ICON = { "历史古迹": "pagoda", ... }）→ images/icons/
    for (const m of src.matchAll(/(?:const|let|var)\s+([A-Z][A-Z0-9_]*_ICON)\s*=\s*\{([\s\S]*?)\n\s*\}/g)) {
      mapCount++;
      for (const v of m[2].matchAll(/"([a-z0-9][a-z0-9-]*)"/g)) iconNames.add(v[1]);
    }
    // 形态 ②：有序规则表（const COVER_ICON_RULES = [ ["home", /…/], … ]）→ images/covers/
    // 每项第一个元素就是图标名 —— 只在行首匹配，避免把正则里的字符串也当成图标名
    for (const m of src.matchAll(/(?:const|let|var)\s+([A-Z][A-Z0-9_]*_ICON_RULES)\s*=\s*\[([\s\S]*?)\n\];/g)) {
      coverMapCount++;
      for (const v of m[2].matchAll(/^\s*\["([a-z0-9][a-z0-9-]*)",/gm)) coverIconNames.add(v[1]);
    }
    // 形态 ③：兜底常量（const COVER_ICON_FALLBACK = "pin"）—— 它也是要渲染的封面图标
    for (const m of src.matchAll(/(?:const|let|var)\s+[A-Z][A-Z0-9_]*_ICON_FALLBACK\s*=\s*"([a-z0-9][a-z0-9-]*)"/g)) {
      coverIconNames.add(m[1]);
    }
  }
}
const nameMiss = [...iconNames].filter((n) => !fs.existsSync(path.join(ROOT, "images/icons/" + n + ".png")));
// mapCount / 名字数都要有下限：正则一旦匹配不到，这条会「0 个全通过」——正是本仓反复踩的假绿形态。
// 下限取 3（当前唯一一张对象表是 subai/deep 的 BLOCK_ICON，4 项）：v1.20.34 把封面
// 分类表分流到下方独立断言后，这里只剩少量 UI 图标，但「0 匹配」仍然必须红。
ok(mapCount >= 1 && iconNames.size >= 3 && nameMiss.length === 0,
  "图标名映射表里的每个名字都有对应 PNG（" + mapCount + " 张表 / " + iconNames.size + " 个名字）",
  (mapCount < 1 || iconNames.size < 3 ? "映射表未匹配到，检查正则是否失效" : "") + nameMiss.join(" / "));

const coverMiss = [...coverIconNames].filter((n) => !fs.existsSync(path.join(ROOT, "images/covers/" + n + ".png")));
ok(coverMapCount >= 1 && coverIconNames.size >= 20 && coverMiss.length === 0,
  "封面分类表的每个图标都有 images/covers/*.png（" + coverIconNames.size + " 个名字）",
  (coverMapCount < 1 || coverIconNames.size < 20 ? "封面表未匹配到，检查正则是否失效" : "") + coverMiss.join(" / "));

console.log("");
if (fail === 0) {
  console.log("emoji 门禁通过：" + pass + " 项（emoji 清零 · 图标引用完整 · 扫描范围有效）");
  process.exit(0);
}
console.log("emoji 门禁失败：" + fail + " 项 / 共 " + (pass + fail) + " 项");
console.log("提示：界面图标改用 images/icons/*.png 自绘图标；纯文本输出去掉 emoji 前缀、保留文字。");
process.exit(1);
