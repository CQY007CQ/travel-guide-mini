#!/usr/bin/env node
/**
 * tools/check/check-doc-numbers.mjs —— 「文档数字与实测一致」门禁（v1.20.8 / T5）
 *
 * 为什么要有这道门禁：
 *   体积、城市数、店数、静态块大小这类数字，只要靠人手写进文档，就一定会漂移。
 *   本项目已实测发生两轮：
 *     · 主包 660KB → 1418KB（瘦身 + 数据落地后没人回头改文档）
 *     · data-packed 约 1828KB → 1924KB
 *   更严重的是「同一事实两个数字」：城市池在基础 require 下是 751、ready() 之后是 868，
 *   美食 9256 / 9569 —— 文档抄哪一个都会与另一半对不上。这类问题不报错、不弄红 allcheck，
 *   只有现场打开开发者工具「代码质量」面板一核对才会穿帮。
 *
 * 设计原则（与 T2 一致：同一事实只允许一个真相源）：
 *   ① 数字真值不由本文件计算，全部来自两个既有脚本的机器可读输出：
 *        · tools/check/check-pkgsize.mjs → 体积（[fig] *_kb）
 *        · tools/check/check-health.mjs  → 数据规模（[fig] city_entries / spots / hospitals …）
 *      本文件只做「取真值 → 扫材料 → 比对」，绝不自己再算一遍，否则又是第二个真相源。
 *      两个脚本统一采用「ready() 之后的运行时口径」，即用户在 App 里实际看到的数字。
 *   ② 锚点必须命中。材料改了措辞导致锚点匹配不到时判 FAIL 而不是静默跳过 ——
 *      门禁假绿比没有门禁更危险（本仓已有旧 smoke 只查字符串造成假绿的教训）。
 *   ③ 另设过期数字黑名单，兜住「换个说法让锚点漏过」的情况。
 *
 * 与 allcheck 的关系：串在既有的「材料口径一致性」step 里一起跑，
 *   不新增 step（61 步口径被考核材料锁死，加减步会连带触发材料校验失败）。
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { materialText } from "../lib/doc-text.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const OUT = path.resolve(ROOT, "..");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name + (extra ? "  → " + extra : "")); }
}

/* ───────── ① 取真值：只认脚本输出，不自己算 ───────── */
function figs(script, label) {
  const r = spawnSync(process.execPath, [path.join(ROOT, script)], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  const out = String(r.stdout || "");
  const map = {};
  for (const m of out.matchAll(/^\[fig\]\s+([a-z0-9_]+)=(\d+)$/gm)) map[m[1]] = Number(m[2]);
  return { map, rc: r.status, label, lines: Object.keys(map).length };
}

console.log("【数字真值（来自脚本输出）】");
const size = figs("tools/check/check-pkgsize.mjs", "check-pkgsize");
const health = figs("tools/check/check-health.mjs", "check-health");
const F = Object.assign({}, size.map, health.map);
ok("check-pkgsize 输出体积真值", size.rc === 0 && size.lines >= 5, size.lines + " 项 / rc=" + size.rc);
ok("check-health 输出规模真值", health.rc === 0 && health.lines >= 10, health.lines + " 项 / rc=" + health.rc);

const NEED = [
  "city_entries", "cities_real", "spots", "spot_info", "spot_cities",
  "food_shops", "food_cities", "food_enrich_cities", "food_enrich_shops",
  "experiences", "hospitals", "hospital_cities", "approx_cities",
  "main_raw_kb", "main_gzip_kb", "main_headroom_kb",
  "sub_gzip_total_kb", "total_gzip_kb", "data_packed_kb", "team_food3_kb",
];
const missing = NEED.filter((k) => !(k in F));
ok("真值字段齐全（" + NEED.length + " 项）", missing.length === 0, missing.join(","));
if (missing.length) {
  // 缺字段说明上游脚本改了输出格式，此时继续比对只会得到一堆无意义的红，直接退出。
  console.log("\n文档数字口径门禁失败：真值字段缺失 " + missing.length + " 项，无法比对");
  process.exit(1);
}
console.log("    " + NEED.slice(0, 8).map((k) => k + "=" + F[k]).join(" ｜ "));

/* ───────── ② 材料清单（与 check-doc-consistency 同一份路径约定） ───────── */
// 第三列 external=true：交付材料在仓库父目录 outputs/ 下，CI 的干净 checkout 里必然没有。
const MATERIALS = [
  ["仓库 README", path.join(ROOT, "README.md"), false],
  ["功能清单", path.join(ROOT, "docs/assessment/功能清单.md"), false],
  ["演示讲稿", path.join(ROOT, "docs/assessment/演示讲稿.md"), false],
  ["考核计划书", path.join(OUT, "旅行攻略生成器-考核计划书.docx"), true],
  ["考核演示 PPT", path.join(OUT, "旅行攻略生成器-考核演示.pptx"), true],
  ["考核整改与答辩方案", path.join(OUT, "考核整改与答辩方案.md"), true],
  ["模拟考核评分报告", path.join(OUT, "模拟考核评分报告.md"), true],
];
const ext = MATERIALS.filter((m) => m[2]);
const extPresent = ext.filter((m) => fs.existsSync(m[1])).length;
const skipExt = extPresent === 0;
const ACTIVE = MATERIALS.filter((m) => !m[2] || !skipExt);
if (skipExt) console.log("【环境判定】CI / 干净 checkout：跳过 " + ext.length + " 份外部材料（仓库内文档照查）");

const texts = {};
console.log("【材料可读性】");
for (const [label, p] of ACTIVE) {
  const t = materialText(p);
  texts[label] = t || "";
  ok(label + " 可读且非空", !!t && t.length > 100, t ? t.length + " 字符" : "读取失败");
}

/* ───────── ③ 锚点比对：文档里的数字必须等于实测真值 ───────── */
// 每条锚点 = 「材料里的一句固定措辞」+ 「句内数字依次对应哪些真值字段」。
// 措辞由文档侧维护，数字一律由脚本填（见各文档对应句子）。
const ANCHORS = [
  // ——— 仓库 README ———
  { doc: "仓库 README", what: "城市池 / 真实城市",
    re: /(\d+)\s*条城市池（(\d+)\s*座真实城市）/g, keys: ["city_entries", "cities_real"] },
  { doc: "仓库 README", what: "美食城 / 店数",
    re: /(\d+)\s*城\s*(\d+)\s*家真实名店/g, keys: ["food_cities", "food_shops"] },
  { doc: "仓库 README", what: "subdata 体积（MB，一位小数）",
    re: /`subdata`\s*应约\s*([\d.]+)\s*MB/g, keys: ["pkg_subdata_raw_kb"] },
  // ——— 功能清单 ———
  { doc: "功能清单", what: "美食城 / 店数",
    re: /覆盖\s*(\d+)\s*城\s*\/\s*(\d+)\s*家/g, keys: ["food_cities", "food_shops"] },
  { doc: "功能清单", what: "富信息城 / 店数",
    re: /富信息（(\d+)\s*城\s*(\d+)\s*家）/g, keys: ["food_enrich_cities", "food_enrich_shops"] },
  { doc: "功能清单", what: "具名医院 / 覆盖城",
    re: /具名真实医院\*\*：(\d+)\s*家\s*\/\s*(\d+)\s*城/g, keys: ["hospitals", "hospital_cities"] },
  { doc: "功能清单", what: "APPROX 降级城数",
    re: /其余\s*(\d+)\s*城降级为/g, keys: ["approx_cities"] },
  { doc: "功能清单", what: "城市池 / 坐标点 / 体验条数",
    re: /聚合\s*(\d+)\s*条城市池\s*\/\s*(\d+)\s*点坐标\s*\/\s*(\d+)\s*条体验/g,
    keys: ["city_entries", "spots", "experiences"] },
  { doc: "功能清单", what: "景点评级条数 / 覆盖城",
    re: /景点评级\s*(\d+)\s*条\s*\/\s*(\d+)\s*城/g, keys: ["spot_info", "spot_cities"] },
  { doc: "功能清单", what: "data-packed 体积",
    re: /（约\s*(\d+)KB）/g, keys: ["data_packed_kb"] },
  // ——— 演示讲稿 ———
  { doc: "演示讲稿", what: "城市池 / 真实城市 / 景点 / 体验",
    re: /(\d+)\s*条城市池（(\d+)\s*座真实城市）、(\d+)\s*个真实景点、(\d+)\s*条体验/g,
    keys: ["city_entries", "cities_real", "spots", "experiences"] },
  { doc: "演示讲稿", what: "具名医院数",
    re: /真实具名\*\*的那\s*(\d+)\s*家/g, keys: ["hospitals"] },
  { doc: "演示讲稿", what: "城市池 / 坐标点 / 体验（复盘句）",
    re: /覆盖\s*(\d+)\s*条城市池、(\d+)\s*个真实坐标点、(\d+)\s*条体验/g,
    keys: ["city_entries", "spots", "experiences"] },
  // ——— 交付材料（docx / pptx / md，存在时才查） ———
  { doc: "考核计划书", what: "城市池 / 真实城 / 景点 / 体验",
    re: /城市池\s*(\d+)\s*条（(\d+)\s*座真实城市），景点\s*([\d,]+)\s*个，体验\s*([\d,]+)\s*条/g,
    keys: ["city_entries", "cities_real", "spots", "experiences"] },
  { doc: "考核计划书", what: "评级条数 / 覆盖城 / 美食城店",
    re: /景点评级\s*([\d,]+)\s*条（覆盖\s*(\d+)\s*座城市），美食\s*([\d,]+)\s*家覆盖\s*(\d+)\s*座城市/g,
    keys: ["spot_info", "spot_cities", "food_shops", "food_cities"] },
  // 交付材料里的体积用 MB 一位小数：改动代码会让 KB 逐位漂移（561→564），
  // 若材料写死 KB，任何一次插桩都要重做材料。MB 一位小数只在跨 0.1MB 时才变，
  // 既不牺牲可核对性，也不会把「改一行代码」变成「改三个文件」。
  { doc: "考核计划书", what: "主包 / 分包合计 / 总包体（MB）",
    re: /主包\s*([\d.]+)MB（压缩后），分包合计\s*([\d.]+)MB，总包体约\s*([\d.]+)MB/g,
    keys: ["main_gzip_kb", "sub_gzip_total_kb", "total_gzip_kb"] },
];

console.log("【文档数字 vs 实测真值】");
const noNum = (s) => Number(String(s).replace(/,/g, ""));
// 体积类锚点允许「换算」：文档写 MB、脚本给 KB。
const KB2MB = (v) => Math.round(v / 1024 * 10) / 10;   // KB → MB（一位小数）
const CONVERT = {
  pkg_subdata_raw_kb: KB2MB,
  main_gzip_kb: KB2MB,
  sub_gzip_total_kb: KB2MB,
  total_gzip_kb: KB2MB,
};
let hitTotal = 0;
const badHits = [];
const missingAnchors = [];
for (const a of ANCHORS) {
  const t = texts[a.doc];
  if (t == null) continue; // 材料不存在（CI）→ 不追责
  const ms = [...t.matchAll(a.re)];
  if (ms.length === 0) { missingAnchors.push(a.doc + "｜" + a.what); continue; }
  for (const m of ms) {
    hitTotal++;
    a.keys.forEach((k, i) => {
      const got = noNum(m[i + 1]);
      const want = CONVERT[k] ? CONVERT[k](F[k]) : F[k];
      if (got !== want) badHits.push(a.doc + "｜" + a.what + "：" + m[i + 1] + " ≠ 实测 " + want + "（" + k + "）");
    });
  }
}
ok("全部锚点都有命中（措辞改动会让门禁静默失效，故此处判红）",
  missingAnchors.length === 0, missingAnchors.slice(0, 6).join(" ; "));
ok("共 " + hitTotal + " 处文档数字全部等于实测真值", badHits.length === 0, badHits.slice(0, 8).join(" ; "));

/* ───────── ④ 过期数字黑名单：换个说法也不能留旧值 ───────── */
// 只放「已确认过期且不会作为合法内容出现」的串。刻意不用裸数字（如 404 会撞 HTTP 404）。
const STALE = [
  "660KB", "1828KB", "2258KB", "258KB ·", "45KB ·", "1.7MB ·", "153.7KB",
  "26,357", "26357 条", "751 座", "751 城", "404 座城市", "403 座城市",
  "404 城 6880 家", "覆盖 404 城", "326 城降级", "156 家 / 125 城", "近似空包",
  "合计约 2.1MB",
  // 注意：`约 2.8MB` 曾在黑名单里（当时总包缩到 2.7MB）。v1.20.27 加了 7 枚图标与代码后
  // 总包 gzip 又回到 2.8MB —— 真值回来了，黑名单就必须删掉这条，否则门禁会「自己判自己过期」。
  // 黑名单只放仍确认过期的值；数字变回真值时同步删除，这不是放松门禁。
];
console.log("【过期数字黑名单】");
const staleHits = [];
for (const [label] of ACTIVE) {
  for (const s of STALE) if (texts[label].indexOf(s) >= 0) staleHits.push(label + "：" + s);
}
ok(ACTIVE.length + " 份材料无过期数字", staleHits.length === 0, staleHits.slice(0, 8).join(" ; "));

/* ───────── ⑤ 元断言：文档必须指明真值来源（防「只留数字、不留出处」） ───────── */
console.log("【真值来源可追溯】");
const readme = texts["仓库 README"] || "";
ok("README 指明体积真值来自 check-pkgsize", readme.indexOf("check-pkgsize.mjs") >= 0);
ok("README 指明规模真值来自 check-health", readme.indexOf("check-health.mjs") >= 0);
ok("README 说明文档数字由脚本产出、不手写", readme.indexOf("数字真值") >= 0);

console.log("");
if (fail === 0) {
  console.log("文档数字口径门禁通过：" + pass + " 项（" + hitTotal + " 处数字与实测一致）");
  process.exit(0);
}
console.log("文档数字口径门禁失败：" + fail + " 项 / 共 " + (pass + fail) + " 项");
process.exit(1);
