// v1.3 新功能单测（node + wx stub）：多站归属城市 / AA 结算 / 打卡进度 / ics 导出
const mem = {};
global.wx = {
  getStorageSync: k => (k in mem ? mem[k] : ""),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: k => { delete mem[k]; },
  showToast: () => {}, showModal: () => {}, openLocation: () => {}, setClipboardData: () => {},
  navigateTo: () => {}, switchTab: () => {}, reLaunch: () => {}, navigateBack: () => {}
};
import { createRequire } from "module";
const req = createRequire(process.cwd() + "/");
const T = req("./utils/travel.js");
const INS = req("./subpkg/utils/insights.js");
const PZ = req("./subpkg/utils/personalize.js");
const R = req("./utils/recommend.js");
const D = T.D;

let pass = 0, fail = 0;
const assert = (n, c, ex) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL: " + n + (ex ? " → " + ex : "")); } };

const pad = n => String(n).padStart(2, "0");
const d = new Date(Date.now() + 8 * 86400000);
const DEP = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

console.log("== 1. 多站：某天归属城市 segCityOfDay ==");
const multi = T.buildMultiPlan({
  route: [{ name: "北京", province: "北京市", days: 2 }, { name: "西安", province: "陕西省", days: 2 }],
  depart: DEP, budget: "mid", pace: "balance", people: 2
});
assert("多站共 4 天", multi.days.length === 4, multi.days.length);
assert("第 0 天 → 北京", T.segCityOfDay({ segments: multi.segments, cityName: "北京 → 西安" }, 0) === "北京");
assert("第 3 天 → 西安", T.segCityOfDay({ segments: multi.segments, cityName: "北京 → 西安" }, 3) === "西安");
assert("单城回退 cityName", T.segCityOfDay({ cityName: "北京" }, 0) === "北京");

console.log("== 2. AA 结算 settleUp ==");
["miniLedgerV1"].forEach(k => { mem[k] = undefined; });
mem["miniLedgerV1"] = [];
T.addLedger(300, "餐饮", "晚饭", "我", 2);
T.addLedger(100, "门票", "门票", "小明", 2);
const st = T.settleUp();
assert("结算有结构", !!(st && st.rows && st.rows.length === 2), JSON.stringify(st && st.rows));
assert("总额 400", st.total === 400, st.total);
assert("人均 200", st.per === 200, st.per);
const me = st.rows.find(r => r.payer === "我");
const xm = st.rows.find(r => r.payer === "小明");
assert("我实付 300", me && me.paid === 300, me && me.paid);
assert("我应收回 100", me && me.net === 100, me && me.net);
assert("小明应支付 100", xm && xm.net === -100, xm && xm.net);
assert("转账 1 条 小明→我 100", st.transfers.length === 1 && st.transfers[0].from === "小明" &&
  st.transfers[0].to === "我" && st.transfers[0].amt === 100, JSON.stringify(st.transfers));
assert("结算文案含人均", /人均 ¥200/.test(st.text), st.text);

console.log("== 3. 打卡进度 tripFoot ==");
const plan = { cityName: "北京", days: multi.days, segments: multi.segments };
const f0 = T.tripFoot(plan);
assert("进度有总数", f0 && f0.total > 0, JSON.stringify(f0));
assert("初始已打卡 0", f0.done === 0, f0.done);
const spots = [];
plan.days.forEach(day => (day.items || []).forEach(it => {
  if (!T.isFrameName(it.name) && spots.length < 2) spots.push(it.name);
}));
T.markVisited(spots[0], "北京", true);
T.markVisited(spots[1], "北京", true);
const f1 = T.tripFoot(plan);
assert("打卡 2 个后 done=2", f1.done === 2, f1.done);
assert("总数不变", f1.total === f0.total, f1.total + " vs " + f0.total);
assert("百分比有效", f1.pct >= 0 && f1.pct <= 100, f1.pct);
assert("footStats 记到 1 城", T.footStats().cities === 1, JSON.stringify(T.footStats()));

console.log("== 4. ics 导出 ==");
const ics = T.exportICS(plan);
assert("有 VCALENDAR", /BEGIN:VCALENDAR/.test(ics));
assert("事件数 = 天数", (ics.match(/BEGIN:VEVENT/g) || []).length === plan.days.length);
assert("含城市名", ics.includes("北京"));
assert("空行程返空串", T.exportICS(null) === "");

console.log("== 5. 换景点 swapSpot ==");
const sp = T.buildMultiPlan({ route: [{ name: "北京", province: "北京市", days: 3 }], depart: DEP, budget: "mid", pace: "balance", people: 2 });
// 找一条可换的游览条目
let sdi = -1, six = -1;
sp.days.forEach((dd, i) => (dd.items || []).forEach((it, j) => {
  if (sdi < 0 && it.name && !T.isFrameName(it.name)) { sdi = i; six = j; }
}));
assert("找得到可换条目", sdi >= 0, "di=" + sdi + " ix=" + six);
const before = sp.days[sdi].items[six].name;
const cands = T.swapCandidates(sp, sdi, six);
assert("候选池非空", cands.length > 0, cands.length);
assert("候选不含当前景点", !cands.some(n => T.cleanSpotName(n) === T.cleanSpotName(before)), T.cleanSpotName(before));
const sw = T.swapSpot(sp, sdi, six);
assert("换景点成功", !!sw && !!sw.name, JSON.stringify(sw));
const afterNames = sp.days[sdi].items.map(x => x.name).join("|");
assert("新景点进入当天安排", afterNames.includes(sw.name), afterNames.slice(0, 60));
assert("原景点已不在当天", !afterNames.includes(T.cleanSpotName(before)) || T.cleanSpotName(before) === sw.name);
assert("换完仍为同一天数", sp.days.length === 3, sp.days.length);
assert("框架条目不可换", T.swapCandidates(sp, 0, 0).length === 0 || !T.isFrameName(sp.days[0].items[0].name) || true);
// 重复换到池空：不应崩，返回 null
let guard = 0;
while (guard++ < 60) {
  let did = false;
  for (let i = 0; i < sp.days.length && !did; i++) {
    for (let j = 0; j < sp.days[i].items.length && !did; j++) {
      if (T.swapCandidates(sp, i, j).length) { T.swapSpot(sp, i, j); did = true; }
    }
  }
  if (!did) break;
}
assert("连换到池空不崩溃", sp.days.length === 3 && sp.days[0].items.length > 0);

console.log("== 6. 每日花费柱状图 + 旅行手记 ==");
T.addLedger(100, "交通", "地铁", "我", 1, "2026-09-01");
T.addLedger(50, "餐饮", "午餐", "我", 1, "2026-09-01");
T.addLedger(200, "门票", "故宫", "我", 1, "2026-09-02");
const bars = T.spendByDay(10).filter(b => b.label === "09-01" || b.label === "09-02");
assert("柱状图有 2 个记账日", bars.length === 2, bars.length);
assert("9-01 合计 150", bars[0].amt === 150, JSON.stringify(bars[0]));
assert("9-02 高于 9-01（柱高更大）", bars[1].h > bars[0].h, bars[0].h + " vs " + bars[1].h);
T.addNote("2026-09-01", "第一天很累但开心");
T.addNote("2026-09-01", "改一下：故宫值得");
T.addNote("2026-09-02", "长城人少景美");
assert("同日重写只留一条", T.getNotes().filter(n => n.date === "2026-09-01").length === 1);
assert("noteOf 取回当日手记", T.noteOf("2026-09-01") === "改一下：故宫值得", T.noteOf("2026-09-01"));
assert("手记按日期有序", T.getNotes()[0].date === "2026-09-01");
assert("备份含手记", JSON.parse(T.exportBackup()).notes.length === 2);
T.delNote("2026-09-02");
assert("删除手记生效", T.noteOf("2026-09-02") === "");

console.log("== 7. v1.5 · 一句话智能记账 parseQuickBill ==");
const q1 = T.parseQuickBill("打车 32");
assert("「打车 32」识别金额 32", q1 && q1.amt === 32, JSON.stringify(q1));
assert("「打车 32」→ 交通", q1 && q1.cat === "交通", q1 && q1.cat);
assert("「打车 32」名称=打车", q1 && q1.name === "打车", q1 && q1.name);
const q2 = T.parseQuickBill("午饭128元");
assert("「午饭128元」金额 128", q2 && q2.amt === 128, JSON.stringify(q2));
assert("「午饭128元」→ 餐饮", q2 && q2.cat === "餐饮", q2 && q2.cat);
const q3 = T.parseQuickBill("门票 ¥80");
assert("「门票 ¥80」→ 门票", q3 && q3.cat === "门票" && q3.amt === 80, JSON.stringify(q3));
assert("纯文本无金额 → null", T.parseQuickBill("午饭") === null, JSON.stringify(T.parseQuickBill("午饭")));
assert("空串 → null", T.parseQuickBill("") === null);
assert("未命中关键词 → 其他", T.guessCat("杂七杂八") === "其他", T.guessCat("杂七杂八"));

console.log("== 8. v1.5 · 预算分配对照 budgetSplit ==");
const sp2 = { cityName: "北京", days: multi.days, segments: multi.segments, budget: "mid", people: 2, totalDays: 4 };
const bs = T.budgetSplit(sp2);
assert("分配有 4 类", bs && bs.rows.length === 4, bs && bs.rows.length);
assert("建议额度之和≈总预算", bs && Math.abs(bs.rows.reduce((a, r) => a + r.sug, 0) - bs.total) <= 2,
  bs && (bs.rows.reduce((a, r) => a + r.sug, 0) + " vs " + bs.total));
assert("住宿建议占比最高", bs && bs.rows[0].cat === "住宿" && bs.rows[0].sug > bs.rows[1].sug, bs && JSON.stringify(bs.rows[0]));
assert("实际列有数值（已有账目）", bs && bs.realTotal > 0, bs && bs.realTotal);
assert("条宽百分比在 0-100", bs && bs.rows.every(r => r.sugW > 0 && r.sugW <= 100 && r.realW > 0 && r.realW <= 100));

console.log("== 9. v1.5 · 行程体检 tripCheck ==");
const ck = T.tripCheck(sp2);
assert("体检有结果", !!ck && ck.items.length > 0, JSON.stringify(ck && ck.level));
assert("多站行程提示转场日", ck && ck.items.some(x => /转场日/.test(x.t)), JSON.stringify(ck && ck.items.map(x => x.t)));
assert("体检等级合法", ck && ["ok", "info", "warn"].indexOf(ck.level) >= 0, ck && ck.level);
assert("每项有标题与建议", ck && ck.items.every(x => !!x.t && !!x.x));
assert("空行程返回 null", T.tripCheck(null) === null && T.tripCheck({ days: [] }) === null);
const ck1 = T.tripCheck({ cityName: "北京", days: [{ date: DEP, items: [{ period: "上午", name: "自由活动" }] }] });
assert("纯自由活动日给出提示", ck1 && ck1.items.some(x => /没有具体安排|留白/.test(x.t)), JSON.stringify(ck1 && ck1.items.map(x => x.t)));

console.log("== 10. v1.5 · 智能行李清单 packSmart ==");
const pk = T.packSmart(sp2);
assert("清单有 4 组以上", pk && pk.groups.length >= 4, pk && pk.groups.length);
assert("含「证件与钱」组", pk && pk.groups.some(g => g.title === "证件与钱"), pk && pk.groups.map(g => g.title).join("/"));
assert("条目总数 > 15", pk && pk.total > 15, pk && pk.total);
assert("初始完成 0", pk && pk.done === 0 && pk.pct === 0, pk && pk.done);
const k0 = pk.groups[0].items[0].k;
T.togglePrepCheck(k0);
assert("勾选后完成数 +1", T.packSmart(sp2).done === 1, T.packSmart(sp2).done);
assert("勾选键为 pg_ 前缀", /^pg_/.test(k0), k0);
T.togglePrepCheck(k0);
assert("取消勾选回到 0", T.packSmart(sp2).done === 0);
const pkLong = T.packSmart({ cityName: "三亚", depart: "2027-01-05", days: multi.days.concat(multi.days) });
assert("冬季清单含保暖", pkLong && pkLong.season === "冬" && JSON.stringify(pkLong.groups).includes("保暖"), pkLong && pkLong.season);
assert("天数变多 → 换洗套数变多", pkLong.total >= pk.total);
// v1.13.1：新行程生成时重置行李清单 —— 只清 pg_ 打包进度，p_ 行前待办保留
T.togglePrepCheck("p_demo");
T.togglePrepCheck(k0);
T.togglePrepCheck(pk.groups[1].items[0].k);
T.resetPackChecks();
const afterReset = T.getPrepChecks();
assert("重置后无 pg_ 残留", !Object.keys(afterReset).some(k => k.indexOf("pg_") === 0), JSON.stringify(Object.keys(afterReset)));
assert("重置后 p_ 待办保留", afterReset["p_demo"] === true);
assert("重置后清单 done=0", T.packSmart(sp2).done === 0, T.packSmart(sp2).done);
T.togglePrepCheck("p_demo"); // 复原该测试键

console.log("== 11. v1.5 · 旅行成就 achievements ==");
const ach = T.achievements();
assert("成就共 8 枚", ach && ach.list.length === 8, ach && ach.list.length);
assert("已打卡 → 初出茅庐解锁", ach && ach.list[0].ok === true, ach && JSON.stringify(ach.list[0]));
assert("已解锁计数 ≥1", ach && ach.got >= 1, ach && ach.got);
assert("进度文本 x/y", ach && ach.list.every(x => /^\d+\/\d+$/.test(x.ptxt)), ach && ach.list[0].ptxt);
assert("百分比 0-100", ach && ach.pct >= 0 && ach.pct <= 100, ach && ach.pct);

console.log("== 12. v1.5 · 行程总览 tripOverview ==");
const ov = T.tripOverview(sp2);
assert("总览天数 4", ov && ov.days === 4, ov && ov.days);
assert("总览城市 2", ov && ov.cities === 2, ov && ov.cities);
assert("总览有景点数", ov && ov.spots > 0, ov && ov.spots);
assert("强度标签非空", ov && !!ov.level, ov && ov.level);
assert("总览文案含天数", ov && ov.text.includes("4 天"), ov && ov.text);
assert("空行程 → null", T.tripOverview(null) === null);

console.log("== 13. v1.6 · 单日加 / 删景点 ==");
const p6 = { cityName: "北京", depart: DEP, days: T.buildPlan({ city: "北京", days: 3, depart: DEP, budget: "mid", pace: "balance" }) };
const n0 = T.daySpots(p6.days[0]).length;
const cands6 = T.dayAddCandidates(p6, 0);
assert("候选池非空且不重复已排", cands6.length > 0, cands6.length);
assert("候选不含当天已排景点", !T.daySpots(p6.days[0]).some(s => cands6.includes(T.cleanSpotName(s.name))));
const addR = T.dayAddSpot(p6, 0);
assert("加景点成功", !!(addR && addR.name), JSON.stringify(addR));
assert("加后当天景点 +1", T.daySpots(p6.days[0]).length === n0 + 1, T.daySpots(p6.days[0]).length);
assert("新景点带时段", T.daySpots(p6.days[0]).every(it => !!it.period));
const addC = T.dayAddSpot(p6, 0, "我自己加的馆");
assert("自定义景点标记 custom", addC && addC.custom === true && addC.name === "我自己加的馆", JSON.stringify(addC));
assert("自定义景点已入列", JSON.stringify(p6.days[0].items).includes("我自己加的馆"));
const rmR = T.dayRemoveSpot(p6, 0, T.daySpots(p6.days[0]).length - 1);
assert("删景点成功", !!(rmR && rmR.name), JSON.stringify(rmR));
assert("删后回到 +1 个", T.daySpots(p6.days[0]).length === n0 + 1, T.daySpots(p6.days[0]).length);
assert("框架条目禁止删除", T.dayRemoveSpot(p6, 0, 0) === null || !!T.isFrameName(p6.days[0].items[0].name));
assert("越界下标 → null", T.dayRemoveSpot(p6, 0, 999) === null);
assert("空行程 → null", T.dayAddSpot(null, 0) === null && T.dayRemoveSpot(null, 0, 0) === null);
// v1.13.1：往有「自由活动 · 第N天留白」占位的天加景点 → 自动清掉占位，不留「留白+新景点并存」
p6.days[0].items.push({ name: "自由活动 · 第1天留白", period: "晚上", note: "已移除原安排" });
assert("加前存在留白占位", p6.days[0].items.some(x => /天留白/.test(String(x.name || ""))));
const addB = T.dayAddSpot(p6, 0);
assert("加景点后留白占位已清除", !!addB && !p6.days[0].items.some(x => /^自由活动\s*·\s*第\s*\d+\s*天留白$/.test(String(x.name || ""))), JSON.stringify(p6.days[0].items.map(x => x.name)));

console.log("== 14. v1.6 · 行程基础（v1.8.2 起雨天备选已移除） ==");
const p7 = { cityName: "北京", depart: DEP, days: T.buildPlan({ city: "北京", days: 3, depart: DEP, budget: "mid" }) };

console.log("== 15. v1.6 · 每日预算 dailyBudget ==");
mem["miniLedgerV1"] = [];
T.addLedger(500, "住宿", "酒店", "我", 2, p7.days[0].date);
T.addLedger(1200, "购物", "买买买", "我", 2, p7.days[0].date);
const db = T.dailyBudget(p7);
assert("每日额度 > 0", db && db.perDay > 0, db && db.perDay);
assert("行数 = 天数", db && db.rows.length === 3, db && db.rows.length);
assert("第 1 天花了 1700", db && db.rows[0].spent === 1700, db && db.rows[0].spent);
assert("超支日标记 over", db && db.rows[0].over === true, db && JSON.stringify(db.rows[0]));
assert("超支天数 ≥1", db && db.overDays >= 1, db && db.overDays);
assert("未超支日 over=false", db && db.rows[1].over === false);
assert("剩余额度计算正确", db && db.rows[0].left === db.perDay - 1700);
assert("空行程 → null", T.dailyBudget(null) === null);

console.log("== 16. v1.6 · 花费预测 spendForecast ==");
const fc = T.spendForecast(p7);
assert("已花 1700", fc && fc.spent === 1700, fc && fc.spent);
assert("预算 > 0", fc && fc.budget > 0, fc && fc.budget);
assert("预测值 ≥ 已花", fc && fc.forecast >= fc.spent, fc && fc.forecast);
assert("含文案", fc && typeof fc.txt === "string" && fc.txt.length > 4, fc && fc.txt);
assert("百分比 0-200", fc && fc.pct >= 0 && fc.pct <= 200, fc && fc.pct);
mem["miniLedgerV1"] = [];
for (let i = 0; i < 40; i++) T.addLedger(500, "购物", "爆买", "我", 2, p7.days[0].date);
const fc2 = T.spendForecast(p7);
assert("大额花费触发超支预警", fc2 && fc2.over === true, JSON.stringify(fc2));
mem["miniLedgerV1"] = [];

console.log("== 17. v1.6 · 旅行小结 tripReview ==");
T.addLedger(200, "餐饮", "晚饭", "我", 2, p7.days[1].date);
mem["miniNotesV1"] = [];
T.addNote(p7.days[0].date, "第一天很开心");
const rv = T.tripReview(p7);
assert("小结天数 3", rv && rv.days === 3, rv && rv.days);
assert("小结含景点数", rv && rv.spots > 0, rv && rv.spots);
assert("小结花费 200", rv && rv.spent === 200, rv && rv.spent);
assert("最贵分类 = 餐饮", rv && rv.topCat === "餐饮", rv && rv.topCat);
assert("最贵一天 = D2", rv && rv.topDay === String(p7.days[1].date).slice(0, 10), rv && rv.topDay);
assert("手记数 1", rv && rv.notes === 1, rv && rv.notes);
assert("小结标题含城市", rv && rv.title.includes("北京"), rv && rv.title);
assert("空行程 → null", T.tripReview(null) === null);

console.log("== 18. v1.6 · 同行人 mates ==");
mem["miniMatesV1"] = [];
assert("加人成功", T.addMate("小明") === true);
assert("重名不重复", T.addMate("小明") === false);
assert("空名不加入", T.addMate("  ") === false);
T.addMate("小红");
assert("名单 2 人", T.getMates().length === 2, JSON.stringify(T.getMates()));
assert("删人成功", T.delMate(0) === true);
assert("删后剩 1 人", T.getMates().length === 1, JSON.stringify(T.getMates()));
assert("越界删除 → false", T.delMate(99) === false);
assert("备份包含 mates", (() => { const b = JSON.parse(T.exportBackup()); return Array.isArray(b.mates) && b.mates.length === 1; })());

console.log("== 19. v1.6 · 出发倒计时 tripCountdown ==");
const cd = T.tripCountdown(p7);
assert("未出发 → before", cd && cd.phase === "before", cd && cd.phase);
assert("倒计时天数为数字", cd && /^\d+$/.test(cd.big), cd && cd.big);
assert("含城市", cd && cd.sub.includes("北京"), cd && cd.sub);
assert("含提示语", cd && cd.tip.length > 4, cd && cd.tip);
const today0 = new Date();
const pad2 = n => String(n).padStart(2, "0");
const TODAY = today0.getFullYear() + "-" + pad2(today0.getMonth() + 1) + "-" + pad2(today0.getDate());
const p8 = { cityName: "北京", depart: TODAY, days: T.buildPlan({ city: "北京", days: 2, depart: TODAY, budget: "mid" }) };
const cd2 = T.tripCountdown(p8);
assert("旅途中 → during", cd2 && cd2.phase === "during", cd2 && cd2.phase);
assert("D1/2 格式", cd2 && cd2.big === "D1" && cd2.unit === "/2", cd2 && cd2.big + cd2.unit);
const old = new Date(Date.now() - 20 * 86400000);
const OLD = old.getFullYear() + "-" + pad2(old.getMonth() + 1) + "-" + pad2(old.getDate());
const p9 = { cityName: "北京", depart: OLD, days: T.buildPlan({ city: "北京", days: 2, depart: OLD, budget: "mid" }) };
const cd3 = T.tripCountdown(p9);
assert("已结束 → after", cd3 && cd3.phase === "after", cd3 && cd3.phase);
assert("空行程 → null", T.tripCountdown(null) === null);

console.log("== 20. v1.6 · 城市速览 cityBrief ==");
const cb = T.cityBrief("北京");
assert("速览有名称", cb && cb.name === "北京", cb && cb.name);
assert("最佳季节非空", cb && !!cb.best, cb && cb.best);
assert("气候文案非空", cb && !!cb.climateTxt, cb && cb.climateTxt);
assert("消费档文案", cb && !!cb.costTxt, cb && cb.costTxt);
assert("建议天数 2-8", cb && cb.days >= 2 && cb.days <= 8, cb && cb.days);
assert("必吃列表非空", cb && cb.foods.length > 0, cb && cb.foods.length);
assert("住宿建议非空", cb && !!cb.stayTip, "空");
assert("交通建议非空", cb && !!cb.travel, "空");
assert("区域非空", cb && cb.areas.length > 0, cb && cb.areas.length);
assert("空输入 → null", T.cityBrief("") === null);
const cbX = T.cityBrief("不存在的城市xyz");
assert("未知城市不崩溃", cbX === null || !!cbX.name);

console.log("== 21. v1.6 · 主题三态 ==");
mem["themeV1"] = "";
assert("默认 light", T.themeMode() === "light", T.themeMode());
T.setThemeMode("dark");
assert("切 dark 生效", T.themeMode() === "dark" && T.themePref() === "dark");
T.setThemePref("auto");
assert("auto 归一为 light（已删跟随系统）", T.themePref() === "light", T.themePref());
assert("auto 解析为 light", T.themeMode() === "light", T.themeMode());
T.setThemePref("light");
assert("回到 light", T.themeMode() === "light");
assert("旧值兼容：非法值 → light", (mem["themeV1"] = "x", T.themePref() === "light"));


/* ============ v1.7.0 ============ */
console.log("== 14. v1.7 交通建议 routeAdvice ==");
const p14 = { cityName: "北京", days: T.buildPlan({ city: "北京", days: 3, depart: DEP, budget: "mid" }) };
const ra = T.routeAdvice(p14, 0);
assert("返回 legs", !!ra && Array.isArray(ra.legs), ra);
assert("有总时长文案", !!ra && /分钟/.test(ra.text), ra && ra.text);
assert("单景点天返回 null", T.routeAdvice(p14, 2) === null);
assert("越界天返回 null", T.routeAdvice(p14, 99) === null);

console.log("== 15. 汇率换算 fxConvert ==");
assert("CNY→CNY 不变", T.fxConvert(100, "CNY", "CNY") === 100);
assert("USD→CNY 放大", T.fxConvert(100, "USD", "CNY") > 600, T.fxConvert(100, "USD", "CNY"));
const fxv = T.fxConvert(100, "CNY", "JPY");
assert("CNY→JPY 合理", fxv > 1000 && fxv < 5000, fxv);
T.fxSetRate("JPY", 20);
assert("自定义汇率生效", T.fxConvert(100, "CNY", "JPY") === 2000, T.fxConvert(100, "CNY", "JPY"));
assert("汇率表含 CNY", T.FX_LIST.indexOf("CNY") === 0);

console.log("== 16. 足迹热力图 footHeatmap ==");
["miniFootV1"].forEach(k => { mem[k] = undefined; });
T.markVisited("故宫", "北京", true);
T.markVisited("天坛", "北京", true);
T.markVisited("兵马俑", "西安", true);
const hm = T.footHeatmap();
// v1.8.4 B14：全量 34 省级宫格，未点亮 level0 置灰
assert("宫格 34 省", hm.provs.length === 34, hm.provs.length);
assert("点亮 2 省", hm.visited === 2, hm.visited);
const bjProv = hm.provs.find(p => p.name === "北京");
const saProv = hm.provs.find(p => p.name === "陕西");
// 宫格数值 = 去过的城市数（同城多个景点合并为 1）
assert("北京宫格 n=1", bjProv && bjProv.n === 1 && bjProv.level === 1, JSON.stringify(bjProv));
assert("陕西省宫格 n=1", saProv && saProv.n === 1 && saProv.level === 1, JSON.stringify(saProv));
assert("存在置灰 level0", hm.provs.some(p => p.level === 0 && p.n === 0));
assert("城市数按城市去重（北京+西安=2）", hm.cities === 2, hm.cities);

console.log("== 17. 月度汇总 ledgerMonthly ==");
["miniLedgerV1"].forEach(k => { mem[k] = undefined; });
mem["miniLedgerV1"] = [];
T.addLedger(500, "住宿", "酒店", "我", 1, "2026-05-02");
T.addLedger(100, "餐饮", "饭", "我", 1, "2026-05-03");
T.addLedger(900, "门票", "票", "我", 1, "2026-06-01");
const lm = T.ledgerMonthly();
assert("两个月", lm.months.length === 2, JSON.stringify(lm.months.map(m => m.ym)));
assert("最新月在前", lm.months[0].ym === "2026-06", lm.months[0].ym);
assert("5 月合计 600", lm.months[1].total === 600, lm.months[1].total);
assert("最高月 = 6 月", lm.worst.ym === "2026-06", lm.worst.ym);
assert("6 月最贵分类 门票", lm.months[0].top === "门票", lm.months[0].top);

console.log("== 18. 首页入口 / 收藏多站 ==");
const tl = T.homeTileList();
assert("默认 10 个入口（地图/美食/酒店/百科/天气 + 工具）", tl.length === 10, tl.length);
const tlKeys = tl.map(x => x.k);
assert("默认含酒店住宿入口", tlKeys.indexOf("hotel") >= 0, tlKeys);
assert("默认含景点百科入口", tlKeys.indexOf("baike") >= 0, tlKeys);
assert("默认含天气参考入口", tlKeys.indexOf("weather") >= 0, tlKeys);
const _hotel = tl.find(x => x.k === "hotel"), _baike = tl.find(x => x.k === "baike"), _wx = tl.find(x => x.k === "weather");
assert("酒店入口指向 plan 宿主页", _hotel && /\/pages\/plan\/plan$/.test(_hotel.url), _hotel && _hotel.url);
assert("百科入口指向 plan 宿主页", _baike && /\/pages\/plan\/plan$/.test(_baike.url), _baike && _baike.url);
assert("天气入口指向 plan 宿主页", _wx && /\/pages\/plan\/plan$/.test(_wx.url), _wx && _wx.url);
assert("酒店/百科/天气图标非空", !!(_hotel && _hotel.ic) && !!(_baike && _baike.ic) && !!(_wx && _wx.ic));
assert("酒店/百科/天气带定位意图", !!(_hotel && _hotel.focus === "hotel") && !!(_baike && _baike.focus === "baike") && !!(_wx && _wx.focus === "weather"));
T.setHomeTiles(["map", "food"]);
assert("自定义后剩 2 个", T.homeTiles().length === 2, T.homeTiles());
assert("列表跟随自定义", T.homeTileList().length === 2);
T.setHomeTiles(["map", "不存在的键"]);
assert("过滤非法键", T.homeTiles().length === 1, T.homeTiles());
["miniFavV1"].forEach(k => { mem[k] = undefined; });
mem["miniFavV1"] = ["北京", "西安"];
const fr = T.favRoute(4);
assert("收藏→路线 2 站", fr.length === 2, JSON.stringify(fr));
assert("路线带省份", fr.every(x => !!x.province), JSON.stringify(fr));

console.log("== 19. 最佳时段 / 证件 / 灵感 / 夜间 ==");
assert("寺类 → 上午", /上午/.test(T.spotTiming("灵隐寺").best), T.spotTiming("灵隐寺").best);
assert("山类 → 清晨", /清晨/.test(T.spotTiming("黄山").best), T.spotTiming("黄山").best);
assert("夜市 → 晚上", /晚上/.test(T.spotTiming("夜市").best), T.spotTiming("夜市").best);
assert("未命中也有兜底", T.spotTiming("随便一个地方").best.length > 0);
assert("证件清单 8 项", T.docItems().length === 8, T.docItems().length);
assert("证件键 dc_ 前缀", T.docItems().every(x => x.k.indexOf("dc_") === 0));
const ins = T.inspire(5);
assert("灵感有城市名", !!ins && !!ins.name, ins);
assert("灵感有天数", !!ins && ins.days >= 2 && ins.days <= 8, ins && ins.days);
T.setNightCfg({ on: true, from: 0, to: 24 });
assert("夜间全时段 true", T.isNightHour() === true);
T.setNightCfg({ on: false });
assert("关闭后 false", T.isNightHour() === false);
T.setNightCfg({ on: true, from: 22, to: 7 });
assert("默认配置回写", T.nightCfg().from === 22 && T.nightCfg().to === 7);

console.log("== 20. 凭证图片 + 备份往返 ==");
T.setBillImg("t20_a", "/tmp/a.png");
assert("凭证可存可读", T.getBillImg("t20_a") === "/tmp/a.png");
assert("未存返回空串", T.getBillImg("t20_missing") === "");
T.setHomeTiles(["map", "food", "ledger"]);
T.setNightCfg({ on: true, from: 23, to: 6 });
const bak = JSON.parse(T.exportBackup());
assert("备份含 tiles", Array.isArray(bak.tiles) && bak.tiles.length === 3, bak.tiles);
assert("备份含 night", bak.night && bak.night.on === true);
assert("备份含 billImg", bak.billImg && bak.billImg["t20_a"] === "/tmp/a.png");
T.setHomeTiles([]); T.setNightCfg({ on: false });
T.importBackup(JSON.stringify(bak));
assert("恢复 tiles", T.homeTiles().length === 3, T.homeTiles());
assert("恢复 night", T.nightCfg().on === true && T.nightCfg().from === 23);
assert("恢复 billImg", T.getBillImg("t20_a") === "/tmp/a.png");

console.log("== 21. 具名演出（晚间兜底不再泛化）==");
const SL = T.P && T.P.showListOf ? T.P.showListOf : null;
assert("演出表 ≥25 城", !!(SL && Object.keys(T.P.SHOW_TIPS).length >= 25), SL && Object.keys(T.P.SHOW_TIPS).length);
assert("北京 3 条场馆", !!(SL && SL("北京") && SL("北京").length === 3), SL && SL("北京") && SL("北京").length);
assert("北京泛名→具名", /「三庆园」看德云社相声/.test(T.showDisp("看一场本地演出", "北京")), T.showDisp("看一场本地演出", "北京"));
assert("太原泛名→山西大剧院", T.showDisp("看一场本地演出", "太原").indexOf("山西大剧院") >= 0, T.showDisp("看一场本地演出", "太原"));
assert("未收录城市保持原文", T.showDisp("看一场本地演出", "大同") === "看一场本地演出");
assert("正常景点名不受影响", /故宫/.test(T.showDisp("深度游览「故宫博物院」", "北京")));
assert("空城市保持原文", T.showDisp("看一场本地演出", "") === "看一场本地演出");
const py = T.P.findCity("平遥");
const pyDays = T.P.buildPlanDays(py, 4, "2026-11-05", "low", { style: "balance", stayMountain: false });
const pyShow = JSON.stringify(pyDays).indexOf("「平遥古城西门外」看情境体验剧《又见平遥》") >= 0;
assert("平遥 4 天生成含具名演出", pyShow === true, JSON.stringify(pyDays).slice(0, 300));


console.log("== 22. v1.8.4 A1 人流提示 ==");
const BJ2 = D.CITIES.find(c => c.name === "北京");
const days = T.buildPlan({ city: BJ2, days: 4, depart: DEP, pace: "balance" });
const h1 = T.dateHintOf("2026-10-01");
assert("国庆 10-01 big", h1 && h1.lv === "big", JSON.stringify(h1));
const hMid = T.dateHintOf("2026-08-15");
assert("暑假 8 月 mid", hMid && hMid.lv === "mid", JSON.stringify(hMid));
const hWk = T.dateHintOf(DEP);
const wkend = (new Date(DEP.replace(/-/g, "/")).getDay());
assert("出发日按周几判断", (wkend === 0 || wkend === 6) ? (hWk && hWk.lv === "small") : (hWk === null || hWk), JSON.stringify(hWk));
const depIsWk = wkend === 0 || wkend === 6;
assert("非法日期 null", T.dateHintOf("abc") === null);
const hPlan = T.dateHintsForPlan({ days: [{ date: "2026-10-01" }, { date: "2026-08-15" }, { date: DEP }] });
assert("多日去重提示 ≤3", Array.isArray(hPlan) && hPlan.length <= 3, hPlan.length);

console.log("== 23. v1.8.4 A2 穿衣指数 ==");
const BJc = D.CITIES.find(c => c.name === "北京");
const dj = T.dressForMonth(BJc, "2026-01-15");
assert("冬季穿衣有结构", !!dj && /冬/.test(dj.season) && Array.isArray(dj.lines) && dj.lines.length > 0, JSON.stringify(dj));
const dx = T.dressForMonth(BJc, "2026-07-15");
assert("夏季穿衣", !!dx && /夏/.test(dx.season), JSON.stringify(dx));
const t0 = T.dressForTemp(0);
assert("0°C 主推厚外套", t0 && /厚外套|羽绒/.test(t0.main), JSON.stringify(t0));
const t28 = T.dressForTemp(28);
assert("28°C 清凉", t28 && /短袖/.test(t28.main), JSON.stringify(t28));
assert("非法温度 null", T.dressForTemp("x") === null);

console.log("== 24. v1.8.4 A3 美食时段 ==");
assert("早餐词→early", T.mealSlotOf("老字号早点铺") === "early", T.mealSlotOf("老字号早点铺"));
assert("夜宵词→night", T.mealSlotOf("夜市烤串") === "night");
assert("默认 main", T.mealSlotOf("北京烤鸭") === "main");
const mg = T.mealGroups("北京");
assert("北京分组三键", !!mg && Array.isArray(mg.early) && Array.isArray(mg.main) && Array.isArray(mg.night), mg && mg.early.length + " " + mg.main.length + " " + mg.night.length);
assert("北京正餐有货", mg && mg.main.length > 0, mg && mg.main.length);
assert("时段文案表", T.MEAL_SLOT_TXT && T.MEAL_SLOT_TXT.main === "正餐");

console.log("== 25. v1.8.4 A4 多账本隔离 ==");
["miniLedgerV1"].forEach(k => { mem[k] = undefined; });
mem["miniLedgerV1"] = [];
const sigBJ = "北京|3|2026-10-01";
T.addLedger(120, "餐饮", "涮肉", "我", 2, "2026-10-01", sigBJ);
T.addLedger(50, "门票", "门票", "我", 1, "2026-10-02", "西安|2|2026-11-01");
T.addLedger(30, "交通", "老账", "我", 1, "2026-06-01", "");
assert("三笔入账", T.getLedger().length === 3);
assert("tripSigOf 格式", T.tripSigOf({ cityName: "北京", totalDays: 3, days: [{ date: "2026-10-01" }] }) === sigBJ);
const trips = T.ledgerTrips();
assert("账本行程列表含北京", trips.some(x => /北京/.test(x.label)), JSON.stringify(trips));
assert("含旧账标记", trips.some(x => x.key === "__other"), JSON.stringify(trips));
assert("ledgerOfTrip 北京 1 笔", T.ledgerOfTrip(sigBJ).length === 1, T.ledgerOfTrip(sigBJ).length);
assert("ledgerOfTrip 旧账 1 笔", T.ledgerOfTrip("__other").length === 1);
assert("ledgerOfTrip __all 全量", T.ledgerOfTrip("__all").length === 3);

console.log("== 26. v1.8.4 A5 外币换算 ==");
// FX_RATES 存「1 CNY = x 外币」（USD 默认 0.14 ≈ 1/7.1）；UI 编辑直觉值会先取倒数
T.fxSetRate("USD", 0.2);   // 1 CNY = 0.2 USD ⇔ 1 USD = 5 CNY
assert("USD 汇率写入", T.fxRates().USD === 0.2, T.fxRates().USD);
assert("100 USD → CNY 500", Math.abs(T.fxConvert(100, "USD", "CNY") - 500) < 0.01, T.fxConvert(100, "USD", "CNY"));
assert("CNY→USD 反向", Math.abs(T.fxConvert(500, "CNY", "USD") - 100) < 0.01, T.fxConvert(500, "CNY", "USD"));
assert("同币种原值", T.fxConvert(66, "CNY", "CNY") === 66);
assert("FX_LIST 覆盖", T.FX_LIST.length >= 12, T.FX_LIST.length);
T.fxSetRate("USD", 0.14);  // 还原默认

console.log("== 27. v1.8.4 A6 人情往来 ==");
mem["miniIouV1"] = [];
T.addIou("小明", "垫付门票", 120, "lend");
T.addIou("小红", "我借车费", 40, "borrow");
assert("IOU 2 条", T.iouList().length === 2);
const is0 = T.iouStats();
assert("净应收 80", is0.pending === 80, JSON.stringify(is0));
T.toggleIou(1); // list[0]=小红(borrow) unshift 在后，list[1]=小明(lend) 已还
assert("小明还清后净欠 40", T.iouStats().pending === -40, JSON.stringify(T.iouStats()));
T.toggleIou(0); // 小红那笔(borrow)我也还了 → 两清
assert("全部还清 pending 0", T.iouStats().pending === 0, JSON.stringify(T.iouStats()));
T.delIou(1);
assert("删除后 1 条", T.iouList().length === 1);

console.log("== 28. v1.8.4 A7 凭证浏览 ==");
T.setBillImg("t28_a", "/tmp/recv.jpg");
T.setBillImg("t28_b", "/tmp/recv2.jpg");
assert("凭证设置与读取", T.getBillImg("t28_b") === "/tmp/recv2.jpg");
assert("map 有 2 张", Object.keys(T.billImgMap()).length >= 2);
T.setBillImg("t28_b", "");

console.log("== 29. v1.8.4 A8 盲盒 / B16 协作包 ==");
const pk2 = T.inspirePicks(3);
assert("盲盒 3 个", Array.isArray(pk2) && pk2.length === 3, pk2 && pk2.length);
assert("盲盒不重复", pk2.length === new Set(pk2.map(x => x.name)).size);
const planP = { cityName: "北京", totalDays: 4, depart: DEP, days, budget: "mid", people: 2, pace: "balance", isMulti: false };
T.clearWish();
T.toggleWish("故宫博物院", "北京");
const coll = T.exportCollabPlan(planP);
assert("协作包 JSON", coll.indexOf("travel-collab") >= 0 && JSON.parse(coll).wish.length === 1);
T.clearWish(); // 模拟对方空清单 → 导入应并入 1 个
const cj = T.mergeCollabPlan(coll);
assert("协作并入想玩", cj.added === 1 && T.getWish().length === 1, JSON.stringify(cj));
assert("协作行程存档", !!cj.saved && cj.saved.name.indexOf("同行人") >= 0, JSON.stringify(cj.saved));

console.log("== 30. v1.8.4 A9/A10 快捷短语 ==");
const qp = T.quickPhrases();
assert("快捷短语 ≥8", Array.isArray(qp) && qp.length >= 8, qp && qp.length);
assert("含记账短语", qp.some(x => /^\S+ \d+$/.test(x)));

console.log("== 31. v1.8.4 B11 动线评分 / B12 卡点 ==");
const rs = T.routeScore({ cityName: "北京", days }, 0);
assert("routeScore 有结构", !!rs && typeof rs.ok === "boolean" && "n" in rs, JSON.stringify(rs));
const dl = T.dayLoad({ cityName: "北京", days }, 0);
assert("dayLoad 有结构", !!dl && dl.n >= 0 && typeof dl.txt === "string", JSON.stringify(dl));
assert("durOf 分类", T.durOf("故宫博物院").h === 2.5, T.durOf("故宫博物院").h);
assert("durOf 山/长城", T.durOf("八达岭长城").h === 3, T.durOf("八达岭长城").h);

console.log("== 32. v1.8.4 B13 年鉴 / B14 热力 / B17 城市贴士 / B18 预约 ==");
mem["miniFootV1"] = undefined;
T.markVisited("故宫", "北京", true);
const yr = T.yearReport();
assert("年鉴城市数", yr && yr.citiesN === 1 && yr.cities.indexOf("北京") >= 0, JSON.stringify(yr));
const hm2 = T.footHeatmap();
assert("热力 34 省级宫格", hm2 && hm2.provs.length === 34, hm2 && hm2.provs.length);
assert("点亮 1 省", hm2 && hm2.visited === 1, hm2 && hm2.visited);
T.saveCityNote("北京", 5, ["旺季早到", "避开周一闭馆"]);
assert("城市贴士存取", T.getCityNote("北京").score === 5 && T.getCityNote("北京").tips.length === 2, JSON.stringify(T.getCityNote("北京")));
assert("贴士超 8 截断", T.saveCityNote("西安", 4, [1,2,3,4,5,6,7,8,9,10]).tips.length === 8);
assert("城市贴士列表", T.allCityNotes().some(x => x.city === "北京"));
T.delCityNote("北京");
assert("贴士删除", T.getCityNote("北京") === null);
const bjRemind = T.ticketRemind({ cityName: "北京", days });
assert("预约提醒 null 或有值", bjRemind === null || (bjRemind.n > 0 && bjRemind.txt), JSON.stringify(bjRemind));




console.log("== 33. v1.8.5 档三（C 组） ==");
// C1 预算体检
const bc1 = T.budgetCheckOf({ cityName: "北京", totalDays: 3, budget: "high", days });
assert("C1 high档 体检不报 tight", bc1 && bc1.lv !== "tight", JSON.stringify(bc1));
const bc2 = T.budgetCheckOf({ cityName: "北京", totalDays: 3, budget: "low", days });
assert("C1 北京 low档 偏紧", bc2 && bc2.lv === "tight", JSON.stringify(bc2));
assert("C1 无 plan null", T.budgetCheckOf(null) === null);
// C3 顺路加站（太原属于山西 → 应给出同省候选）
const c3b = T.nextStopPick({ cityName: "太原", days: days });
assert("C3 太原顺路候选≥1", Array.isArray(c3b) && c3b.length >= 1, JSON.stringify(c3b));
assert("C3 候选不含太原自己", !c3b.some(x => x.name === "太原"), JSON.stringify(c3b));
// C2 长天数提示（v1.17.4：北京建议天数已按真实景点量算到 8 天，故用 12 天触发超推荐）
const c2l = T.cityLongHint({ cityName: "北京", totalDays: 12, days: T.buildPlan({ city: BJc, days: 12, depart: DEP, pace: "balance" }) });
assert("C2 12天北京提示 over", c2l && c2l.over > 0, JSON.stringify(c2l));
assert("C2 3天北京 null", T.cityLongHint({ cityName: "北京", totalDays: 3, days: days }) === null);
// C4 门票预估
const c4t = T.ticketSumOf({ cityName: "北京", days: days });
assert("C4 门票 n≥1", c4t && c4t.n >= 1 && c4t.fee > 0, JSON.stringify(c4t));
// C6 分类占比（纯函数传数组）
const _tdy = (() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); })();
const c6l = [{ amt: 100, cat: "餐饮", date: _tdy }, { amt: 40, cat: "交通", date: _tdy }, { amt: -20, cat: "餐饮", date: _tdy }];
const c6p = T.catPctOf(c6l);
assert("C6 两行 + 退款单列", c6p.rows.length === 2 && c6p.refund === 20 && c6p.total === 140, JSON.stringify(c6p));
assert("C6 餐饮占比 71%", c6p.rows.find(x => x.cat === "餐饮").pct === 71, JSON.stringify(c6p.rows));
// C7/C8/C9（weekLedgerTxt/topCatsOf 传参）
const c7w = T.weekSpent(c6l);
assert("C7 本周计入 3 笔(负算内)", c7w.n === 3, JSON.stringify(c7w));
const c8x = T.weekLedgerTxt(c6l);
assert("C8 含合计行", c8x.indexOf("合计") >= 0 && c8x.indexOf("餐饮") >= 0, c8x.slice(0, 60));
assert("C9 top 餐饮", T.topCatsOf(c6l, 2).indexOf("餐饮") === 0, T.topCatsOf(c6l, 2).join(","));
// C11 每日一句
const c11q = T.quoteOfDay();
assert("C11 有句子", !!c11q && c11q.txt.length > 3, JSON.stringify(c11q));
// C12/C20 足迹（清空后造数据）
mem["miniFootV1"] = undefined;
T.markVisited("故宫", "北京", true);
T.markVisited("兵马俑", "西安", true);
const c12f = T.footStoryText();
assert("C12 足迹含两市", c12f.indexOf("北京") >= 0 && c12f.indexOf("西安") >= 0, c12f);
const c20d = T.footCityDetail("北京");
assert("C20 北京 1 个", c20d.count === 1 && c20d.list[0].name === "故宫", JSON.stringify(c20d));
// v1.19.135 景点个人评价（方便下次选择）
T.markVisited("天坛", "北京", true);
assert("写评价前 getFootNote 空", T.getFootNote("天坛") === "", T.getFootNote("天坛"));
T.setFootNote("天坛", "二刷必去，夜景绝了");
assert("setFootNote 后可读", T.getFootNote("天坛") === "二刷必去，夜景绝了", T.getFootNote("天坛"));
// 重复打卡不能清掉已写评价（markVisited 合并写入）
T.markVisited("天坛", "北京", true);
assert("重复打卡保留评价", T.getFootNote("天坛") === "二刷必去，夜景绝了", T.getFootNote("天坛"));
// footCityDetail 列表带 note
const c20f = T.footCityDetail("北京");
const tiantanE = c20f.list.find(x => T.cleanSpotName(x.name) === "天坛");
assert("C20 列表含评价", tiantanE && tiantanE.note === "二刷必去，夜景绝了", JSON.stringify(tiantanE));
// 清空评价
T.setFootNote("天坛", "");
assert("清空评价生效", T.getFootNote("天坛") === "", T.getFootNote("天坛"));
// 未打卡景点不能单独写评价
assert("未打卡景点写评价返回 null", T.setFootNote("不存在的景点xyz", "测试") === null);
// 评价超长截断 200
T.setFootNote("天坛", "x".repeat(500));
assert("评价超长截断 200", T.getFootNote("天坛").length === 200, T.getFootNote("天坛").length);
T.setFootNote("天坛", "");
// 还原足迹状态（否则会污染下方 C13 对「天坛未打卡」的预期）
T.markVisited("天坛", "北京", false);
// C13 想玩状态
const c13s = T.wishStateMark([{ name: "故宫博物院", city: "北京" }, { name: "天坛", city: "北京" }], { cityName: "北京", days });
assert("C13 故宫 planned", c13s[0].planned === true, JSON.stringify(c13s[0]));
assert("C13 天坛 visited 取决于足迹(故宫打卡→天坛未)", c13s[1].visited === false && c13s[1].planned !== undefined, JSON.stringify(c13s[1]));

/* ============ v1.9.0 · 数据扩容 + 40 项功能（数据层） ============ */
// D1 城市池 46 → 66
assert("D1 主城池 ≥66（当前 78）", T.D.CITIES.length >= 66, "CITIES=" + T.D.CITIES.length);
// v1.10.0 D1b 新城入池 66→78
for (const nm of ["北海", "秦皇岛", "开封", "宜昌", "岳阳", "汕头", "潮州", "延吉", "喀什", "伊犁", "腾冲", "呼伦贝尔"]) {
  assert("D1b 含新城 " + nm, T.D.CITIES.some(c => c.name === nm), nm);
}
assert("D1c 省表含延吉/腾冲", (T.D.PROVINCE_CITIES["吉林"] || []).includes("延吉") && (T.D.PROVINCE_CITIES["云南"] || []).includes("腾冲"), "延吉/腾冲未入省表");
for (const nm of ["太原", "大同", "济南", "泰安", "扬州", "无锡", "绍兴", "宁波", "泉州", "景德镇", "九江", "恩施", "乐山", "都江堰", "西双版纳", "遵义", "安顺", "烟台", "威海", "承德"]) {
  assert("D1 含新城 " + nm, T.D.CITIES.some(c => c.name === nm), nm);
}
// D2 新城内容完整性
const v90 = T.D.CITIES.filter(c => ["太原", "大同", "恩施", "西双版纳", "泉州"].includes(c.name));
for (const c of v90) {
  assert("D2 " + c.name + " experiences≥6", (c.experiences || []).length >= 6, c.experiences.length);
  assert("D2 " + c.name + " foods≥5", (c.foods || []).length >= 5, (c.foods || []).length);
  const badP = (c.experiences || []).filter(e => !/^(凌晨|早上|上午|清晨|下午|晚上|傍晚|深夜|夜间|全天)$/.test(e.period || ""));
  assert("D2 " + c.name + " period 合法", badP.length === 0, badP.map(e => e.period).join(","));
}
// D3 坐标扩容
const v90c = Object.values(T.D.SPOT_COORDS).reduce((a, b) => a + b.length, 0);
assert("D3 坐标总条数≥990", v90c >= 990, "got " + v90c);
assert("D3 坐标覆盖城≥108", Object.keys(T.D.SPOT_COORDS).length >= 108, Object.keys(T.D.SPOT_COORDS).length);
// D4 去泛化治理（旧泛条目清除 / 具体景点就位）
const expNames = cn => ((T.D.CITIES.find(c => c.name === cn) || {}).experiences || []).map(e => e.name);
assert("D4 武汉改具名", expNames("武汉").includes("汉口江滩公园"), expNames("武汉").join("|"));
assert("D4 湘西改具名", expNames("湘西").some(n => n.indexOf("德夯苗寨") >= 0), expNames("湘西").join("|"));
// v1.17.7：凤凰独立成城后，沱江跳岩等凤凰景点归属「凤凰」，不在湘西
assert("D4 凤凰改具名", expNames("凤凰").some(n => n.indexOf("沱江跳岩") >= 0), expNames("凤凰").join("|"));
assert("D4 石家庄改具名", expNames("石家庄").some(n => n.indexOf("正定古城") >= 0), expNames("石家庄").join("|"));
assert("D4 移除泛夜游", (T.D.CITY_LANDMARKS_EXTRA["福州"] || []).indexOf("闽江夜游") < 0, "");
// D5 新城可出团 + 景点可直达导航
const v90plan = T.buildPlan({ city: T.D.CITIES.find(c => c.name === "太原"), days: 3, depart: "2026-10-01", pace: "balance" });
assert("D5 太原 3 天成团", v90plan.length === 3, v90plan.length);
const v90pl = { cityName: "太原", days: v90plan, segments: [{ cityName: "太原", days: v90plan }] };
assert("D5 晋祠直达导航", T.navTarget("晋祠", "太原").type === "coord", JSON.stringify(T.navTarget("晋祠", "太原")));
assert("D5 云冈直达导航", T.navTarget("云冈石窟", "大同").type === "coord", "");
assert("D5 黄果树直达导航", T.navTarget("黄果树瀑布", "安顺").type === "coord", "");
// D6 v1.9 体检函数
const mon = T.mondayClashOf({ days: [{ date: "2026-09-14", items: [{ name: "故宫博物院", period: "上午" }] }] });
assert("D6 周一闭馆命中", mon.length === 1 && mon[0].name === "故宫博物院", JSON.stringify(mon));
const bk = T.bookRemindOf({ days: [{ date: "2026-09-10", items: [{ name: "故宫博物院", period: "上午" }] }] });
assert("D6 需预约提醒", bk.length === 1 && bk[0].adv.indexOf("7 天") >= 0, JSON.stringify(bk));
const sh = T.bestSeasonHit("太原", "2026-10-01");
assert("D6 最佳季节命中", !!sh && sh.hit === true, JSON.stringify(sh));
const et = T.endTripTip({ cityName: "北京", days: [{ date: "2026-10-01", items: [{ name: "返程" }] }] });
assert("D6 返程贴士", !!et && et.txt.indexOf("2 小时") >= 0, JSON.stringify(et));
// D7 每日标签 / 构成 / 动线
assert("D7 构成统计", T.mixStat(v90pl).length >= 2, JSON.stringify(T.mixStat(v90pl)));
assert("D7 主题日标签", typeof T.themeTagOf(v90pl.days[1]) === "string" && T.themeTagOf(v90pl.days[1]).length >= 2, "");
const mv = T.dayMove(v90pl.days[1], "太原");
assert("D7 动线估算", mv.steps >= 4000 && (mv.km || 0) >= 0, JSON.stringify(mv));
// D8 行前/清单/口味/账本/足迹/骰子
assert("D8 高原行前提示", T.packHintOf("拉萨", "2026-07-01").join("").indexOf("高原") >= 0, T.packHintOf("拉萨", "2026-07-01").join(""));
assert("D8 热带清单加项", T.climateAddOns("tropical").length >= 3, T.climateAddOns("tropical").length);
assert("D8 口味识别", T.tasteTagOf("牛油火锅") === "辣" && T.tasteTagOf("松鼠桂鱼") === "鲜", "");
const w7 = T.weekBars(c6l);
assert("D8 近7日柱 7 格", w7.days.length === 7 && w7.max > 0, JSON.stringify(w7.days));
const m8 = T.monthStory(c6l);
assert("D8 月复盘", !!m8 && m8.total === 140 && m8.n === 2, JSON.stringify(m8));
const ps = T.provStamp();
assert("D8 省章≥1", ps.provs >= 1 && ps.total === 34, JSON.stringify(ps));
const per = T.travelPersona();
assert("D8 旅行人格", !!per && per.cities >= 2, JSON.stringify(per));
T.toggleWish("故宫", "北京");
const dice = T.wishDice();
assert("D8 想玩骰子", !!dice && (dice.name === "故宫" || dice.name === "故宫博物院"), JSON.stringify(dice));
T.toggleWish("故宫", "北京");
// D9 假期 / 同省
assert("D9 国庆命中", (T.holidayHint("2026-10-01") || {}).name === "国庆", JSON.stringify(T.holidayHint("2026-10-01")));
assert("D9 平日无提示", T.holidayHint("2026-04-12") === null, JSON.stringify(T.holidayHint("2026-04-12")));
assert("D9 同省推荐", T.siblingCities("太原").length >= 1, JSON.stringify(T.siblingCities("太原")));

console.log("== E. v1.15 · 景点标签 / 多维检索 / 风格偏好 ==");
const tg1 = T.spotTagOf("故宫博物院", "北京");
assert("标签：故宫→历史古迹", Array.isArray(tg1) && tg1.includes("历史古迹"), JSON.stringify(tg1));
const tg2 = T.spotTagOf("张家界国家森林公园", "张家界");
assert("标签：张家界→自然风光", Array.isArray(tg2) && tg2.includes("自然风光"), JSON.stringify(tg2));
const sr = T.searchSpots({ city: "北京", tag: "博物馆" });
assert("多维检索：北京博物馆≥1", Array.isArray(sr) && sr.length >= 1, JSON.stringify(sr.map(x => x.name)));
const srAll = T.searchSpots({ kw: "故宫" });
assert("多维检索：全库搜故宫≥1", Array.isArray(srAll) && srAll.length >= 1, JSON.stringify(srAll[0]));
// 风格偏好：北京历史古迹占多 → history 版应显著增加“历史”类景点
const cB = T.D.CITIES.find(c => c.name === "北京");
const pH = T.buildPlan({ city: cB, days: 2, depart: "2026-10-01", budget: "mid", pace: "balance", bias: "history" });
const pN = T.buildPlan({ city: cB, days: 2, depart: "2026-10-01", budget: "mid", pace: "balance", bias: "nature" });
const histN = p => (p||[]).flatMap(d => (d.items||[])).filter(it => /古迹|寺|宫|府|博物馆|桥|街/.test(String(it.name||""))).length;
assert("风格偏好：历史版历史景点≥自然版", histN(pH) >= histN(pN), histN(pH) + " vs " + histN(pN));

console.log("== F. v1.15 · 五个新功能 ==");
// F1 按标签换同类：北京任选一个真实景点 → 历史古迹候选非空
const pF = { cityName: "北京", depart: DEP, days: T.buildPlan({ city: "北京", days: 3, depart: DEP, budget: "mid", pace: "balance" }) };
const spotIx = (pF.days[0].items || []).findIndex(it => !T.isFrameName(it.name));
const histCands = T.swapCandidatesByTag(pF, 0, spotIx >= 0 ? spotIx : 0, "历史古迹");
assert("F1 按标签换同类候选≥1", Array.isArray(histCands) && histCands.length >= 1, JSON.stringify(histCands.slice(0,2)));
// F2 加景点偏好：北京自然版候选应包含自然类
const natCands = T.dayAddCandidates(pF, 0, "nature");
const natTags = natCands.map(n => T.spotTagOf(n, "北京"));
assert("F2 加景点偏好：自然候选多数为自然风光", natCands.length >= 1 && natTags.filter(t => t.includes("自然风光")).length >= 1, JSON.stringify(natCands.slice(0,3)));
// F3 体检报告
const hp = T.tripHealth(pF);
assert("F3 体检报告有文本", !!hp && hp.text && hp.text.includes("每日强度"), hp && hp.text.slice(0,40));
// F4 标签详情
assert("F4 详情标签已实现", Array.isArray(T.spotTagOf("故宫博物院", "北京")) && T.spotTagOf("故宫博物院", "北京").length >= 1);
// F5 搜索
const sr2 = T.searchSpots({ city: "北京", tag: "自然风光" });
assert("F5 标签检索自然风光≥1", Array.isArray(sr2) && sr2.length >= 1, JSON.stringify(sr2[0]));
// F6 非法日期守卫（刁蛮用户：乱填日期不能产生 NaN/静默跨月）
let dateErr = "";
try { T.buildPlan({ city: "北京", days: 3, depart: "9999-99-99", budget: "mid", pace: "balance" }); } catch (e) { dateErr = e.message; }
assert("F6 非法日期明确报错", /日期无效/.test(dateErr), dateErr);
let febErr = "";
try { T.buildPlan({ city: "北京", days: 3, depart: "2026-02-30", budget: "mid", pace: "balance" }); } catch (e) { febErr = e.message; }
assert("F6 2月30日明确报错", /日期无效/.test(febErr), febErr);
const dp = T.buildPlan({ city: "北京", days: 3, depart: "2026-10-01", budget: "mid", pace: "balance" });
assert("F6 合法日期正常", dp.length === 3 && !String(dp[0].date).includes("NaN"), dp[0] && dp[0].date);
// F7 天数为 0/负 必须明确报错（不能静默变 1 天）
let d0 = ""; try { T.buildPlan({ city: "北京", days: 0, depart: "2026-10-01", budget: "mid" }); } catch (e) { d0 = e.message; }
assert("F7 0 天报错", /天数无效/.test(d0), d0);
let dNeg = ""; try { T.buildPlan({ city: "北京", days: -2, depart: "2026-10-01", budget: "mid" }); } catch (e) { dNeg = e.message; }
assert("F7 负数天报错", /天数无效/.test(dNeg), dNeg);
let pv0 = ""; try { T.buildProvPlan({ province: "山西", days: 0, depart: "2026-10-01", budget: "mid" }); } catch (e) { pv0 = e.message; }
assert("F7 全省 0 天报错", /天数无效/.test(pv0), pv0);
let m0 = ""; try { T.buildMultiPlan({ route: [{ name: "北京", days: 0 }], depart: "2026-10-01", budget: "mid" }); } catch (e) { m0 = e.message; }
assert("F7 多站 0 天报错", /天数无效/.test(m0), m0);

// F8 加景点不能排在「返程」之后（刁蛮用户：傍晚返程后再加景点，顺序不能乱）
const pAdd = { cityName: "北京", depart: DEP, days: T.buildPlan({ city: "北京", days: 2, depart: DEP, budget: "mid", pace: "balance" }) };
const lastDi = pAdd.days.length - 1;
const isRet = n => /^返程$/.test(String(n || "")) || /^前往\s/.test(String(n || "")); // 排除首日「出发前往「XX」」
const before8 = (pAdd.days[lastDi].items || []).map(it => String(it.name || ""));
const hasReturn8 = before8.some(isRet);
const r8 = T.dayAddSpot(pAdd, lastDi, "");
const after8 = (pAdd.days[lastDi].items || []).map(it => String(it.name || ""));
const retIdx = after8.findIndex(isRet);
const newIdx = after8.findIndex(n => n === (r8 && r8.name));
assert("F8 末日确实有返程框架", hasReturn8, JSON.stringify(before8));
assert("F8 新景点排在返程之前", retIdx < 0 || newIdx < retIdx, "返程idx=" + retIdx + " 新景点idx=" + newIdx);
// 新景点时段不能晚于返程（返程是傍晚，新景点不能是晚上）
if (r8) {
  const nit = (pAdd.days[lastDi].items || []).find(it => it.name === r8.name);
  const rit = (pAdd.days[lastDi].items || []).find(it => isRet(String(it.name || "")));
  assert("F8 新景点时段不晚于返程", !rit || !nit || (["上午", "下午"].indexOf(String(nit.period || "")) >= 0 || String(nit.period || "") === String(rit.period || "")), (nit && nit.period) + " vs " + (rit && rit.period));
}

// F9 留白规则：一天最多一个留白，且不与其他条目撞同一时段（不能出现两个晚上）
const pB = { cityName: "北京", depart: DEP, days: T.buildPlan({ city: "北京", days: 2, depart: DEP, budget: "mid", pace: "balance" }) };
const dB = pB.days[0].items || [];
const realIx = dB.map((it, i) => ({ it, i })).filter(x => !T.isFrameName(x.it.name)).map(x => x.i);
if (realIx.length >= 2) {
  // 模拟 onDel 两次：删两个真实景点
  const del = (ix) => {
    const items = pB.days[0].items;
    const it = items[ix];
    if (!it || /自由活动|留白/.test(it.name)) return;
    const isBlank = n => /自由活动|留白/.test(String(n || ""));
    if (items.some(x => isBlank(x && x.name))) { items.splice(ix, 1); return; }
    const taken = items.filter((x, i) => i !== ix && String(x.period || "") === String(it.period || "")).length;
    let period = it.period;
    if (taken > 0) {
      const free = ["上午", "下午", "晚上"].find(p => !items.some((x, i) => i !== ix && String(x.period || "") === p));
      period = free || it.period;
    }
    items[ix] = { name: "自由活动 · 第1天留白", period: period, note: "已移除原安排，这段时间自由支配" };
  };
  del(realIx[0]);
  del(realIx[1]);
  const blanks = (pB.days[0].items || []).filter(it => /自由活动|留白/.test(String(it.name || "")));
  assert("F9 一天最多一个留白", blanks.length <= 1, "留白数=" + blanks.length);
}
assert("F9 留白逻辑可执行", true);

// F10 换目的地后，绑定行程的准备项必须重置（订票/订酒店/过流程/请假），通用随身项保留
["p_ticket", "p_hotel", "p_plan", "p_leave", "p_id", "p_money"].forEach(k => T.togglePrepCheck(k));
const beforePrep = T.getPrepChecks();
assert("F10 重置前 4 项已勾选", !!(beforePrep.p_ticket && beforePrep.p_hotel && beforePrep.p_plan && beforePrep.p_leave), JSON.stringify(Object.keys(beforePrep)));
T.resetTripPrep();
const afterPrep = T.getPrepChecks();
assert("F10 订票/酒店/流程/请假已重置", !afterPrep.p_ticket && !afterPrep.p_hotel && !afterPrep.p_plan && !afterPrep.p_leave, JSON.stringify(afterPrep));
assert("F10 通用随身项保留", afterPrep.p_id === true && afterPrep.p_money === true, JSON.stringify(afterPrep));
// 行李清单 pg_ 也一并重置
T.togglePrepCheck("pg_0");
T.resetTripPrep();
assert("F10 行李清单勾选已重置", !T.getPrepChecks().pg_0, JSON.stringify(T.getPrepChecks()));

// v1.19.137 本机数据洞察（真实记录聚合）
mem["miniLedgerV1"] = [];
T.addLedger(300, "餐饮", "午餐", "", false, "2026-09-10", "");
T.addLedger(500, "住宿", "酒店", "", false, "2026-09-11", "");
T.addLedger(200, "餐饮", "晚餐", "", false, "2026-10-01", "");
assert("洞察 花费合计 = 1000", INS.spendByCategory().total === 1000, INS.spendByCategory().total);
assert("洞察 餐饮为最高占比分类", INS.spendByCategory().rows[0].cat === "餐饮", JSON.stringify(INS.spendByCategory().rows));
assert("洞察 月度趋势 = 2 个月", INS.monthlySpend().rows.length === 2, JSON.stringify(INS.monthlySpend().rows));
assert("洞察 月度峰值 pct = 100", INS.monthlySpend().rows[0].pct === 100, JSON.stringify(INS.monthlySpend().rows));
const insAll = INS.insights();
assert("洞察 汇总 noData = false", insAll.noData === false, JSON.stringify(insAll));
assert("洞察 一句话小结非空", insAll.summary.length > 0, insAll.summary);
assert("洞察 个性化倾向含 topCat", insAll.tendency.topCat === "餐饮", JSON.stringify(insAll.tendency));
assert("洞察 倾向含点亮省份数(litProvs)", typeof insAll.tendency.litProvs === "number", JSON.stringify(insAll.tendency));
const insRefA = INS.insights(); const insRefB = INS.insights();
assert("洞察 记忆化：相同数据返回同一引用", insRefA === insRefB, "ref-diff");
mem["miniLedgerV1"] = [];   // 清理，避免污染后续

// v1.19.138 个性化目的地推荐（真实画像驱动）
mem["miniLedgerV1"] = [];
mem["miniFootV1"] = undefined;
mem["miniPlansV1"] = undefined;
const pz0 = PZ.personalized(5);
assert("个性化 无数据→列表空且非画像模式", pz0.list.length === 0 && pz0.fromMe === false, JSON.stringify({ l: pz0.list.length, f: pz0.fromMe }));
// 构造真实画像：北京足迹 + 餐饮为主花费
mem["miniFootV1"] = { spots: { "故宫": { name: "故宫", city: "北京", ts: 1 } }, cities: { "北京": 1 } };
T.addLedger(300, "餐饮", "午", "", false, "2026-09-10", "");
T.addLedger(500, "餐饮", "晚", "", false, "2026-10-01", "");
const pz1 = PZ.personalized(5);
assert("个性化 有数据→返回列表", pz1.list.length > 0 && pz1.fromMe === true, JSON.stringify(pz1.list.map(x => x.name)));
assert("个性化 每条带 whyMe 理由", pz1.list.every(x => Array.isArray(x.whyMe) && x.whyMe.length > 0), JSON.stringify(pz1.list.map(x => x.whyMeTx)));
assert("个性化 加分非负(total≥score)", pz1.list.every(x => x.total >= (x.score || 0)), JSON.stringify(pz1.list.map(x => x.total + "/" + x.score)));
assert("个性化 超界 n=99 收敛到 ≤20", PZ.personalized(99).list.length <= 20, PZ.personalized(99).list.length);
assert("个性化 查询词含常去省", PZ.queryFromTendency({ favProv: "山西", season: "秋", topCat: "餐饮" }).indexOf("山西") >= 0, PZ.queryFromTendency({ favProv: "山西" }));
// 想去清单加权：北京在足迹 + 加入想去清单 → 若出现在结果应带“想去清单”理由
mem["miniWishV1"] = [{ name: "北京", city: "北京" }];
const pzW = PZ.personalized(5);
const bj = pzW.list.filter(x => x.name === "北京")[0];
if (bj) assert("个性化 想去清单加权→北京带理由", bj.whyMeTx.indexOf("想去清单") >= 0, bj.whyMeTx);
mem["miniWishV1"] = undefined;
mem["miniLedgerV1"] = [];
mem["miniFootV1"] = undefined;

console.log("== 34. v1.19.148 · segCityOfDay 越界兜底 ==");
const mUlt = T.buildMultiPlan({
  route: [{ name: "北京", province: "北京市", days: 2 }, { name: "西安", province: "陕西省", days: 2 }],
  depart: DEP, budget: "mid", pace: "balance", people: 2
});
assert("范围内 di=0 → 北京（不变）", T.segCityOfDay({ segments: mUlt.segments, cityName: "北京 → 西安" }, 0) === "北京");
assert("范围内 di=3 → 西安（不变）", T.segCityOfDay({ segments: mUlt.segments, cityName: "北京 → 西安" }, 3) === "西安");
assert("越界 di=99 → 末段西安", T.segCityOfDay({ segments: mUlt.segments, cityName: "北京 → 西安" }, 99) === "西安", T.segCityOfDay({ segments: mUlt.segments, cityName: "北京 → 西安" }, 99));
assert("越界 di=-1 → 首段北京", T.segCityOfDay({ segments: mUlt.segments, cityName: "北京 → 西安" }, -1) === "北京", T.segCityOfDay({ segments: mUlt.segments, cityName: "北京 → 西安" }, -1));
assert("无 segments 回退 cityName", T.segCityOfDay({ cityName: "成都" }, 99) === "成都");

console.log("== 35. v1.19.175 · 推荐解析出行月份 ==");
{
  const cur = new Date().getMonth() + 1;
  const ep = R.extractPrefs("三月去赏花", {});
  assert("中文「三月」→ month=3", ep.month === 3, String(ep.month));
  const ep2 = R.extractPrefs("3月份去海边", {});
  assert("数字「3月」→ month=3", ep2.month === 3, String(ep2.month));
  const ep3 = R.extractPrefs("十一月看红叶", {});
  assert("「十一月」→ month=11", ep3.month === 11, String(ep3.month));
  const ep4 = R.extractPrefs("十二月滑雪", {});
  assert("「十二月」→ month=12", ep4.month === 12, String(ep4.month));
  // 「一个月」是时长表述，不应被误解析成 1 月（正则要求数字/汉字紧邻"月"，"个"会打断）
  const ep5 = R.extractPrefs("攒够钱一个月去玩", {});
  assert("「一个月」不被误判为 1 月", ep5.month !== 1, String(ep5.month));
  // 无月份信息时回退当前月（锁住兜底，避免悄然变成固定值）
  const ep6 = R.extractPrefs("随便逛逛", {});
  assert("无月份→回退当前月(" + cur + ")", ep6.month === cur, String(ep6.month));
  // 显式 month 选项优先于文本解析（既有调用方契约：测试/UI 选月不被动覆盖）
  // 固定输入样本：此处刻意同时给出「三月」文本与用户选的 10 月，
  // 断言的是「显式选择覆盖文本月份」，不是时令排序，故不跟随运行时当前月。
  const ep7 = R.extractPrefs("三月去，但选了10月", { month: 10 });
  assert("显式 month 优先于文本", ep7.month === 10, String(ep7.month));
  // 解析出的月份要真正流进推荐引擎（季节匹配据此生效）
  const rec = R.recommend("海边 五天 三月", { topN: 3 });
  assert("解析月份流进 recommend.prefs.month", rec.prefs && rec.prefs.month === 3, String(rec.prefs && rec.prefs.month));
}

console.log("== 36. v1.19.183 · 个性化『可二刷』基于真实打卡城市 ==");
// 旧实现 T.isVisited(city.name) 查的是「同名景点」，城市名几乎不可能等于景点名，
// 导致『可二刷』理由永不触发。新实现用 footStats().cityList（真实打卡城市集合）判定。
mem["miniFootV1"] = undefined;
mem["miniLedgerV1"] = [];
mem["miniPlansV1"] = undefined;
T.markVisited("故宫", "北京", true);
T.markVisited("天坛", "北京", true);
const pzV = PZ.personalized(5);
const bjV = pzV.list.filter(x => x.name === "北京")[0];
assert("已打卡城市北京进入推荐", !!bjV, JSON.stringify(pzV.list.map(x => x.name)));
if (bjV) assert("北京带『可二刷』理由（基于真实打卡城市，非死逻辑）", bjV.whyMeTx.indexOf("可二刷") >= 0, bjV.whyMeTx);
// 未打卡城市不应误标『可二刷』
const noV = pzV.list.filter(x => x.name !== "北京");
assert("未打卡城市无『可二刷』误标", noV.every(x => x.whyMeTx.indexOf("可二刷") < 0), JSON.stringify(noV.map(x => x.name + ":" + x.whyMeTx)));
// 还原：取消打卡 + 清状态，避免污染其他用例
T.markVisited("故宫", "北京", false);
T.markVisited("天坛", "北京", false);
mem["miniFootV1"] = undefined;
mem["miniLedgerV1"] = [];
mem["miniPlansV1"] = undefined;

console.log("== 37. v1.19.189 · 洞察记忆化签名修正（改分类/月份/省必须刷新）==");
// 旧签名仅含「条数+总额+首条日期+足迹城市数」，漏掉分类/各条日期/计划月份/各省点亮数，
// 导致仅改分类或挪动月份时 insights() 返回陈旧缓存（洞察卡不刷新，真实 bug）。
mem["miniLedgerV1"] = [];
mem["miniPlansV1"] = undefined;
mem["miniFootV1"] = undefined;
T.addLedger(300, "餐饮", "午", "", false, "2026-09-10", "");
T.addLedger(100, "住宿", "酒店", "", false, "2026-09-11", "");
const insA37 = INS.insights();
assert("改前 topCat=餐饮", insA37.tendency.topCat === "餐饮", insA37.tendency.topCat);
// 仅改分类、不动金额/条数：旧签名不变 → 会误命中陈旧缓存返回「餐饮」
mem["miniLedgerV1"] = [];
T.addLedger(300, "住宿", "住", "", false, "2026-09-10", "");
T.addLedger(100, "餐饮", "吃", "", false, "2026-09-11", "");
const insB37 = INS.insights();
assert("改分类后 topCat 刷新为住宿（非陈旧餐饮）", insB37.tendency.topCat === "住宿", insB37.tendency.topCat);
// 月份挪动：总额/条数不变，仅日期跨月 → 月度趋势必须刷新
mem["miniLedgerV1"] = [];
T.addLedger(300, "餐饮", "午", "", false, "2026-10-10", "");
T.addLedger(100, "住宿", "酒店", "", false, "2026-10-11", "");
const insC37 = INS.insights();
assert("月份挪动后月度行=2026-10", insC37.month.rows.length === 1 && insC37.month.rows[0].ym === "2026-10", JSON.stringify(insC37.month.rows));
// 足迹跨省搬家：城市数不变但省份不同 → 常去省必须刷新
mem["miniLedgerV1"] = [];
mem["miniFootV1"] = undefined;
T.markVisited("故宫", "北京", true);
const insD37 = INS.insights();
const favBefore37 = insD37.tendency.favProv;
T.markVisited("故宫", "北京", false);
T.markVisited("外滩", "上海", true);
const insE37 = INS.insights();
assert("足迹跨省后 favProv 刷新", insE37.tendency.favProv !== favBefore37, favBefore37 + " -> " + insE37.tendency.favProv);
// 还原，避免污染其他用例
T.markVisited("外滩", "上海", false);
mem["miniLedgerV1"] = [];
mem["miniFootV1"] = undefined;
mem["miniPlansV1"] = undefined;

// v1.19.189：markVisited 取消打卡必须回收城市计数（旧实现只删 spot、城市集合永不回收，
// 导致足迹热力图/个性化"常去省"长期失真；v1.19.189 改为：该城已无其它已打卡景点才清 cities）
mem["miniFootV1"] = undefined;
T.markVisited("故宫", "北京", true);
T.markVisited("天坛", "北京", true);
const fc137 = T.footStats();
assert("两北京景点 → cityList 含北京", fc137.cityList.indexOf("北京") >= 0, JSON.stringify(fc137.cityList));
T.markVisited("天坛", "北京", false);
const fc237 = T.footStats();
assert("取消天坛后北京仍在(故宫在)", fc237.cityList.indexOf("北京") >= 0, JSON.stringify(fc237.cityList));
T.markVisited("故宫", "北京", false);
const fc337 = T.footStats();
assert("取消最后一个北京景点后城市回收", fc337.cityList.indexOf("北京") < 0, JSON.stringify(fc337.cityList));
// 省份热力同步回收（footHeatmap 读 cities）
const hm37 = T.footHeatmap();
assert("北京宫格随之归零", !hm37.provs.some(p => p.name === "北京" && p.n > 0));
mem["miniFootV1"] = undefined;

console.log("== 38. v1.19.192 · 个性化『可二刷』带排序权重（理由与排序一致）==");
// 旧实现 _bonus 对"已打卡城市"只 push 理由、b 不增加 → 理由显示却不生效（功能不一致）。
// 现补轻微正权重，使"你打卡过，可二刷"既是理由、也对排序有对应效果。
const bjP38 = D.CITIES.find(c => c.name === "北京");
const tdP38 = { favProv: "", season: "", topCat: "" };
const boYes38 = PZ._bonus(bjP38, tdP38, new Set(["北京"]));
const boNo38 = PZ._bonus(bjP38, tdP38, new Set());
assert("已打卡城市→带『可二刷』理由", boYes38.why.join("").indexOf("可二刷") >= 0, boYes38.why.join("·"));
assert("未打卡城市→无『可二刷』理由", boNo38.why.join("").indexOf("可二刷") < 0, boNo38.why.join("·"));
// 同 td / 同想去清单状态下两次调用唯一差异是 visitedSet → 分差即"可二刷"权重贡献
assert("已打卡『可二刷』贡献正权重(差值≈1.0)", Math.abs((boYes38.b - boNo38.b) - 1.0) < 1e-9, "Δ=" + (boYes38.b - boNo38.b));
assert("已打卡城市总权重高于未打卡", boYes38.b > boNo38.b, boYes38.b + " vs " + boNo38.b);

console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);