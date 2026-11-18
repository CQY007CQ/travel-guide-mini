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
console.log("[6] 图标语义匹配（50 类有序规则表）");
const ICON_CASES = [
  // 顺序敏感：dam 必须在 canyon 之前（「三峡大坝」含「峡」）与 river 之前（「都江堰」含「江」）
  ["三峡大坝", "dam"], ["都江堰", "dam"],
  // 顺序敏感：canyon 必须在 water 之前（「黄河画廊」含「河」）
  ["黄河画廊", "canyon"], ["壶口瀑布", "waterfall"], ["水帘洞", "waterfall"],
  // 顺序敏感：terrace 在 grass 之前（含「田」）；glacier/ski 在 snowmtn 之前（含「雪」）
  ["元阳梯田", "terrace"], ["呼伦贝尔草原", "grass"],
  ["海螺沟冰川", "glacier"], ["亚布力滑雪场", "ski"], ["玉龙雪山", "snowmtn"],
  // 顺序敏感：ruins / wall 在 town 之前（都含「古城」）
  ["良渚古城遗址", "ruins"], ["平遥古城墙", "wall"], ["丽江古城", "town"],
  // 顺序敏感：statue 在 temple 之前（含「佛」）；tower 在 pagoda 之前（含「塔」）
  ["乐山大佛", "statue"], ["晋祠", "temple"], ["东方明珠塔", "tower"], ["大雁塔", "pagoda"],
  // 顺序敏感：aquarium 在 paw 之前（含「水族」）；paw 在 garden 之前（「动物园」以园结尾）
  ["珠海长隆海洋王国", "aquarium"], ["长隆野生动物园", "paw"],
  // 顺序敏感：bridge 在 island 之前（「青岛栈桥」含「岛」）；lake 在 island 之前（「千岛湖」）
  ["青岛栈桥", "bridge"], ["鼓浪屿", "island"], ["千岛湖", "lake"],
  // 顺序敏感：town 在 lake/river 之前（「丽江古城」含「江」已在上方）；「江南」不是江
  ["江南水乡", "water"], ["漓江", "river"], ["九寨沟", "water"],
  // 顺序敏感：ferris 在 garden 之前（「游乐园」含「园」）
  ["上海迪士尼", "ferris"], ["常州中华恐龙园", "ferris"], ["颐和园", "garden"], ["人民公园", "garden"],
  // 地貌细分（v1.20.34 新增：湖 / 河 / 湿地 / 火山 / 冰川 / 梯田 / 森林）
  ["西湖", "lake"], ["茶卡盐湖", "lake"], ["长白山天池", "lake"], ["汉城湖", "lake"],
  ["西溪湿地", "wetland"], ["五大连池火山", "volcano"], ["张家界", "mountain"], ["莫干山", "mountain"],
  ["鸣沙山", "desert"], ["那拉提草原", "grass"], ["大连滨海路", "umbrella"], ["三亚亚龙湾", "umbrella"],
  ["蜀南竹海", "forest"],
  // 建筑 / 文化细分（新增：土楼 / 造像 / 遗址 / 校园 / 现代塔 / 市集）
  ["福建土楼", "fort"], ["开平碉楼", "fort"], ["云冈石窟", "cave"], ["龙门石窟", "cave"],
  ["圆明园遗址", "ruins"], ["武汉大学", "school"], ["武大樱花", "flower"],
  ["碛口古镇", "town"], ["乌镇", "town"], ["西塘古镇", "town"],
  ["乔家大院", "palace"], ["秦始皇兵马俑", "palace"], ["北京故宫", "palace"],
  ["西安城墙", "wall"], ["钟楼街", "street"], ["回民街", "street"], ["永兴坊", "street"],
  ["德云社剧场", "show"], ["延安革命旧址", "flag"], ["外滩夜景", "city"], ["天安门广场", "city"],
  ["独库公路", "road"], ["草原天路", "road"],
  ["太原南站", "bus"],
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

/* ────────────────────────────────────────────────────────────────────────
 * [7] 封面图标规格与配色语义（v1.20.34）
 *
 * 病因（用户真机报障「示意图有点小、规格和图不匹配」）：
 *   封面 96rpx、图标 48rpx，在 pixelRatio=3.5 的设备上图标要占 80~100 物理像素，
 *   而源图是 images/icons/ 里的 **32x32** 小图（给列表行内 32rpx 场景画的）——
 *   等于被拉伸 2.5 倍，线条发虚。且旧版色相是全局哈希 %360，颜色不携带语义。
 *
 * 现在：封面图标独立成 images/covers/*.png（96x96），色相按类别色域给基值。
 * 这里锁三件事，都是「漏了会静默」的：
 *   ① 规则表用到的每个图标都必须真有 96x96 的 covers 文件（缺文件在真机上是静默空白）
 *   ② 渲染层必须引用 /images/covers/，不能又指回 /images/icons/ 的 32x32
 *   ③ 山=绿系 / 水=蓝系 / 古建=暖色系；同类不同景点仍要能区分（不许所有封面同色）
 * ──────────────────────────────────────────────────────────────────────── */
console.log("[7] 封面图标规格（96x96 独立一套）与配色语义");
const COVERS_DIR = path.join(ROOT, "images", "covers");
const ruleIcons = new Set();
{
  // 从 travel.js 真源里抠出规则表用到的所有 icon 名（比手写清单可靠：加规则不会漏）
  const src = fs.readFileSync(path.join(ROOT, "tools/_src-backup/travel.js"), "utf8");
  const block = src.slice(src.indexOf("const COVER_ICON_RULES = ["), src.indexOf("const COVER_ICON_FALLBACK"));
  for (const m of block.matchAll(/\[\s*"([a-z]+)"\s*,/g)) ruleIcons.add(m[1]);
  ruleIcons.add("pin"); // 兜底
}
ck("规则表解析出的图标类别 ≥ 45", ruleIcons.size >= 45, ruleIcons.size + " 类");
const missingCovers = [...ruleIcons].filter((ic) => !fs.existsSync(path.join(COVERS_DIR, ic + ".png")));
ck("每个规则图标都有 images/covers/*.png（缺文件真机静默空白）", missingCovers.length === 0, missingCovers.join(","));

// 尺寸必须真的是 96x96：源图分辨率不够就白改了（这条是「规格与用法不匹配」的直接护栏）
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
const badSize = [];
for (const ic of ruleIcons) {
  const p = path.join(COVERS_DIR, ic + ".png");
  if (!fs.existsSync(p)) continue;
  const { w, h } = pngSize(fs.readFileSync(p));
  if (w < 96 || h < 96 || w !== h) badSize.push(ic + "=" + w + "x" + h);
}
ck("封面图标均为 ≥96x96 的正方形（替换 32x32 旧图的核心目的）", badSize.length === 0, badSize.join(","));

// 渲染层引用的目录：plan 页与检索页都必须走 covers，不许回退到 icons 的 32x32
for (const rel of ["pages/plan/plan.wxml", "subpkg/spotsearch/spotsearch.wxml"]) {
  const wxml = stripWxmlComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  ck(rel + " 引用 /images/covers/", wxml.indexOf("/images/covers/") >= 0);
  ck(rel + " 不再用 /images/icons/ 画封面图标", !/\/images\/icons\/\{\{[^}]*[Cc]over/.test(wxml) && !/\/images\/icons\/\{\{[^}]*thumbIcon/.test(wxml));
}

// 尺寸比例：图标要明显大于半封（旧版 48/96=50%，且被名字条压住）。
// 从 WXSS 真读数值，不写死断言 —— 改样式改坏了必须红。
{
  const css = fs.readFileSync(path.join(ROOT, "pages/plan/plan.wxss"), "utf8");
  const num = (re) => { const m = css.match(re); return m ? parseFloat(m[1]) : NaN; };
  const thumb = num(/\.tl-thumb-wrap\s*\{[^}]*width:\s*(\d+)rpx/);
  const glyph = num(/\.tl-thumb-glyph\s*\{[^}]*width:\s*(\d+)rpx/);
  const padB = num(/\.tl-thumb\.gen\s*\{[^}]*padding-bottom:\s*(\d+)rpx/);
  ck("封面尺寸可解析（.tl-thumb-wrap width）", !isNaN(thumb), String(thumb));
  ck("封面 ≥ 100rpx（旧版 96rpx 偏小）", thumb >= 100, thumb + "rpx");
  ck("图标 ≥ 56rpx 且占封面 > 55%（旧版 48rpx / 50%）", glyph >= 56 && glyph / thumb > 0.55, glyph + "/" + thumb);
  // 名字条不许压住图标：图标（去掉底部留白后居中）必须与名字条分居上下
  ck("封面底部为名字条预留 ≥ 24rpx（图标不再被压住）", padB >= 24, padB + "rpx");
  ck("图标在留白区内容得下（封面−留白 ≥ 图标高）", thumb - padB >= glyph, (thumb - padB) + " vs " + glyph);
}

// 配色语义：把 hue 从 bg 里反解不出来（bg 是 hex），改成按长度比对 + 类别近似判定
// —— 直接断言「不同类别的封面几乎不撞色」比断言具体 hex 更耐改（调色不改语义也不该红）。
{
  const SAMPLE = {
    nature: ["华山", "张家界", "那拉提草原"],       // 山/草 → 绿系
    water: ["西湖", "壶口瀑布", "漓江"],            // 湖/瀑/河 → 蓝青系
    heritage: ["北京故宫", "大雁塔", "西安城墙"]     // 古建 → 暖色系（红橙黄）
  };
  const hueOf = (city, nm) => {
    const bg = cover(city, nm).bg;
    const m = bg.match(/#([0-9a-f]{6})/i);
    if (!m) return null;
    const r = parseInt(m[1].slice(0, 2), 16) / 255, g = parseInt(m[1].slice(2, 4), 16) / 255, b = parseInt(m[1].slice(4, 6), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 0.02) return -1;
    let hh;
    if (mx === r) hh = ((g - b) / d) % 6;
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    return (hh * 60 + 360) % 360;
  };
  const inBand = (h, lo, hi) => (lo <= hi ? (h >= lo && h <= hi) : (h >= lo || h <= hi));
  for (const nm of SAMPLE.nature) {
    const hh = hueOf("", nm);
    ck("自然「" + nm + "」落在绿色域 80~200°", hh !== null && inBand(hh, 80, 200), String(hh && hh.toFixed(0)));
  }
  for (const nm of SAMPLE.water) {
    const hh = hueOf("", nm);
    ck("水景「" + nm + "」落在蓝青色域 165~230°", hh !== null && inBand(hh, 165, 230), String(hh && hh.toFixed(0)));
  }
  for (const nm of SAMPLE.heritage) {
    const hh = hueOf("", nm);
    ck("古建「" + nm + "」落在暖色域 330~70°", hh !== null && inBand(hh, 330, 70), String(hh && hh.toFixed(0)));
  }
  // 对照组：连排的三个古建景点不许同色（旧版 +34 偏移把两段色一起推到橄榄绿，三张几乎一样）
  const trio = ["大雁塔", "回民街", "秦始皇兵马俑博物馆"].map((n) => cover("", n).bg);
  ck("连排古建三张封面互不相同", new Set(trio).size === 3, JSON.stringify(trio.map((x) => x.slice(20, 28))));
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
ck("实际在用的图标类别 ≥ 45（v1.20.34 从 30 类扩到 50 类）", Object.keys(dist).length >= 45, Object.keys(dist).length + " 类");
ck("山占比 < 15%（旧实现 37%）", pct("mountain") < 15, pct("mountain").toFixed(1) + "%");
ck("塔占比 < 5%（旧实现 21%）", pct("pagoda") < 5, pct("pagoda").toFixed(1) + "%");
ck("中性兜底 pin < 30%", pct("pin") < 30, pct("pin").toFixed(1) + "%");

console.log("\n封面护栏：" + pass + " 项通过 / " + fail + " 项失败");
process.exit(fail ? 1 : 0);
