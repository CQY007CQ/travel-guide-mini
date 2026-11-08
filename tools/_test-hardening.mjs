/**
 * tools/_test-hardening.mjs —— 深度审计「高严重·纯防御」项运行时单测
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
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

console.log("");
if (fail > 0) {
  console.log("审计加固运行时单测失败：" + fail + " 项 / 共 " + (pass + fail) + " 项");
  process.exit(1);
}
console.log("审计加固运行时单测通过：" + pass + " 项");
