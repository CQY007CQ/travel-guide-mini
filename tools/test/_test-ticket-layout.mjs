#!/usr/bin/env node
/**
 * tools/test/_test-ticket-layout.mjs —— v1.19.203 行前准备「门票清单」逐字竖排回归
 *
 * 背景：用户模拟器截图报障——门票清单里「晋阳湖公园」显示成
 *   首行「晋免费（多数公园免费开放，个别象征性收费，以现场为准）」，
 *   然后「阳」「湖」「公」「园」逐字竖排，where 说明也逐字竖排，行程名完全读不出来。
 *
 * 根因：SPOT_TICKETS 4617 条里有 3889 条票价带括号补充说明（「¥30（联票¥60）」
 *   「免费（多数公园免费开放…）」），整串塞进 .tk-price；该列 flex-shrink:0 且无宽度上限
 *   → 吃掉整行宽度，.tk-main 被压到 1 个字宽，中文在窄容器里只能逐字换行。
 *
 * 修复：① T.splitTicketPrice() 把票价拆成「主值 + 补充说明」，主值 ≤12 字并按标点断；
 *   ② 补充说明与 where 语义重复（文本重叠 ≥5 字）时丢弃，避免同屏说两遍；
 *   ③ CSS 侧 max-width + nowrap + ellipsis 三重兜底，任何数据都撑不爆布局。
 *
 * 断言：全量 4617 条票价拆分后主值 ≤12 字且非空、典型样例、note 去重规则、
 *   WXSS / WXML / prep.js 静态护栏、版本一致性。
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import path from "path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const req = createRequire(fileURLToPath(import.meta.url));
const T = req("../../utils/travel.js");

let fail = 0, n = 0;
const ok = (name, cond, extra = "") => {
  n++;
  if (cond) return;
  fail++;
  console.log("  ✗ FAIL: " + name + (extra ? "  → " + extra : ""));
};

const whereOf = (v) => (v && v.where && v.where !== "—") ? v.where : "";
const spOf = (name) => {
  const v = (T.D && T.D.SPOT_TICKETS && T.D.SPOT_TICKETS[name]) || {};
  return T.splitTicketPrice(v.p, whereOf(v));
};

/* ---------- 1. 单一真源函数可用 ---------- */
ok("utils/travel.js 导出 splitTicketPrice", typeof T.splitTicketPrice === "function");

const D = (T.D && T.D.SPOT_TICKETS) || {};
const keys = Object.keys(D);
ok("SPOT_TICKETS 随包加载（≥4000 条）", keys.length >= 4000, "实得 " + keys.length);

/* ---------- 2. 全量数据：主值必须短且非空 ---------- */
let over = 0, empty = 0, longest = "", withNote = 0;
keys.forEach(k => {
  const v = D[k] || {};
  const r = T.splitTicketPrice(v.p, whereOf(v));
  if (!r.price) empty++;
  if (r.price.length > 12) over++;
  if (r.price.length > longest.length) longest = r.price;
  if (r.note) withNote++;
});
ok("全量票价拆分后主值均 ≤12 字（不会再撑爆票价列）", over === 0,
  "超标 " + over + " 条，最长 " + JSON.stringify(longest));
ok("全量票价拆分后主值均非空", empty === 0, "空值 " + empty + " 条");
ok("补充说明仍被保留（不是一刀切丢掉）", withNote >= 500, "带 note " + withNote + " 条");

/* ---------- 3. 典型样例（用户报障那几条） ---------- */
{
  const r = spOf("晋阳湖公园");
  ok("晋阳湖公园：主值只剩「免费」", r.price === "免费", JSON.stringify(r));
  ok("晋阳湖公园：长免费条款与 where 重复时丢弃", r.note === "", JSON.stringify(r.note));
}
{
  const r = spOf("汾河公园");
  ok("汾河公园：主值只剩「免费」", r.price === "免费", JSON.stringify(r));
}
{
  const r = spOf("五一广场");
  ok("五一广场：本身就是纯「免费」，保持原样", r.price === "免费" && r.note === "", JSON.stringify(r));
}
{
  const r = spOf("颐和园");
  ok("颐和园：主值 ¥30", r.price === "¥30", r.price);
  ok("颐和园：联票信息保留为补充说明", r.note === "联票¥60", r.note);
}
{
  const r = spOf("广州塔");
  ok("广州塔：主值含「起」", /¥150\s*起/.test(r.price.replace(/\s/g, "")), r.price);
  ok("广州塔：观景说明进 note", r.note === "观景", r.note);
}
{
  const r = spOf("周庄古镇");
  ok("周庄古镇：夜游价进 note", r.price === "¥100" && r.note === "夜游¥80", JSON.stringify(r));
}
{
  const r = spOf("灵隐寺");
  ok("灵隐寺：含飞来峰进 note", r.price === "¥75" && r.note === "含飞来峰", JSON.stringify(r));
}
{
  const r = spOf("故宫博物院");
  ok("故宫：分季票价被拆开且数字没丢", r.price.length <= 12 && r.price.length > 0
    && (/\d/.test(r.price) || /\d/.test(r.note)), JSON.stringify(r));
}
{
  const r = T.splitTicketPrice("", "");
  ok("空票价兜底为「—」不抛错", r.price === "—", JSON.stringify(r));
  const r2 = T.splitTicketPrice(null);
  ok("null 票价兜底为「—」不抛错", r2.price === "—", JSON.stringify(r2));
}

/* ---------- 4. 票价列 CSS 兜底（防回潮核心） ---------- */
const wxss = read("subpkg/prep/prep.wxss");
const priceRule = (wxss.match(/\.tk-price\s*\{[^}]*\}/) || [""])[0];
ok("票价列有宽度上限（max-width）", /max-width\s*:\s*\d+%/.test(priceRule), priceRule);
ok("票价列不换行 + 溢出省略", /white-space\s*:\s*nowrap/.test(priceRule)
  && /overflow\s*:\s*hidden/.test(priceRule) && /text-overflow\s*:\s*ellipsis/.test(priceRule), priceRule);
ok("票价列固定不伸缩（flex:0 0 auto）", /flex\s*:\s*0\s+0\s+auto/.test(priceRule), priceRule);
const mainRule = (wxss.match(/\.tk-main\s*\{[^}]*\}/) || [""])[0];
ok("主区保留 min-width:0（flex 子项可收缩）", /min-width\s*:\s*0/.test(mainRule), mainRule);
ok("补充说明有独立样式 .tk-pnote", /\.tk-pnote\s*\{[^}]*\}/.test(wxss));

/* ---------- 5. WXML / 逻辑侧护栏 ---------- */
const wxml = read("subpkg/prep/prep.wxml");
ok("wxml 渲染主值 item.price", /class="tk-price"[^>]*>\{\{item\.price\}\}/.test(wxml));
ok("wxml 渲染补充说明 item.priceNote", /class="tk-pnote"[^>]*>.*item\.priceNote/.test(wxml));
const prepJs = read("subpkg/prep/prep.js");
ok("prep.js 走单一真源 T.splitTicketPrice", /T\.splitTicketPrice\s*\(/.test(prepJs));
ok("prep.js 不再把原始票价整串塞进 price", !/price:\s*info\.p\b/.test(prepJs));

/* ---------- 6. 版本一致性（动态真值，禁止写死） ---------- */
const ver = (s) => (s.match(/APP_VER\s*=\s*"([^"]+)"/) || [])[1];
const cfgVer = JSON.parse(read("project.config.json")).version;
ok("真源 / 产物 / project.config.json 版本一致",
  ver(read("tools/_src-backup/travel.js")) === cfgVer && ver(read("utils/travel.js")) === cfgVer,
  [ver(read("tools/_src-backup/travel.js")), ver(read("utils/travel.js")), cfgVer].join(" / "));

console.log("  门票清单布局回归: " + (n - fail) + "/" + n + " 通过");
if (fail) process.exit(1);
console.log("  ✔ 逐字竖排根因已固化为护栏（数据拆分 + CSS 限宽）");
