/**
 * tools/lib/deep-auto-out.mjs —— 自动深度卡片的唯一落盘实现（分块 + 聚合入口）
 *
 * 背景（T4）：subai/data/ai-deep-auto.js 原本是 8267 行单文件（200 城 436KB），
 * 认知负荷与合并冲突面都集中在一个文件里。这里把它按顺序切成 N 块，
 * 对外仍然只暴露一个入口文件 subai/data/ai-deep-auto.js，形状完全不变：
 *     module.exports = { v, updated, auto, cities }
 *
 * 两条必须守住的约束：
 * 1) 城市键序就是文件里的顺序 —— 聚合必须按 parts 顺序合并，不能 sort，
 *    否则「先人工核心后自动衍生」的展示顺序会变（渲染输出不再等价）。
 * 2) 微信编译期只认静态字面量 require —— 聚合入口里必须逐个写
 *    require("./deep-auto/pNN.js")，不能用拼接路径的循环。
 *
 * 写盘职责收在这里，build-deep-cards.mjs 与一次性迁移脚本共用，
 * 避免「生成器写单文件、仓库里是分块」这种第二个真相源。
 */
import fs from "fs";
import path from "path";

/** 单块目标行数：验收线是 800，留出 banner + 包装 + 余量 */
export const PART_MAX_LINES = 780;

const DIR = "subai/data/deep-auto";
const ENTRY = "subai/data/ai-deep-auto.js";

/**
 * 入口文件里「生成区」的起始标记。
 * 人工写的声明头在这个标记之前；标记之后全是生成内容。
 * 重新生成时必须按这个标记切一刀，否则「把上次生成的索引当成人工头再拼一遍」
 * 会让入口文件每跑一次就膨胀一次（实测第二次重写就出现重复块）。
 */
export const ENTRY_SENTINEL = "// ── 分块聚合入口（对外形状与原单文件完全一致）─────────────────────────";

/** 从已有入口文件里取出「人工声明头」（没有标记就取 module.exports 之前） */
export function bannerOf(entryText) {
  const i = entryText.indexOf(ENTRY_SENTINEL);
  const head = i >= 0 ? entryText.slice(0, i) : entryText.slice(0, Math.max(0, entryText.indexOf("module.exports")));
  return head.trim();
}
/** 把一个城市条目渲染成 part 文件里的两空格缩进形态 */
function cityLines(name, obj) {
  const body = JSON.stringify({ [name]: obj }, null, 2) // 形如 { "城": {...} }
    .split("\n")
    .slice(1, -1); // 去掉最外层 { }，保留内层成员行
  // JSON.stringify 给的缩进是 2 空格起；part 里城市挂在 `cities: {` 下一层，需要再右移 2
  return body.map((l) => "  " + l);
}

function partHead(i, total, from, to, label, entryName, humanEdited) {
  return [
    "// " + label + " · 分块 " + i + "/" + total + "（第 " + from + "~" + to + " 城）",
    humanEdited
      ? "// 人工维护：改城市内容直接改这里（同城的所有块合起来才是一份完整内容库）"
      : "// 由 tools/lib/deep-auto-out.mjs 生成，请勿手改；重新生成：node tools/team/build-deep-cards.mjs",
    "// 聚合入口：" + entryName + "（对外形状与原单文件一致）",
    "module.exports = {",
    "  cities: {"
  ];
}
const PART_TAIL = ["  }", "};", ""];

/**
 * 把 { v, updated, auto, cities } 写成「分块 + 聚合入口」。
 * 三份城市内容库（ai-deep 人工核心 / ai-deep-extra 人工扩写 / ai-deep-auto 自动衍生）
 * 形状一致，落盘逻辑共用一份：差异只有「分块目录、入口文件名、自己的声明头」。
 *
 * @param {object} out        内容对象
 * @param {string} root       仓库根
 * @param {{dir?:string, entry?:string, banner?:string}} opts 目录 / 入口 / 人工声明头（原样保留）
 * @returns {{parts:number, entryLines:number, cities:number}}
 */
export function writeDeepAuto(out, root = process.cwd(), opts = {}) {
  const DIRX = opts.dir || DIR;
  const ENTRYX = opts.entry || ENTRY;
  const BANNER = bannerOf((opts.banner || "").trim() || "module.exports");
  const LABEL = opts.label || "自动衍生深度卡片";
  const HUMAN = !!opts.humanEdited;
  const names = Object.keys(out.cities || {});
  if (!names.length) throw new Error("writeDeepAuto: cities 为空，拒绝写出（会产生加载期空内容）");

  // 逐城算行数 → 贪心装箱，保持原始顺序不变
  const bundles = [];
  let cur = [], curLines = 0;
  const headLines = partHead(1, 1, 1, 1, LABEL, ENTRYX, HUMAN).length + PART_TAIL.length;
  for (const n of names) {
    const lines = cityLines(n, out.cities[n]).length;
    if (cur.length && curLines + lines > PART_MAX_LINES - headLines) {
      bundles.push(cur);
      cur = [];
      curLines = 0;
    }
    cur.push(n);
    curLines += lines;
  }
  if (cur.length) bundles.push(cur);
  const total = bundles.length;

  // 清掉上一轮多出来的分块（改名/合并时不能留下孤儿文件，否则聚合入口写不到它们却仍占体积）
  const absDir = path.join(root, DIRX);
  fs.mkdirSync(absDir, { recursive: true });
  const keep = new Set();
  for (let i = 1; i <= total; i++) keep.add("p" + String(i).padStart(2, "0") + ".js");
  for (const f of fs.readdirSync(absDir)) {
    if (/^p\d+\.js$/.test(f) && !keep.has(f)) fs.unlinkSync(path.join(absDir, f));
  }

  let from = 1;
  for (let i = 1; i <= total; i++) {
    const names2 = bundles[i - 1];
    const to = from + names2.length - 1;
    const lines = [...partHead(i, total, from, to, LABEL, ENTRYX, HUMAN)];
    for (let k = 0; k < names2.length; k++) {
      const one = cityLines(names2[k], out.cities[names2[k]]);
      // 城市之间要有逗号：补在上一块的最后一行（漏逗号是只能靠跑起来才发现的语法错）
      if (k > 0) lines[lines.length - 1] += ",";
      lines.push(...one);
    }
    lines.push(...PART_TAIL);
    const file = "p" + String(i).padStart(2, "0") + ".js";
    fs.writeFileSync(path.join(absDir, file), lines.join("\n"));
    from = to + 1;
  }

  // 聚合入口：静态 require 逐个列出（微信编译期硬要求）
  const base = path.basename(DIRX);
  const L = [];
  if (BANNER) { L.push(BANNER); L.push(""); }
  L.push(ENTRY_SENTINEL);
  L.push("// 为什么切成 " + total + " 块：单文件曾达数千行，认知负荷与合并冲突面过大（T4）。");
  L.push("// 内容本体在 subai/data/" + base + "/pNN.js，本文件只做聚合，不再承载数据。");
  L.push("// 下面按 p01→p" + String(total).padStart(2, "0") + " 列出了每块覆盖的城市，改内容直接去对应块。");
  L.push("//");
  L.push("// 两个不能改的地方：");
  L.push("//   1) require 必须逐个写静态字面量 —— 微信编译期不解析拼接出来的路径；");
  L.push("//   2) 合并必须按 p01→p" + String(total).padStart(2, "0") + " 顺序，键序即展示顺序，不可 sort。");
  L.push("");
  L.push("// 城市 → 分块索引（生成，供人工定位；查找请用 grep \"\\\"城市名\\\":\" subai/data/" + base + "/）");
  let cursor = 0;
  for (let i = 1; i <= total; i++) {
    const ns = bundles[i - 1];
    L.push("//   p" + String(i).padStart(2, "0") + "（" + ns.length + " 城）：" + ns[0] + " … " + ns[ns.length - 1]);
    cursor += ns.length;
  }
  L.push("");
  for (let i = 1; i <= total; i++) {
    L.push("const P" + String(i).padStart(2, "0") + " = require(\"./" + base + "/p" + String(i).padStart(2, "0") + ".js\");");
  }
  L.push("");
  L.push("const PARTS = [");
  for (let i = 1; i <= total; i++) L.push("  P" + String(i).padStart(2, "0") + (i < total ? "," : ""));
  L.push("];");
  L.push("");
  L.push("const cities = {};");
  L.push("for (let i = 0; i < PARTS.length; i++) {");
  L.push("  const src = PARTS[i] && PARTS[i].cities;");
  L.push("  if (!src) continue; // 极端裁剪下某块缺失不应连累其余城市");
  L.push("  for (const k in src) if (Object.prototype.hasOwnProperty.call(src, k)) cities[k] = src[k];");
  L.push("}");
  L.push("");
  L.push("module.exports = {");
  L.push("  v: " + JSON.stringify(out.v) + ",");
  L.push("  updated: " + JSON.stringify(out.updated) + ",");
  L.push("  auto: " + JSON.stringify(!!out.auto) + ",");
  L.push("  cities: cities");
  L.push("};");
  L.push("");
  const entrySrc = L.join("\n");
  fs.writeFileSync(path.join(root, ENTRYX), entrySrc);

  return { parts: total, entryLines: entrySrc.split("\n").length - 1, cities: names.length };
}
