/**
 * tools/audit/_test-hardening.mjs —— 深度审计「高严重·纯防御」项运行时单测
 *
 * 覆盖 2026-11-09 落地的四条真源加固（跑的是随包压缩产物 utils/travel.js，不是真源草稿）：
 *   #11/#12 parseQuickBill 金额有限性与业务上限
 *   #14     addLedger 非法金额不得入库
 *   #16     exportLedgerCSV 标准转义 + Excel/WPS 公式注入防护
 *   #15/#65 importBackup 内容级净化（原先只校验顶层是数组）
 *
 * 挂在 allcheck 已有的「审计整改防回潮断言」步，不新增 step —— 61 步口径与考核材料无需改动。
 */
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const mem = new Map();
global.wx = {
  getStorageSync(k) { return mem.has(k) ? mem.get(k) : ""; },
  setStorageSync(k, v) { mem.set(k, v); },
  removeStorageSync(k) { mem.delete(k); },
  getStorageInfoSync() { return { keys: [...mem.keys()], currentSize: 0, limitSize: 10240 }; },
  getSystemInfoSync() { return { windowWidth: 375, pixelRatio: 2, platform: "devtools" }; },
  showToast() {}, showModal() {}
};

const T = require(path.join(ROOT, "utils/travel.js"));
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name + (extra !== undefined ? "  → " + String(extra).slice(0, 160) : "")); }
}
const reset = () => mem.clear();

// ── #11/#12 金额边界 ──
reset();
ok("#11/#12 合法金额不回潮（午餐88元）", (T.parseQuickBill("午餐88元") || {}).amt === 88,
  JSON.stringify(T.parseQuickBill("午餐88元")));
ok("#11/#12 既有语义保留（第3天 早餐15元）", (T.parseQuickBill("第3天 早餐15元") || {}).amt === 15,
  JSON.stringify(T.parseQuickBill("第3天 早餐15元")));
ok("#11/#12 超大金额拒绝（原会入库 1e30）", T.parseQuickBill("打车999999999999999999999999元") === null);
ok("#11/#12 零金额仍拒绝", T.parseQuickBill("0元") === null);

// ── #14 addLedger 非法金额 ──
reset();
const before = T.getLedger().length;
T.addLedger(Infinity, "餐饮", "脏数据");
T.addLedger(NaN, "餐饮", "脏数据");
T.addLedger(-5, "餐饮", "脏数据");
ok("#14 Infinity / NaN / 负数一律不入库", T.getLedger().length === before, "len=" + T.getLedger().length);
T.addLedger(88.555, "餐饮", "午餐");
const rec = T.getLedger()[0];
ok("#14 合法金额正常入库且两位小数", rec && rec.amt === 88.56, JSON.stringify(rec && rec.amt));

// ── #16 CSV 转义与公式注入 ──
reset();
T.addLedger(88, "餐饮", '午餐, "招牌" 菜');
const csv = T.exportLedgerCSV();
const dataLine = csv.split("\n")[1] || "";
ok("#16 内部双引号翻倍", dataLine.indexOf('""招牌""') >= 0, dataLine);
ok("#16 半角逗号保真（旧版被替换成全角）", dataLine.indexOf("午餐, ") >= 0, dataLine);
ok("#16 七个字段均被双引号包裹", /^"(?:[^"]|"")*"(?:,"(?:[^"]|"")*"){6}$/.test(dataLine), dataLine);
reset();
T.addLedger(12, "餐饮", '=HYPERLINK("http://x","点我")');
const csv2 = T.exportLedgerCSV();
ok("#16 公式注入被前缀阻断", csv2.indexOf("'=HYPERLINK") >= 0, csv2.split("\n")[1]);
reset();
T.addLedger(12, "餐饮", "+SUM(1+1)");
ok("#16 加号开头同样阻断", T.exportLedgerCSV().indexOf("'+SUM") >= 0);

// ── #15/#65 importBackup 内容级净化 ──
reset();
const dirty = {
  v: 1,
  plan: { days: [
    { title: "D1", items: [{ name: "景点A" }, "脏字符串", null, 42, { name: "X".repeat(500) }] },
    "脏天", null, 7,
    { title: "D2", items: "不是数组" }
  ] },
  ledger: [{ amt: 10, name: "正常" }, "脏记录", null, 5]
};
let r = null, err = "";
try { r = T.importBackup(JSON.stringify(dirty)); } catch (e) { err = e.message; }
ok("#15/#65 脏备份不再抛异常", !err, err);
ok("#15/#65 非法「天」被过滤，仅剩 2 天", !!(r && r.plan && r.plan.days.length === 2),
  r && r.plan && r.plan.days.length);
ok("#15/#65 非法景点条目被过滤，仅剩 2 条", !!(r && r.plan.days[0].items.length === 2),
  r && r.plan.days[0].items.length);
ok("#15/#65 超长景点名截断到 200", !!(r && r.plan.days[0].items[1].name.length === 200),
  r && r.plan.days[0].items[1].name.length);
ok("#15/#65 items 非数组被归一为 []", !!(r && Array.isArray(r.plan.days[1].items) && r.plan.days[1].items.length === 0));
ok("#15/#65 合法备份照常返回 hasPlan", !!(r && r.hasPlan && r.count > 0), JSON.stringify(r && { c: r.count, p: r.hasPlan }));

// ── v1.20.6 本地速查：穿衣建议不得混入「适宜时节」──
// 症状：问「穿衣」时把城市「最佳时节」也拼进穿衣建议（太原 best=4-5月…即触发），
//       行程页已过滤，但「本地速查」页没过滤 → 用户看到穿衣建议里冒出适宜时节。
// 修法：clothAdvice 只讲「怎么穿」；askAssistant 仅在问「季节/几月/几时」时单独给适宜时节。
const _ty = T.findCity("太原");
ok("v1.20.6 穿衣建议不含「适宜时节」", !!_ty && (T.clothAdvice(_ty) || "").indexOf("适宜时节") < 0);
const _fp = { cityName: "太原", days: [{ items: [] }], depart: "2027-04-05", budget: "mid", people: 2 };
ok("v1.20.6 问穿衣答复不含「适宜时节」", (T.askAssistant("太原穿衣穿什么", _fp).text || "").indexOf("适宜时节") < 0);
ok("v1.20.6 问季节答复保留「适宜时节」", (T.askAssistant("太原什么季节去好", _fp).text || "").indexOf("适宜时节") >= 0);

// ── v1.20.6 北方 11 月穿衣按冬季（不再给薄外套），南方不误伤 ──
// 用指定日期的 dressForMonth 断言（不受运行当月影响）；覆盖华北/华东/高原三类。
const _ty2 = T.findCity("太原"), _sh = T.findCity("上海"), _ls = T.findCity("拉萨");
ok("v1.20.6 太原(华北)11月按冬季（羽绒服）", !!_ty2 && T.dressForMonth(_ty2, "2026-11-09").season === "冬季出行");
ok("v1.20.6 上海(华东)11月仍按秋季（不误伤南方）", !!_sh && T.dressForMonth(_sh, "2026-11-09").season === "秋季出行");
ok("v1.20.6 拉萨(高原)11月按冬季", !!_ls && T.dressForMonth(_ls, "2026-11-09").season === "冬季出行");

// ── v1.20.6 深度玩法：目标地未收录时显式提示（不再静默换成别的城市）──
const DD = require(path.join(ROOT, "subai/data/ai-deep.js"));
ok("v1.20.6 深度内容含太原（4 块）", !!(DD.cities && DD.cities["太原"] && (DD.cities["太原"].blocks || []).length === 4));
ok("v1.20.6 深度内容含大同/晋中", !!(DD.cities && DD.cities["大同"] && DD.cities["晋中"]));
const _deepSrc = fs.readFileSync(path.join(ROOT, "subai/deep/deep.js"), "utf8");
ok("v1.20.6 深度页未收录显式提示（无静默换城）",
  _deepSrc.includes("暂未收录深度玩法") && !/if \(!curName \|\| !A\.hasDeep\(curName\)\) curName = cities\[0\]/.test(_deepSrc));
// 路由参数是 URL 编码过的（plan 页 encodeURIComponent），页面必须解码，否则会显示 %E5%8C%97%E4%BA%AC
ok("v1.20.6 深度页解码 city 路由参数", /decodeURIComponent\(want\)/.test(_deepSrc));

// ── v1.20.6 行程编辑：删空某天后加景点要按 上午/下午/晚上 依次分配（不再堆同一时段）──
await T.ready();
{
  const _dp = T.buildPlan({ city: "成都", days: 4, depart: "2027-04-05", budget: "mid", pace: "balance" });
  const _pl = { cityName: "成都", days: _dp, depart: "2027-04-05", budget: "mid", people: 2, pace: "balance" };
  let _g = 0;
  while (_g++ < 20) { let last = -1; _pl.days[2].items.forEach((it, i) => { if (!T.isFrameName(it.name)) last = i; }); if (last < 0) break; T.dayRemoveSpot(_pl, 2, last); }
  const _per = [];
  for (let k = 0; k < 3; k++) { const c = T.dayAddCandidates(_pl, 2, ""); if (!c.length) break; const r = T.dayAddSpot(_pl, 2, c[0]); const it = _pl.days[2].items.find(x => x.name === r.name); _per.push(it && it.period); }
  ok("v1.20.6 删空后加景点按时段依次分配", _per[0] === "上午" && _per[1] === "下午" && _per[2] === "晚上", _per.join("/"));
  ok("v1.20.6 景点详情不含「同城参考」", (T.baikeInfo("八达岭", "北京").text || "").indexOf("同城参考") < 0);
}

// ── v1.20.6 数据规模卡：城市数已去重（不再把别名算成城市），且气候/区域分布合计=城市数 ──
{
  const _cp = require(path.join(ROOT, "utils/corpus.js"));
  const _cs = _cp.corpusStats();
  ok("v1.20.6 规模卡城市数已去重（< CITIES 条目数）", _cs.cities > 0 && _cs.cities < (T.D.CITIES || []).length, String(_cs.cities));
  ok("v1.20.6 气候/区域分布合计=城市数",
    _cs.climate.reduce((a, b) => a + b.n, 0) === _cs.cities && _cs.region.reduce((a, b) => a + b.n, 0) === _cs.cities);
}

// ── v1.20.6 日历：小程序无写系统日历 API → 失败要落到 .ics 文件（不能只弹一句提示）──
{
  const _planSrc2 = fs.readFileSync(path.join(ROOT, "pages/plan/plan.js"), "utf8");
  ok("v1.20.6 日历写入失败时提供 .ics 文件", /_shareICS\(plan\)/.test(_planSrc2) && /shareFileMessage/.test(_planSrc2));
  // 深度卡：切行程后必须清空/丢弃旧结果，否则会出现「井冈山行程显示太原深度玩法」
  ok("v1.20.6 深度卡不残留旧城市",
    /_planSig\(cur\)\s*!==\s*sig/.test(_planSrc2) && /if \(!hit\) \{ clear\(\); return; \}/.test(_planSrc2));
}

// ── v1.20.6 本机数据洞察：未加载不渲染空壳（回退 null）+ 分包模块到位后主动 refresh ──
{
  const _moreSrc = fs.readFileSync(path.join(ROOT, "pages/more/more.js"), "utf8");
  ok("v1.20.6 洞察未加载回退 null（不渲染空卡）", /insights:\s*INS\s*\?\s*INS\.insights\(\)\s*:\s*null/.test(_moreSrc));
  ok("v1.20.6 分包模块加载后主动 refresh", /_preloadMoreMods\(this\)/.test(_moreSrc) && /page\s*&&\s*page\.refresh/.test(_moreSrc));
}

console.log("");
if (fail > 0) {
  console.log("审计加固运行时单测失败：" + fail + " 项 / 共 " + (pass + fail) + " 项");
  process.exit(1);
}
console.log("审计加固运行时单测通过：" + pass + " 项");
