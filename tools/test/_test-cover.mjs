// 单测：生成式封面（v1.20.30 真机报障修复的护栏）
//
// 病情（用户真机截图）：
//   行程页时间线左侧 96rpx 见方的封面上，除了类别图标，还压着两行东西 ——
//   一行「示意图」角标，一行景点名。景点名只有 4 个字时刚好铺满一行，看着还行；
//   但住宿项的名字是长店名（「XX客栈1 | YY民居客栈」），中文可任意断行 →
//   名字条塌成一列汉字，整张封面全是字，比图标还抢眼。
//
// 修法与边界：
//   1) 「示意图」角标去掉。诚实性靠**形态**表达：渐变 + 单色线条图标本身没有照片质感，
//      不会被误认为实拍。若哪天封面改成有照片质感的设计，必须把标注加回来 —— 所以这里
//      断言 spotCover 不再返回 badge 字段，谁加回来就红。
//   2) 住宿 / 交通给类别短词（完整名称右侧行标题已有），其余名称超 6 字截断。
//      这是**主断言**，真跑 spotCover 校验输出，不是看源码有没有那串字。
//   3) 样式层 nowrap + ellipsis 是第二道兜底（CSS 无法在 Node 里真跑渲染，只能文本断言）。
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const ROOT = path.resolve(process.cwd());
const req = createRequire(ROOT + "/");

// travel.js 顶层需要 wx（store 读写 → 拿不到会走 catch 降级）。装上最小垫片，
// 免得「没装垫片 → 空存储 → 断言看着过其实没验」。
global.wx = global.wx || {
  getStorageSync: () => "",
  setStorageSync() {},
  removeStorageSync() {},
  getSystemInfoSync: () => ({ pixelRatio: 2, windowWidth: 375, windowHeight: 667, statusBarHeight: 20, platform: "devtools" }),
  getStorageInfoSync: () => ({ keys: [], currentSize: 0, limitSize: 10240 })
};

const T = req("./utils/travel.js");

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}

const cover = (city, name, img) => T.spotCover(city || "", name || "", img || "");
const labelOf = (city, name) => cover(city, name).label;

console.log("[1] 长店名不再糊在封面上（住宿 / 交通 → 类别短词）");
const HOTEL_LONG = "中*内客栈1 平遥古城民居客栈";
const HOTEL_SHORT = "平遥古城民居客栈";
const STATION = "太原武宿国际机场";
for (const n of [HOTEL_LONG, HOTEL_SHORT, "某某青年旅舍", "山谷度假村"]) {
  const l = labelOf("晋中", n);
  ck("住宿「" + n.slice(0, 10) + "」→ 住宿", l === "住宿", "实际「" + l + "」");
}
for (const n of [STATION, "太原南站", "青岛港客运码头"]) {
  const l = labelOf("太原", n);
  ck("交通「" + n + "」→ 交通", l === "交通", "实际「" + l + "」");
}
// 对照组：普通景点名不受影响，短名原样保留（不能为了防崩把 4 字名也截了）
for (const n of ["碛口古镇", "黄河画廊", "乔家大院"]) {
  const l = labelOf("吕梁", n);
  ck("景点「" + n + "」原样保留", l === n, "实际「" + l + "」");
}

console.log("[2] 超长景点名截断（按字截，不切半个代理对）");
const LONGG = "这是一个非常非常长的景点名字用于测试";
const lg = labelOf("吕梁", LONGG);
ck("超 6 字截断成 6 字 + 省略号", lg === "这是一个非常…", "实际「" + lg + "」");
ck("截断后长度 ≤ 7", Array.from(lg).length <= 7, "实际 " + Array.from(lg).length);
const sur = labelOf("吕梁", "𠀀𠀁𠀂𠀃𠀄𠀅𠀆𠀇");   // 生僻字，全是代理对
ck("代理对不被切成半个（无孤立代理项）", !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(sur), "实际「" + sur + "」");

console.log("[3] 「示意图」角标不许回潮");
const cv0 = cover("吕梁", "碛口古镇");
ck("spotCover 不再返回 badge 字段", cv0.badge === undefined, "实际 " + JSON.stringify(cv0.badge));
ck("isReal / placeholder 仍在（真图仍优先）",
  cv0.isReal === false && cv0.placeholder === true);
const cvReal = cover("吕梁", "碛口古镇", "cloud://x/y.jpg");
ck("传了真图 → isReal=true 且仍给短标签", cvReal.isReal === true && typeof cvReal.label === "string");
ck("fullLabel 保留完整名（截断不丢信息）", cover("晋中", HOTEL_LONG).fullLabel === HOTEL_LONG, "实际「" + cover("晋中", HOTEL_LONG).fullLabel + "」");
// 渲染层：去掉注释后不许再有「示意图」字样，也不许再引用 coverBadge
// （注释里保留这个词是**对的**：p-render.js 有一句「加载失败兜底回退示意图」，描述的是
//   行为而不是要渲染的文案。所以断言必须滤注释 —— 记忆里那条「门禁断言先滤注释行再匹配」）
function stripWxmlComments(s) { return s.replace(/<!--[\s\S]*?-->/g, ""); }
function stripJsLineComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "")                    // 块注释
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"); // 整行行注释
}
const FILES = {
  planWxml: "pages/plan/plan.wxml",
  planCtx: "pages/plan/plan-ctx.js",
  planRender: "pages/plan/p-render.js",
  rsWxml: "subpkg/spotsearch/spotsearch.wxml",
  rsJs: "subpkg/spotsearch/spotsearch.js"
};
for (const [k, rel] of Object.entries(FILES)) {
  let src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  src = k.endsWith("Wxml") ? stripWxmlComments(src) : stripJsLineComments(src);
  ck(rel + " 不再出现「示意图」字样", src.indexOf("示意图") < 0);
  ck(rel + " 不再引用 coverBadge", src.indexOf("coverBadge") < 0);
}

console.log("[4] 名字条样式兜底（内容侧漏网时只会省略，不会竖排）");
const css = fs.readFileSync(path.join(ROOT, "pages/plan/plan.wxss"), "utf8");
const rule = (css.match(/\.tl-thumb-name\s*\{[^}]*\}/) || [""])[0];
ck("找到 .tl-thumb-name 规则", !!rule);
ck("带 white-space: nowrap", /white-space\s*:\s*nowrap/.test(rule), rule.slice(0, 80));
ck("带 text-overflow: ellipsis", /text-overflow\s*:\s*ellipsis/.test(rule));
ck("带 overflow: hidden", /overflow\s*:\s*hidden/.test(rule));
const rsCss = fs.readFileSync(path.join(ROOT, "subpkg/spotsearch/spotsearch.wxss"), "utf8");
ck("检索页 .rs-cover-badge 样式已删除", rsCss.indexOf(".rs-cover-badge") < 0);

console.log("[5] 封面渐变确定性（同一输入必须同色，防哈希漂移）");
const a1 = cover("吕梁", "碛口古镇"), a2 = cover("吕梁", "碛口古镇");
ck("二次调用 bg 完全一致", a1.bg === a2.bg, a1.bg + " vs " + a2.bg);
ck("不同城市同景点配色不同", cover("吕梁", "古镇").bg !== cover("太原", "古镇").bg);

/* ────────────────────────────────────────────────────────────────────────
 * [6] 图标与景点语义匹配（v1.20.31）
 *
 * 病因：旧实现 `COVER_ICON[cat] || 'mountain'`，颗粒度只有 11 类且未命中兜底成山 ——
 * 全量 24797 个景点名里 **37% 画成山**、21% 画成塔、34% 是 pin，三种图占了 92%。
 * 「黄河画廊」（黄河边崖壁水蚀浮雕）配山峦图就是这么来的。
 *
 * 这里锁三件事：
 *   ① 具体景点必须命中具体类别（33 例精确断言，含顺序敏感的那几个）
 *   ② 兜底必须是 pin，不许再是 mountain
 *   ③ 全量语料的山/塔占比不许反弹（防有人重排规则表又退回「都能变山」）
 * ──────────────────────────────────────────────────────────────────────── */
console.log("[6] 图标语义匹配（30 类有序规则表）");
const ICON_CASES = [
  // 顺序敏感：canyon 必须在 water 之前（「黄河画廊」含「河」）
  ["黄河画廊", "canyon"], ["壶口瀑布", "waterfall"], ["水帘洞", "waterfall"],
  // 顺序敏感：bridge 必须在 island 之前（「青岛栈桥」含「岛」）
  ["青岛栈桥", "bridge"], ["鼓浪屿", "island"],
  // 顺序敏感：ferris 必须在 garden 之前（「游乐园」含「园」）
  ["上海迪士尼", "ferris"], ["颐和园", "garden"], ["人民公园", "garden"],
  // 地貌细分
  ["云冈石窟", "cave"], ["鸣沙山", "desert"], ["那拉提草原", "grass"],
  ["玉龙雪山", "snowmtn"], ["九寨沟", "water"], ["西湖", "water"],
  ["张家界", "mountain"], ["五台山", "mountain"], ["大连滨海路", "umbrella"],
  // 建筑 / 文化细分
  ["碛口古镇", "town"], ["平遥古城", "town"], ["乔家大院", "palace"],
  ["秦始皇兵马俑", "palace"], ["北京故宫", "palace"], ["晋祠", "temple"],
  ["西安城墙", "wall"], ["钟楼街", "street"], ["南京路步行街", "street"],
  ["德云社剧场", "show"], ["延安革命旧址", "flag"], ["外滩夜景", "camera"],
  ["长隆野生动物园", "paw"], ["太原南站", "bus"],
  // 行程框架行分流（历史 bug：「入住 XX 客栈」显示成刀叉）
  ["入住 平遥古城客栈", "home"], ["前往 晋中", "bus"], ["抵达 太原", "bus"]
];
let iconBad = 0;
for (const [nm, want] of ICON_CASES) {
  const got = cover("", nm).icon;
  if (got !== want) { iconBad++; ck("「" + nm + "」→ " + want, false, "实际 " + got); }
}
ck("具体景点全部命中正确类别（" + ICON_CASES.length + " 例）", iconBad === 0, iconBad + " 例不符");
// 兜底：未命中必须是 pin。这条是「黄河画廊变山」的根因锁
ck("未命中兜底是 pin 而不是 mountain", cover("", "某某小卖部").icon === "pin", cover("", "某某小卖部").icon);
ck("空名兜底是 pin", cover("", "").icon === "pin");
// 规则表里出现的每个图标都必须真有 PNG —— 漏文件在真机上是**静默空白**（不报错、只是图没了）
const ICON_DIR = path.join(ROOT, "images/icons");
const usedIcons = new Set(ICON_CASES.map((c) => cover("", c[0]).icon));
usedIcons.add("pin");
for (const ic of [...usedIcons]) {
  ck("图标文件存在：" + ic + ".png", fs.existsSync(path.join(ICON_DIR, ic + ".png")));
}

// 全量语料统计：类别数 / 山占比 / 塔占比（防回退成「都能变山」）
const D = req("./utils/data.js");
const allNames = new Set();
((D.CITIES) || []).forEach((c) => {
  (c.experiences || []).forEach((e) => { if (e && e.name) allNames.add(e.name); });
  (c.spots || []).forEach((s) => { const n = typeof s === "string" ? s : (s && s.name); if (n) allNames.add(n); });
});
const dist = {};
let N = 0;
for (const nm of allNames) { dist[cover("", nm).icon] = (dist[cover("", nm).icon] || 0) + 1; N++; }
const pct = (k) => (dist[k] || 0) * 100 / N;
ck("语料规模可解析（>10000 个景点名）", N > 10000, N + " 个");
ck("实际在用的图标类别 ≥ 25", Object.keys(dist).length >= 25, Object.keys(dist).length + " 类");
ck("山占比 < 15%（旧实现 37%）", pct("mountain") < 15, pct("mountain").toFixed(1) + "%");
ck("塔占比 < 5%（旧实现 21%）", pct("pagoda") < 5, pct("pagoda").toFixed(1) + "%");
ck("中性兜底 pin < 30%", pct("pin") < 30, pct("pin").toFixed(1) + "%");

console.log("\n封面护栏：" + pass + " 项通过 / " + fail + " 项失败");
process.exit(fail ? 1 : 0);
